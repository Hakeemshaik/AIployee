"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/** A select box bound to a URL search param — server components re-filter on change. */
export function ParamSelect({
  param,
  placeholder,
  options,
}: {
  param: string;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  return (
    <select
      className="field min-w-[140px]"
      aria-label={placeholder}
      value={params.get(param) ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        if (e.target.value) next.set(param, e.target.value);
        else next.delete(param);
        startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
      }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
