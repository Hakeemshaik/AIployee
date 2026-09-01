import type { Metadata } from "next";
import "./globals.css";
import { getSession } from "@/lib/session";
import { Topbar } from "@/components/shell/Topbar";

export const metadata: Metadata = {
  title: {
    default: "AIployee — AI Debt Collection Command Centre",
    template: "%s · AIployee",
  },
  description:
    "Command centre for AI-driven debt collection: campaigns, calls, promises to pay, payments, and AI-generated insight.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // With no session the only reachable pages are sign-in and first-run setup,
  // so the shell is left off rather than offering navigation that redirects.
  const session = await getSession().catch(() => null);

  if (!session) {
    return (
      <html lang="en">
        <body className="min-h-screen">
          <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col justify-center px-4 py-10 sm:px-6">
            {children}
          </main>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className="min-h-screen">
        {/* Navigation lives in the header now. A column down the left held
            twelve links and 236px of permanent air on a screen whose job is
            data; the page gets that back. */}
        <div className="flex min-h-screen flex-col">
          <Topbar />
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
