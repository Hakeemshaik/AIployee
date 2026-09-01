import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Lock } from "lucide-react";
import type { SetupStatus } from "@/services/setup-status";
import { Card } from "@/components/ui";

/**
 * What is set up and what is next, read from the live deployment.
 *
 * Deliberately plain: one line per step saying what it gives you, one line of
 * current state, and a link to the screen that does it. A step marked with a
 * lock needs an environment variable, which is an administrator's job on the
 * host rather than something to click here.
 *
 * `compact` is for the dashboard, which is not the setup screen. It shows the
 * progress and the one step to do next — the full list used to open the
 * dashboard with six numbered paragraphs above the first real figure.
 */
export function SetupChecklist({ status, compact = false }: { status: SetupStatus; compact?: boolean }) {
  const complete = status.done === status.total;

  if (compact) {
    const next = status.steps.find((step) => !step.done);
    if (complete || !next) return null;
    return (
      <div className="card-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <span className="flex items-center gap-2.5">
          {/* Progress as a bar rather than a fraction to read. */}
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.round((status.done / status.total) * 100)}%` }}
            />
          </span>
          <span className="num text-[0.71875rem] text-ink-3">
            {status.done}/{status.total} set up
          </span>
        </span>
        {/* Full width on a phone, where sharing the row with the button left
            it showing "N…". */}
        <span className="order-last w-full min-w-0 text-[0.8125rem] leading-relaxed text-ink sm:order-none sm:w-auto sm:flex-1 sm:truncate">
          Next: <span className="font-medium">{next.title}</span>
          <span className="ml-2 text-[0.75rem] text-ink-3">{next.detail}</span>
        </span>
        <Link href={next.href} className="btn btn-sm shrink-0">
          {next.hrefLabel} <ArrowRight size={12} />
        </Link>
      </div>
    );
  }

  return (
    <Card
      title="Setting up"
      subtitle={
        complete
          ? "Everything is configured."
          : `${status.done} of ${status.total} steps done — the rest are below, in order.`
      }
    >
      <ol className="space-y-3">
        {status.steps.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <span className="mt-0.5 shrink-0">
              {step.done ? (
                <CheckCircle2 size={15} className="text-good" />
              ) : (
                <Circle size={15} className="text-ink-3" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-2 text-[0.8125rem] text-ink">
                <span className="num text-ink-3">{index + 1}.</span>
                <span className={step.done ? "text-ink-2" : "font-medium text-ink"}>{step.title}</span>
                {step.serverSide && !step.done && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-ink/[0.03] px-2 py-0.5 text-[0.625rem] text-ink-3"
                    title="Needs an environment variable set on the host, then a redeploy"
                  >
                    <Lock size={9} /> Admin
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[0.71875rem] leading-relaxed text-ink-3">{step.purpose}</p>
              <p className="mt-1 text-[0.71875rem] leading-relaxed text-ink-2">{step.detail}</p>
              {!step.done && (
                <Link
                  href={step.href}
                  className="mt-1.5 inline-block text-[0.71875rem] text-accent hover:underline"
                >
                  {step.hrefLabel}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
