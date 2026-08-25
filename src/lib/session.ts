import { cookies } from "next/headers";

// ---------------------------------------------------------------------------
// Guest (demo) session.
//
// A guest sees the fixture dataset and cannot trigger a call. The flag lives in
// an httpOnly cookie so the client cannot grant itself demo — or escape it —
// and every calling path re-checks it server-side rather than trusting the UI.
// ---------------------------------------------------------------------------

const GUEST_COOKIE = "aip_guest";

export async function isGuest(): Promise<boolean> {
  const store = await cookies();
  return store.get(GUEST_COOKIE)?.value === "1";
}

export async function setGuest(enabled: boolean): Promise<void> {
  const store = await cookies();
  if (enabled) {
    store.set(GUEST_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 8,
    });
  } else {
    store.delete(GUEST_COOKIE);
  }
}

export class GuestBlockedError extends Error {
  // The action is named so the message fits whatever was refused — the guard
  // covers ingestion as well as calling.
  constructor(action = "trigger calls") {
    super(`Not available in the demo — sign in to ${action}.`);
    this.name = "GuestBlockedError";
  }
}

/** Guard for any action a guest must never perform. */
export async function blockGuests(action?: string): Promise<void> {
  if (await isGuest()) throw new GuestBlockedError(action);
}
