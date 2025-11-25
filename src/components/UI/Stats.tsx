'use client';
import { useEffect, useState } from 'react';
import { EventBus } from '@/game/EventBus';

export default function Stats() {
  const [stats, setStats] = useState({ moves: 0, time: 0 });

  useEffect(() => {
    const handleUpdate = (newStats: { moves: number; time: number }) => {
      setStats(newStats);
    };
    
    EventBus.on('stats-update', handleUpdate);
    EventBus.on('game-start', () => setStats({ moves: 0, time: 0 }));
    
    return () => {
      EventBus.off('stats-update', handleUpdate);
      EventBus.off('game-start');
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex justify-center gap-8 mb-4 font-mono text-lg bg-gray-800 p-4 rounded-lg w-full max-w-[500px]">
      <div className="flex flex-col items-center">
        <span className="text-xs text-gray-400 uppercase tracking-wider">Moves</span>
        <span className="font-bold text-white text-2xl">{stats.moves}</span>
      </div>
      <div className="flex flex-col items-center">
        <span className="text-xs text-gray-400 uppercase tracking-wider">Time</span>
        <span className="font-bold text-white text-2xl">{formatTime(stats.time)}</span>
      </div>
    </div>
  );
}
