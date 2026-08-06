import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BM Time',
  description: 'Bargain Moulding employee time clock',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
