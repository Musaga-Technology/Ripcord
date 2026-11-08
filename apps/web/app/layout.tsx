import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

const description =
  'Everyone can see where your Hyperliquid position dies. Ripcord keeps a reserve nobody can see, and moves it in first.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: { default: 'Ripcord · Hidden margin for Hyperliquid', template: '%s · Ripcord' },
  description,
  openGraph: { title: 'Ripcord · Hidden margin for Hyperliquid', description, type: 'website' },
  twitter: { card: 'summary_large_image', title: 'Ripcord · Hidden margin for Hyperliquid', description },
};

// Applies a saved theme choice before first paint, so a light-mode user never sees a dark flash.
const themeScript = `try{var t=localStorage.getItem('ripcord-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
