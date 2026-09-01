"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/Select";

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
    <Select
      className="min-w-[140px]"
      aria-label={placeholder}
      value={params.get(param) ?? ""}
      onChange={(value) => {
        const next = new URLSearchParams(params.toString());
        if (value) next.set(param, value);
        else next.delete(param);
        startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
      }}
      options={[{ value: "", label: placeholder }, ...options]}
    />
  );
}
