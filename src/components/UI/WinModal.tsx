'use client';
import { useEffect, useState } from 'react';
import { EventBus } from '@/game/EventBus';

export default function WinModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState({ moves: 0, time: 0 });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleWin = (finalStats: { moves: number; time: number }) => {
      setStats(finalStats);
      setIsOpen(true);
    };

    EventBus.on('game-win', handleWin);
    return () => {
      EventBus.off('game-win', handleWin);
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleShare = async () => {
    const date = new Date().toLocaleDateString();
    const text = `Mazle ${date}\nMoves: ${stats.moves}\nTime: ${formatTime(stats.time)}\n\nPlay at: https://mazle-game.vercel.app`; // Placeholder URL
    
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handlePlayAgain = () => {
      setIsOpen(false);
      EventBus.emit('request-restart');
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 p-8 rounded-xl max-w-sm w-full shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-300">
        <h2 className="text-3xl font-bold text-yellow-400 mb-2">Level Clear!</h2>
        <p className="text-gray-400 text-sm mb-6">Great job solving today's puzzle.</p>
        
        <div className="grid grid-cols-2 gap-4 w-full mb-8">
          <div className="bg-gray-800 p-4 rounded-lg flex flex-col items-center border border-gray-700">
            <span className="text-xs text-gray-400 uppercase mb-1">Moves</span>
            <span className="text-2xl font-bold text-white">{stats.moves}</span>
          </div>
          <div className="bg-gray-800 p-4 rounded-lg flex flex-col items-center border border-gray-700">
            <span className="text-xs text-gray-400 uppercase mb-1">Time</span>
            <span className="text-2xl font-bold text-white">{formatTime(stats.time)}</span>
          </div>
        </div>

        <button 
          onClick={handleShare}
          className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg mb-3 transition-colors flex items-center justify-center gap-2"
        >
          {copied ? 'Copied to Clipboard!' : 'Share Result'}
        </button>
        
        <button 
          onClick={handlePlayAgain}
          className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
        >
          Play Again
        </button>
      </div>
    </div>
  );
}
