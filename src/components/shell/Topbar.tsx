import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { AccountMenu } from "./AccountMenu";
import { TopNav } from "./TopNav";
import { BrandLockup } from "@/components/Brand";

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

  // Two rows on a laptop and one on a wide screen: brand, who you are and
  // where you are up top, and the navigation as a pill row beneath it. The bar
  // is glass, but opaque enough to read against — at 45% the content scrolling
  // beneath showed through the blur and collided with the text.
  return (
    <header className="sticky top-0 z-30 border-b border-ink/[0.08] bg-base/80 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <Link href="/" className="shrink-0" aria-label="AIployee Command Centre">
          <BrandLockup />
        </Link>

        {/* Its own row, centred. Sharing one with the account cluster was tight
            at 1440 and the More button ended up under the organisation name;
            centred, the dock reads as one object rather than a row of links
            trailing off the brand. */}
        <div className="scroll-x order-last flex w-full min-w-0 justify-center pb-1 pt-0.5">
          <TopNav guest={guest} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <p className="hidden min-w-0 items-center gap-2 text-[0.8125rem] sm:flex">
            <span className="pulse-live h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span className="max-w-[14rem] truncate font-medium text-ink">{orgName}</span>
          </p>
          {/* Who you are and everything you change about the place, in one
              control. The separate sign-out button beside it was a permanent
              destructive-looking thing in the corner of every screen. */}
          <AccountMenu name={userName} role={userRole} initials={initials} guest={guest} />
        </div>
      </div>
    </header>
  );
}
