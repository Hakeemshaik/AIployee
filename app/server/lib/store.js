/**
 * Flat-file JSON persistence. One file per campaign plus a settings file.
 *
 * Deliberately not a database: a campaign is a few hundred to a few thousand
 * rows, one operator works at a time, and a plain JSON file can be opened,
 * diffed and backed up without tooling.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CAMPAIGN_DIR = path.join(ROOT, 'campaigns');
const SETTINGS_FILE = path.join(ROOT, 'settings.json');

fs.mkdirSync(CAMPAIGN_DIR, { recursive: true });

export const DEFAULT_SETTINGS = {
  stlBaseUrl: 'https://forms.aiployee.co.za',
  stlFormId: '',
  stlApiKey: '',
  stlSubmitPath: '/api/forms/{formId}/submissions',
  jobixBaseUrl: 'https://dashboard.jobix.ai',
  jobixToken: '',
  expectedTenantEmail: '',
  batchSize: 150,
  dispatchConcurrency: 4,
  dispatchDelayMs: 150,
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write via a temp file and rename so an interrupted write cannot truncate. */
function writeJson(file, data) {
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJson(SETTINGS_FILE, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(SETTINGS_FILE, next);
  return next;
}

/** Settings with the secrets replaced by a presence flag, for the browser. */
export function redactSettings(s = getSettings()) {
  const { stlApiKey, jobixToken, ...rest } = s;
  return { ...rest, hasStlApiKey: Boolean(stlApiKey), hasJobixToken: Boolean(jobixToken) };
}

const campaignFile = (id) => path.join(CAMPAIGN_DIR, `${id}.json`);

export function newId(prefix = 'cmp') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export function listCampaigns() {
  return fs.readdirSync(CAMPAIGN_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const c = readJson(path.join(CAMPAIGN_DIR, f), null);
      if (!c) return null;
      const dispatched = c.tenants.filter((t) => t.dispatch?.status === 'sent').length;
      const reached = c.tenants.filter((t) => t.call?.reached).length;
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        createdAt: c.createdAt,
        tenants: c.tenants.length,
        batches: c.batches.length,
        batchesRun: c.batches.filter((b) => b.status === 'complete').length,
        dispatched,
        reached,
        bookValue: c.quality?.bookValue ?? 0,
        lastResyncAt: c.resync?.lastAt ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getCampaign(id) {
  if (!/^[\w-]+$/.test(String(id))) return null;   // no path traversal
  return readJson(campaignFile(id), null);
}

export function saveCampaign(campaign) {
  campaign.updatedAt = new Date().toISOString();
  writeJson(campaignFile(campaign.id), campaign);
  return campaign;
}

export function deleteCampaign(id) {
  if (!/^[\w-]+$/.test(String(id))) return false;
  try { fs.unlinkSync(campaignFile(id)); return true; } catch { return false; }
}
