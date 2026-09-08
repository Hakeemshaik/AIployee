/* Collections Console -- upload, dispatch in batches, resync, redial. */

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const state = { screen: 'home', campaignId: null, campaign: null, tenants: [], job: null, poll: null };

/* ---------------- helpers ---------------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rand = (n) => (n === null || n === undefined ? '--' : 'R' + Math.round(n).toLocaleString('en-ZA'));
const pct = (n) => (n === null || n === undefined ? '--' : n + '%');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '--');

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = msg;
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), isError ? 7000 : 3800);
}

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData)
      ? { 'Content-Type': 'application/json', ...opts.headers } : opts.headers,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body;
}

function tile(k, v, cls = '', sub = '') {
  return `<div class="tile"><span class="k">${esc(k)}</span>
    <span class="v ${cls}">${esc(v)}</span>
    ${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
}

/* ---------------- home ---------------- */

async function renderHome() {
  state.screen = 'home'; state.campaignId = null; stopPolling();
  $('#crumb').innerHTML = '';
  const { campaigns } = await api('/campaigns');

  view.innerHTML = `
    <div class="drop" id="drop">
      <h2>Drop a spreadsheet to start a campaign</h2>
      <p>Any layout. The columns are detected, the data is cleaned, and you approve it before anything dials.</p>
      <div class="formats">
        .xlsx &middot; .xls &middot; .csv &nbsp;|&nbsp; headers matched automatically, or one of the eight known age-analysis layouts
      </div>
      <input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>
    </div>

    <div class="card" style="margin-top:22px">
      <div class="card-head"><h3>Campaigns</h3><div class="spacer"></div>
        <span class="label">${campaigns.length} total</span></div>
      ${campaigns.length ? `<div class="card-body tight"><div class="scroller"><table>
        <thead><tr><th>Campaign</th><th>Code</th><th class="r">Tenants</th><th class="r">Book</th>
          <th class="r">Batches</th><th class="r">Dispatched</th><th class="r">Reached</th><th>Created</th><th></th></tr></thead>
        <tbody>${campaigns.map((c) => `<tr>
          <td class="ink">${esc(c.name)}</td>
          <td><span class="chip neutral">${esc(c.code)}</span></td>
          <td class="r num">${c.tenants}</td>
          <td class="r num">${rand(c.bookValue)}</td>
          <td class="r num">${c.batchesRun}/${c.batches}</td>
          <td class="r num">${c.dispatched}</td>
          <td class="r num">${c.reached}</td>
          <td class="num" style="font-size:.76rem">${when(c.createdAt)}</td>
          <td class="r"><button class="btn sm" data-open="${esc(c.id)}">Open</button></td>
        </tr>`).join('')}</tbody></table></div></div>`
        : '<div class="empty">No campaigns yet. Upload a spreadsheet above.</div>'}
    </div>`;

  wireDropzone();
  view.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', () => openCampaign(b.dataset.open)));
}

