"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Deleting a campaign.
//
// The accounts survive — they are the book, and they belong to the
// organization, not to a run — so the confirmation says so rather than letting
// someone believe they are about to delete their debtors.
//
// A campaign with a live run is refused by the server, because deleting the
// record that holds the batch code would leave accounts armed on the voice
// platform with nothing here able to name them.
// ---------------------------------------------------------------------------

export function DeleteCampaignButton({
  campaignId,
  name,
  accounts,
}: {
  campaignId: string;
  name: string;
  accounts: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (
      !window.confirm(
        `Delete the campaign "${name}"?\n\n` +
          (accounts > 0
            ? accounts === 1
              ? "Its 1 account is NOT deleted — it stays in your book and becomes unassigned, ready for another campaign."
              : `Its ${accounts} accounts are NOT deleted — they stay in your book and become unassigned, ready for another campaign.`
            : "It holds no accounts.") +
          "\n\nThe campaign, its contact history and its redial batches go. This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "The campaign could not be deleted.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The campaign could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        // Recessive on purpose: it sits beside the campaign's status, and a
        // bordered button there read as an equal action. Still always visible
        // — hiding it until hover would put it out of reach on a touch screen.
        className="btn btn-sm border-transparent bg-transparent text-ink-3 opacity-70 hover:text-serious hover:opacity-100"
        onClick={(event) => {
          // The whole card is a link; deleting must not follow it.
          event.preventDefault();
          event.stopPropagation();
          void remove();
        }}
        disabled={busy}
        title={`Delete ${name}`}
        aria-label={`Delete ${name}`}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      </button>
      {error && (
        <span className="absolute inset-x-3 bottom-2 rounded-lg border border-serious/35 bg-serious/12 px-2.5 py-1.5 text-[0.6875rem] leading-relaxed text-serious">
          {error}
        </span>
      )}
    </>
  );
}
