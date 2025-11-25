import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Mazle - Daily Puzzle',
  description: 'A daily Pokémon-inspired puzzle game.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white antialiased h-screen w-screen flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  )
}
