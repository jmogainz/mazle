"use client";

import dynamic from 'next/dynamic';

// Dynamically import the game wrapper to avoid SSR issues with Phaser
const GameWrapper = dynamic(() => import('@/components/GameWrapper'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full text-white">
      Loading Game...
    </div>
  ),
});

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-950">
      <h1 className="text-3xl font-bold mb-4 tracking-widest text-yellow-400 pixel-font">MAZLE</h1>
      <div className="relative w-full max-w-2xl aspect-square md:aspect-[4/3] bg-black border-4 border-gray-700 rounded-lg overflow-hidden shadow-2xl">
        <GameWrapper />
      </div>
      <div className="mt-4 text-gray-400 text-sm text-center max-w-md">
        <p>Use Arrow Keys or Swipe to move.</p>
        <p>Goal: Reach the red flag.</p>
      </div>
    </main>
  );
}
