"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { visitedInside } from "@/components/shell/NavTracker";

// ---------------------------------------------------------------------------
// Going back, properly.
//
// This used to be a plain link to the list page, which threw away where you
// actually were: page 4 of a filtered debtors list became page 1 of everything,
// and the filters you had set were gone. The browser's own history has all of
// that, so when the previous page is inside this app, going back IS going back.
//
// "Inside this app" cannot be read off document.referrer — client-side
// navigation never updates it, so it only says how the DOCUMENT was loaded,
// not where the person just was. The shell counts route changes instead
// (NavTracker); more than one means the previous history entry is ours.
//
// The href stays as the fallback for the case history cannot cover: the page
// was opened directly, in a new tab, or from a link outside the app, where
// "back" would drop the person out of the platform entirely.
// ---------------------------------------------------------------------------

export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();

  function goBack() {
    if (visitedInside()) router.back();
    else router.push(href);
  }

  return (
    <button
      onClick={goBack}
      className="group mb-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-white/60 py-1.5 pl-2.5 pr-3.5 text-[0.75rem] text-ink-2 backdrop-blur-xl transition-all hover:border-accent/40 hover:bg-white hover:text-ink"
    >
      <ArrowLeft
        size={14}
        className="text-ink-3 transition-transform duration-200 group-hover:-translate-x-0.5 group-hover:text-accent"
      />
      {label}
    </button>
  );
}
