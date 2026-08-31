// ---------------------------------------------------------------------------
// Which build is answering.
//
// Two diagnostic rounds were spent reading output from a deployment that did
// not contain the change being tested. The payload had moved in the repository
// and not in what was running, and nothing on the screen said so — the report
// looked current, described a payload that no longer existed, and sent the
// diagnosis in the wrong direction both times.
//
// So every write diagnostic now names its own build. The revision moves
// whenever what a send writes changes, which is the thing worth telling apart.
// ---------------------------------------------------------------------------

/**
 * What a send writes, by revision.
 *
 *   r1 — the inferred shape: a readable reference built from the account number
 *        and the batch code, the number repeated in the fields, the email in
 *        the identity block, nineteen fields, the flag in `call` only.
 *   r2 — the shape of a dial this workspace has actually made: a uuid
 *        reference, the number and name in the identity block only, the email
 *        as a field, nine fields, the flag in `call` and `all`.
 */
export const PAYLOAD_REVISION = 2;

/**
 * The revision and the deployed commit, for the top of a diagnostic.
 *
 * Vercel sets VERCEL_GIT_COMMIT_SHA at build time, so this is the commit that
 * is actually running rather than the newest one pushed.
 */
export function buildStamp(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "";
  return `payload r${PAYLOAD_REVISION}, build ${sha ? sha.slice(0, 7) : "local"}`;
}
