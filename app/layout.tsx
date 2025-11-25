import type { Metadata } from 'next';
import './globals.css';
import { Press_Start_2P, Space_Grotesk } from 'next/font/google';

const pixel = Press_Start_2P({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-pixel',
});

const body = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
});

export const metadata: Metadata = {
  title: 'Mazle | Daily Ice Gym Puzzle',
  description: 'A Pokémon-inspired daily maze with ice slides and ledges. Built for fast, shareable solves.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${pixel.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
