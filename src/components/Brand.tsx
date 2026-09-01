// ---------------------------------------------------------------------------
// The mark.
//
// Four bars rising left to right: a voice on a line, and a book being recovered.
// Three in teal, the tallest in cream — the two Mafadi colours, and nothing
// else. It replaces a gradient box with the letter A in it, which said nothing
// and went muddy at favicon size.
//
// Drawn on a 32-unit grid with 3-unit bars on a 6-unit pitch, so every edge
// lands on a whole pixel at 16, 32 and 64.
// ---------------------------------------------------------------------------

export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="32" height="32" rx="9" fill="#15202E" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" stroke="rgba(22,179,162,0.35)" />
      <rect x="6" y="18" width="3" height="8" rx="1.5" fill="#16B3A2" opacity="0.5" />
      <rect x="12" y="14" width="3" height="12" rx="1.5" fill="#16B3A2" opacity="0.75" />
      <rect x="18" y="10" width="3" height="16" rx="1.5" fill="#16B3A2" />
      <rect x="24" y="6" width="3" height="20" rx="1.5" fill="#FBF3D6" />
    </svg>
  );
}

/** The mark with the name beside it, as it appears in the sidebar. */
export function BrandLockup() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark size={30} />
      <span className="leading-tight">
        {/* "AI" is set apart because in a humanist sans a capital I and a
            lowercase l are the same stroke — the wordmark read "Alployee". */}
        <span className="block text-[0.9375rem] font-semibold tracking-tight text-ink">
          <span className="text-accent">AI</span>ployee
        </span>
        <span className="block text-[0.5625rem] font-medium uppercase tracking-[0.16em] text-ink-3">
          Command Centre
        </span>
      </span>
    </span>
  );
}
