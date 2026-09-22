import Link from 'next/link';

export const COMPANY = 'Ledgerline';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#14a89a" />
      <path d="M9 8v16h14" stroke="#0b1526" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M13 17l4-4 3 3 4-5" stroke="#e8fbf8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <BrandMark />
      <span className="leading-tight">
        <span className={`block text-[15px] font-semibold ${dark ? 'text-white' : 'text-ink-950'}`}>{COMPANY}</span>
        <span className={`block text-[10px] font-medium uppercase tracking-[0.14em] ${dark ? 'text-ink-400' : 'text-ink-500'}`}>
          Internal Tools
        </span>
      </span>
    </Link>
  );
}
