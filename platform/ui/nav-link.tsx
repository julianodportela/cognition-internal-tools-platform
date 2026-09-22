'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition ${
        active
          ? 'bg-ink-800 text-white shadow-[inset_2px_0_0_0_var(--color-brand-400)]'
          : 'text-ink-300 hover:bg-ink-900 hover:text-white'
      }`}
    >
      {children}
    </Link>
  );
}
