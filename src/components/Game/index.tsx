'use client';

import dynamic from 'next/dynamic';

const PhaserGame = dynamic(() => import('./PhaserGame'), {
  ssr: false,
  loading: () => <div className="w-full max-w-[500px] aspect-square bg-gray-900 animate-pulse rounded-lg flex items-center justify-center text-gray-500">Loading Game...</div>
});

export default PhaserGame;
