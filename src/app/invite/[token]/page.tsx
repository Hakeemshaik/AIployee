import { AcceptInviteCard } from "./AcceptInviteCard";

export const metadata = { title: "Join organization" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <AcceptInviteCard token={token} />
    </div>
  );
}
