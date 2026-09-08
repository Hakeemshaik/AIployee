/**
 * The truth layer.
 *
 * Whether a tenant was actually reached is decided here and nowhere else.
 * Pure functions on purpose, so the rules can be tested against the campaigns
 * that previously produced wrong figures.
 *
 * Rule 1: the platform's own outcome and voicemail fields do not decide
 *         anything. On one run, 164 of 438 calls carried voicemail: true over a
 *         full two-way conversation.
 * Rule 2: reached means the person spoke. An answering-machine greeting is not
 *         the person speaking.
 */

const VOICEMAIL = new RegExp([
  'voicemail', 'leave a message', 'after the tone', 'not available', 'unavailable',
  'please leave', 'voice mail', 'mailbox', 'subscriber', 'switched off',
  'does not exist', 'try again later', 'answering machine', 'record your message',
  'cannot be reached', 'no longer in service', 'has been forwarded',
].join('|'), 'i');

/**
 * @param {{userTurns:number, userWords:number, text:string}} t
 * @returns {boolean} true when the contact genuinely spoke
 */
export function spokeOnCall(t) {
  if (!t || !t.userTurns) return false;
  // A short utterance that looks like a machine greeting is a machine.
  if (VOICEMAIL.test(t.text || '') && t.userWords < 15) return false;
  return true;
}

/** Collapse a contact's attempts into one verdict. */
export function classifyContact(attempts) {
  const calls = attempts.length;
  const maxDuration = attempts.reduce((m, a) => Math.max(m, a.duration || 0), 0);
  const reached = attempts.some((a) => spokeOnCall(a.transcript));
  const everConnected = attempts.some((a) => (a.duration || 0) > 0);

  return {
    calls,
    maxDuration,
    reached,
    // Every attempt connected for zero seconds: the number does not work.
    // These people are not ignoring the calls and must not go into a redial.
    dead: calls > 0 && !everConnected,
    lastAttemptAt: attempts.reduce((m, a) => (!m || a.startedAt > m ? a.startedAt : m), null),
    words: attempts.reduce((m, a) => Math.max(m, a.transcript?.userWords || 0), 0),
    snippet: (attempts.find((a) => spokeOnCall(a.transcript))?.transcript?.text || '').slice(0, 240),
  };
}

/**
 * Reach rate per attempt number, plus cumulative unique contacts by FIRST
 * reach. Summing the per-round reached column double-counts anyone reached
 * more than once -- that overstatement once shipped as 60.7% against a true
 * 58.3%.
 */
export function attemptDecay(contacts) {
  const perAttempt = new Map();
  const firstReachAt = new Map();

  for (const [key, attempts] of contacts) {
    const ordered = [...attempts].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    ordered.forEach((a, i) => {
      const n = i + 1;
      const row = perAttempt.get(n) || { attempt: n, calls: 0, reachedThisRound: 0 };
      row.calls += 1;
      if (spokeOnCall(a.transcript)) {
        row.reachedThisRound += 1;
        if (!firstReachAt.has(key)) firstReachAt.set(key, n);
      }
      perAttempt.set(n, row);
    });
  }

  const total = contacts.length;
  let cumulative = 0;
  return [...perAttempt.values()]
    .sort((a, b) => a.attempt - b.attempt)
    .map((row) => {
      const newContacts = [...firstReachAt.values()].filter((n) => n === row.attempt).length;
      cumulative += newContacts;
      return {
        ...row,
        rate: row.calls ? +((100 * row.reachedThisRound) / row.calls).toFixed(1) : 0,
        newContacts,
        cumulativeUnique: cumulative,
        cumulativeRate: total ? +((100 * cumulative) / total).toFixed(1) : 0,
      };
    });
}

/** Who belongs in the next redial round. Built as an exclusion list. */
export const STOP_OUTCOMES = new Set([
  'Promise to Pay', 'PTP Recommitted', 'Partial Payment Arrangement', 'Paid Claimed',
  'Dispute Logged', 'Escalated', 'Office Visit Claimed', 'Callback Requested',
  'Wrong Number', 'Refused to Pay',
]);

export function redialDecision(tenant, { attemptCap = 4 } = {}) {
  const call = tenant.call || {};
  if (!tenant.phone) return { redial: false, reason: 'no usable number' };
  if (tenant.doNotCall) return { redial: false, reason: 'do not call' };
  if (call.dead) return { redial: false, reason: 'dead number - send back for data cleaning' };
  if (STOP_OUTCOMES.has(call.outcome)) return { redial: false, reason: call.outcome };
  if (call.reached) return { redial: false, reason: 'spoke, no commitment' };
  if ((call.calls || 0) >= attemptCap) return { redial: false, reason: `attempt cap (${attemptCap}) reached` };
  if (!tenant.dispatch || tenant.dispatch.status !== 'sent') return { redial: false, reason: 'not dispatched yet' };
  if ((call.calls || 0) === 0) return { redial: true, reason: 'dispatched but never dialled' };
  return { redial: true, reason: 'not reached' };
}
