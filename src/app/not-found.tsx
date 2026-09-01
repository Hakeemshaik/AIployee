import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto mt-20 max-w-md">
      <div className="card p-6 text-center">
        <p className="text-[0.9375rem] font-semibold text-ink">Not found</p>
        <p className="mt-2 text-[0.8125rem] text-ink-2">
          This record doesn&apos;t exist or belongs to a different organization.
        </p>
        <Link href="/" className="btn mt-4 inline-flex">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
