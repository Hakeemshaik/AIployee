import express from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseWorkbook, normalise } from './lib/parse.js';
import * as store from './lib/store.js';
import * as stl from './lib/speedtolead.js';
import * as jobix from './lib/jobix.js';
import { classifyContact, attemptDecay, redialDecision } from './lib/reach.js';
import { buildImportWorkbook, buildReviewWorkbook } from './lib/xlsxout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

/* ------------------------------------------------------------------ *
 * Background jobs -- dispatch and resync both report live progress
 * ------------------------------------------------------------------ */

const jobs = new Map();

function startJob(kind, run) {
  const id = store.newId('job');
  const job = { id, kind, status: 'running', done: 0, total: 0, message: '', startedAt: new Date().toISOString(), stop: false };
  jobs.set(id, job);
  run(job)
    .then((result) => Object.assign(job, { status: 'done', result, finishedAt: new Date().toISOString() }))
    .catch((err) => Object.assign(job, { status: 'error', error: String(err.message || err), finishedAt: new Date().toISOString() }));
  // Keep finished jobs around briefly so the UI can read the final state.
  setTimeout(() => jobs.delete(id), 15 * 60 * 1000).unref?.();
  return job;
}

const publicJob = (j) => j && ({
  id: j.id, kind: j.kind, status: j.status, done: j.done, total: j.total,
  message: j.message, error: j.error, result: j.result,
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found or expired.' });
  res.json(publicJob(job));
});

app.post('/api/jobs/:id/stop', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  job.stop = true;
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

app.get('/api/settings', (_req, res) => res.json(store.redactSettings()));

app.post('/api/settings', (req, res) => {
  const allowed = Object.keys(store.DEFAULT_SETTINGS);
  const patch = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k)) continue;
    // An empty string for a secret means "leave it alone", not "clear it".
    if ((k === 'stlApiKey' || k === 'jobixToken') && !v) continue;
    patch[k] = ['batchSize', 'dispatchConcurrency', 'dispatchDelayMs'].includes(k) ? Number(v) : v;
  }
  store.saveSettings(patch);
  res.json(store.redactSettings());
});

app.post('/api/settings/test-dispatch', async (_req, res) => {
  res.json(await stl.testConnection(store.getSettings()));
});

app.post('/api/settings/test-jobix', async (_req, res) => {
  const settings = store.getSettings();
  if (!settings.jobixToken) return res.json({ ok: false, error: 'No Jobix token saved yet.' });
  try {
    const who = await jobix.whoami(settings);
    const expected = settings.expectedTenantEmail?.trim().toLowerCase();
    const mismatch = expected && who.email && who.email.toLowerCase() !== expected;
    res.json({
      ok: true, ...who, mismatch,
      warning: mismatch ? `Token belongs to ${who.email}, not ${settings.expectedTenantEmail}. Resync would report the wrong workspace.` : null,
    });
  } catch (err) {
    res.json({ ok: false, error: String(err.message || err) });
  }
});

/* ------------------------------------------------------------------ *
 * Upload -> preview -> confirm
 * ------------------------------------------------------------------ */

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received.' });

  let parsed;
  try {
    parsed = parseWorkbook(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ error: `Could not read that file: ${err.message}` });
  }
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.records.length) {
    return res.status(400).json({
      error: 'No usable rows found. Every row was missing either a name or a positive balance.',
      detail: parsed.rejected.slice(0, 10),
    });
  }

  const { tenants, quality } = normalise(parsed.records);
  const settings = store.getSettings();

  const campaign = {
    id: store.newId(),
    status: 'draft',
    name: parsed.batchName,
    code: defaultCode(),
    sourceFile: req.file.originalname,
    sheetName: parsed.sheetName,
    format: parsed.format,
    formatLabel: parsed.formatLabel,
    headerLabels: parsed.headerLabels,
    createdAt: new Date().toISOString(),
    batchSize: settings.batchSize,
    quality,
    rejected: parsed.rejected.slice(0, 500),
    tenants: tenants.map((t, i) => ({ ...t, id: `t${i + 1}`, batchNo: null, dispatch: null, call: null })),
    batches: [],
  };

  store.saveCampaign(campaign);
  res.json({ campaign: summarise(campaign), preview: campaign.tenants.slice(0, 25) });
});

