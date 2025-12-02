'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, MobileControls, ErrorBoundary } from '@/components';
import {
  getPuzzleNumber,
  onGameEvent,
  Direction,
  PuzzleData,
  generatePuzzleParallel,
  getDailySeed,
  GenerationProgress,
  TILE_SIZE,
} from '@/game';
import { getPlayerStats, saveTodaysResult, getTodaysResult, getCachedPuzzle, cachePuzzle } from '@/utils/storage';
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const gameControlsRef = useRef<GameControls | null>(null);
  const debugModeRef = useRef(false);

  const loadDailyPuzzle = useCallback(async () => {
    const today = new Date();
    const todayNumber = getPuzzleNumber(today);
    const todaySeed = getDailySeed(today);
    const playerStats = getPlayerStats();
    const existingResult = getTodaysResult();

    // Set initial state immediately so UI renders
    debugModeRef.current = false;
    setPuzzleNumber(todayNumber);
    setPuzzleLabel(null);
    setActiveSeed(todaySeed);
    setSeedInput('');
    setStats(playerStats);
    setPreviousResult(existingResult);
    setShowShareCard(false);
    setIsPlaying(false);

    if (existingResult?.completed) {
      setGameResult({ moveCount: existingResult.moveCount, timeMs: existingResult.timeMs });
    } else {
      setGameResult(null);
    }

    // Check cache first for instant loading
    const cachedPuzzle = getCachedPuzzle(todaySeed);
    if (cachedPuzzle) {
      setPuzzle(cachedPuzzle);
      setRenderKey((prev) => prev + 1);
      return;
    }

    // Generate puzzle in parallel (non-blocking)
    setIsGenerating(true);
    setGenerationProgress(null);
    
    try {
      const todayPuzzle = await generatePuzzleParallel(todaySeed, setGenerationProgress);
      setPuzzle(todayPuzzle);
      setRenderKey((prev) => prev + 1);
      // Cache for future visits
      cachePuzzle(todaySeed, todayPuzzle);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  }, []);

  // Initialize puzzle and stats - use requestAnimationFrame to ensure first paint
  useEffect(() => {
    // Ensure the loading UI renders before starting heavy computation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loadDailyPuzzle();
      });
    });
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
    async (rawSeed?: string) => {
      if (!DEVTOOLS_ENABLED) return;

      const trimmed = rawSeed?.trim() ?? '';
      const isDateSeed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);

      if (isDateSeed) {
        setIsGenerating(true);
        setGenerationProgress(null);
        
        const targetDate = new Date(trimmed);
        const dailySeed = getDailySeed(targetDate);
        
        try {
          const datedPuzzle = await generatePuzzleParallel(dailySeed, setGenerationProgress);
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
        } finally {
          setIsGenerating(false);
          setGenerationProgress(null);
        }
        return;
      }

      const newSeed =
        trimmed ||
        `dev-${Date.now()}-${Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0')}`;

      setIsGenerating(true);
      setGenerationProgress(null);
      
      try {
        const newPuzzle = await generatePuzzleParallel(newSeed, setGenerationProgress);
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
      } finally {
        setIsGenerating(false);
        setGenerationProgress(null);
      }
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
          <p>
            {generationProgress 
              ? `Generating puzzle... ${generationProgress.workersComplete}/${generationProgress.totalWorkers} workers complete`
              : 'Loading Mazle...'}
          </p>
        </div>
      </main>
    );
  }

  const puzzleWidth = puzzle?.width ?? 10;
  const puzzleHeight = puzzle?.height ?? 10;
  const baseWidth = Math.max(420, puzzleWidth * TILE_SIZE + 64);
  const baseHeight = Math.max(520, puzzleHeight * TILE_SIZE + 120);

  return (
    <ErrorBoundary>
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
            
            {/* Psychology-Based Difficulty Metrics */}
            <div className={styles.devMetrics}>
              <div className={styles.devMetric}>
                <span className={styles.devMetricLabel}>Psych Score</span>
                <span className={styles.devMetricValue}>{puzzle.difficultyScore ?? '—'}</span>
              </div>
              <div className={styles.devMetric}>
                <span className={styles.devMetricLabel}>Moves</span>
                <span className={styles.devMetricValue}>{puzzle.optimalMoves}</span>
              </div>
              <div className={styles.devMetric}>
                <span className={styles.devMetricLabel}>Counter-Int</span>
                <span className={styles.devMetricValue}>{puzzle.counterIntuitiveMoves ?? '—'}</span>
              </div>
              <div className={styles.devMetric}>
                <span className={styles.devMetricLabel}>Decoys</span>
                <span className={styles.devMetricValue}>{puzzle.attractiveDecoys ?? '—'}</span>
              </div>
            </div>
            {/* More Psychology Metrics */}
            <div className={styles.devMetrics}>
              <div className={styles.devMetric}>
                <span className={styles.devMetricLabel}>Commit Gates</span>
                <span className={styles.devMetricValue}>{puzzle.commitmentGates ?? '—'}</span>
              </div>
              <div className={styles.devMetric}>
                <span className={styles.devMetricLabel}>False Prog</span>
                <span className={styles.devMetricValue}>{puzzle.falseProgressPaths ?? '—'}</span>
              </div>
            </div>

            <div className={styles.devControls}>
              <input
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="Custom seed or YYYY-MM-DD"
                className={styles.devInput}
                disabled={isGenerating}
              />
              <button
                type="button"
                className={styles.devButton}
                onClick={() => handleDevSeedGenerate(seedInput)}
                disabled={isGenerating}
              >
                Load seed
              </button>
              <button
                type="button"
                className={styles.devButtonSecondary}
                onClick={() => handleDevSeedGenerate()}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <span className={styles.buttonSpinner} />
                    {generationProgress 
                      ? `${generationProgress.workersComplete}/${generationProgress.totalWorkers} done`
                      : 'Starting...'}
                  </>
                ) : (
                  'Random seed'
                )}
              </button>
              <button 
                type="button" 
                className={styles.devButtonGhost} 
                onClick={handleLoadDaily}
                disabled={isGenerating}
              >
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
        
        <div
          className={styles.gameFrame}
          style={{
            maxWidth: `${baseWidth}px`,
            aspectRatio: `${baseWidth} / ${baseHeight}`,
          }}
        >
          <div className={styles.gameContainer}>
            <div className={`${styles.gameContent} ${(!isPlaying && isGameReady) ? styles.blurred : ''}`}>
              <PhaserGame
                key={renderKey}
                puzzle={puzzle}
                viewportWidth={baseWidth}
                viewportHeight={baseHeight}
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
    </ErrorBoundary>
  );
}
