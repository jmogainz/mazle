'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Header, GameUI, ShareCard, StatsModal, HelpModal, ErrorBoundary, Loader, DevTools, AdSlot } from '@/components';
import { HELP_MENU_HASH } from '@/components/helpMenuHash';
import {
  CHEAT_TIMEOUT_MS,
  CHEAT_CODE_LENGTH,
  TAP_COUNT_THRESHOLD,
  TAP_WINDOW_MS,
  GAME_BUFFER_PX,
  STORAGE_KEYS,
  isCheatCode,
} from '@/constants';
import {
  getPuzzleNumber,
  onGameEvent,
  PuzzleData,
  MapType,
  generatePuzzleParallel,
  cancelRustRequest,
  fetchDailyPuzzle,
  getDailySeed,
  GenerationProgress,
  GeneratorBackend,
  preloadWasm,
  TILE_SIZE,
} from '@/game';
import { getPlayerStats, saveTodaysResult, getTodaysResult, getCachedPuzzle, cachePuzzle, saveInProgressState, getInProgressState, clearInProgressState } from '@/utils/storage';
import { useAdConsent } from '@/utils/consent';
import { PlayerStats, DailyStats } from '@/game/types';
import type { GameControls } from '@/game/PhaserGame';
import { getSwipeDirection, SWIPE_MIN_DISTANCE_PX } from '@/game/swipe';
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
  process.env.NEXT_PUBLIC_DEVTOOLS_ENABLED === 'true';

