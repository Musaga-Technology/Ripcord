import type { Metadata } from 'next';
import { Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const instrument = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-instrument',
});
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-jetbrains' });

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
    <html lang="en" className={`${instrument.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
