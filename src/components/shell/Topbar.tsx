import { Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";
import { CommandPalette } from "./CommandPalette";
import { SignOutButton } from "./SignOutButton";

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

  const aiLive = process.env.AI_PROVIDER === "claude" && !!process.env.ANTHROPIC_API_KEY;
  const initials = userName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-[1440px] items-center justify-between gap-4 px-4 pl-14 sm:px-6 lg:pl-8 lg:pr-8">
        <div className="min-w-0">
          <p className="truncate text-[0.8125rem] text-ink-2">
            <span className="text-ink-3">Organization</span>{" "}
            <span className="font-medium text-ink">{orgName}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!guest && <CommandPalette />}
          <span
            className="hidden items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-[0.6875rem] text-ink-2 sm:inline-flex"
            title={
              aiLive
                ? "AI analysis and reporting served by Claude"
                : "Running on the built-in analysis engine. An administrator can enable Claude in the server configuration."
            }
          >
            <Sparkles size={12} className={aiLive ? "text-accent" : "text-ink-3"} />
            {aiLive ? "Claude connected" : "Built-in analysis engine"}
          </span>
          {userName && (
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-gradient-to-b from-white/[0.09] to-white/[0.03] text-[0.6875rem] font-semibold text-ink">
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
