"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Catching up on calls nobody watched.
//
// Placed a dial, closed the tab, came back tomorrow: the schedule has almost
// certainly filled it in by then, but "almost certainly" is what left an
// account reading "no interactions recorded" after a call that captured a
// promise to pay. So the pages that show call results ask once, on arrival,
// whether anything is still outstanding.
//
// It is deliberately quiet. Nothing outstanding means nothing on screen — a
// banner saying "checked, all good" on every page load is noise. It only
// appears when it actually recovered something, and then it refreshes the page
// underneath so the recovered call is in the list you are looking at.
// ---------------------------------------------------------------------------

type Sweep = {
  considered: number;
  filled: number;
  pending: number;
  abandoned: number;
  failed: number;
  remaining: number;
};

export function OutcomeCatchUp() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "working" | "filled">("idle");
  const [filled, setFilled] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    // Once per mount. In development React mounts twice, and two sweeps racing
    // each other would ask the platform the same question twice.
    if (ran.current) return;
    ran.current = true;

    let live = true;
    void (async () => {
      // A beat after paint: the page the person came to read matters more than
      // this does.
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (!live) return;
      setState("working");
      try {
        const response = await fetch("/api/calling/sweep", { method: "POST" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as Sweep;
        if (!live) return;
        if (body.filled > 0) {
          setFilled(body.filled);
          setState("filled");
          router.refresh();
        } else {
          setState("idle");
        }
      } catch {
        // Nothing to say. The schedule runs regardless, and a page that
        // announces a failed background read it never promised is noise.
        if (live) setState("idle");
      }
    })();

    return () => {
      live = false;
    };
  }, [router]);

  if (state === "idle") return null;

  return (
    <p
      className="value-in mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-3 py-1.5 text-[0.71875rem] text-ink-2 backdrop-blur-xl"
      role="status"
    >
      {state === "working" ? (
        <>
          <Loader2 size={12} className="animate-spin text-accent" />
          Checking for calls that finished while you were away…
        </>
      ) : (
        <>
          <CheckCircle2 size={12} className="text-good" />
          Filled in {filled} call{filled === 1 ? "" : "s"} that finished while you were away.
        </>
      )}
    </p>
  );
}
