"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, PhoneOutgoing, Trash2, X } from "lucide-react";
import { Overlay } from "@/components/Overlay";

// ---------------------------------------------------------------------------
// Asking, in our own voice.
//
// window.confirm draws the operating system's dialog: a grey box with the
// browser's name on it, no room to say what will actually happen, and a
// blocking call that freezes the page. For a platform that dials real phones
// and deletes real records, the sentence explaining what is about to happen is
// the most important part of the interaction, and the browser gives it one
// line of plain text.
//
// So: our own. Same job, same keyboard behaviour — Enter confirms, Escape
// cancels, focus lands on the safe choice — with room for a proper
// explanation, the palette, and glass.
// ---------------------------------------------------------------------------

export type ConfirmKind = "default" | "danger" | "call";

export type ConfirmRequest = {
  title: string;
  /** What will actually happen. Two sentences at most. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  kind?: ConfirmKind;
};

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((request: ConfirmRequest) => Promise<boolean>) | null>(null);

/**
 * `const confirm = useConfirm()` then `if (!(await confirm({...}))) return;`
 *
 * Reads like window.confirm on purpose: a drop-in at every call site that was
 * already asking, so nothing stops asking by accident during the swap.
 */
export function useConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const ask = useContext(ConfirmContext);
  if (!ask) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ask;
}

const ICONS: Record<ConfirmKind, typeof AlertTriangle> = {
  default: AlertTriangle,
  danger: Trash2,
  call: PhoneOutgoing,
};

const ACCENTS: Record<ConfirmKind, { ring: string; icon: string; button: string }> = {
  default: { ring: "bg-accent/12", icon: "text-accent", button: "btn-primary" },
  danger: { ring: "bg-critical/12", icon: "text-critical", button: "btn btn-danger" },
  call: { ring: "bg-accent/12", icon: "text-accent", button: "btn-primary" },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const ask = useCallback(
    (request: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...request, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      setPending((current) => {
        current?.resolve(ok);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!pending) return;
    // Focus the confirming button, but only after the entrance — moving focus
    // mid-animation makes the panel jump on some browsers.
    const timer = setTimeout(() => confirmRef.current?.focus(), 60);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(false);
      if (event.key === "Enter" && event.target === confirmRef.current) settle(true);
    };
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("keydown", key);
    };
  }, [pending, settle]);

  const kind = pending?.kind ?? "default";
  const Icon = ICONS[kind];
  const accent = ACCENTS[kind];

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <Overlay>
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={pending.title}
        >
          <div
            className="scrim-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]"
            onClick={() => settle(false)}
          />
          <div className="card-float pop-in relative w-full max-w-[26rem] p-5">
            <button
              onClick={() => settle(false)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full p-1.5 text-ink-3 transition-colors hover:bg-ink/[0.06] hover:text-ink"
            >
              <X size={15} />
            </button>
            <span
              className={`mb-3.5 flex h-11 w-11 items-center justify-center rounded-2xl ${accent.ring}`}
            >
              <Icon size={19} className={accent.icon} />
            </span>
            <h2 className="pr-6 text-[1.0625rem] font-semibold tracking-tight text-ink">
              {pending.title}
            </h2>
            {pending.body && (
              <div className="mt-2 text-[0.8125rem] leading-relaxed text-ink-2">{pending.body}</div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </button>
              <button
                ref={confirmRef}
                className={accent.button === "btn-primary" ? "btn btn-primary" : accent.button}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
        </Overlay>
      )}
    </ConfirmContext.Provider>
  );
}
