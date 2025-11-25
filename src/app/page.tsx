'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, MobileControls } from '@/components';
import {
  getTodaysPuzzle,
  getPuzzleNumber,
  onGameEvent,
  Direction,
  PuzzleData,
  generatePuzzle,
  getDailySeed,
  getPuzzleForDate,
} from '@/game';
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

const DEVTOOLS_ENABLED =
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === 'true';

export default function Home() {
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState(0);
  const [puzzleLabel, setPuzzleLabel] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [renderKey, setRenderKey] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number } | null>(null);
  const [previousResult, setPreviousResult] = useState<DailyStats | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const gameControlsRef = useRef<GameControls | null>(null);
  const debugModeRef = useRef(false);

  const loadDailyPuzzle = useCallback(() => {
    const today = new Date();
    const todayPuzzle = getTodaysPuzzle();
    const todayNumber = getPuzzleNumber(today);
    const todaySeed = getDailySeed(today);
    const playerStats = getPlayerStats();
    const existingResult = getTodaysResult();

    debugModeRef.current = false;
    setPuzzle(todayPuzzle);
    setPuzzleNumber(todayNumber);
    setPuzzleLabel(null);
    setActiveSeed(todaySeed);
    setSeedInput('');
    setRenderKey((prev) => prev + 1);
    setStats(playerStats);
    setPreviousResult(existingResult);
    setShowShareCard(false);
    setIsPlaying(false);

    if (existingResult?.completed) {
      setGameResult({ moveCount: existingResult.moveCount, timeMs: existingResult.timeMs });
    } else {
      setGameResult(null);
    }
  }, []);

  // Initialize puzzle and stats
  useEffect(() => {
    loadDailyPuzzle();
  }, [loadDailyPuzzle]);

  // Listen for game completion
  useEffect(() => {
    const unsubscribe = onGameEvent('gameComplete', (data) => {
      const result = data as { moveCount: number; timeMs: number; optimalMoves: number };
      setGameResult(result);
      setShowShareCard(true);

      if (debugModeRef.current) {
        return;
      }

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
    setIsPlaying(false);
    gameControlsRef.current?.restart();
    setShowShareCard(false);
  }, []);

  const handleBegin = useCallback(() => {
    setIsPlaying(true);
    gameControlsRef.current?.start();
  }, []);

  const handleDevSeedGenerate = useCallback(
    (rawSeed?: string) => {
      if (!DEVTOOLS_ENABLED) return;

      const trimmed = rawSeed?.trim() ?? '';
      const isDateSeed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);

      if (isDateSeed) {
        const targetDate = new Date(trimmed);
        const datedPuzzle = getPuzzleForDate(targetDate);
        const dailySeed = getDailySeed(targetDate);
        debugModeRef.current = true;
        setPuzzle(datedPuzzle);
        setPuzzleNumber(getPuzzleNumber(targetDate));
        setPuzzleLabel(`DATE ${trimmed}`);
        setActiveSeed(dailySeed);
        setSeedInput(trimmed);
        setGameResult(null);
        setShowShareCard(false);
        setPreviousResult(null);
        setIsPlaying(false);
        return;
      }

      const newSeed =
        trimmed ||
        `dev-${Date.now()}-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0')}`;

      const newPuzzle = generatePuzzle(newSeed);
      debugModeRef.current = true;
      setPuzzle(newPuzzle);
      setPuzzleLabel(`DEV ${newSeed}`);
      setActiveSeed(newSeed);
      setSeedInput(newSeed);
      setRenderKey((prev) => prev + 1);
      setGameResult(null);
      setShowShareCard(false);
      setPreviousResult(null);
      setIsPlaying(false);
    },
    [],
  );

  const handleLoadDaily = useCallback(() => {
    loadDailyPuzzle();
  }, [loadDailyPuzzle]);

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
      <main className={`${styles.main} bg-pattern`} style={{ justifyContent: 'center' }}>
        <div className={styles.loading} style={{ minHeight: 'auto' }}>
          <div className={styles.loadingSpinner} />
          <p>Loading Mazle...</p>
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
        {DEVTOOLS_ENABLED && (
          <div className={styles.devPanel}>
            <div className={styles.devPanelHeader}>
              <span className={styles.devPanelTitle}>Dev tools</span>
              <span className={styles.devPanelSeed}>
                {puzzleLabel ?? `Daily #${puzzleNumber}`} • Seed: {activeSeed || 'daily'}
              </span>
            </div>
            <div className={styles.devControls}>
              <input
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="Custom seed or YYYY-MM-DD"
                className={styles.devInput}
              />
              <button
                type="button"
                className={styles.devButton}
                onClick={() => handleDevSeedGenerate(seedInput)}
              >
                Load seed
              </button>
              <button
                type="button"
                className={styles.devButtonSecondary}
                onClick={() => handleDevSeedGenerate()}
              >
                Random seed
              </button>
              <button type="button" className={styles.devButtonGhost} onClick={handleLoadDaily}>
                Back to daily
              </button>
            </div>
            <p className={styles.devHint}>Dev-test only. Dev runs are not saved to stats.</p>
          </div>
        )}

        <GameUI
          puzzleNumber={puzzleNumber}
          puzzleLabel={puzzleLabel ?? undefined}
        />
        
        <div className={styles.gameFrame}>
          <div 
            className={styles.gameContainer}
            style={{
              aspectRatio: `${Math.max(420, puzzle.width * 32 + 64)} / ${Math.max(520, puzzle.height * 32 + 120)}`,
              maxWidth: `${Math.max(420, puzzle.width * 32 + 64)}px`
            }}
          >
            <div className={`${styles.gameContent} ${(!isPlaying && isGameReady) ? styles.blurred : ''}`}>
              <PhaserGame
                key={renderKey}
                puzzle={puzzle}
                onReady={handleGameReady}
              />
            </div>
          </div>
          {!isPlaying && isGameReady && (
            <div className={styles.startOverlay}>
              <button className={styles.startButton} onClick={handleBegin}>
                Begin
              </button>
            </div>
          )}
        </div>

        <MobileControls
          onMove={handleMobileMove}
          disabled={!isGameReady || !!gameResult || !isPlaying}
        />

        {previousResult && !showShareCard && !isPlaying && (
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
          puzzleLabel={puzzleLabel ?? undefined}
          moveCount={gameResult.moveCount}
          timeMs={gameResult.timeMs}
          optimalMoves={puzzle.optimalMoves}
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
