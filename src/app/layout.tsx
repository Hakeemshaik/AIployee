import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { Topbar } from "@/components/shell/Topbar";

export const metadata: Metadata = {
  title: {
    default: "AIployee — AI Debt Collection Command Centre",
    template: "%s · AIployee",
  },
  description:
    "Command centre for AI-driven debt collection: campaigns, calls, promises to pay, payments, and AI-generated insight.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
