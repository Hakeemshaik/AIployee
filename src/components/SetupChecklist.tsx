import Link from "next/link";
import { CheckCircle2, Circle, Lock } from "lucide-react";
import type { SetupStatus } from "@/services/setup-status";
import { GlassCard } from "@/components/ui";

/**
 * What is set up and what is next, read from the live deployment.
 *
 * Deliberately plain: one line per step saying what it gives you, one line of
 * current state, and a link to the screen that does it. A step marked with a
 * lock needs an environment variable, which is an administrator's job on the
 * host rather than something to click here.
 */
export function SetupChecklist({ status, compact = false }: { status: SetupStatus; compact?: boolean }) {
  const complete = status.done === status.total;

  return (
    <GlassCard
      title="Setting up"
      subtitle={
        complete
          ? "Everything is configured."
          : `${status.done} of ${status.total} steps done — the rest are below, in order.`
      }
      className={compact ? "mb-4" : undefined}
    >
      <ol className="space-y-3">
        {status.steps.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <span className="mt-0.5 shrink-0">
              {step.done ? (
                <CheckCircle2 size={15} className="text-[#3ecf9a]" />
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
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-white/[0.03] px-2 py-0.5 text-[0.625rem] text-ink-3"
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
    </GlassCard>
  );
}
