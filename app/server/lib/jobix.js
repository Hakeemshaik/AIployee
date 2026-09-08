/**
 * Read-only Jobix client for the resync.
 *
 * Authenticates with the access_token copied from a logged-in dashboard tab.
 * Three constraints learned the hard way:
 *   - page_size above 25 on /api/conversations returns HTTP 500
 *   - the transcription endpoint needs ?call_uuid set to the same uuid, or 422
 *   - responses are scoped to the selected workspace, so the tenant must be
 *     confirmed before any number is believed
 */

const PAGE_SIZE = 25;

function headers(settings) {
  return { Authorization: `Bearer ${settings.jobixToken}`, Accept: 'application/json' };
}

async function get(settings, path, timeoutMs = 30000) {
  const url = `${settings.jobixBaseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, { headers: headers(settings), signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 401 || res.status === 403) {
    const err = new Error('Jobix rejected the token. Copy a fresh access_token from a logged-in dashboard tab.');
    err.code = 'UNAUTHORISED';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Jobix returned HTTP ${res.status} for ${path}`);
    err.code = 'HTTP';
    throw err;
  }
  return res.json();
}

/** Confirm which tenant the token belongs to before trusting any figure. */
export async function whoami(settings) {
  const body = await get(settings, '/api/profile?includes=company');
  const data = body?.data || body || {};
  return {
    email: data.email || null,
    company: data.company?.name || data.company_name || null,
  };
}

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-9);

/**
 * Page through conversations back to `since`, keeping only those whose number
 * matches one of `phones`.
 */
export async function fetchConversations(settings, { since, phones, maxPages = 200, onProgress }) {
  const wanted = new Set([...phones].map(digits));
  const out = [];
  let stop = false;

  for (let page = 0; page < maxPages && !stop; page++) {
    const body = await get(settings, `/api/conversations?page=${page}&page_size=${PAGE_SIZE}`);
    const rows = body?.data || [];
    if (!rows.length) break;

    for (const row of rows) {
      const ts = row.created_at || '';
      if (since && ts && ts < since) { stop = true; break; }
      if (!wanted.has(digits(row.phone_number))) continue;
      out.push({
        uuid: row.uuid,
        phone: row.phone_number,
        duration: row.duration || 0,
        startedAt: ts,
        agent: row.agent?.name || null,
      });
    }
    onProgress?.({ page, collected: out.length, total: body?.pagination?.totalCount ?? null });
  }
  return out;
}

/** Fetch and reduce one transcript to the fields the classifier needs. */
async function fetchTranscript(settings, uuid) {
  try {
    const body = await get(settings, `/api/conversations/${uuid}/transcription?call_uuid=${uuid}`, 25000);
    let userTurns = 0, userWords = 0, text = '';
    for (const leg of body?.data || []) {
      for (const turn of leg.transcription || []) {
        if (turn.role !== 'user') continue;
        const content = String(turn.content || '').trim();
        if (!content) continue;
        userTurns += 1;
        userWords += content.split(/\s+/).filter(Boolean).length;
        text += ` ${content}`;
      }
    }
    return { userTurns, userWords, text: text.trim().slice(0, 600) };
  } catch (err) {
    if (err.code === 'UNAUTHORISED') throw err;
    // A single unreadable transcript must not fail the whole resync, but it
    // must not be silently counted as "did not speak" either.
    return { userTurns: 0, userWords: 0, text: '', error: String(err.message || err) };
  }
}

export async function fetchTranscripts(settings, conversations, { concurrency = 10, onProgress } = {}) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < conversations.length) {
      const c = conversations[cursor++];
      results.set(c.uuid, await fetchTranscript(settings, c.uuid));
      onProgress?.({ done: results.size, total: conversations.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, conversations.length || 1) }, worker));
  return results;
}

export { digits as phoneKey };
