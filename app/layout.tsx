import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Ledgerline · Internal Tools',
  description: 'Ledgerline internal tools platform',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
