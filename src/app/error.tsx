"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const needsSeed = error.message?.includes("No organization found");
  return (
    <div className="mx-auto mt-20 max-w-md">
      <div className="glass p-6 text-center">
        <p className="text-[0.9375rem] font-semibold text-ink">
          {needsSeed ? "Database not seeded yet" : "Something went wrong"}
        </p>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-2">
          {needsSeed
            ? "This deployment hasn't been initialised. Run the one-time setup to create your organization."
            : "An unexpected error occurred while loading this page. The details have been logged on the server."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {needsSeed && (
            <a href="/setup" className="btn btn-primary">
              Run setup
            </a>
          )}
          <button onClick={reset} className="btn">
            Try again
          </button>
        </div>
        {!needsSeed && (
          <p className="mt-3 text-[0.6875rem] text-ink-3">
            Fresh deployment? <a href="/setup" className="text-accent hover:underline">Run the one-time setup</a>.
          </p>
        )}
      </div>
    </div>
  );
}
