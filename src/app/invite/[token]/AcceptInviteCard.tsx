"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Invite acceptance.
//
// The link is the credential: the page describes what the invite is for
// (organization, address, role), the invitee chooses a password, and the
// account is created and signed in. An invalid or expired link states that
// plainly instead of showing a form that cannot succeed.
// ---------------------------------------------------------------------------

type InviteDetails = {
  organizationName: string;
  email: string;
  name: string;
  role: string;
};

export function AcceptInviteCard({ token }: { token: string }) {
  const router = useRouter();
  const [details, setDetails] = useState<InviteDetails | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "submitting">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/invites/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setError(body.message ?? "This invite link is not valid.");
          setState("invalid");
          return;
        }
        setDetails(body as InviteDetails);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setError("The invite could not be checked. Try again.");
        setState("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    setState("submitting");
    setError(null);
    try {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The invite could not be accepted.");
      router.push(body.redirectTo ?? "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The invite could not be accepted.");
      setState("ready");
    }
  }

  return (
    <div className="glass w-full max-w-md p-6">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#3f8de9] to-[#2d6fc4] text-[17px] font-bold text-white shadow-[0_0_22px_rgba(57,135,229,0.35)]">
          A
        </span>
        <h1 className="text-[1.0625rem] font-semibold tracking-tight text-ink">
          {details ? `Join ${details.organizationName}` : "Join organization"}
        </h1>
        {details && (
          <p className="mt-1 text-[0.8125rem] text-ink-2">
            {details.name} · {details.email} · <span className="capitalize">{details.role}</span>
          </p>
        )}
      </div>

      {state === "loading" && (
        <p className="flex items-center justify-center gap-2 py-6 text-[0.8125rem] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Checking this invite
        </p>
      )}

      {state === "invalid" && (
        <div className="rounded-xl border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] p-4">
          <p className="flex items-start gap-2 text-[0.8125rem] text-[#e2714a]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
          <p className="mt-2 text-[0.75rem] text-ink-3">
            Ask your administrator to issue a new invite.
          </p>
        </div>
      )}

      {(state === "ready" || state === "submitting") && details && (
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="password">
              Choose a password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              className="field w-full"
            />
            <p className="mt-1 text-[0.6875rem] text-ink-3">At least 12 characters.</p>
          </div>
          {error && <p className="text-[0.75rem] text-[#ec8181]">{error}</p>}
          <button type="submit" disabled={state === "submitting"} className="btn btn-primary w-full justify-center">
            {state === "submitting" ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Creating account
              </>
            ) : (
              <>
                <KeyRound size={13} /> Set password and join
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
