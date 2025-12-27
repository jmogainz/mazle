import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { Nunito, Press_Start_2P } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const CMP_SCRIPT_SRC = process.env.NEXT_PUBLIC_CMP_SCRIPT_SRC || '';

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
  title: {
    default: 'Mazle - Free Daily Puzzle Game | Ice Maze Challenge',
    template: '%s | Mazle',
  },
  description: 'Play Mazle, the free daily puzzle game inspired by Pokémon ice gym puzzles. Navigate ice, ledges, and walls to solve the maze in 10 moves. New puzzle every day!',
  applicationName: 'Mazle',
  keywords: [
    'mazle',
    'daily puzzle game',
    'free puzzle game',
    'ice puzzle',
    'maze game',
    'pokemon ice gym puzzle',
    'wordle alternative',
    'brain training game',
    'logic puzzle',
    'sliding puzzle',
    'daily challenge',
  ],
  authors: [{ name: 'Mazle' }],
  creator: 'Mazle',
  publisher: 'Mazle',
  manifest: '/manifest.json',
  alternates: {
    canonical: 'https://mazle.io',
  },
  category: 'games',
  classification: 'Puzzle Game',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
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
    title: 'Mazle - Free Daily Puzzle Game',
    description: 'The daily ice puzzle game everyone is playing. Navigate ice, ledges, and walls to reach the goal in 10 moves. Can you solve it?',
    siteName: 'Mazle',
    type: 'website',
    locale: 'en_US',
    url: 'https://mazle.io',
    images: [
      {
        url: 'https://mazle.io/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Mazle - Daily Puzzle Game',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mazle - Free Daily Puzzle Game',
    description: 'The daily ice puzzle game everyone is playing. Can you solve today\'s maze in 10 moves?',
    images: ['https://mazle.io/icon-512.png'],
  },
  appleWebApp: {
    capable: true,
    title: 'Mazle',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'google-site-verification': '',
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
        {CMP_SCRIPT_SRC ? (
          <Script
            id="cmp-script"
            strategy="beforeInteractive"
            src={CMP_SCRIPT_SRC}
            crossOrigin="anonymous"
          />
        ) : null}
      </head>
      <body>
        <Script
          id="adsense"
          strategy="beforeInteractive"
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4676376614824147"
          crossOrigin="anonymous"
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'Mazle',
              alternateName: ['Mazle Game', 'Daily Maze Puzzle', 'Mazle Puzzle'],
              url: 'https://mazle.io',
              description: 'A free daily puzzle game inspired by Pokémon ice gym puzzles. Navigate ice, ledges, and walls to solve the maze in 10 moves.',
              potentialAction: {
                '@type': 'SearchAction',
                target: 'https://mazle.io/?q={search_term_string}',
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'VideoGame',
              name: 'Mazle',
              description: 'Daily ice puzzle game inspired by Pokémon ice gym puzzles',
              url: 'https://mazle.io',
              genre: ['Puzzle', 'Strategy', 'Brain Training'],
              gamePlatform: ['Web Browser'],
              applicationCategory: 'Game',
              operatingSystem: 'Any',
              playMode: 'SinglePlayer',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
                availability: 'https://schema.org/InStock',
              },
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                {
                  '@type': 'ListItem',
                  position: 1,
                  name: 'Home',
                  item: 'https://mazle.io',
                },
              ],
            }),
          }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
