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
  applicationName: 'Mazle',
  keywords: ['puzzle', 'game', 'daily', 'maze', 'pokemon', 'wordle'],
  authors: [{ name: 'Mazle' }],
  manifest: '/manifest.json',
  alternates: {
    canonical: 'https://mazle.io',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      {
        rel: 'mask-icon',
        url: '/pinned-mask.svg',
        color: '#ff4d4d',
      },
    ],
  },
  openGraph: {
    title: 'Mazle - Daily Puzzle Game',
    description: 'A daily Pokémon-inspired puzzle game. Navigate through ice, ledges, and walls to reach the goal!',
    siteName: 'Mazle',
    type: 'website',
    locale: 'en_US',
    url: 'https://mazle.io',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mazle - Daily Puzzle Game',
    description: 'A daily Pokémon-inspired puzzle game. Navigate through ice, ledges, and walls to reach the goal!',
  },
  appleWebApp: {
    capable: true,
    title: 'Mazle',
    statusBarStyle: 'black-translucent',
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
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'Mazle',
              alternateName: ['Mazle Game', 'Daily Maze Puzzle'],
              url: 'https://mazle.io',
              description: 'A daily Pokémon-inspired puzzle game. Navigate through ice, ledges, and walls to reach the goal!',
            }),
          }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
