import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Internal Tools' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-white text-slate-900">{children}</body>
    </html>
  );
}
