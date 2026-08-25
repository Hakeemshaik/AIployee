"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

/**
 * Ends the session server-side, then returns to the sign-in page.
 *
 * The cookie is cleared by the server — clearing it client-side is impossible
 * (it is httpOnly) and pretending otherwise would leave the session live.
 */
export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "signout" }),
      });
    } catch {
      // Even if the request failed, send them to /login — it re-checks the
      // session server-side and will bounce them back if they are still in.
    }
    router.push("/login");
    // Ending the session removes the shell from the root layout; without the
    // refresh the old layout stays on screen with stale navigation.
    router.refresh();
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      className="btn btn-ghost text-[0.71875rem]"
      title="End this session"
    >
      <LogOut size={13} />
      {busy ? "Signing out…" : label}
    </button>
  );
}
