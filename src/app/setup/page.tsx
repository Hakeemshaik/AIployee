import Link from "next/link";
import { getSetupStatus } from "@/services/bootstrap";
import { GlassCard } from "@/components/ui";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setup" };

export default async function SetupPage() {
  let status: { needsSetup: boolean; orgName: string | null } | null = null;
  try {
    status = await getSetupStatus();
  } catch {
    // database unreachable — surface guidance below
  }

  return (
    <div className="page-in mx-auto mt-10 max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold tracking-tight text-ink">
        {status?.needsSetup ? "Set up AIployee" : "Setup"}
      </h1>
      <p className="mb-6 text-[0.8125rem] text-ink-2">
        {status === null
          ? "The database is not reachable."
          : status.needsSetup
            ? "Choose how to initialise this deployment."
            : "This deployment is already configured."}
      </p>
      <GlassCard>
        {status === null ? (
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">
            The database is not reachable. Connect a PostgreSQL database (on Vercel: Project →
            Storage), then redeploy and reload this page.
          </p>
        ) : status.needsSetup ? (
          <SetupForm />
        ) : (
          <div>
            <p className="text-[0.8125rem] text-ink-2">
              <span className="font-medium text-ink">{status.orgName}</span> is already set up on this
              deployment, so this page is locked.
            </p>
            <Link href="/" className="btn btn-primary mt-4 inline-flex">Open the dashboard</Link>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
