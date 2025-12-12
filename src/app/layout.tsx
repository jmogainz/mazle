import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { Nunito, Press_Start_2P } from 'next/font/google';
import './globals.css';

const pixelFont = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
});

const nunito = Nunito({
  weight: ['400', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Mazle - Daily Puzzle Game',
  description: 'A daily Pokémon-inspired puzzle game. Navigate through ice, ledges, and walls to reach the goal!',
  keywords: ['puzzle', 'game', 'daily', 'maze', 'pokemon', 'wordle'],
  authors: [{ name: 'Mazle' }],
  openGraph: {
    title: 'Mazle - Daily Puzzle Game',
    description: 'A daily Pokémon-inspired puzzle game. Navigate through ice, ledges, and walls to reach the goal!',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mazle - Daily Puzzle Game',
    description: 'A daily Pokémon-inspired puzzle game. Navigate through ice, ledges, and walls to reach the goal!',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0f0f1a',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${pixelFont.variable} ${nunito.variable}`}>
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
