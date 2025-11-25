"use client";
import { useRef, useState, useEffect } from 'react';
import { PhaserGame, IRefPhaserGame } from './PhaserGame';
import { EventBus } from '../game/EventBus';
import { RefreshCcw, Share2, Trophy } from 'lucide-react';

export default function GameWrapper() {
    const phaserRef = useRef<IRefPhaserGame>(null);
    const [moves, setMoves] = useState(0);
    const [time, setTime] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [scene, setScene] = useState<Phaser.Scene | null>(null);

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    const currentScene = (scene_instance: Phaser.Scene) => {
        setScene(scene_instance);
    };

    useEffect(() => {
        const handleStats = (data: { moves: number, time: number }) => {
            setMoves(data.moves);
            setTime(data.time);
        };

        const handleComplete = (data: { moves: number, time: number }) => {
            setMoves(data.moves);
            setTime(data.time);
            setIsComplete(true);
        };

        EventBus.on('stats-update', handleStats);
        EventBus.on('game-complete', handleComplete);

        return () => {
            EventBus.removeListener('stats-update');
            EventBus.removeListener('game-complete');
        };
    }, []);

    const handleShare = () => {
        const dateStr = new Date().toISOString().split('T')[0];
        const text = `Mazle ${dateStr}\nMoves: ${moves}\nTime: ${formatTime(time)}\nPlay at: [URL]`;
        navigator.clipboard.writeText(text);
        alert("Result copied to clipboard!");
    };

    return (
        <div className="relative w-full h-full">
            {/* HUD */}
            <div className="absolute top-0 left-0 w-full p-4 flex justify-between items-start pointer-events-none z-10">
                <div className="bg-gray-900/80 border border-gray-700 rounded-lg p-2 text-white font-mono text-sm backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400">MOVES</span>
                        <span className="text-xl font-bold text-yellow-400">{moves}</span>
                    </div>
                </div>
                <div className="bg-gray-900/80 border border-gray-700 rounded-lg p-2 text-white font-mono text-sm backdrop-blur-sm">
                    <div className="flex items-center gap-2">
                        <span className="text-gray-400">TIME</span>
                        <span className="text-xl font-bold text-blue-400">{formatTime(time)}</span>
                    </div>
                </div>
            </div>

            {/* Game */}
            <PhaserGame ref={phaserRef} currentActiveScene={currentScene} />

            {/* Complete Modal */}
            {isComplete && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-gray-800 border-2 border-yellow-500 rounded-xl p-6 max-w-xs w-full shadow-2xl text-center">
                        <div className="flex justify-center mb-4">
                            <Trophy className="w-12 h-12 text-yellow-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white mb-2 pixel-font">LEVEL CLEARED!</h2>
                        
                        <div className="grid grid-cols-2 gap-4 my-6">
                            <div className="bg-gray-900 p-3 rounded-lg">
                                <div className="text-xs text-gray-400 mb-1">MOVES</div>
                                <div className="text-2xl font-bold text-white">{moves}</div>
                            </div>
                            <div className="bg-gray-900 p-3 rounded-lg">
                                <div className="text-xs text-gray-400 mb-1">TIME</div>
                                <div className="text-2xl font-bold text-white">{formatTime(time)}</div>
                            </div>
                        </div>

                        <button 
                            onClick={handleShare}
                            className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors mb-3"
                        >
                            <Share2 className="w-4 h-4" />
                            Share Result
                        </button>
                        
                        <p className="text-xs text-gray-500">Come back tomorrow for a new puzzle!</p>
                    </div>
                </div>
            )}
        </div>
    );
}
