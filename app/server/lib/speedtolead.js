/**
 * Dispatch client -- submits one tenant record per request. The platform mints
 * the SUID and forwards the record to the voice agent using the form's own
 * company key, so nothing here needs the Jobix credentials.
 */

function submitUrl(settings) {
  const path = settings.stlSubmitPath.replace('{formId}', settings.stlFormId);
  return `${settings.stlBaseUrl.replace(/\/$/, '')}${path}`;
}

/** Map a tenant record onto the form's field keys. */
export function toFormValues(tenant, callCode) {
  return {
    name: tenant.name,
    phone: tenant.phone,
    email: tenant.email || `noreply+${String(tenant.phone).replace(/\D/g, '')}@aiployee.co.za`,
    total_due: tenant.total_due,
    building_name: tenant.building_name || 'Not supplied',
    unit_number: tenant.unit_number || 'Not supplied',
    timezone: 'Africa/Johannesburg',
    call: callCode,
    all: callCode,
  };
}

async function post(url, apiKey, body, timeoutMs = 30000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep the raw body for diagnosis */ }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 400) };
  } finally {
    clearTimeout(timer);
  }
}

export async function submitOne(settings, tenant, callCode) {
  const res = await post(submitUrl(settings), settings.stlApiKey, { values: toFormValues(tenant, callCode) });

  if (!res.ok) {
    const hint = res.status === 404
      ? 'Endpoint not found. Check the submit path in Settings.'
      : res.status === 401 || res.status === 403
        ? 'Rejected. Check the API key has submit scope for this form.'
        : null;
    return { ok: false, status: res.status, error: hint || res.text || `HTTP ${res.status}` };
  }

  const body = res.json || {};
  const suid = body.suid || body.submission?.suid || body.data?.suid || body.submissionId || null;
  return { ok: true, status: res.status, suid, raw: body };
}

/**
 * Dispatch a list of tenants with bounded concurrency, reporting progress as it
 * goes. onProgress is called after every record so the UI can show a live count.
 */
export async function dispatchBatch(settings, tenants, callCode, onProgress, shouldStop) {
  const results = [];
  const concurrency = Math.max(1, Math.min(16, settings.dispatchConcurrency || 4));
  let cursor = 0;

  async function worker() {
    while (cursor < tenants.length) {
      if (shouldStop?.()) return;
      const tenant = tenants[cursor++];
      let outcome;
      try {
        outcome = await submitOne(settings, tenant, callCode);
      } catch (err) {
        outcome = { ok: false, error: err.name === 'AbortError' ? 'timed out' : String(err.message || err) };
      }
      results.push({ tenantId: tenant.id, ...outcome });
      onProgress?.({ done: results.length, total: tenants.length, tenantId: tenant.id, ok: outcome.ok });
      if (settings.dispatchDelayMs) await new Promise((r) => setTimeout(r, settings.dispatchDelayMs));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

/** Reachability probe -- fetches the public form JSON, which needs no key. */
export async function testConnection(settings) {
  if (!settings.stlFormId) return { ok: false, error: 'No form id set.' };
  const url = `${settings.stlBaseUrl.replace(/\/$/, '')}/api/forms/${settings.stlFormId}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, error: `Form lookup returned HTTP ${res.status}` };
    const body = await res.json();
    const fields = (body.fields || body.definition?.fields || []).map((f) => f.key);
    return { ok: true, title: body.title || body.definition?.title || null, fields };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}
