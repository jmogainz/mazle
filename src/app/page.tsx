'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, MobileControls, ErrorBoundary } from '@/components';
import {
  getPuzzleNumber,
  onGameEvent,
  Direction,
  PuzzleData,
  MapType,
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

// Keep for potential future use (e.g., auto-enable in dev builds)
const _DEVTOOLS_BUILD_FLAG =
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === '1' ||
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === 'true';

// Cheat code validation using hash comparison
// The actual code is never stored as plain text in the bundle
const CHEAT_TIMEOUT_MS = 2000;
const CHEAT_CODE_LENGTH = 5;
// Hash of the cheat code (pre-computed, code itself not in source)
const CHEAT_HASH = 0x5f69e7c;

// Simple hash function for string comparison
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash >>> 0; // Convert to unsigned
}

// Check if buffer ends with the cheat code
function isCheatCode(buffer: string): boolean {
  if (buffer.length < CHEAT_CODE_LENGTH) return false;
  const suffix = buffer.slice(-CHEAT_CODE_LENGTH);
  return hashCode(suffix) === CHEAT_HASH;
}

export default function Home() {
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState(0);
  const [puzzleLabel, setPuzzleLabel] = useState<string | null>(null);
  const [activeSeed, setActiveSeed] = useState('');
  const [seedInput, setSeedInput] = useState('');
  const [selectedMapType, setSelectedMapType] = useState<MapType | 'random'>('random');
  const [renderKey, setRenderKey] = useState(0);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showDevTools, setShowDevTools] = useState(false);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number } | null>(null);
  const [previousResult, setPreviousResult] = useState<DailyStats | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const gameControlsRef = useRef<GameControls | null>(null);
  const debugModeRef = useRef(false);
  const cheatBufferRef = useRef('');
  const cheatTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Secret cheat code listener (hash-based, code not in plain text)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Only track single character keys
      if (e.key.length !== 1) return;

      // Clear timeout and reset buffer after delay
      if (cheatTimeoutRef.current) {
        clearTimeout(cheatTimeoutRef.current);
      }
      cheatTimeoutRef.current = setTimeout(() => {
        cheatBufferRef.current = '';
      }, CHEAT_TIMEOUT_MS);

      // Add key to buffer
      cheatBufferRef.current += e.key.toLowerCase();

      // Keep buffer at reasonable length
      if (cheatBufferRef.current.length > 20) {
        cheatBufferRef.current = cheatBufferRef.current.slice(-20);
      }

      // Check if cheat code was entered (hash comparison)
      if (isCheatCode(cheatBufferRef.current)) {
        cheatBufferRef.current = '';
        setShowDevTools(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (cheatTimeoutRef.current) {
        clearTimeout(cheatTimeoutRef.current);
      }
    };
  }, []);

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
      const trimmed = rawSeed?.trim() ?? '';
      const isDateSeed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
      const forceMapType = selectedMapType === 'random' ? undefined : selectedMapType;

      if (isDateSeed) {
        setIsGenerating(true);
        setGenerationProgress(null);
        
        const targetDate = new Date(trimmed);
        const dailySeed = getDailySeed(targetDate);
        
        try {
          const datedPuzzle = await generatePuzzleParallel(dailySeed, setGenerationProgress, forceMapType);
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
        const newPuzzle = await generatePuzzleParallel(newSeed, setGenerationProgress, forceMapType);
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
    [selectedMapType],
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
              ? generationProgress.phase === 'rust-backend'
                ? 'Generating puzzle via Rust backend...'
                : `Generating puzzle... ${generationProgress.workersComplete}/${generationProgress.totalWorkers} workers complete`
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
        {showDevTools && (
          <div className={styles.devPanel}>
            <div className={styles.devPanelHeader}>
              <span className={styles.devPanelTitle}>🔧 Dev Tools</span>
              <button 
                className={styles.devCloseButton}
                onClick={() => setShowDevTools(false)}
                title="Close (or type 'iddqd' again)"
              >
                ✕
              </button>
            </div>

            {/* Seed Info */}
            <div className={styles.devSeedInfo}>
              <span className={styles.devSeedLabel}>
                {puzzleLabel ?? `Daily #${puzzleNumber}`}
              </span>
              <span className={styles.devSeedValue}>{activeSeed || 'daily'}</span>
            </div>
            
            {/* Core Metrics Grid */}
            <div className={styles.devStatsGrid}>
              <div className={styles.devStatItem}>
                <span className={styles.devStatValue} style={{ textTransform: 'uppercase' }}>
                  {puzzle.mapType ?? 'ice'}
                </span>
                <span className={styles.devStatLabel}>Map</span>
              </div>
              <div className={styles.devStatItem}>
                <span className={styles.devStatValue}>{puzzle.width}×{puzzle.height}</span>
                <span className={styles.devStatLabel}>Size</span>
              </div>
              <div className={styles.devStatItem}>
                <span className={styles.devStatValue}>{puzzle.optimalMoves}</span>
                <span className={styles.devStatLabel}>Moves</span>
              </div>
              <div className={styles.devStatItem}>
                <span className={styles.devStatValue}>{puzzle.difficultyScore ?? '—'}</span>
                <span className={styles.devStatLabel}>Score</span>
              </div>
            </div>

            {/* Psychology Metrics */}
            <div className={styles.devPsychSection}>
              <div className={styles.devPsychHeader}>Psychology Metrics</div>
              <div className={styles.devPsychGrid}>
                <div className={styles.devPsychItem}>
                  <span className={styles.devPsychValue}>{puzzle.counterIntuitiveMoves ?? '—'}</span>
                  <span className={styles.devPsychLabel}>Counter-Intuitive</span>
                </div>
                <div className={styles.devPsychItem}>
                  <span className={styles.devPsychValue}>{puzzle.attractiveDecoys ?? '—'}</span>
                  <span className={styles.devPsychLabel}>Decoys</span>
                </div>
                <div className={styles.devPsychItem}>
                  <span className={styles.devPsychValue}>{puzzle.commitmentGates ?? '—'}</span>
                  <span className={styles.devPsychLabel}>Commitments</span>
                </div>
                <div className={styles.devPsychItem}>
                  <span className={styles.devPsychValue}>{puzzle.falseProgressPaths ?? '—'}</span>
                  <span className={styles.devPsychLabel}>False Progress</span>
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className={styles.devControls}>
              <input
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                placeholder="Custom seed or YYYY-MM-DD"
                className={styles.devInput}
                disabled={isGenerating}
              />
              <select
                value={selectedMapType}
                onChange={(e) => setSelectedMapType(e.target.value as MapType | 'random')}
                className={styles.devSelect}
                disabled={isGenerating}
              >
                <option value="random">Random Map</option>
                <option value={MapType.ICE}>Ice Map</option>
                <option value={MapType.GROUND}>Ground Map</option>
              </select>
              <button
                type="button"
                className={styles.devButton}
                onClick={() => handleDevSeedGenerate(seedInput)}
                disabled={isGenerating}
              >
                Load
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
                      ? generationProgress.phase === 'rust-backend'
                        ? '🦀'
                        : `${generationProgress.workersComplete}/${generationProgress.totalWorkers}`
                      : '...'}
                  </>
                ) : (
                  'Random'
                )}
              </button>
              <button 
                type="button" 
                className={styles.devButtonGhost} 
                onClick={handleLoadDaily}
                disabled={isGenerating}
              >
                ↩ Daily
              </button>
            </div>
            <p className={styles.devHint}>Dev runs are not saved to stats</p>
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
          disabled={!isGameReady || !isPlaying}
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
