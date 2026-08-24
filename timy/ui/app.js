/* Timy.ai front end.
 *
 * Vanilla JS on purpose: no build step, no node_modules, no CDN. It runs on an
 * isolated network, it is one file to debug, and it will still work in two
 * years without a dependency upgrade. For a homelab tool that is the right
 * trade -- reach for a framework when the UI needs more than this.
 *
 * Conversations live in localStorage, so the server stores nothing. That keeps
 * the privacy claim honest and means there is no database to back up.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    thread: $("thread"), welcome: $("welcome"), input: $("input"),
    send: $("send"), stop: $("stop"), newChat: $("newChat"),
    convoList: $("convoList"), modelSelect: $("modelSelect"),
    useKnowledge: $("useKnowledge"), statusDot: $("statusDot"),
    statusText: $("statusText"), kbLine: $("kbLine"), tagline: $("tagline"),
    themeToggle: $("themeToggle"), themeLabel: $("themeLabel"),
    menuToggle: $("menuToggle"), sidebar: $("sidebar"),
    suggestions: $("suggestions"),
  };

  const LS_CONVOS = "timy.convos";
  const LS_THEME = "timy.theme";
  const LS_MODEL = "timy.model";

  let convos = [];        // [{id, title, messages:[{role,content,meta,sources}]}]
  let activeId = null;
  let controller = null;  // AbortController for the in-flight request

  // ---------- storage (all guarded: private windows throw) ----------
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  // ---------- theme ----------
  function applyTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    el.themeLabel.textContent = mode === "dark" ? "Light" : "Dark";
    save(LS_THEME, mode);
  }
  function initTheme() {
    let mode = load(LS_THEME, null);
    if (!mode) {
      mode = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(mode);
  }
  el.themeToggle.addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
  });

  // ---------- markdown (deliberately small) ----------
  // Enough for what a chat model emits: fences, inline code, headings, lists,
  // tables, bold/italic, links, blockquotes, and [file.md] citations.
  // Everything is escaped first, so this cannot inject HTML.
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function renderMarkdown(src) {
    const fences = [];
    // Pull fenced code out first so nothing else touches its contents.
    let text = src.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
      fences.push(`<pre><code data-lang="${escapeHtml(lang)}">${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`);
      return ` FENCE${fences.length - 1} `;
    });

    text = escapeHtml(text);

    const lines = text.split("\n");
    const out = [];
    let listType = null;      // "ul" | "ol" | null
    let inQuote = false;
    let tableRows = null;

    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };
    const flushTable = () => {
      if (!tableRows) return;
      const [head, ...body] = tableRows;
      out.push("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead>");
      if (body.length) {
        out.push("<tbody>" + body.map((r) =>
          "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody>");
      }
      out.push("</table>");
      tableRows = null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // table row
      if (/^\s*\|.*\|\s*$/.test(line)) {
        const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        // a separator row (|---|---|) just confirms the header
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        closeList(); closeQuote();
        (tableRows ||= []).push(cells);
        continue;
      }
      flushTable();

      if (!line.trim()) { closeList(); closeQuote(); continue; }

      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        closeList(); closeQuote();
        const lvl = Math.min(m[1].length + 1, 4);
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
        closeQuote();
        if (listType !== "ul") { closeList(); out.push("<ul>"); listType = "ul"; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        closeQuote();
        if (listType !== "ol") { closeList(); out.push("<ol>"); listType = "ol"; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
        closeList();
        if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
        out.push(`<p>${inline(m[1])}</p>`);
      } else if (/^ FENCE\d+ $/.test(line.trim())) {
        closeList(); closeQuote();
        out.push(line.trim());
      } else {
        closeList(); closeQuote();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList(); closeQuote(); flushTable();

    let html = out.join("\n");
    html = html.replace(/ FENCE(\d+) /g, (_m, i) => fences[Number(i)]);
    return html;
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
               '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      // Citations like [handbook.md] -- only when it looks like a filename, so
      // ordinary bracketed prose is left alone.
      .replace(/\[([\w./-]+\.(?:md|txt|markdown))\]/gi, '<span class="cite">$1</span>');
  }

  // ---------- conversations ----------
  function newConvo() {
    const c = { id: String(Date.now()), title: "New conversation", messages: [] };
    convos.unshift(c);
    activeId = c.id;
    persist();
    renderConvoList();
    renderThread();
    el.input.focus();
  }

  function activeConvo() { return convos.find((c) => c.id === activeId); }
  function persist() { save(LS_CONVOS, convos); }

  function renderConvoList() {
    el.convoList.innerHTML = "";
    for (const c of convos) {
      const b = document.createElement("button");
      b.className = "convo" + (c.id === activeId ? " active" : "");
      b.setAttribute("role", "listitem");
      const s = document.createElement("span");
      s.textContent = c.title;
      const d = document.createElement("button");
      d.className = "del"; d.textContent = "×";
      d.title = "Delete";
      d.addEventListener("click", (e) => {
        e.stopPropagation();
        convos = convos.filter((x) => x.id !== c.id);
        if (activeId === c.id) activeId = convos[0]?.id ?? null;
        persist();
        renderConvoList();
        if (!activeId) newConvo(); else renderThread();
      });
      b.append(s, d);
      b.addEventListener("click", () => {
        activeId = c.id; renderConvoList(); renderThread();
        el.sidebar.classList.remove("open");
      });
      el.convoList.appendChild(b);
    }
  }

  function renderThread() {
    const c = activeConvo();
    el.thread.innerHTML = "";
    if (!c || !c.messages.length) {
      el.thread.appendChild(el.welcome);
      el.welcome.classList.remove("hidden");
      return;
    }
    for (const m of c.messages) el.thread.appendChild(turnNode(m));
    scrollDown();
  }

  function turnNode(msg) {
    const wrap = document.createElement("div");
    wrap.className = `turn ${msg.role}`;

    const head = document.createElement("div");
    head.className = "turn-head";
    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = msg.role === "user" ? "Y" : "T";
    head.append(av, document.createTextNode(msg.role === "user" ? "You" : "Timy"));
    wrap.appendChild(head);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (msg.role === "user") bubble.textContent = msg.content;
    else bubble.innerHTML = renderMarkdown(msg.content || "");
    wrap.appendChild(bubble);

    if (msg.sources?.length) wrap.appendChild(sourcesNode(msg.sources));
    if (msg.meta) wrap.appendChild(metaNode(msg));
    return wrap;
  }

  function sourcesNode(sources) {
    const box = document.createElement("div");
    box.className = "sources";
    const label = document.createElement("span");
    label.className = "sources-label";
    label.textContent = "Sources";
    box.appendChild(label);
    for (const s of sources) {
      const chip = document.createElement("span");
      chip.className = "source-chip";
      chip.textContent = s.doc + (s.heading ? ` › ${s.heading}` : "");
      // Show the retrieval score on hover: when a citation looks wrong, the
      // score usually explains why.
      chip.title = `similarity ${s.score}\n\n${(s.text || "").slice(0, 300)}…`;
      box.appendChild(chip);
    }
    return box;
  }

  function metaNode(msg) {
    const box = document.createElement("div");
    box.className = "meta";
    const t = document.createElement("span");
    t.className = "timings";
    const m = msg.meta;
    // These timings are not trivia on self-hosted CPU inference: a TTFT that
    // has quietly tripled is how you notice a node throttling or swapping.
    t.textContent = `${m.ttft_ms} ms to first token · ${m.tokens} tokens · ${m.tok_per_s} tok/s`;
    box.appendChild(t);

    const rate = document.createElement("div");
    rate.className = "rate";
    for (const [kind, glyph] of [["up", "✓"], ["down", "✗"]]) {
      const b = document.createElement("button");
      b.textContent = glyph;
      b.dataset.kind = kind;
      b.title = kind === "up" ? "Good answer" : "Bad answer";
      if (msg.rating === kind) b.classList.add("on");
      b.addEventListener("click", () => sendFeedback(msg, kind, rate));
      rate.appendChild(b);
    }
    box.appendChild(rate);
    return box;
  }

  async function sendFeedback(msg, rating, rateEl) {
    msg.rating = rating;
    persist();
    [...rateEl.children].forEach((b) => {
      b.classList.toggle("on", b.dataset.kind === rating);
    });
    const c = activeConvo();
    const idx = c.messages.indexOf(msg);
    const question = idx > 0 ? c.messages[idx - 1].content : "";
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating, question, answer: msg.content, model: msg.meta?.model || "",
        }),
      });
    } catch { /* feedback is best-effort; never interrupt the user */ }
  }

  function scrollDown() { el.thread.scrollTop = el.thread.scrollHeight; }

  // ---------- sending ----------
  async function sendMessage(text) {
    text = (text ?? el.input.value).trim();
    if (!text || controller) return;

    let c = activeConvo();
    if (!c) { newConvo(); c = activeConvo(); }

    c.messages.push({ role: "user", content: text });
    if (c.messages.length === 1) {
      c.title = text.length > 42 ? text.slice(0, 42) + "…" : text;
      renderConvoList();
    }
    el.input.value = "";
    autosize();
    el.welcome.classList.add("hidden");
    if (el.welcome.parentNode === el.thread) el.thread.removeChild(el.welcome);
    el.thread.appendChild(turnNode(c.messages[c.messages.length - 1]));

    // Placeholder assistant turn we stream into.
    const reply = { role: "assistant", content: "", sources: [], meta: null };
    const node = turnNode(reply);
    const bubble = node.querySelector(".bubble");
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    bubble.appendChild(cursor);
    el.thread.appendChild(node);
    scrollDown();

    setBusy(true);
    controller = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: c.messages.map(({ role, content }) => ({ role, content })),
          model: el.modelSelect.value || undefined,
          use_knowledge: el.useKnowledge.checked,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`server returned ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // SSE frames are separated by a blank line.
        let split;
        while ((split = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, split);
          buf = buf.slice(split + 2);
          let event = "message", data = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          let payload;
          try { payload = JSON.parse(data); } catch { continue; }

          if (event === "token") {
            reply.content += payload.t;
            bubble.innerHTML = renderMarkdown(reply.content);
            bubble.appendChild(cursor);
            scrollDown();
          } else if (event === "sources") {
            reply.sources = payload.sources || [];
            reply.model = payload.model;
            if (reply.sources.length) node.appendChild(sourcesNode(reply.sources));
          } else if (event === "done") {
            reply.meta = { ...payload, model: reply.model };
          } else if (event === "error") {
            cursor.remove();
            bubble.innerHTML = "";
            const box = document.createElement("div");
            box.className = "err";
            const strong = document.createElement("strong");
            strong.textContent = payload.message || "Something went wrong";
            box.appendChild(strong);
            if (payload.detail) {
              const d = document.createElement("div");
              d.style.marginTop = "6px";
              const code = document.createElement("code");
              code.textContent = String(payload.detail).slice(0, 500);
              d.appendChild(code);
              box.appendChild(d);
            }
            bubble.appendChild(box);
            reply.content = `**Error:** ${payload.message || "request failed"}`;
          }
        }
      }
    } catch (e) {
      cursor.remove();
      if (e.name === "AbortError") {
        reply.content += "\n\n_(stopped)_";
        bubble.innerHTML = renderMarkdown(reply.content);
      } else {
        bubble.innerHTML = "";
        const box = document.createElement("div");
        box.className = "err";
        const strong = document.createElement("strong");
        strong.textContent = "Could not reach Timy";
        const d = document.createElement("div");
        d.style.marginTop = "6px";
        const code = document.createElement("code");
        code.textContent = e.message;
        d.appendChild(code);
        box.append(strong, d);
        bubble.appendChild(box);
        reply.content = `**Error:** ${e.message}`;
      }
    } finally {
      cursor.remove();
      controller = null;
      setBusy(false);
      c.messages.push(reply);
      persist();
      if (reply.meta) node.appendChild(metaNode(reply));
      scrollDown();
      el.input.focus();
    }
  }

  function setBusy(busy) {
    el.send.classList.toggle("hidden", busy);
    el.stop.classList.toggle("hidden", !busy);
  }

  // ---------- health ----------
  async function refreshHealth() {
    try {
      const r = await fetch("/api/health");
      const h = await r.json();
      el.tagline.textContent = h.tagline || "";
      document.title = `${h.name || "Timy"}.ai`;

      const up = h.upstream || {};
      el.statusDot.className = "dot " + (up.reachable ? "ok" : "bad");
      el.statusText.textContent = up.reachable
        ? `cluster online · ${up.models.length} model${up.models.length === 1 ? "" : "s"}`
        : "cluster unreachable";
      if (!up.reachable && up.error) el.statusText.title = up.error;

      // Model list, preferring what the gateway actually reports.
      const wanted = up.models?.length ? up.models
                   : [h.default_model, h.fast_model].filter(Boolean);
      const previous = load(LS_MODEL, null) || h.default_model;
      const current = el.modelSelect.value;
      el.modelSelect.innerHTML = "";
      for (const m of wanted) {
        const o = document.createElement("option");
        o.value = m; o.textContent = m;
        if (m === (current || previous)) o.selected = true;
        el.modelSelect.appendChild(o);
      }

      const kbs = h.knowledge || {};
      el.kbLine.textContent = kbs.available
        ? `knowledge: ${kbs.chunks} chunks · ${kbs.documents.length} docs`
        : `knowledge: off (${kbs.reason || "unavailable"})`;
    } catch {
      el.statusDot.className = "dot bad";
      el.statusText.textContent = "API unreachable";
    }
  }

  // ---------- input handling ----------
  function autosize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px";
  }
  el.input.addEventListener("input", autosize);
  el.input.addEventListener("keydown", (e) => {
    // Enter sends, Shift+Enter makes a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  });
  el.send.addEventListener("click", () => sendMessage());
  el.stop.addEventListener("click", () => controller?.abort());
  el.newChat.addEventListener("click", newConvo);
  el.modelSelect.addEventListener("change", () => save(LS_MODEL, el.modelSelect.value));
  el.menuToggle.addEventListener("click", () => el.sidebar.classList.toggle("open"));
  el.suggestions.addEventListener("click", (e) => {
    const q = e.target.closest("button")?.dataset.q;
    if (q) sendMessage(q);
  });

  // ---------- boot ----------
  initTheme();
  convos = load(LS_CONVOS, []);
  if (!Array.isArray(convos) || !convos.length) { convos = []; newConvo(); }
  else { activeId = convos[0].id; renderConvoList(); renderThread(); }
  refreshHealth();
  setInterval(refreshHealth, 30000);
})();