function defaultCode() {
  const d = new Date();
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${String(d.getDate()).padStart(2, '0')}${months[d.getMonth()]}`;
}

app.post('/api/campaigns/:id/confirm', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const batchSize = Math.max(1, Math.min(1000, Number(req.body?.batchSize) || campaign.batchSize || 150));
  if (req.body?.name) campaign.name = String(req.body.name).slice(0, 80);
  if (req.body?.code) campaign.code = String(req.body.code).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);

  campaign.batchSize = batchSize;
  campaign.status = 'ready';
  campaign.batches = [];

  // Highest balance first, so the first round works the biggest debt.
  campaign.tenants.sort((a, b) => b.total_due - a.total_due);
  campaign.tenants.forEach((t, i) => {
    t.batchNo = Math.floor(i / batchSize) + 1;
    t.id = `t${i + 1}`;
  });

  const count = Math.ceil(campaign.tenants.length / batchSize);
  for (let n = 1; n <= count; n++) {
    const members = campaign.tenants.filter((t) => t.batchNo === n);
    campaign.batches.push({
      no: n,
      code: `${campaign.code}-B${n}`,
      // Membership is frozen on the batch. Deriving it from tenant.batchNo
      // instead would rewrite a completed batch's history the moment one of
      // its tenants moved into a redial round.
      tenantIds: members.map((t) => t.id),
      size: members.length,
      value: members.reduce((s, t) => s + t.total_due, 0),
      status: 'pending',
      kind: 'initial',
      dispatched: 0,
      failed: 0,
    });
  }

  store.saveCampaign(campaign);
  res.json({ campaign: summarise(campaign) });
});

/* ------------------------------------------------------------------ *
 * Reading campaigns
 * ------------------------------------------------------------------ */

app.get('/api/campaigns', (_req, res) => res.json({ campaigns: store.listCampaigns() }));

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  res.json({ campaign: summarise(campaign), tenants: campaign.tenants });
});

app.delete('/api/campaigns/:id', (req, res) => {
  res.json({ ok: store.deleteCampaign(req.params.id) });
});

/**
 * Has this tenant ever been sent to the platform, in any round?
 *
 * Creating a redial round clears the current dispatch record so the tenant can
 * be sent again. Counting only that field made campaign totals collapse the
 * moment a redial was staged -- dispatched fell below the number already
 * dialled and awaitingDial went negative.
 */
function everDispatched(t) {
  if (t.dispatch?.status === 'sent') return true;
  return (t.dispatchHistory || []).some((d) => d.status === 'sent');
}

function summarise(c) {
  const dispatched = c.tenants.filter(everDispatched);
  const withCalls = c.tenants.filter((t) => (t.call?.calls || 0) > 0);
  const reached = c.tenants.filter((t) => t.call?.reached);
  const dead = c.tenants.filter((t) => t.call?.dead);
  const awaiting = dispatched.filter((t) => (t.call?.calls || 0) === 0);

  return {
    id: c.id, status: c.status, name: c.name, code: c.code,
    sourceFile: c.sourceFile, sheetName: c.sheetName,
    format: c.format, formatLabel: c.formatLabel, headerLabels: c.headerLabels,
    createdAt: c.createdAt, batchSize: c.batchSize,
    quality: c.quality, rejectedCount: (c.rejected || []).length,
    batches: c.batches,
    stats: {
      tenants: c.tenants.length,
      bookValue: c.quality?.bookValue ?? 0,
      dispatched: dispatched.length,
      dialled: withCalls.length,
      reached: reached.length,
      contactRate: dispatched.length ? +((100 * reached.length) / dispatched.length).toFixed(1) : null,
      dead: dead.length,
      deadValue: dead.reduce((s, t) => s + t.total_due, 0),
      notReached: Math.max(0, dispatched.length - reached.length - dead.length),
      awaitingDial: awaiting.length,
    },
    decay: c.decay || [],
    resync: c.resync || null,
  };
}

/* ------------------------------------------------------------------ *
 * Run a batch
 * ------------------------------------------------------------------ */

app.post('/api/campaigns/:id/batches/:no/run', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const no = Number(req.params.no);
  const batch = campaign.batches.find((b) => b.no === no);
  if (!batch) return res.status(404).json({ error: `Batch ${no} does not exist.` });
  if (batch.status === 'dispatching') return res.status(409).json({ error: `Batch ${no} is already running.` });
  if (batch.status !== 'pending' && !req.body?.force) {
    return res.status(409).json({ error: `Batch ${no} has already been run. Pass force to send it again.` });
  }

  // Sequential by default: batch 2 waits for batch 1's run to finish.
  const earlier = campaign.batches.filter((b) => b.no < no && b.kind === batch.kind);
  const unfinished = earlier.find((b) => b.status === 'pending' || b.status === 'dispatching');
  if (unfinished && !req.body?.force) {
    return res.status(409).json({
      error: `Batch ${unfinished.no} has not finished yet. Run the batches in order, or pass force.`,
    });
  }

  const settings = store.getSettings();
  if (!settings.stlFormId || !settings.stlApiKey) {
    return res.status(400).json({ error: 'Set the form id and API key in Settings before running a batch.' });
  }

  const inBatch = new Set(batch.tenantIds || []);
  const members = campaign.tenants.filter(
    (t) => inBatch.has(t.id) && t.phone && (req.body?.force || t.dispatch?.status !== 'sent'),
  );
  if (!members.length) return res.status(400).json({ error: 'Nothing left to send in this batch.' });

  batch.status = 'dispatching';
  batch.startedAt = new Date().toISOString();
  store.saveCampaign(campaign);

  const job = startJob('dispatch', async (j) => {
    j.total = members.length;
    j.message = `Sending batch ${no} as ${batch.code}`;

    const results = await stl.dispatchBatch(
      settings, members, batch.code,
      (p) => { j.done = p.done; },
      () => j.stop,
    );

    // Re-read: a resync may have written to the file while this ran.
    const fresh = store.getCampaign(campaign.id);
    const freshBatch = fresh.batches.find((b) => b.no === no);
    const byId = new Map(results.map((r) => [r.tenantId, r]));

    for (const tenant of fresh.tenants) {
      const r = byId.get(tenant.id);
      if (!r) continue;
      tenant.dispatch = r.ok
        ? { status: 'sent', at: new Date().toISOString(), suid: r.suid || null, code: freshBatch.code }
        : { status: 'failed', at: new Date().toISOString(), error: r.error || `HTTP ${r.status}` };
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;
    const ids = new Set(freshBatch.tenantIds || []);
    freshBatch.dispatched = fresh.tenants.filter((t) => ids.has(t.id) && t.dispatch?.status === 'sent').length;
    freshBatch.failed = fresh.tenants.filter((t) => ids.has(t.id) && t.dispatch?.status === 'failed').length;
    freshBatch.status = j.stop ? 'pending' : 'dispatched';
    freshBatch.finishedAt = new Date().toISOString();
    if (fresh.status === 'ready') fresh.status = 'running';
    store.saveCampaign(fresh);

    const firstError = results.find((r) => !r.ok)?.error || null;
    return { batch: no, sent, failed, stopped: j.stop, firstError };
  });

  res.json({ job: publicJob(job) });
});

/* ------------------------------------------------------------------ *
 * Resync -- who actually got dialled, and who picked up
 * ------------------------------------------------------------------ */

app.post('/api/campaigns/:id/resync', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const settings = store.getSettings();
  if (!settings.jobixToken) {
    return res.status(400).json({ error: 'Paste a Jobix access token in Settings before resyncing.' });
  }

  const dispatched = campaign.tenants.filter((t) => t.dispatch?.status === 'sent' && t.phone);
  if (!dispatched.length) return res.status(400).json({ error: 'Nothing has been dispatched yet.' });

  const job = startJob('resync', async (j) => {
    j.message = 'Confirming which workspace the token belongs to';
    const who = await jobix.whoami(settings);
    const expected = settings.expectedTenantEmail?.trim().toLowerCase();
    if (expected && who.email && who.email.toLowerCase() !== expected) {
      throw new Error(`Token is for ${who.email}, not ${settings.expectedTenantEmail}. Refusing to resync against the wrong workspace.`);
    }

    // Floor the search at the first dispatch, minus a day for clock skew.
    const firstDispatch = dispatched
      .map((t) => t.dispatch.at)
      .sort()[0] || campaign.createdAt;
    const since = new Date(new Date(firstDispatch).getTime() - 864e5).toISOString();

    j.message = 'Reading call attempts';
    const phones = dispatched.map((t) => t.phone);
    const conversations = await jobix.fetchConversations(settings, {
      since, phones,
      onProgress: (p) => { j.done = p.collected; j.message = `Reading call attempts (page ${p.page + 1})`; },
    });

    j.message = `Reading ${conversations.length} transcripts`;
    j.total = conversations.length;
    j.done = 0;
    const transcripts = await jobix.fetchTranscripts(settings, conversations, {
      onProgress: (p) => { j.done = p.done; },
    });

    // Group attempts by contact, then classify each contact once.
    const byPhone = new Map();
    for (const c of conversations) {
      const key = jobix.phoneKey(c.phone);
      if (!byPhone.has(key)) byPhone.set(key, []);
      byPhone.get(key).push({ ...c, transcript: transcripts.get(c.uuid) });
    }

    const fresh = store.getCampaign(campaign.id);
    let matched = 0;
    for (const tenant of fresh.tenants) {
      if (!tenant.phone) continue;
      const attempts = byPhone.get(jobix.phoneKey(tenant.phone));
      if (!attempts) {
        if (everDispatched(tenant)) {
          tenant.call = { calls: 0, reached: false, dead: false, awaitingDial: true };
        }
        continue;
      }
      matched += 1;
      const verdict = classifyContact(attempts);
      tenant.call = { ...(tenant.call || {}), ...verdict, awaitingDial: false };
    }

    const dispatchedFresh = fresh.tenants.filter(everDispatched);
    fresh.decay = attemptDecay(
      dispatchedFresh
        .map((t) => [jobix.phoneKey(t.phone), byPhone.get(jobix.phoneKey(t.phone))])
        .filter(([, a]) => a && a.length),
    );

    // A batch is complete once every number in it has been attempted or is dead.
    for (const batch of fresh.batches) {
      if (batch.status !== 'dispatched') continue;
      const ids = new Set(batch.tenantIds || []);
      const members = fresh.tenants.filter((t) => ids.has(t.id) && t.dispatch?.status === 'sent');
      if (members.length && members.every((t) => (t.call?.calls || 0) > 0)) batch.status = 'complete';
    }

    // The gap that matters: sent to the platform, never dialled.
    const neverDialled = dispatchedFresh.filter((t) => (t.call?.calls || 0) === 0);
    fresh.resync = {
      lastAt: new Date().toISOString(),
      tenant: who.email,
      company: who.company,
      conversations: conversations.length,
      contactsMatched: matched,
      neverDialled: neverDialled.length,
      neverDialledValue: neverDialled.reduce((s, t) => s + t.total_due, 0),
      transcriptErrors: [...transcripts.values()].filter((t) => t.error).length,
    };
    store.saveCampaign(fresh);
    return fresh.resync;
  });

  res.json({ job: publicJob(job) });
});

/* ------------------------------------------------------------------ *
 * Build the redial round
 * ------------------------------------------------------------------ */

app.post('/api/campaigns/:id/redial', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  if (!campaign.resync) {
    return res.status(400).json({ error: 'Resync first, so the redial list is built from live call outcomes.' });
  }

  const attemptCap = Math.max(1, Math.min(10, Number(req.body?.attemptCap) || 4));
  const batchSize = Math.max(1, Math.min(1000, Number(req.body?.batchSize) || campaign.batchSize));

  const pool = [];
  const skipped = {};
  for (const tenant of campaign.tenants) {
    const { redial, reason } = redialDecision(tenant, { attemptCap });
    if (redial) pool.push(tenant);
    else skipped[reason] = (skipped[reason] || 0) + 1;
  }

  if (req.body?.dryRun) {
    return res.json({
      pool: pool.length,
      poolValue: pool.reduce((s, t) => s + t.total_due, 0),
      skipped,
      attemptCap,
      batches: Math.ceil(pool.length / batchSize),
    });
  }
  if (!pool.length) return res.status(400).json({ error: 'Nobody qualifies for a redial.', skipped });

  const round = (campaign.batches.filter((b) => b.kind === 'redial').length) + 1;
  pool.sort((a, b) => b.total_due - a.total_due);

  const created = [];
  const startNo = Math.max(...campaign.batches.map((b) => b.no)) + 1;
  for (let i = 0; i < pool.length; i += batchSize) {
    const members = pool.slice(i, i + batchSize);
    const no = startNo + created.length;
    const batch = {
      no,
      code: `${campaign.code}-R${round}B${created.length + 1}`,
      tenantIds: members.map((t) => t.id),
      size: members.length,
      value: members.reduce((s, t) => s + t.total_due, 0),
      status: 'pending',
      kind: 'redial',
      round,
      dispatched: 0,
      failed: 0,
    };
    for (const t of members) {
      t.batchNo = no;
      // Archive the previous round rather than dropping it -- the earlier
      // attempt is what justifies this redial, and the call history below
      // still counts toward the attempt cap.
      if (t.dispatch) t.dispatchHistory = [...(t.dispatchHistory || []), t.dispatch];
      t.dispatch = null;
    }
    campaign.batches.push(batch);
    created.push(batch);
  }

  campaign.redialRounds = [...(campaign.redialRounds || []), {
    round, attemptCap, createdAt: new Date().toISOString(),
    pool: pool.length, skipped,
  }];
  store.saveCampaign(campaign);

  res.json({ campaign: summarise(campaign), created, skipped, pool: pool.length });
});

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

function sendXlsx(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

app.get('/api/campaigns/:id/export/import.xlsx', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const no = req.query.batch ? Number(req.query.batch) : null;
  const batch = no ? campaign.batches.find((b) => b.no === no) : null;
  if (no && !batch) return res.status(404).json({ error: `Batch ${no} does not exist.` });

  const tenants = no ? campaign.tenants.filter((t) => t.batchNo === no) : campaign.tenants;
  const buffer = buildImportWorkbook(tenants, { batch: campaign.name, callCode: batch ? batch.code : campaign.code });
  sendXlsx(res, buffer, `${campaign.name}_${batch ? batch.code : campaign.code}_import.xlsx`);
});

app.get('/api/campaigns/:id/export/review.xlsx', (req, res) => {
  const campaign = store.getCampaign(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  sendXlsx(res, buildReviewWorkbook(campaign.tenants, campaign.quality), `${campaign.name}_${campaign.code}_review.xlsx`);
});

/* ------------------------------------------------------------------ */

app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'That file is larger than 25 MB.' });
  res.status(500).json({ error: String(err?.message || err) });
});

const PORT = Number(process.env.PORT) || 4310;
app.listen(PORT, () => {
  console.log(`Collections console  ->  http://localhost:${PORT}`);
});