function wireDropzone() {
  const drop = $('#drop'), file = $('#file');
  if (!drop) return;
  drop.addEventListener('click', () => file.click());
  file.addEventListener('change', () => file.files[0] && uploadFile(file.files[0]));
  ['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => {
    ev.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => {
    ev.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (ev) => {
    const f = ev.dataTransfer?.files?.[0];
    if (f) uploadFile(f);
  });
}

async function uploadFile(f) {
  const drop = $('#drop');
  if (drop) drop.innerHTML = `<h2>Reading ${esc(f.name)}</h2><p class="muted">Detecting layout and cleaning rows&hellip;</p>`;
  try {
    const fd = new FormData();
    fd.append('file', f);
    const { campaign } = await api('/upload', { method: 'POST', body: fd });
    openCampaign(campaign.id);
  } catch (err) {
    toast(err.message, true);
    renderHome();
  }
}

/* ---------------- campaign ---------------- */

async function openCampaign(id) {
  stopPolling();
  state.campaignId = id;
  const { campaign, tenants } = await api('/campaigns/' + id);
  state.campaign = campaign; state.tenants = tenants;
  state.screen = campaign.status === 'draft' ? 'review' : 'campaign';
  render();
}

async function refresh() {
  if (!state.campaignId) return;
  const { campaign, tenants } = await api('/campaigns/' + state.campaignId);
  state.campaign = campaign; state.tenants = tenants;
  render();
}

function render() {
  if (state.screen === 'review') return renderReview();
  if (state.screen === 'campaign') return renderCampaign();
  return renderHome();
}

/* ---------------- review (approve before dialling) ---------------- */

function renderReview() {
  const c = state.campaign, q = c.quality;
  $('#crumb').innerHTML = `<span class="chip live">Draft</span><span class="muted">${esc(c.sourceFile)}</span>`;

  view.innerHTML = `
    <div class="card">
      <div class="card-head">
        <h3>Check this before anything dials</h3><div class="spacer"></div>
        <span class="chip neutral">${esc(c.formatLabel)}</span>
        ${c.sheetName ? `<span class="chip neutral">sheet: ${esc(c.sheetName)}</span>` : ''}
      </div>
      <div class="tiles">
        ${tile('Rows parsed', q.parsed)}
        ${tile('Callable tenants', q.callable, 'hl')}
        ${tile('Book value', rand(q.bookValue))}
        ${tile('No usable number', q.noPhone, q.noPhone ? 'warn' : '', q.noPhone ? rand(q.noPhoneValue) + ' unreachable' : '')}
        ${tile('Duplicates merged', q.duplicatesMerged, '', q.duplicatesMerged ? 'kept highest balance' : '')}
        ${tile('Multi-unit tenants', q.multiUnit, '', q.multiUnit ? 'full exposure listed' : '')}
        ${tile('Missing unit', q.missingUnit, q.missingUnit ? 'warn' : '')}
        ${tile('Rejected rows', c.rejectedCount, c.rejectedCount ? 'warn' : '')}
      </div>

      ${q.noPhone ? `<details class="qa"><summary>${q.noPhone} tenants have no usable mobile number &mdash; ${rand(q.noPhoneValue)}</summary>
        <div class="scroller"><table><thead><tr><th>Name</th><th>Unit</th><th>Building</th><th class="r">Owed</th><th>Problem</th><th class="r">Row</th></tr></thead>
        <tbody>${q.noPhoneList.map((r) => `<tr><td class="ink">${esc(r.name)}</td><td>${esc(r.unit || '--')}</td>
          <td>${esc(r.building || '--')}</td><td class="r num">${rand(r.amount)}</td>
          <td><span class="chip warn">${esc(r.reason)}</span></td><td class="r num">${r.row}</td></tr>`).join('')}</tbody>
        </table></div></details>` : ''}

      ${q.multiUnit ? `<details class="qa"><summary>${q.multiUnit} tenants hold more than one unit</summary>
        <div class="scroller"><table><thead><tr><th>Name</th><th>Phone</th><th class="r">Called on</th><th>Other units</th><th class="r">Combined</th></tr></thead>
        <tbody>${q.multiUnitList.map((r) => `<tr><td class="ink">${esc(r.name)}</td><td class="num">${esc(r.phone)}</td>
          <td class="r num">${rand(r.primary)}</td>
          <td class="num" style="font-size:.76rem">${esc(r.alsoHolds.map((u) => `${u.unit || '?'} (${rand(u.amount)})`).join(', '))}</td>
          <td class="r num">${rand(r.combined)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><h3>Set up the run</h3></div>
      <div class="card-body">
        <div class="grid2">
          <div class="field"><label class="label" for="cname">Campaign name</label>
            <input id="cname" value="${esc(c.name)}"></div>
          <div class="field"><label class="label" for="ccode">Campaign code</label>
            <input id="ccode" value="${esc(c.code)}">
            <span class="hint">Written to the <span class="mono">call</span> field. Each batch becomes <span class="mono">${esc(c.code)}-B1</span>, <span class="mono">-B2</span> and so on, so a campaign stays filterable.</span></div>
          <div class="field"><label class="label" for="bsize">Batch size</label>
            <input id="bsize" type="number" min="1" max="1000" value="${c.batchSize}">
            <span class="hint">How many tenants go out per run. Highest balance first.</span></div>
        </div>
        <div class="note" id="split">&nbsp;</div>
        <div class="row" style="margin-top:16px">
          <button class="btn primary" id="btn-confirm">Create batches</button>
          <a class="btn ghost" href="/api/campaigns/${esc(c.id)}/export/review.xlsx">Download review sheet</a>
          <button class="btn ghost danger" id="btn-discard">Discard</button>
        </div>
      </div>
    </div>`;

  const updateSplit = () => {
    const size = Math.max(1, Number($('#bsize').value) || 1);
    const n = Math.ceil(q.callable / size);
    const last = q.callable % size || size;
    $('#split').innerHTML = `<strong>${q.callable}</strong> tenants split into <strong>${n}</strong> ${n === 1 ? 'batch' : 'batches'} of ${size}${n > 1 ? ` (the last holds ${last})` : ''}.`;
  };
  $('#bsize').addEventListener('input', updateSplit);
  updateSplit();

  $('#btn-confirm').addEventListener('click', async () => {
    try {
      await api(`/campaigns/${c.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          name: $('#cname').value, code: $('#ccode').value, batchSize: Number($('#bsize').value),
        }),
      });
      toast('Batches created.');
      openCampaign(c.id);
    } catch (err) { toast(err.message, true); }
  });

  $('#btn-discard').addEventListener('click', async () => {
    if (!confirm('Discard this draft? The uploaded rows are removed.')) return;
    await api('/campaigns/' + c.id, { method: 'DELETE' });
    renderHome();
  });
}

/* ---------------- campaign (batches, resync, redial) ---------------- */

const BATCH_CHIP = {
  pending: 'neutral', dispatching: 'live', dispatched: 'warn', complete: 'good',
};

function renderCampaign() {
  const c = state.campaign, s = c.stats, q = c.quality;
  $('#crumb').innerHTML = `<span class="chip neutral">${esc(c.code)}</span><span class="muted">${esc(c.name)}</span>`;

  const nextPending = c.batches.find((b) => b.status === 'pending');
  const anyRunning = c.batches.some((b) => b.status === 'dispatching');
  const canRedial = Boolean(c.resync) && s.notReached > 0;

  view.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Where this campaign stands</h3><div class="spacer"></div>
        <span class="label">${c.resync ? 'Last resync ' + when(c.resync.lastAt) : 'Never resynced'}</span></div>
      <div class="tiles">
        ${tile('Tenants in book', s.tenants)}
        ${tile('Book value', rand(s.bookValue))}
        ${tile('Dispatched', s.dispatched, 'hl')}
        ${tile('Dialled', s.dialled, '', c.resync ? '' : 'resync to fill')}
        ${tile('Reached', s.reached, 'hl')}
        ${tile('Contact rate', pct(s.contactRate), 'hl', 'of dispatched')}
        ${tile('Not reached', s.notReached, s.notReached ? 'warn' : '')}
        ${tile('Dead numbers', s.dead, s.dead ? 'crit' : '', s.dead ? rand(s.deadValue) + ' stuck' : '')}
      </div>
      ${s.awaitingDial > 0 && c.resync ? `<div style="padding:14px 20px 18px"><div class="note crit">
        <strong>${s.awaitingDial} tenants were sent to the platform but never dialled</strong> &mdash; ${rand(c.resync.neverDialledValue)} of book.
        This is the gap that has silently swallowed a whole batch before. Check the platform before running the next batch.
      </div></div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><h3>Batches</h3><div class="spacer"></div>
        <button class="btn sm" id="btn-resync" ${anyRunning ? 'disabled' : ''}>Resync live outcomes</button>
      </div>
      <div id="job-panel"></div>
      <div class="card-body tight"><div class="scroller"><table>
        <thead><tr><th>Batch</th><th>Code</th><th>Type</th><th class="r">Size</th><th class="r">Value</th>
          <th class="r">Sent</th><th class="r">Failed</th><th class="r">Dialled</th><th class="r">Reached</th>
          <th>Status</th><th></th></tr></thead>
        <tbody>${c.batches.map((b) => {
    const ids = new Set(b.tenantIds || []);
    const members = state.tenants.filter((t) => ids.has(t.id));
    const dialled = members.filter((t) => (t.call?.calls || 0) > 0).length;
    const reached = members.filter((t) => t.call?.reached).length;
    const isNext = nextPending && b.no === nextPending.no;
    return `<tr>
          <td class="ink num">${b.no}</td>
          <td class="num" style="font-size:.78rem">${esc(b.code)}</td>
          <td>${b.kind === 'redial' ? `<span class="chip warn">redial R${b.round}</span>` : '<span class="chip neutral">initial</span>'}</td>
          <td class="r num">${b.size}</td>
          <td class="r num">${rand(b.value)}</td>
          <td class="r num">${b.dispatched || 0}</td>
          <td class="r num">${b.failed ? `<span class="chip crit">${b.failed}</span>` : '0'}</td>
          <td class="r num">${dialled || '--'}</td>
          <td class="r num">${reached || '--'}</td>
          <td><span class="chip ${BATCH_CHIP[b.status] || 'neutral'}">${esc(b.status)}</span></td>
          <td class="r"><div class="row" style="justify-content:flex-end;gap:6px">
            <a class="btn sm ghost" href="/api/campaigns/${esc(c.id)}/export/import.xlsx?batch=${b.no}">.xlsx</a>
            ${b.status === 'pending'
      ? `<button class="btn sm ${isNext ? 'primary' : ''}" data-run="${b.no}" ${anyRunning ? 'disabled' : ''}>Run batch ${b.no}</button>`
      : b.status === 'dispatching' ? '<span class="chip live">running</span>'
        : `<button class="btn sm ghost" data-rerun="${b.no}">Re-send</button>`}
          </div></td></tr>`;
  }).join('')}</tbody></table></div></div>
      ${nextPending ? `<div style="padding:14px 20px"><div class="note">
        Next up: <strong>batch ${nextPending.no}</strong> &mdash; ${nextPending.size} tenants, ${rand(nextPending.value)}.
        Batches of the same type run in order, so the one after it waits until this run finishes.</div></div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><h3>Redial round</h3><div class="spacer"></div>
        ${c.resync ? '' : '<span class="label">resync first</span>'}</div>
      <div class="card-body">
        ${c.resync ? `
          <div class="grid2">
            <div class="field"><label class="label" for="cap">Attempt cap</label>
              <input id="cap" type="number" min="1" max="10" value="4">
              <span class="hint">Nobody is dialled more times than this in total.</span></div>
            <div class="field"><label class="label" for="rsize">Batch size</label>
              <input id="rsize" type="number" min="1" max="1000" value="${c.batchSize}"></div>
          </div>
          <div class="row"><button class="btn" id="btn-preview">Preview who qualifies</button>
            <button class="btn primary" id="btn-redial" ${canRedial ? '' : 'disabled'}>Create redial batches</button></div>
          <div id="redial-out" style="margin-top:14px"></div>`
    : '<div class="note warn">Resync the campaign first. The redial list is built from live call outcomes, never from the platform\'s own outcome fields.</div>'}
      </div>
    </div>

    ${c.decay?.length ? `<div class="card">
      <div class="card-head"><h3>Attempt decay</h3><div class="spacer"></div>
        <span class="label">cumulative counts unique tenants by first reach</span></div>
      <div class="card-body tight"><div class="scroller"><table>
        <thead><tr><th class="r">Attempt</th><th class="r">Calls</th><th class="r">Reached</th><th class="r">Rate</th>
          <th class="r">Newly reached</th><th class="r">Cumulative unique</th><th class="r">Cumulative rate</th></tr></thead>
        <tbody>${c.decay.map((r) => `<tr><td class="r ink num">${r.attempt}</td><td class="r num">${r.calls}</td>
          <td class="r num">${r.reachedThisRound}</td><td class="r num">${r.rate}%</td>
          <td class="r num">${r.newContacts}</td><td class="r num">${r.cumulativeUnique}</td>
          <td class="r num">${r.cumulativeRate}%</td></tr>`).join('')}</tbody></table></div></div></div>` : ''}

    <div class="row">
      <a class="btn ghost" href="/api/campaigns/${esc(c.id)}/export/review.xlsx">Download full review sheet</a>
      <span class="muted" style="font-size:.82rem">Source: ${esc(c.sourceFile)} &middot; ${esc(c.formatLabel)} &middot; ${q.duplicatesMerged} duplicates merged on upload</span>
    </div>`;

  view.querySelectorAll('[data-run]').forEach((b) =>
    b.addEventListener('click', () => runBatch(Number(b.dataset.run), false)));
  view.querySelectorAll('[data-rerun]').forEach((b) =>
    b.addEventListener('click', () => {
      if (confirm(`Re-send batch ${b.dataset.rerun}? Everyone in it is submitted again, which means another call.`)) {
        runBatch(Number(b.dataset.rerun), true);
      }
    }));
  $('#btn-resync').addEventListener('click', resync);
  $('#btn-preview')?.addEventListener('click', previewRedial);
  $('#btn-redial')?.addEventListener('click', createRedial);

  if (anyRunning && !state.poll) startPolling();
}

/* ---------------- jobs ---------------- */

function jobPanel(job) {
  const panel = $('#job-panel');
  if (!panel) return;
  if (!job) { panel.innerHTML = ''; return; }
  const pctDone = job.total ? Math.round((100 * job.done) / job.total) : 0;
  panel.innerHTML = `<div style="padding:14px 20px;border-bottom:1px solid var(--rule)">
    <div class="row"><span class="chip live">${esc(job.kind)}</span>
      <span class="muted" style="font-size:.85rem">${esc(job.message || '')}</span>
      <div class="spacer" style="flex:1"></div>
      <span class="num" style="font-size:.8rem">${job.done}${job.total ? ' / ' + job.total : ''}</span>
      ${job.status === 'running' ? '<button class="btn sm ghost danger" id="btn-stop">Stop</button>' : ''}
    </div>
    <div class="bar"><i style="width:${pctDone}%"></i></div>
    ${job.error ? `<div class="note crit" style="margin-top:8px">${esc(job.error)}</div>` : ''}
  </div>`;
  $('#btn-stop')?.addEventListener('click', () => api(`/jobs/${job.id}/stop`, { method: 'POST' }));
}

function startPolling() {
  stopPolling();
  state.poll = setInterval(async () => {
    if (!state.job) { stopPolling(); return; }
    try {
      const job = await api('/jobs/' + state.job.id);
      state.job = job;
      jobPanel(job);
      if (job.status !== 'running') {
        stopPolling();
        const r = job.result;
        if (job.status === 'error') toast(job.error, true);
        else if (job.kind === 'dispatch') {
          toast(r.stopped ? `Stopped after ${r.sent} sent.`
            : `Batch ${r.batch}: ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ''}.`, Boolean(r.failed));
          if (r.firstError) toast('First failure: ' + r.firstError, true);
        } else if (job.kind === 'resync') {
          toast(`Resynced ${r.conversations} attempts across ${r.contactsMatched} tenants.`);
        }
        state.job = null;
        await refresh();
      }
    } catch {
      stopPolling(); state.job = null;
    }
  }, 900);
}

function stopPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = null;
}

async function runBatch(no, force) {
  try {
    const { job } = await api(`/campaigns/${state.campaignId}/batches/${no}/run`, {
      method: 'POST', body: JSON.stringify({ force }),
    });
    state.job = job;
    await refresh();
    jobPanel(job);
    startPolling();
  } catch (err) { toast(err.message, true); }
}

async function resync() {
  try {
    const { job } = await api(`/campaigns/${state.campaignId}/resync`, { method: 'POST', body: '{}' });
    state.job = job;
    jobPanel(job);
    startPolling();
  } catch (err) { toast(err.message, true); }
}

/* ---------------- redial ---------------- */

function redialBody() {
  return JSON.stringify({
    attemptCap: Number($('#cap').value), batchSize: Number($('#rsize').value),
  });
}

async function previewRedial() {
  try {
    const r = await api(`/campaigns/${state.campaignId}/redial`, {
      method: 'POST',
      body: JSON.stringify({ ...JSON.parse(redialBody()), dryRun: true }),
    });
    $('#redial-out').innerHTML = `
      <div class="note ${r.pool ? 'good' : 'warn'}">
        <strong>${r.pool} tenants qualify</strong> &mdash; ${rand(r.poolValue)}, ${r.batches} ${r.batches === 1 ? 'batch' : 'batches'}.
      </div>
      <div class="scroller" style="margin-top:12px"><table>
        <thead><tr><th>Excluded</th><th class="r">Tenants</th></tr></thead>
        <tbody>${Object.entries(r.skipped).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
    `<tr><td>${esc(k)}</td><td class="r num">${v}</td></tr>`).join('')}</tbody></table></div>`;
  } catch (err) { toast(err.message, true); }
}

async function createRedial() {
  try {
    const r = await api(`/campaigns/${state.campaignId}/redial`, { method: 'POST', body: redialBody() });
    toast(`Created ${r.created.length} redial ${r.created.length === 1 ? 'batch' : 'batches'} for ${r.pool} tenants.`);
    await refresh();
  } catch (err) { toast(err.message, true); }
}

/* ---------------- settings ---------------- */

async function openSettings() {
  const s = await api('/settings');
  const root = $('#modal-root');
  root.innerHTML = `<div class="veil"><div class="modal"><div class="card">
    <div class="card-head"><h3>Settings</h3><div class="spacer"></div>
      <button class="btn sm ghost" id="btn-close">Close</button></div>
    <div class="card-body">
      <h4 style="font-size:.9rem;margin-bottom:12px">Dispatch &mdash; where batches are sent</h4>
      <div class="grid2">
        <div class="field"><label class="label" for="s-base">Platform base URL</label>
          <input id="s-base" value="${esc(s.stlBaseUrl)}"></div>
        <div class="field"><label class="label" for="s-form">Form id</label>
          <input id="s-form" value="${esc(s.stlFormId)}" placeholder="frm_..."></div>
        <div class="field"><label class="label" for="s-key">API key</label>
          <input id="s-key" type="password" placeholder="${s.hasStlApiKey ? 'saved -- leave blank to keep' : 'required to dispatch'}"></div>
        <div class="field"><label class="label" for="s-path">Submit path</label>
          <input id="s-path" value="${esc(s.stlSubmitPath)}">
          <span class="hint">If a run fails with 404, correct this path. <span class="mono">{formId}</span> is substituted.</span></div>
      </div>
      <div class="row"><button class="btn sm" id="btn-test-dispatch">Test dispatch connection</button>
        <span id="out-dispatch" class="muted" style="font-size:.82rem"></span></div>

      <h4 style="font-size:.9rem;margin:24px 0 12px">Resync &mdash; reading live call outcomes</h4>
      <div class="grid2">
        <div class="field"><label class="label" for="s-jbase">Dashboard base URL</label>
          <input id="s-jbase" value="${esc(s.jobixBaseUrl)}"></div>
        <div class="field"><label class="label" for="s-jtok">Access token</label>
          <input id="s-jtok" type="password" placeholder="${s.hasJobixToken ? 'saved -- leave blank to keep' : 'paste access_token cookie value'}">
          <span class="hint">From a logged-in dashboard tab: Application &rarr; Cookies &rarr; <span class="mono">access_token</span>. Re-paste when it expires.</span></div>
        <div class="field"><label class="label" for="s-email">Expected workspace email</label>
          <input id="s-email" value="${esc(s.expectedTenantEmail)}" placeholder="optional but recommended">
          <span class="hint">A resync refuses to run if the token belongs to a different workspace. Querying the wrong one returns plausible, wrong numbers.</span></div>
      </div>
      <div class="row"><button class="btn sm" id="btn-test-jobix">Test token</button>
        <span id="out-jobix" class="muted" style="font-size:.82rem"></span></div>

      <h4 style="font-size:.9rem;margin:24px 0 12px">Defaults</h4>
      <div class="grid2">
        <div class="field"><label class="label" for="s-batch">Batch size</label>
          <input id="s-batch" type="number" min="1" max="1000" value="${s.batchSize}"></div>
        <div class="field"><label class="label" for="s-conc">Dispatch concurrency</label>
          <input id="s-conc" type="number" min="1" max="16" value="${s.dispatchConcurrency}"></div>
        <div class="field"><label class="label" for="s-delay">Delay between sends (ms)</label>
          <input id="s-delay" type="number" min="0" max="5000" value="${s.dispatchDelayMs}"></div>
      </div>

      <div class="row" style="margin-top:8px"><button class="btn primary" id="btn-save">Save settings</button></div>
    </div></div></div></div>`;

  const close = () => { root.innerHTML = ''; };
  $('#btn-close').addEventListener('click', close);
  root.querySelector('.veil').addEventListener('click', (e) => { if (e.target.classList.contains('veil')) close(); });

  const collect = () => ({
    stlBaseUrl: $('#s-base').value.trim(),
    stlFormId: $('#s-form').value.trim(),
    stlApiKey: $('#s-key').value,
    stlSubmitPath: $('#s-path').value.trim(),
    jobixBaseUrl: $('#s-jbase').value.trim(),
    jobixToken: $('#s-jtok').value,
    expectedTenantEmail: $('#s-email').value.trim(),
    batchSize: Number($('#s-batch').value),
    dispatchConcurrency: Number($('#s-conc').value),
    dispatchDelayMs: Number($('#s-delay').value),
  });

  const save = async () => { await api('/settings', { method: 'POST', body: JSON.stringify(collect()) }); };

  $('#btn-save').addEventListener('click', async () => {
    try { await save(); toast('Settings saved.'); close(); } catch (err) { toast(err.message, true); }
  });

  $('#btn-test-dispatch').addEventListener('click', async () => {
    const out = $('#out-dispatch'); out.textContent = 'Checking...';
    try {
      await save();
      const r = await api('/settings/test-dispatch', { method: 'POST', body: '{}' });
      out.innerHTML = r.ok
        ? `<span class="chip good">reachable</span> ${esc(r.title || '')} &middot; fields: ${esc((r.fields || []).join(', '))}`
        : `<span class="chip crit">failed</span> ${esc(r.error)}`;
    } catch (err) { out.innerHTML = `<span class="chip crit">failed</span> ${esc(err.message)}`; }
  });

  $('#btn-test-jobix').addEventListener('click', async () => {
    const out = $('#out-jobix'); out.textContent = 'Checking...';
    try {
      await save();
      const r = await api('/settings/test-jobix', { method: 'POST', body: '{}' });
      out.innerHTML = r.ok
        ? `<span class="chip ${r.mismatch ? 'crit' : 'good'}">${r.mismatch ? 'wrong workspace' : 'valid'}</span> ${esc(r.email || '')}${r.company ? ' &middot; ' + esc(r.company) : ''}${r.warning ? ' &mdash; ' + esc(r.warning) : ''}`
        : `<span class="chip crit">failed</span> ${esc(r.error)}`;
    } catch (err) { out.innerHTML = `<span class="chip crit">failed</span> ${esc(err.message)}`; }
  });
}

/* ---------------- boot ---------------- */

$('#btn-home').addEventListener('click', renderHome);
$('#btn-settings').addEventListener('click', openSettings);
renderHome().catch((err) => { view.innerHTML = `<div class="note crit">${esc(err.message)}</div>`; });
