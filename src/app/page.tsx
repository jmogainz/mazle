'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, MobileControls, ErrorBoundary, Loader } from '@/components';
import {
  getPuzzleNumber,
  onGameEvent,
  Direction,
  PuzzleData,
  MapType,
  generatePuzzleParallel,
  fetchDailyPuzzle,
  getDailySeed,
  GenerationProgress,
  GeneratorBackend,
  isRustBackendConfigured,
  preloadWasm,
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
      <Loader text="Loading puzzle..." />
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

// Mobile tap-to-open dev tools config
const TAP_COUNT_THRESHOLD = 10;
const TAP_WINDOW_MS = 2000;
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
  const [selectedBackend, setSelectedBackend] = useState<GeneratorBackend>('auto');
  const [lastUsedBackend, setLastUsedBackend] = useState<'rust-backend' | 'wasm' | null>(null);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number; failed?: boolean; attempts?: any[] } | null>(null);
  const [previousResult, setPreviousResult] = useState<DailyStats | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [showInlineResult, setShowInlineResult] = useState(false);
  const [lifeFlash, setLifeFlash] = useState(false);
  const gameControlsRef = useRef<GameControls | null>(null);
  const debugModeRef = useRef(false);
  const cheatBufferRef = useRef('');
  const cheatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  const tapTimestampsRef = useRef<number[]>([]);

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

  // Mobile tap-to-open dev tools (10 taps in 2 seconds on the scoreboard)
  const handleDevToolsTap = useCallback(() => {
    const now = Date.now();
    
    // Filter out taps older than the window
    tapTimestampsRef.current = tapTimestampsRef.current.filter(
      (ts) => now - ts < TAP_WINDOW_MS
    );
    
    // Add current tap
    tapTimestampsRef.current.push(now);
    
    // Check if threshold reached
    if (tapTimestampsRef.current.length >= TAP_COUNT_THRESHOLD) {
      tapTimestampsRef.current = []; // Reset
      setShowDevTools((prev) => !prev);
    }
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
    console.log('[LOAD] Loaded previousResult:', existingResult);
    setShowShareCard(false);
    setShowInlineResult(false);
    setIsPlaying(false);

    if (existingResult?.completed) {
      setGameResult({ 
        moveCount: existingResult.moveCount, 
        timeMs: existingResult.timeMs,
        attempts: existingResult.attempts,
        failed: existingResult.failed,
      });
    } else {
      setGameResult(null);
    }

    // Check localStorage cache first for instant loading (same-day revisit)
    const cachedPuzzle = getCachedPuzzle(todaySeed);
    if (cachedPuzzle) {
      setPuzzle(cachedPuzzle);
      setRenderKey((prev) => prev + 1);
      return;
    }

    // Fetch daily puzzle: KV (pre-generated) → Rust → WASM fallback
    setIsGenerating(true);
    setGenerationProgress(null);
    
    try {
      const { puzzle: todayPuzzle, source } = await fetchDailyPuzzle(todaySeed, (progress) => {
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      });
      
      console.log(`[Daily] Loaded puzzle from ${source}`);
      setPuzzle(todayPuzzle);
      setRenderKey((prev) => prev + 1);
      
      // Cache in localStorage for same-day revisits
      cachePuzzle(todaySeed, todayPuzzle);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  }, []);

  // Track if we've already initiated loading (prevent React Strict Mode double-call)
  const loadInitiatedRef = useRef(false);
  
  // Initialize puzzle and stats - use requestAnimationFrame to ensure first paint
  useEffect(() => {
    // Prevent duplicate calls from React Strict Mode
    if (loadInitiatedRef.current) return;
    loadInitiatedRef.current = true;
    
    // Preload WASM early for faster fallback if needed
    preloadWasm();
    
    // Ensure the loading UI renders before starting heavy computation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        loadDailyPuzzle();
      });
    });
  }, [loadDailyPuzzle]);

  // Listen for game completion
  useEffect(() => {
    const unsubscribeComplete = onGameEvent('gameComplete', (data) => {
      const result = data as { moveCount: number; timeMs: number; optimalMoves: number; failed?: boolean; attempts?: any[] };
      setGameResult(result);
      setShowShareCard(true);
      setIsPlaying(false); // Ensure game is marked as not playing to show blocked state

      if (debugModeRef.current) {
        return;
      }

      // Save result if not already saved today
      if (!previousResult) {
        console.log('[SAVE] Saving daily result:', result);
        const dailyResult: DailyStats = {
          date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
          completed: true,
          moveCount: result.moveCount,
          timeMs: result.timeMs,
          puzzleNumber,
          attempts: result.attempts,
          failed: result.failed,
        };
        saveTodaysResult(dailyResult);
        setStats(getPlayerStats());
        setPreviousResult(dailyResult);
        console.log('[SAVE] Result saved, previousResult updated');
      } else {
        console.log('[SAVE] Skipped - previousResult already exists:', previousResult);
      }
    });

    const unsubscribeLifeLost = onGameEvent('lifeLost', (data) => {
      const { lives } = data as { lives: number; penaltyMs: number };
      // Final life gets longer flash handled by GameScene, but still trigger React flash
      setLifeFlash(true);
      // Longer timeout for final life to match GameScene's linger
      const flashDuration = lives <= 0 ? 800 : 500;
      setTimeout(() => setLifeFlash(false), flashDuration);
    });

    return () => {
      unsubscribeComplete();
      unsubscribeLifeLost();
    };
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

      const progressHandler = (progress: GenerationProgress) => {
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      };

      if (isDateSeed) {
        setIsGenerating(true);
        setGenerationProgress(null);
        
        const targetDate = new Date(trimmed);
        const dailySeed = getDailySeed(targetDate);
        
        try {
          const datedPuzzle = await generatePuzzleParallel(dailySeed, progressHandler, forceMapType, selectedBackend);
          debugModeRef.current = true;
          setPuzzle(datedPuzzle);
          setPuzzleNumber(getPuzzleNumber(targetDate));
          setPuzzleLabel(`DATE ${trimmed}`);
          setActiveSeed(dailySeed);
          setSeedInput(trimmed);
          setGameResult(null);
          setShowShareCard(false);
          setShowInlineResult(false);
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
        const newPuzzle = await generatePuzzleParallel(newSeed, progressHandler, forceMapType, selectedBackend);
        debugModeRef.current = true;
        setPuzzle(newPuzzle);
        setPuzzleLabel(`DEV ${newSeed}`);
        setActiveSeed(newSeed);
        setSeedInput(newSeed);
        setRenderKey((prev) => prev + 1);
        setGameResult(null);
        setShowShareCard(false);
        setShowInlineResult(false);
        setPreviousResult(null);
        setIsPlaying(false);
      } finally {
        setIsGenerating(false);
        setGenerationProgress(null);
      }
    },
    [selectedMapType, selectedBackend],
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

  const handleViewResult = useCallback(() => {
    setShowInlineResult(true);
    setIsPlaying(false);
    // Ensure analysis is shown
    if (gameResult?.attempts && gameControlsRef.current) {
        gameControlsRef.current.showAnalysis(gameResult.attempts);
    }
  }, [gameResult]);

  const handleCloseShareCard = useCallback(() => {
    setShowShareCard(false);
    // Small delay before showing analysis for smooth transition
    setTimeout(() => {
      setShowInlineResult(true);
      // Show analysis when closing share card
      if (gameResult?.attempts && gameControlsRef.current) {
          gameControlsRef.current.showAnalysis(gameResult.attempts);
      }
    }, 100);
  }, [gameResult]);

  // Calculate progress percentage (works for both loading screen and dev tools)
  const progressPercent = generationProgress 
    ? Math.round((generationProgress.workersComplete / generationProgress.totalWorkers) * 100)
    : 0;

  if (!puzzle) {
    return (
      <main className={`${styles.main} bg-pattern`} style={{ justifyContent: 'center' }}>
        <Loader 
          text={isGenerating ? 'Generating daily puzzle...' : 'Loading puzzle...'} 
          progress={isGenerating ? progressPercent : undefined}
        />
      </main>
    );
  }

  const puzzleWidth = puzzle?.width ?? 10;
  const puzzleHeight = puzzle?.height ?? 10;
  const baseWidth = Math.max(420, puzzleWidth * TILE_SIZE + 64);
  const baseHeight = Math.max(480, puzzleHeight * TILE_SIZE + 80);

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
              <span className={styles.devPanelTitle}>Dev Tools</span>
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

            {/* Maze Engine Selector */}
            <div className={styles.devBackendSection}>
              <div className={styles.devBackendHeader}>
                Maze Engine
                {lastUsedBackend && (
                  <span className={styles.devBackendStatus}>
                    {lastUsedBackend === 'rust-backend' ? '🦀 Rust' : 'WASM'}
                  </span>
                )}
              </div>
              <div className={styles.devBackendOptions}>
                <label className={styles.devBackendOption}>
                  <input
                    type="radio"
                    name="engine"
                    value="auto"
                    checked={selectedBackend === 'auto'}
                    onChange={() => setSelectedBackend('auto')}
                    disabled={isGenerating}
                  />
                  <span>Auto</span>
                </label>
                <label 
                  className={`${styles.devBackendOption} ${!isRustBackendConfigured() ? styles.devBackendDisabled : ''}`}
                  title={isRustBackendConfigured() ? 'Rust server (fastest, parallel)' : 'Not configured (set NEXT_PUBLIC_GENERATOR_URL)'}
                >
                  <input
                    type="radio"
                    name="engine"
                    value="rust"
                    checked={selectedBackend === 'rust'}
                    onChange={() => setSelectedBackend('rust')}
                    disabled={isGenerating || !isRustBackendConfigured()}
                  />
                  <span>🦀 Rust</span>
                </label>
                <label 
                  className={styles.devBackendOption}
                  title="Browser WASM (parallel via Web Workers)"
                >
                  <input
                    type="radio"
                    name="engine"
                    value="wasm"
                    checked={selectedBackend === 'wasm'}
                    onChange={() => setSelectedBackend('wasm')}
                    disabled={isGenerating}
                  />
                  <span>WASM</span>
                </label>
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
                  <span className={styles.buttonSpinner} />
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
            
            {/* Generation Progress */}
            {isGenerating && generationProgress && (
              <div className={styles.devProgress}>
                <div className={styles.devProgressHeader}>
                  {generationProgress.phase === 'rust-backend' 
                    ? `🦀 Rust ${progressPercent}%` 
                    : `WASM ${progressPercent}%`}
                </div>
                <div className={styles.progressBar}>
                  <div 
                    className={styles.progressFill} 
                    style={{ width: `${progressPercent}%` }} 
                  />
                </div>
              </div>
            )}
            
            <p className={styles.devHint}>Dev runs are not saved to stats</p>
          </div>
        )}

        <div onPointerUp={handleDevToolsTap}>
          <GameUI
            puzzleNumber={puzzleNumber}
            puzzleLabel={puzzleLabel ?? undefined}
            optimalMoves={puzzle.optimalMoves}
            variant="header"
          />
        </div>
        
        <div
          ref={gameFrameRef}
          className={styles.gameFrame}
          style={{
            maxWidth: `${baseWidth}px`,
            aspectRatio: `${baseWidth} / ${baseHeight}`,
          }}
        >
          <div className={styles.gameContainer}>
            <div className={`${styles.gameContent} ${(!isPlaying && isGameReady && !showInlineResult) || showShareCard ? styles.blurred : ''}`}>
              <PhaserGame
                key={renderKey}
                puzzle={puzzle}
                viewportWidth={baseWidth}
                viewportHeight={baseHeight}
                onReady={handleGameReady}
              />
            </div>
            {lifeFlash && <div className={styles.lifeFlash} />}
          </div>
          {!isPlaying && isGameReady && !showInlineResult && !showShareCard && (
            <div className={styles.startOverlay}>
              {previousResult ? (
                <div className={styles.previousResult}>
                  <p>You already completed today&apos;s puzzle!</p>
                  <button onClick={handleViewResult} className={styles.viewResultButton}>
                    View Result
                  </button>
                </div>
              ) : (
                <button className={styles.startButton} onClick={handleBegin}>
                  Begin
                </button>
              )}
            </div>
          )}
        </div>

        <MobileControls
          onMove={handleMobileMove}
          disabled={!isGameReady || !isPlaying}
        />
      </div>

      {/* Inline Share Card (below map) */}
      {showInlineResult && gameResult && !showShareCard && (
        <div className={styles.inlineResultContainer}>
             <ShareCard
               puzzleNumber={puzzleNumber}
               puzzleLabel={puzzleLabel ?? undefined}
               moveCount={gameResult.moveCount}
               timeMs={gameResult.timeMs}
               optimalMoves={puzzle.optimalMoves}
               failed={gameResult.failed}
               attempts={gameResult.attempts}
               onClose={() => {}} // No close button for inline
               inline={true}
             />
        </div>
      )}

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
          failed={gameResult.failed}
          attempts={gameResult.attempts}
          onClose={handleCloseShareCard}
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
