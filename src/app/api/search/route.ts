import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { label } from "@/lib/domain";
import { money } from "@/lib/format";

// GET /api/search?q= — org-scoped quick search for the command palette.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext();
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) return NextResponse.json({ results: [] });

    const [debtors, campaigns, agents] = await Promise.all([
      db.debtor.findMany({
        where: {
          organizationId: ctx.organizationId,
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { accountNumber: { contains: q, mode: "insensitive" } },
            { phone: { contains: q.replace(/[\s()-]/g, "") } },
          ],
        },
        include: { accounts: { select: { currentBalance: true } } },
        take: 6,
      }),
      db.campaign.findMany({
        where: { organizationId: ctx.organizationId, name: { contains: q, mode: "insensitive" } },
        select: { id: true, name: true, status: true },
        take: 4,
      }),
      db.aIAgent.findMany({
        where: { organizationId: ctx.organizationId, name: { contains: q, mode: "insensitive" } },
        select: { id: true, name: true, status: true },
        take: 3,
      }),
    ]);

    const results = [
      ...debtors.map((d) => ({
        kind: "debtor" as const,
        href: `/debtors/${d.id}`,
        title: `${d.firstName} ${d.lastName}`,
        subtitle: `${d.accountNumber} · ${money(d.accounts.reduce((s, a) => s + a.currentBalance, 0))} · ${label(d.status)}`,
      })),
      ...campaigns.map((c) => ({
        kind: "campaign" as const,
        href: `/campaigns/${c.id}`,
        title: c.name,
        subtitle: `Campaign · ${label(c.status)}`,
      })),
      ...agents.map((a) => ({
        kind: "agent" as const,
        href: `/agents/${a.id}`,
        title: a.name,
        subtitle: `AI agent · ${label(a.status)}`,
      })),
    ];
    return NextResponse.json({ results });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[search] failed:", err);
    return NextResponse.json({ results: [] }, { status: 200 });
  }
}
