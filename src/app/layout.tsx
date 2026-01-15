import type { Metadata, Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { Nunito, Press_Start_2P, Roboto } from 'next/font/google';
import Script from 'next/script';
import ThemeApplier from '@/components/ThemeApplier';
import './globals.css';

const CMP_SCRIPT_SRC = process.env.NEXT_PUBLIC_CMP_SCRIPT_SRC || '';
const IS_PROD = process.env.NEXT_PUBLIC_ENV === 'prod';
const ADSENSE_TOP_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_TOP ?? (!IS_PROD ? 'DEV_TOP' : '');
const ADSENSE_BOTTOM_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM ?? (!IS_PROD ? 'DEV_BOTTOM' : '');
const AD_BANNER_HEIGHT = 50;

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

const roboto = Roboto({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-roboto',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://mazle.io'),
  title: {
    default: 'Mazle | Daily Puzzle Game',
    template: '%s | Mazle',
  },
  description: 'Play Mazle, the daily sliding puzzle game. Navigate ice, ledges, and walls to solve the maze in the optimal number of moves. Can you solve today\'s maze?',
  applicationName: 'Mazle',
  keywords: [
    'mazle',
    'daily puzzle game',
    'puzzle game',
    'ice puzzle',
    'maze game',
    'sliding puzzle',
    'logic puzzle',
    'brain training',
    'daily challenge',
    'wordle style game',
    'puzzle strategy',
  ],
  authors: [{ name: 'Mazle' }],
  creator: 'Mazle',
  publisher: 'Mazle',
  manifest: '/manifest.json',
  alternates: {
    canonical: '/',
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
      { url: '/favicon-48x48.png', sizes: '48x48', type: 'image/png' },
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
    title: 'Mazle | Daily Puzzle Game',
    description: 'The daily sliding puzzle game. Navigate ice, ledges, and walls to reach the goal in the perfect number of moves. Can you solve today\'s maze?',
    siteName: 'Mazle',
    type: 'website',
    locale: 'en_US',
    url: 'https://mazle.io',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Mazle - Daily Puzzle Game',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mazle | Daily Puzzle Game',
    description: 'The daily sliding puzzle game. Can you solve today\'s maze in the optimal number of moves?',
    images: ['/icon-512.png'],
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
  overlay,
}: {
  children: React.ReactNode;
  overlay: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${pixelFont.variable} ${nunito.variable} ${roboto.variable}`}
      suppressHydrationWarning
    >
      <head>
        {CMP_SCRIPT_SRC ? (
          <Script
            id="cmp-script"
            strategy="beforeInteractive"
            src={CMP_SCRIPT_SRC}
            crossOrigin="anonymous"
          />
        ) : null}
        <link rel="preload" as="image" href="/assets/images/alive_character.svg" type="image/svg+xml" />
        <link rel="preload" as="image" href="/assets/images/dead_character.svg" type="image/svg+xml" />
      </head>
      <body suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document;var w=window;var vh=(w.visualViewport&&w.visualViewport.height)||w.innerHeight;var vw=w.innerWidth;var showTopAd=${Boolean(ADSENSE_TOP_SLOT)};var showBottomAd=${Boolean(ADSENSE_BOTTOM_SLOT)};var HEADER_HEIGHT=56;var PUZZLE_NUM_HEIGHT=32;var SCOREBOARD_HEIGHT=70;var CONTROLS_HEIGHT=56;var FOOTER_HEIGHT=vw>768?32:0;var AD_HEIGHT=(showTopAd?${AD_BANNER_HEIGHT}+8:0)+(showBottomAd?${AD_BANNER_HEIGHT}+8:0);var PADDING=24;var totalUIHeight=HEADER_HEIGHT+PUZZLE_NUM_HEIGHT+SCOREBOARD_HEIGHT+CONTROLS_HEIGHT+FOOTER_HEIGHT+AD_HEIGHT+PADDING;var availableForMaze=vh-totalUIHeight;var MAX_MAZE_SIZE=520;var UI_SCALE_MIN=0.70;var UI_SCALE_MAX=1;var maxMazeByWidth=Math.max(1,Math.min(vw-4,MAX_MAZE_SIZE));var idealMazeSize=Math.min(maxMazeByWidth,MAX_MAZE_SIZE);var neededForIdealMaze=idealMazeSize;var uiScale=UI_SCALE_MAX;if(availableForMaze<neededForIdealMaze){var uiScalableHeight=HEADER_HEIGHT+PUZZLE_NUM_HEIGHT+SCOREBOARD_HEIGHT+CONTROLS_HEIGHT;var deficit=neededForIdealMaze-availableForMaze;var maxUISavings=uiScalableHeight*(1-UI_SCALE_MIN);if(deficit<=maxUISavings){uiScale=1-(deficit/uiScalableHeight);uiScale=Math.max(UI_SCALE_MIN,Math.min(UI_SCALE_MAX,uiScale));}else{uiScale=UI_SCALE_MIN;}}var uiScaleValue=Math.round(uiScale*1000)/1000;var scaledUIHeight=(HEADER_HEIGHT+PUZZLE_NUM_HEIGHT+SCOREBOARD_HEIGHT+CONTROLS_HEIGHT)*uiScale+FOOTER_HEIGHT+AD_HEIGHT+PADDING;var actualAvailable=vh-scaledUIHeight;var gameSize=Math.min(maxMazeByWidth,Math.max(1,Math.floor(actualAvailable)),MAX_MAZE_SIZE);var style=d.getElementById('ui-scale-preload-style');if(!style){style=d.createElement('style');style.id='ui-scale-preload-style';style.type='text/css';d.head.appendChild(style);}style.textContent=':root{--vh:'+vh+'px;--ui-scale:'+uiScaleValue.toFixed(3)+';--game-size:'+gameSize+'px;}';}catch(e){}})();`,
          }}
        />
        <ThemeApplier />
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
              description: 'A daily sliding puzzle game. Navigate ice, ledges, and walls to solve the maze in the optimal number of moves. Can you solve today\'s maze?',
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
              description: 'Daily sliding puzzle game. Solve the maze in the optimal number of moves.',
              url: 'https://mazle.io',
              genre: ['Puzzle', 'Strategy', 'Brain Training', 'Logic'],
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
        {overlay}
        <Analytics />
      </body>
    </html>
  );
}
