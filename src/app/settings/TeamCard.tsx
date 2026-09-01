"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, UserPlus, X } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { useConfirm } from "@/components/Dialog";
import { Select } from "@/components/Select";

// ---------------------------------------------------------------------------
// Team management (admin).
//
// Invites work by link because the deployment sends no email: the link is
// shown exactly once after creation, and the administrator passes it on
// through whatever channel the team already uses. Roles can be changed and
// members removed here, with the last admin protected server-side.
// ---------------------------------------------------------------------------

const ROLES = ["admin", "manager", "collector", "viewer"] as const;

type Member = {
  id: string;
  name: string;
  email: string;
  role: string;
  canSignIn: boolean;
};

type PendingInvite = {
  id: string;
  email: string;
  name: string;
  role: string;
  expiresAt: string;
};

type Team = { users: Member[]; invites: PendingInvite[] };

async function fetchTeam(): Promise<Team> {
  const response = await fetch("/api/settings/team", { cache: "no-store" });
  const body = (await response.json()) as Team & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The team could not be loaded.");
  return body;
}

export function TeamCard({ selfId }: { selfId: string }) {
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const [refresh, setRefresh] = useState(0);
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    fetchTeam()
      .then((loaded) => {
        if (cancelled) return;
        setTeam(loaded);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "The team could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function act(body: Record<string, unknown>, key: string): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setError(null);
    try {
      const response = await fetch("/api/settings/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await response.json();
      if (!response.ok) throw new Error(parsed.message ?? "That change was not applied.");
      setRefresh((n) => n + 1);
      return parsed as Record<string, unknown>;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change was not applied.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const result = await act(
      {
        action: "invite",
        email,
        name: String(form.get("name") ?? "").trim(),
        role: String(form.get("role") ?? "collector"),
      },
      "invite",
    );
    if (result?.token) {
      setInviteLink({ email, url: `${window.location.origin}/invite/${result.token}` });
      setShowForm(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The link stays visible for manual copying.
    }
  }

  return (
    <Card
      title="Team"
      subtitle="Members, roles and invitations"
      actions={
        <button className="btn" onClick={() => setShowForm((value) => !value)}>
          {showForm ? <X size={13} /> : <UserPlus size={13} />}
          {showForm ? "Cancel" : "Invite member"}
        </button>
      }
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-serious/35 bg-serious/8 px-3 py-2 text-[0.78125rem] text-serious">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {inviteLink && (
        <div className="mb-4 rounded-lg border border-good/35 bg-good/8 p-3">
          <p className="text-[0.78125rem] font-medium text-ink">
            Invite created for {inviteLink.email}
          </p>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-ink-3">
            This link is shown once and expires in seven days. Send it to them directly.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="num flex-1 truncate rounded-lg border border-line bg-ink/[0.05] px-3 py-2 text-[0.71875rem] text-ink">
              {inviteLink.url}
            </code>
            <button className="btn shrink-0" onClick={copyLink}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={invite} className="mb-4 grid gap-3 rounded-lg border border-line bg-ink/[0.025] p-3 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-[0.6875rem] font-medium text-ink-2" htmlFor="invite-name">
              Name
            </label>
            <input id="invite-name" name="name" required minLength={2} className="field w-full" />
          </div>
          <div>
            <label className="mb-1 block text-[0.6875rem] font-medium text-ink-2" htmlFor="invite-email">
              Email
            </label>
            <input id="invite-email" name="email" type="email" required className="field w-full" />
          </div>
          <div>
            <label className="mb-1 block text-[0.6875rem] font-medium text-ink-2" htmlFor="invite-role">
              Role
            </label>
            <Select
              id="invite-role"
              name="role"
              defaultValue="collector"
              className="w-full capitalize"
              options={ROLES.map((role) => ({ value: role, label: role }))}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={busy === "invite"} className="btn btn-primary w-full justify-center">
              {busy === "invite" ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              Create invite
            </button>
          </div>
        </form>
      )}

      {!team ? (
        <p className="flex items-center gap-2 py-4 text-[0.8125rem] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Loading team
        </p>
      ) : (
        <>
          <ul className="space-y-2.5">
            {team.users.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[0.8125rem] font-medium text-ink">
                    {member.name}
                    {member.id === selfId && <span className="ml-1.5 text-[0.6875rem] font-normal text-ink-3">(you)</span>}
                  </p>
                  <p className="truncate text-[0.6875rem] text-ink-3">
                    {member.email}
                    {!member.canSignIn && " · no password set"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={member.role}
                    disabled={busy !== null || member.id === selfId}
                    onChange={(role) => void act({ action: "change_role", userId: member.id, role }, member.id)}
                    className="w-auto px-2 py-1 text-[0.71875rem] capitalize"
                    aria-label={`Role for ${member.name}`}
                    options={ROLES.map((role) => ({ value: role, label: role }))}
                  />
                  {member.id !== selfId && (
                    <button
                      className="btn btn-ghost text-[0.6875rem]"
                      disabled={busy !== null}
                      onClick={() => {
                        void (async () => {
                          const ok = await confirm({
                            title: `Remove ${member.name}?`,
                            body: (
                              <>
                                <span className="font-medium text-ink">{member.email}</span> loses
                                access to this organisation immediately. Their sign-in stops
                                working; nothing they recorded is deleted.
                              </>
                            ),
                            confirmLabel: "Remove them",
                            kind: "danger",
                          });
                          if (ok) act({ action: "remove_user", userId: member.id }, member.id);
                        })();
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {team.invites.length > 0 && (
            <div className="mt-4 border-t border-line-2 pt-3">
              <p className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                Pending invitations
              </p>
              <ul className="space-y-2">
                {team.invites.map((pending) => (
                  <li key={pending.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[0.78125rem] text-ink">{pending.name}</p>
                      <p className="truncate text-[0.6875rem] text-ink-3">{pending.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge value="pending" label={pending.role} />
                      <button
                        className="btn btn-ghost text-[0.6875rem]"
                        disabled={busy !== null}
                        onClick={() => void act({ action: "revoke_invite", inviteId: pending.id }, pending.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
