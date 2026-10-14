export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[19px] font-medium tracking-[-0.02em]">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="16" fill="var(--color-lime)" />
        <path d="M8.5 13.5c2.2-2.6 4.6-2.6 7.5 0s5.3 2.6 7.5 0M8.5 19c2.2-2.6 4.6-2.6 7.5 0s5.3 2.6 7.5 0" stroke="#141714" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </svg>
      {!compact && <span>hydris<span className="text-muted">/</span><span className="font-light">glasses</span></span>}
    </span>
  );
}
