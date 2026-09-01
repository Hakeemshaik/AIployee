import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CommandPalette } from "./CommandPalette";
import { SignOutButton } from "./SignOutButton";

// ---------------------------------------------------------------------------
// The bar carries three things: which organisation's data is on screen, the
// way to search it, and who is signed in.
//
// The analysis-engine chip that used to sit here has gone: it is configuration,
// it never changes while anybody is looking at it, and it is stated where it
// matters — on the insight itself and in Settings.
// ---------------------------------------------------------------------------

export async function Topbar() {
  const session = await getSession();
  const guest = session?.kind === "guest";

  let orgName = "—";
  let userName = "";
  let userRole = "";

  if (guest) {
    orgName = "Demo organization";
    userName = "Guest";
    userRole = "read-only demo";
  } else if (session) {
    try {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        include: { organization: { select: { name: true } } },
      });
      if (user) {
        orgName = user.organization.name;
        userName = user.name;
        userRole = user.role;
      }
    } catch {
      // Database unreachable — the pages surface the guidance.
    }
  }

  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  // The bar is glass, but opaque enough to read against: at 45% the content
  // scrolling beneath it showed through the blur and collided with the text.
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-base/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-4 px-4 pl-14 sm:px-6 lg:pl-8 lg:pr-8">
        <p className="flex min-w-0 items-center gap-2 text-[0.8125rem]">
          <span className="pulse-live h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
          <span className="truncate font-medium text-ink">{orgName}</span>
        </p>
        <div className="flex items-center gap-3">
          {!guest && <CommandPalette />}
          {userName && (
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.09] bg-white/[0.06] text-[0.6875rem] font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.09)]">
                {initials}
              </span>
              <div className="hidden leading-tight md:block">
                <p className="text-[0.8125rem] font-medium text-ink">{userName}</p>
                <p className="text-[0.6875rem] capitalize text-ink-3">{userRole}</p>
              </div>
            </div>
          )}
          <SignOutButton label={guest ? "Leave demo" : "Sign out"} />
        </div>
      </div>
    </header>
  );
}
