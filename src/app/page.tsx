'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, MobileControls } from '@/components';
import { getTodaysPuzzle, getPuzzleNumber, onGameEvent, Direction, PuzzleData } from '@/game';
import { getPlayerStats, saveTodaysResult, getTodaysResult } from '@/utils/storage';
import { PlayerStats, DailyStats } from '@/game/types';
import type { GameControls } from '@/game/PhaserGame';
import styles from './page.module.css';

// Dynamic import for Phaser (client-side only)
const PhaserGame = dynamic(() => import('@/game/PhaserGame'), {
  ssr: false,
  loading: () => (
    <div className={styles.loading}>
      <div className={styles.loadingSpinner} />
      <p>Loading puzzle...</p>
    </div>
  ),
});

export default function Home() {
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number } | null>(null);
  const [previousResult, setPreviousResult] = useState<DailyStats | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const gameControlsRef = useRef<GameControls | null>(null);

  // Initialize puzzle and stats
  useEffect(() => {
    const todayPuzzle = getTodaysPuzzle();
    const todayNumber = getPuzzleNumber(new Date());
    const playerStats = getPlayerStats();
    const existingResult = getTodaysResult();

    setPuzzle(todayPuzzle);
    setPuzzleNumber(todayNumber);
    setStats(playerStats);
    setPreviousResult(existingResult);

    // If already played today, show the result
    if (existingResult?.completed) {
      setGameResult({ moveCount: existingResult.moveCount, timeMs: existingResult.timeMs });
    }
  }, []);

  // Listen for game completion
  useEffect(() => {
    const unsubscribe = onGameEvent('gameComplete', (data) => {
      const result = data as { moveCount: number; timeMs: number; optimalMoves: number };
      setGameResult(result);
      setShowShareCard(true);

      // Save result if not already saved today
      if (!previousResult) {
        const dailyResult: DailyStats = {
          date: new Date().toISOString().split('T')[0],
          completed: true,
          moveCount: result.moveCount,
          timeMs: result.timeMs,
          puzzleNumber,
        };
        saveTodaysResult(dailyResult);
        setStats(getPlayerStats());
        setPreviousResult(dailyResult);
      }
    });

    return unsubscribe;
  }, [puzzleNumber, previousResult]);

  // Handle mobile control input
  const handleMobileMove = useCallback((direction: Direction) => {
    // Directly call the game's movePlayer method
    gameControlsRef.current?.movePlayer(direction);
  }, []);

  const handleRestart = useCallback(() => {
    gameControlsRef.current?.restart();
    setShowShareCard(false);
  }, []);

  const handleGameReady = useCallback((controls: GameControls) => {
    gameControlsRef.current = controls;
    setIsGameReady(true);
    
    // Show help on first visit
    const hasSeenHelp = localStorage.getItem('mazle_seen_help');
    if (!hasSeenHelp) {
      setShowHelp(true);
      localStorage.setItem('mazle_seen_help', 'true');
    }
  }, []);

  if (!puzzle) {
    return (
      <main className={styles.main}>
        <div className={styles.loading}>
          <div className={styles.loadingSpinner} />
          <p>Generating puzzle...</p>
        </div>
      </main>
    );
  }

  return (
    <main className={`${styles.main} bg-pattern`}>
      <Header
        streak={stats?.currentStreak || 0}
        onHelpClick={() => setShowHelp(true)}
        onStatsClick={() => setShowStats(true)}
      />

      <div className={styles.gameWrapper}>
        <GameUI puzzleNumber={puzzleNumber} optimalMoves={puzzle.optimalMoves} />
        
        <div className={styles.gameContainer}>
          <PhaserGame
            puzzle={puzzle}
            onReady={handleGameReady}
          />
        </div>

        <MobileControls
          onMove={handleMobileMove}
          disabled={!isGameReady || !!gameResult}
        />

        {previousResult && !showShareCard && (
          <div className={styles.previousResult}>
            <p>You already completed today&apos;s puzzle!</p>
            <button onClick={() => setShowShareCard(true)} className={styles.viewResultButton}>
              View Result
            </button>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <p>Use arrow keys or swipe to move</p>
      </footer>

      {/* Modals */}
      {showShareCard && gameResult && (
        <ShareCard
          puzzleNumber={puzzleNumber}
          moveCount={gameResult.moveCount}
          timeMs={gameResult.timeMs}
          optimalMoves={puzzle.optimalMoves}
          puzzle={puzzle}
          onClose={() => setShowShareCard(false)}
          onPlayAgain={handleRestart}
        />
      )}

      {showStats && stats && (
        <StatsModal stats={stats} onClose={() => setShowStats(false)} />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </main>
  );
}