const IS_PROD = process.env.NEXT_PUBLIC_ENV === 'prod';
const HELP_SEEN_KEY = `mazle_seen_help_${HELP_MENU_HASH}`;
const ADSENSE_TOP_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_TOP ?? (!IS_PROD ? 'DEV_TOP' : '');
const ADSENSE_BOTTOM_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM ?? (!IS_PROD ? 'DEV_BOTTOM' : '');
const AD_BANNER_HEIGHT = 50;

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
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [adsReady, setAdsReady] = useState(false);
  const { consentReady } = useAdConsent();
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgress | null>(null);
  const [showInlineResult, setShowInlineResult] = useState(false);
  const [hintsEnabled, setHintsEnabled] = useState(true);
  const [lifeFlash, setLifeFlash] = useState(false);
  const [hasPendingRestore, setHasPendingRestore] = useState(false);
  const [initialStats, setInitialStats] = useState<{
    lives?: number;
    currentAttemptMoves?: number;
    elapsedTimeMs?: number;
    penaltyTimeMs?: number;
  } | null>(null);
  const [startBatchInput, setStartBatchInput] = useState('');
  const [adStatus, setAdStatus] = useState<{ top: 'filled' | 'unfilled' | null; bottom: 'filled' | 'unfilled' | null }>({
    top: null,
    bottom: null,
  });
  const gameControlsRef = useRef<GameControls | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const inFlightSeedRef = useRef<string | null>(null);
  const debugModeRef = useRef(false);
  const cheatBufferRef = useRef('');
  const cheatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  const gameStageRef = useRef<HTMLDivElement | null>(null);
  const adTopRef = useRef<HTMLDivElement | null>(null);
  const adBottomRef = useRef<HTMLDivElement | null>(null);
  const adsReadyTimeoutRef = useRef<number | null>(null);
  const adTimeoutsRef = useRef<{ top?: number; bottom?: number }>({});
  const hintsPrefLoadedRef = useRef(false);
  const [gameFrameSizePx, setGameFrameSizePx] = useState<{ width: number; height: number } | null>(null);
  const tapTimestampsRef = useRef<number[]>([]);
  const lastDevToolsTouchTsRef = useRef<number>(0);
  const devToolsTapTargetRef = useRef<HTMLDivElement | null>(null);
  const pendingRestoreRef = useRef<Parameters<GameControls['restoreState']>[0] | null>(null);
  const hintsEnabledRef = useRef(hintsEnabled);

  // Sync CSS custom property to the real visual viewport height (iOS-safe)
  useEffect(() => {
    function setVH() {
      const vh = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    }

    window.visualViewport?.addEventListener('resize', setVH);
    window.visualViewport?.addEventListener('scroll', setVH);
    window.addEventListener('resize', setVH);
    setVH();

    return () => {
      window.visualViewport?.removeEventListener('resize', setVH);
      window.visualViewport?.removeEventListener('scroll', setVH);
      window.removeEventListener('resize', setVH);
    };
  }, []);

  useEffect(() => {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    const ua = navigator.userAgent || '';
    const uaMobile = /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobi/i.test(ua);
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    setIsMobileDevice(Boolean(uaData?.mobile) || uaMobile || coarsePointer);
  }, []);

  useEffect(() => {
    if (!isGameReady) {
      setAdsReady(false);
      if (adsReadyTimeoutRef.current !== null) {
        window.clearTimeout(adsReadyTimeoutRef.current);
        adsReadyTimeoutRef.current = null;
      }
      return;
    }

    if (adsReady) return;
    adsReadyTimeoutRef.current = window.setTimeout(() => {
      setAdsReady(true);
      adsReadyTimeoutRef.current = null;
    }, 1000);

    return () => {
      if (adsReadyTimeoutRef.current !== null) {
        window.clearTimeout(adsReadyTimeoutRef.current);
        adsReadyTimeoutRef.current = null;
      }
    };
  }, [isGameReady, adsReady]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.HINTS_ENABLED);
    if (stored !== null) {
      const enabled = stored === '1';
      hintsEnabledRef.current = enabled;
      setHintsEnabled(enabled);
    }
    hintsPrefLoadedRef.current = true;
  }, []);

  useEffect(() => {
    if (!hintsPrefLoadedRef.current) return;
    hintsEnabledRef.current = hintsEnabled;
    localStorage.setItem(STORAGE_KEYS.HINTS_ENABLED, hintsEnabled ? '1' : '0');
    gameControlsRef.current?.setHintsEnabled?.(hintsEnabled);
  }, [hintsEnabled]);

  const puzzleWidth = puzzle?.width ?? 10;
  const puzzleHeight = puzzle?.height ?? 10;
  const baseWidth = puzzleWidth * TILE_SIZE + GAME_BUFFER_PX * 2;
  const baseHeight = puzzleHeight * TILE_SIZE + GAME_BUFFER_PX * 2;
  const showTopAd = !!ADSENSE_TOP_SLOT;
  const showBottomAd = !!ADSENSE_BOTTOM_SLOT;
  const canRequestAds = adsReady && consentReady;

  // Dynamic UI scaling system - maximizes maze size while keeping UI readable
  // The --ui-scale CSS variable controls all UI element sizes
  useEffect(() => {
    let rafId: number | null = null;
    
    const updateScale = () => {
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Fixed UI heights at scale=1 (approximate values)
      const HEADER_HEIGHT = 56;      // MAZLE logo + icons
      const PUZZLE_NUM_HEIGHT = 32;  // Puzzle number banner
      const SCOREBOARD_HEIGHT = 70;  // Lives, moves, time row
      const CONTROLS_HEIGHT = 56;    // Share button area
      const FOOTER_HEIGHT = viewportWidth > 768 ? 32 : 0; // Desktop footer
      const AD_HEIGHT = (showTopAd ? AD_BANNER_HEIGHT + 8 : 0) + (showBottomAd ? AD_BANNER_HEIGHT + 8 : 0);
      const PADDING = 24;            // Various padding/gaps
      
      const totalUIHeight = HEADER_HEIGHT + PUZZLE_NUM_HEIGHT + SCOREBOARD_HEIGHT + 
                           CONTROLS_HEIGHT + FOOTER_HEIGHT + AD_HEIGHT + PADDING;
      
      // Available height for the maze
      const availableForMaze = viewportHeight - totalUIHeight;
      
      // Maximum maze size (don't let it grow infinitely on large screens)
      const MAX_MAZE_SIZE = 520;
      const MIN_MAZE_SIZE = 200;
      
      // Scale limits for UI
      const UI_SCALE_MIN = 0.75;
      const UI_SCALE_MAX = 1.0;
      
      // Calculate ideal maze size (constrained by width too)
      const maxMazeByWidth = Math.min(viewportWidth - 32, MAX_MAZE_SIZE); // 16px padding each side
      const idealMazeSize = Math.min(baseWidth, baseHeight, maxMazeByWidth, MAX_MAZE_SIZE);
      
      // How much height do we need for the ideal maze?
      const neededForIdealMaze = idealMazeSize;
      
      let uiScale = UI_SCALE_MAX;
      let mazeSize = idealMazeSize;
      
      if (availableForMaze < neededForIdealMaze) {
        // Not enough space - try scaling down UI first
        // Calculate how much UI space we can save by scaling
        const uiScalableHeight = HEADER_HEIGHT + PUZZLE_NUM_HEIGHT + SCOREBOARD_HEIGHT + CONTROLS_HEIGHT;
        
        // How much extra space do we need?
        const deficit = neededForIdealMaze - availableForMaze;
        
        // How much can we save by scaling UI to minimum?
        const maxUISavings = uiScalableHeight * (1 - UI_SCALE_MIN);
        
        if (deficit <= maxUISavings) {
          // We can fit the ideal maze by just scaling down UI
          // Calculate the exact scale needed
          uiScale = 1 - (deficit / uiScalableHeight);
          uiScale = Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, uiScale));
          mazeSize = idealMazeSize;
        } else {
          // Even at minimum UI scale, we can't fit ideal maze
          // Scale UI to minimum and shrink maze
          uiScale = UI_SCALE_MIN;
          const minUIHeight = totalUIHeight - uiScalableHeight * (1 - UI_SCALE_MIN);
          mazeSize = Math.max(MIN_MAZE_SIZE, viewportHeight - minUIHeight);
        }
      }
      
      // Apply the UI scale to CSS custom property
      document.documentElement.style.setProperty('--ui-scale', uiScale.toFixed(3));
      
      // Also update maze frame size
      const mazeScale = Math.min(1, mazeSize / baseWidth, mazeSize / baseHeight);
      const width = Math.max(1, Math.floor(baseWidth * mazeScale));
      const height = Math.max(1, Math.floor(baseHeight * mazeScale));
      
      setGameFrameSizePx((prev) => {
        if (prev && prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    const scheduleUpdate = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateScale();
      });
    };

    scheduleUpdate();
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [baseWidth, baseHeight, showTopAd, showBottomAd]);

  useEffect(() => {
    const targets: Record<'top' | 'bottom', boolean> = {
      top: adsReady && showTopAd,
      bottom: adsReady && showBottomAd,
    };

    const clearTimeoutFor = (key: keyof typeof targets) => {
      const timeoutId = adTimeoutsRef.current[key];
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
        adTimeoutsRef.current[key] = undefined;
      }
    };

    const ensureTimeout = (key: keyof typeof targets) => {
      if (adTimeoutsRef.current[key] !== undefined) return;
      adTimeoutsRef.current[key] = window.setTimeout(() => {
        setAdStatus((prev) => {
          if (prev[key] !== null) return prev;
          return { ...prev, [key]: 'unfilled' };
        });
        adTimeoutsRef.current[key] = undefined;
      }, 2000);
    };

    (Object.keys(targets) as Array<keyof typeof targets>).forEach((key) => {
      const shouldTrack = targets[key];
      if (!shouldTrack || adStatus[key] !== null) {
        clearTimeoutFor(key);
        return;
      }
      ensureTimeout(key);
    });
  }, [
    adsReady,
    showTopAd,
    showBottomAd,
    adStatus,
  ]);

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

  // Robust mobile activation: use native event listeners in capture phase.
  // This avoids React/pointer-event edge cases with global `touch-action: none`.
  useEffect(() => {
    const isInsideTapTarget = (eventTarget: EventTarget | null) => {
      const node = eventTarget as Node | null;
      return !!node && !!devToolsTapTargetRef.current && devToolsTapTargetRef.current.contains(node);
    };

    const onTouchEndCapture = (e: TouchEvent) => {
      if (!isInsideTapTarget(e.target)) return;
      lastDevToolsTouchTsRef.current = Date.now();
      handleDevToolsTap();
    };

    // Some browsers may still deliver pointer events; keep as a non-invasive fallback.
    const onPointerUpCapture = (e: PointerEvent) => {
      if (!isInsideTapTarget(e.target)) return;
      // If we've just processed a touch, ignore the follow-up pointer event.
      if (Date.now() - lastDevToolsTouchTsRef.current < 700) return;
      handleDevToolsTap();
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!isInsideTapTarget(e.target)) return;
      if (Date.now() - lastDevToolsTouchTsRef.current < 700) return;
      handleDevToolsTap();
    };

    document.addEventListener('touchend', onTouchEndCapture, { capture: true });
    document.addEventListener('pointerup', onPointerUpCapture, { capture: true });
    document.addEventListener('click', onClickCapture, { capture: true });
    return () => {
      document.removeEventListener('touchend', onTouchEndCapture, { capture: true } as any);
      document.removeEventListener('pointerup', onPointerUpCapture, { capture: true } as any);
      document.removeEventListener('click', onClickCapture, { capture: true } as any);
    };
  }, [handleDevToolsTap]);

  // Mobile swipe anywhere (outside the Phaser canvas) to move.
  // Keep the swipe feel identical to the in-canvas Phaser handler.
  useEffect(() => {
    const isTouchCapable =
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 0);

    if (!isTouchCapable) return;
    if (!isGameReady || !isPlaying) return;
    if (showHelp || showStats || showShareCard || showDevTools) return;

    let active: { kind: 'touch' | 'pointer'; id: number } | null = null;
    let startX = 0;
    let startY = 0;
    let consumed = false;
    let lastTouchTs = 0;

    const canAcceptMove = () => gameControlsRef.current?.canAcceptMoveInput?.() ?? false;

    const getScale = () => {
      const rect = gameFrameRef.current?.getBoundingClientRect();
      const scaleX = rect && rect.width > 0 ? rect.width / baseWidth : 1;
      const scaleY = rect && rect.height > 0 ? rect.height / baseHeight : 1;
      return {
        scaleX: Math.max(scaleX, 1e-6),
        scaleY: Math.max(scaleY, 1e-6),
      };
    };

    const capture = { capture: true } as const;
    const capturePassive = { capture: true, passive: true } as const;

    const onTouchStartCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (active) return;
      if (!gameControlsRef.current) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      active = { kind: 'touch', id: touch.identifier };
      startX = touch.clientX;
      startY = touch.clientY;
      consumed = false;
    };

    const onTouchMoveCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (!active || active.kind !== 'touch') return;
      if (consumed) return;
      if (!gameControlsRef.current) return;

      const t = Array.from(e.touches).find((touch) => touch.identifier === active!.id);
      if (!t) return;

      const { scaleX, scaleY } = getScale();
      const dx = (t.clientX - startX) / scaleX;
      const dy = (t.clientY - startY) / scaleY;
      const dir = getSwipeDirection(dx, dy, SWIPE_MIN_DISTANCE_PX);
      if (!dir) return;
      if (!canAcceptMove()) return;

      gameControlsRef.current.movePlayer(dir);
      consumed = true;
    };

    const onTouchEndCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (!active || active.kind !== 'touch') return;
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === active.id) {
          active = null;
          consumed = false;
          return;
        }
      }
    };

    const onTouchCancelCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (!active || active.kind !== 'touch') return;
      for (const touch of Array.from(e.changedTouches)) {
        if (touch.identifier === active.id) {
          active = null;
          consumed = false;
          return;
        }
      }
    };

    // Pointer events fallback (some browsers / WebViews)
    const onPointerDownCapture = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (Date.now() - lastTouchTs < 700) return;
      if (active) return;
      if (!gameControlsRef.current) return;

      active = { kind: 'pointer', id: e.pointerId };
      startX = e.clientX;
      startY = e.clientY;
      consumed = false;
    };

    const onPointerMoveCapture = (e: PointerEvent) => {
      if (!active || active.kind !== 'pointer' || active.id !== e.pointerId) return;
      if (consumed) return;
      if (!gameControlsRef.current) return;

      const { scaleX, scaleY } = getScale();
      const dx = (e.clientX - startX) / scaleX;
      const dy = (e.clientY - startY) / scaleY;
      const dir = getSwipeDirection(dx, dy, SWIPE_MIN_DISTANCE_PX);
      if (!dir) return;
      if (!canAcceptMove()) return;

      gameControlsRef.current.movePlayer(dir);
      consumed = true;
    };

    const onPointerUpCapture = (e: PointerEvent) => {
      if (!active || active.kind !== 'pointer' || active.id !== e.pointerId) return;
      active = null;
      consumed = false;
    };

    const onPointerCancelCapture = (e: PointerEvent) => {
      if (!active || active.kind !== 'pointer' || active.id !== e.pointerId) return;
      active = null;
      consumed = false;
    };

    document.addEventListener('touchstart', onTouchStartCapture, capturePassive);
    document.addEventListener('touchmove', onTouchMoveCapture, capturePassive);
    document.addEventListener('touchend', onTouchEndCapture, capture);
    document.addEventListener('touchcancel', onTouchCancelCapture, capture);
    document.addEventListener('pointerdown', onPointerDownCapture, capture);
    document.addEventListener('pointermove', onPointerMoveCapture, capture);
    document.addEventListener('pointerup', onPointerUpCapture, capture);
    document.addEventListener('pointercancel', onPointerCancelCapture, capture);
    return () => {
      document.removeEventListener('touchstart', onTouchStartCapture, capturePassive as any);
      document.removeEventListener('touchmove', onTouchMoveCapture, capturePassive as any);
      document.removeEventListener('touchend', onTouchEndCapture, capture as any);
      document.removeEventListener('touchcancel', onTouchCancelCapture, capture as any);
      document.removeEventListener('pointerdown', onPointerDownCapture, capture as any);
      document.removeEventListener('pointermove', onPointerMoveCapture, capture as any);
      document.removeEventListener('pointerup', onPointerUpCapture, capture as any);
      document.removeEventListener('pointercancel', onPointerCancelCapture, capture as any);
    };
  }, [isGameReady, isPlaying, showHelp, showStats, showShareCard, showDevTools, baseWidth, baseHeight]);

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

    // Helper to set scoreboard stats for completed game once we have puzzle
    const setCompletedStats = (optimalMoves: number) => {
      if (!existingResult?.completed) return;
      const attemptsCount = existingResult.attempts?.length ?? 1;
      const livesRemaining = existingResult.failed ? 0 : 3 - (attemptsCount - 1);
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: optimalMoves, // Shows 0 moves remaining
        elapsedTimeMs: existingResult.timeMs,
        penaltyTimeMs: 0, // Already included in timeMs
      });
    };

    if (existingResult?.completed) {
      setGameResult({
        moveCount: existingResult.moveCount,
        timeMs: existingResult.timeMs,
        attempts: existingResult.attempts,
        failed: existingResult.failed,
      });
      // initialStats will be set after puzzle loads (need optimalMoves)
      // Keep overlay prompt; let user choose to view results
      setShowShareCard(false);
      setShowInlineResult(false);
      setIsPlaying(false);
    } else {
      setGameResult(null);

      // Check for in-progress state (mid-game refresh resume)
      const inProgressState = getInProgressState(todaySeed);
      if (inProgressState) {
        console.log('[RESUME] Found in-progress state, will restore after game ready');
        pendingRestoreRef.current = inProgressState;
        setHasPendingRestore(true);
        setInitialStats({
          lives: inProgressState.lives,
          currentAttemptMoves: inProgressState.currentAttemptMoves,
          elapsedTimeMs: inProgressState.elapsedTimeMs,
          penaltyTimeMs: inProgressState.penaltyTimeMs,
        });
      } else {
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        setInitialStats(null);
      }
    }

    // Check localStorage cache first for instant loading (same-day revisit)
    const cachedPuzzle = getCachedPuzzle(todaySeed);
    if (cachedPuzzle) {
      setPuzzle(cachedPuzzle);
      setCompletedStats(cachedPuzzle.optimalMoves);
      setRenderKey((prev) => prev + 1);
      return;
    }

    // Fetch daily puzzle: KV (pre-generated) → Rust → WASM fallback
    // setIsGenerating(true); // Don't show progress bar for initial KV check
    setGenerationProgress(null);

    try {
      const { puzzle: todayPuzzle, source } = await fetchDailyPuzzle(todaySeed, (progress) => {
        // Only show generating state if we are actually generating (not checking cache)
        if (progress.phase !== 'kv') {
          setIsGenerating(true);
        }
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      });

      console.log(`[Daily] Loaded puzzle from ${source}`);
      setPuzzle(todayPuzzle);
      setCompletedStats(todayPuzzle.optimalMoves);
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

      // Set initialStats so scoreboard stays frozen at completion state
      const attemptsCount = result.attempts?.length ?? 1;
      const livesRemaining = result.failed ? 0 : 3 - (attemptsCount - 1);
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: result.optimalMoves, // 0 moves remaining
        elapsedTimeMs: result.timeMs,
        penaltyTimeMs: 0, // Already included in timeMs
      });

      // Clear in-progress state since game is complete
      clearInProgressState();

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
      // Let GameScene handle the final life flash to avoid double-flashing.
      if (lives > 0) {
        setLifeFlash(true);
        setTimeout(() => setLifeFlash(false), 500);
      }
    });

    // Save in-progress state on each state update (for resume after refresh)
    const persistInProgressState = () => {
      // Only save if we're in the daily puzzle (not debug mode) and game hasn't completed
      if (debugModeRef.current || previousResult) return;

      const state = gameControlsRef.current?.getSerializableState();
      if (state && state.isPlaying && activeSeed) {
        saveInProgressState(activeSeed, state);
      }
    };
    const unsubscribeStateUpdate = onGameEvent('stateUpdate', persistInProgressState);

    // Also persist while idle and when backgrounding/unloading so elapsed time doesn't jump backwards.
    const intervalId = window.setInterval(persistInProgressState, 5000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistInProgressState();
      }
    };
    const handlePageHide = () => {
      persistInProgressState();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      unsubscribeComplete();
      unsubscribeLifeLost();
      unsubscribeStateUpdate();
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [puzzleNumber, previousResult, activeSeed]);

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
      const startBatch = startBatchInput ? parseInt(startBatchInput, 10) : undefined;
      const abortController = new AbortController();

      // Abort any previous in-flight generation to avoid duplicate work
      if (generationAbortRef.current && !generationAbortRef.current.signal.aborted) {
        generationAbortRef.current.abort();
      }
      generationAbortRef.current = abortController;

      // Track which seed this request is for (used by Stop button)
      const requestSeed = isDateSeed
        ? getDailySeed(new Date(trimmed))
        : (trimmed ||
            `dev-${Date.now()}-${Math.floor(Math.random() * 10000)
              .toString()
              .padStart(4, '0')}`);
      inFlightSeedRef.current = requestSeed;

      const progressHandler = (progress: GenerationProgress) => {
        setGenerationProgress(progress);
        setLastUsedBackend(progress.phase === 'kv' ? null : progress.phase);
      };

      if (isDateSeed) {
        setIsGenerating(true);
        setGenerationProgress(null);

        const targetDate = new Date(trimmed);
        const dailySeed = requestSeed;

        try {
          const datedPuzzle = await generatePuzzleParallel(
            dailySeed,
            progressHandler,
            forceMapType,
            selectedBackend,
            startBatch,
            abortController,
          );
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
          setInitialStats(null);
          setIsPlaying(false);
        } catch (error) {
          if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            console.log('[Dev] Generation cancelled by user');
            return;
          }
          throw error;
        } finally {
          setIsGenerating(false);
          setGenerationProgress(null);
          generationAbortRef.current = null;
          inFlightSeedRef.current = null;
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
        const newPuzzle = await generatePuzzleParallel(
          requestSeed,
          progressHandler,
          forceMapType,
          selectedBackend,
          startBatch,
          abortController,
        );
        debugModeRef.current = true;
        setPuzzle(newPuzzle);
        setPuzzleLabel(`DEV ${requestSeed}`);
        setActiveSeed(requestSeed);
        setSeedInput(requestSeed);
        setRenderKey((prev) => prev + 1);
        setGameResult(null);
        setShowShareCard(false);
        setShowInlineResult(false);
        setPreviousResult(null);
        setInitialStats(null);
        setIsPlaying(false);
      } catch (error) {
        if (abortController.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          console.log('[Dev] Generation cancelled by user');
          return;
        }
        throw error;
      } finally {
        setIsGenerating(false);
        setGenerationProgress(null);
        generationAbortRef.current = null;
        inFlightSeedRef.current = null;
      }
    },
    [selectedMapType, selectedBackend, startBatchInput],
  );

  const handleLoadDaily = useCallback(() => {
    loadDailyPuzzle();
  }, [loadDailyPuzzle]);

  const showAnalysis = useCallback(() => {
    const attempts = gameResult?.attempts ?? previousResult?.attempts;
    if (attempts && gameControlsRef.current) {
      gameControlsRef.current.showAnalysis(attempts);
    }
  }, [gameResult?.attempts, previousResult?.attempts]);

  const handleGameReady = useCallback((controls: GameControls) => {
    gameControlsRef.current = controls;
    setIsGameReady(true);
    controls.setHintsEnabled(hintsEnabledRef.current);

    // Show help on first visit
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('mazle_seen_help') && key !== HELP_SEEN_KEY) {
          localStorage.removeItem(key);
        }
      }
    } catch {
      // Ignore storage access errors (e.g., private mode)
    }

    const hasSeenHelp = localStorage.getItem(HELP_SEEN_KEY);
    if (!hasSeenHelp) {
      setShowHelp(true);
      localStorage.setItem(HELP_SEEN_KEY, 'true');
    }

    // Restore in-progress state if we have one (mid-game refresh resume)
    if (pendingRestoreRef.current) {
      console.log('[RESUME] Restoring in-progress state');
      try {
        controls.restoreState(pendingRestoreRef.current);
        setIsPlaying(pendingRestoreRef.current.isPlaying);
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        return;
      } catch (error) {
        console.warn('[RESUME] Failed to restore in-progress state, clearing it', error);
        clearInProgressState();
        pendingRestoreRef.current = null;
        setHasPendingRestore(false);
        setInitialStats(null);
      }
    }

    // If inline results are already visible (e.g., post-game), re-sync analysis
    if (showInlineResult) {
      showAnalysis();
      setIsPlaying(false);
    }
  }, [showAnalysis, showInlineResult]);

  const handleViewResult = useCallback(() => {
    // Show analysis on the map; share card can be opened from the bottom button
    showAnalysis();
    setShowInlineResult(true);
    setIsPlaying(false);
    setShowShareCard(false);
  }, [showAnalysis]);

  const handleShowShareCard = useCallback(() => {
    showAnalysis();
    setShowInlineResult(true);
    setIsPlaying(false);
    setShowShareCard(true);
  }, [showAnalysis]);

  const handleStopGeneration = useCallback(() => {
    const controller = generationAbortRef.current;
    const seedToCancel = inFlightSeedRef.current || activeSeed;
    if (!controller || !seedToCancel) {
      return;
    }

    // Only cancel if no other same-seed requests are in-flight (handled in wasmGenerator)
    const didCancel = cancelRustRequest(seedToCancel);
    if (didCancel) {
      console.log('[Dev] Stopping generation request (client abort)');
      controller.abort();
      // Ask backend to cancel compute if we're the only waiter
      fetch(`/api/generate/${encodeURIComponent(seedToCancel)}/cancel`, {
        method: 'POST',
      }).catch((err) => console.warn('[Dev] Backend cancel request failed', err));
      setIsGenerating(false);
      setGenerationProgress(null);
      generationAbortRef.current = null;
    } else {
      console.log('[Dev] Cancel skipped; another request for this seed is in-flight');
    }
  }, [activeSeed]);

  const handleCloseShareCard = useCallback(() => {
    // Hide the share card but keep inline analysis visible
    setShowShareCard(false);
    setShowInlineResult(true);
    showAnalysis();
  }, [showAnalysis]);

  // Calculate progress percentage (works for both loading screen and dev tools)
  const progressPercent = generationProgress
    ? Math.round((generationProgress.workersComplete / generationProgress.totalWorkers) * 100)
    : 0;

  if (!puzzle) {
    return (
      <main className={`${styles.main} bg-pattern`} style={{ justifyContent: 'center' }}>
        <Loader
          text={isGenerating ? 'Generating daily puzzle...' : 'Loading Mazle...'}
          progress={isGenerating ? progressPercent : undefined}
        />
      </main>
    );
  }

  const isPostGame = !isPlaying && (!!gameResult || !!previousResult);
  const shouldBlur = showShareCard || (!isPlaying && isGameReady && !showInlineResult);
  const showResultsButton = showInlineResult;
  const isAdVisible = (status: 'filled' | 'unfilled' | null) => canRequestAds && status === 'filled';

  return (
    <ErrorBoundary>
      <main className={`${styles.main} bg-pattern`}>
        {showTopAd && (
          <div
            ref={adTopRef}
            className={`${styles.adBanner} ${styles.adBannerTop} ${adStatus.top === 'unfilled' ? styles.adCollapsed : (!isAdVisible(adStatus.top) ? styles.adHidden : '')}`}
            role="complementary"
            aria-label="Advertisement"
          >
            <AdSlot
              slot={ADSENSE_TOP_SLOT}
              className={styles.adBannerSlot}
              format="horizontal"
              responsive={true}
              enabled={canRequestAds}
              onSlotStatus={(status) =>
                setAdStatus((prev) => (prev.top === status ? prev : { ...prev, top: status }))
              }
            />
          </div>
        )}
        <Header
          streak={stats?.currentStreak || 0}
          puzzleInfo={puzzleLabel ?? `#${puzzleNumber}`}
          onHelpClick={() => setShowHelp(true)}
          onStatsClick={() => setShowStats(true)}
          logoRef={devToolsTapTargetRef}
          logoClassName={styles.devToolsTapTarget}
        />

        <div className={styles.gameWrapper}>
          {showDevTools && (
            <DevTools
              puzzle={puzzle}
              puzzleNumber={puzzleNumber}
              puzzleLabel={puzzleLabel}
              activeSeed={activeSeed}
              seedInput={seedInput}
              onSeedInputChange={setSeedInput}
              selectedMapType={selectedMapType}
              onMapTypeChange={setSelectedMapType}
              startBatchInput={startBatchInput}
              onStartBatchInputChange={setStartBatchInput}
              selectedBackend={selectedBackend}
              onBackendChange={setSelectedBackend}
              lastUsedBackend={lastUsedBackend}
              hintsEnabled={hintsEnabled}
              onHintsToggle={setHintsEnabled}
              isGenerating={isGenerating}
              generationProgress={generationProgress}
              onGenerate={handleDevSeedGenerate}
              onLoadDaily={handleLoadDaily}
              onStopGeneration={handleStopGeneration}
              onClose={() => setShowDevTools(false)}
              canStopGeneration={!!generationAbortRef.current}
            />
          )}

          {/* Only show stats when game is ready (avoids flash of default values during restore) */}
          {(!hasPendingRestore || isGameReady) && (
            <GameUI
              puzzleNumber={puzzleNumber}
              puzzleLabel={puzzleLabel ?? undefined}
              optimalMoves={puzzle.optimalMoves}
              variant="header"
              hidePuzzleNumber={true}
              initialState={initialStats ?? undefined}
              frozen={isPostGame}
            />
          )}

          <div ref={gameStageRef} className={styles.gameArea}>
            <div
              ref={gameFrameRef}
              className={styles.gameFrame}
              style={{
                width: gameFrameSizePx ? `${gameFrameSizePx.width}px` : undefined,
                height: gameFrameSizePx ? `${gameFrameSizePx.height}px` : undefined,
              }}
            >
              <PhaserGame
                key={renderKey}
                puzzle={puzzle}
                viewportWidth={baseWidth}
                viewportHeight={baseHeight}
                onReady={handleGameReady}
              />
              <div className={`${styles.blurOverlay} ${!shouldBlur ? styles.blurOverlayHidden : ''}`} />
              {lifeFlash && <div className={styles.lifeFlash} />}
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
          </div>

          <div className={styles.controlsArea}>
            <button
              className={styles.shareButton}
              onClick={handleShowShareCard}
              style={{
                visibility: showResultsButton ? 'visible' : 'hidden',
                opacity: showResultsButton ? 1 : 0,
                transform: showResultsButton ? 'scale(1)' : 'scale(0.9)',
                pointerEvents: showResultsButton ? 'auto' : 'none',
              }}
            >
              Share Score
            </button>
          </div>
        </div>

        {showBottomAd && (
          <div
            ref={adBottomRef}
            className={`${styles.adBanner} ${styles.adBannerBottom} ${adStatus.bottom === 'unfilled' ? styles.adCollapsed : (!isAdVisible(adStatus.bottom) ? styles.adHidden : '')}`}
            role="complementary"
            aria-label="Advertisement"
          >
            <AdSlot
              slot={ADSENSE_BOTTOM_SLOT}
              className={styles.adBannerSlot}
              format="horizontal"
              responsive={true}
              enabled={canRequestAds}
              onSlotStatus={(status) =>
                setAdStatus((prev) => (prev.bottom === status ? prev : { ...prev, bottom: status }))
              }
            />
          </div>
        )}

        <footer className={styles.footer}>
          <p>Use arrow keys or swipe to move</p>
          <p className={styles.footerLinks}>
            <a href="/about">About</a>
            <span>·</span>
            <a href="/privacy">Privacy</a>
          </p>
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

        {showHelp && <HelpModal onClose={() => setShowHelp(false)} hintsEnabled={hintsEnabled} />}
      </main>
    </ErrorBoundary>
  );
}
