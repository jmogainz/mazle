'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { ErrorBoundary, Header, HelpModal, Loader, ShareCard, StatsModal, GameUI, AdSlot } from '@/components';
import MoreMenuModal from '@/components/MoreMenuModal';
import OverlayShell from '@/components/OverlayShell';
import AccountView from '@/components/AccountView';
import LeaderboardView from '@/components/LeaderboardView';
import { onGameEvent, TILE_SIZE, getNewYorkDateString, type Direction, type PuzzleData } from '@/game';
import type { GameControls } from '@/game/PhaserGame';
import { api } from '@/lib/api';
import { prefetchAccount, prefetchLeaderboard } from '@/lib/api/cached';
import { getPlayerStats } from '@/utils/storage';
import { useGlobalSwipeMoves } from '@/game/useGlobalSwipeMoves';
import baseStyles from '@/app/page.module.css';
import styles from './play-client.module.css';

const PhaserGame = dynamic(() => import('@/game/PhaserGame'), {
  ssr: false,
  loading: () => (
    <div className={baseStyles.loading}>
      <Loader text="Loading puzzle..." />
    </div>
  ),
});

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

function isValidNyDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export default function ArchivePlayClient({ date }: { date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [puzzle, setPuzzle] = useState<PuzzleData | null>(null);
  const [puzzleNumber, setPuzzleNumber] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<{ kind: 'invalid' | 'locked' | 'missing' | 'unknown'; message: string } | null>(null);

  const [stats, setStats] = useState(() => getPlayerStats());
  const [showShareCard, setShowShareCard] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);
  const [gameResult, setGameResult] = useState<{ moveCount: number; timeMs: number; failed?: boolean; attempts?: any[] } | null>(null);
  const [isGameReady, setIsGameReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showInlineResult, setShowInlineResult] = useState(false);
  const [initialStats, setInitialStats] = useState<{
    lives?: number;
    currentAttemptMoves?: number;
    elapsedTimeMs?: number;
    penaltyTimeMs?: number;
  } | null>(null);

  const gameControlsRef = useRef<GameControls | null>(null);
  const gameFrameRef = useRef<HTMLDivElement | null>(null);
  const gameStageRef = useRef<HTMLDivElement | null>(null);
  const [gameFrameSizePx, setGameFrameSizePx] = useState<{ width: number; height: number } | null>(null);

  const safeDate = useMemo(() => (isValidNyDateString(date) ? date : null), [date]);
  const expectedPath = safeDate ? `/play/${safeDate}` : null;
  const isRouteOverlayOpen = expectedPath != null && pathname !== expectedPath;
  const isModalOpen = showHelp || showStats || showShareCard || showMenu || showLeaderboard || showAccount;
  const shouldPause = isRouteOverlayOpen || isModalOpen;

  useEffect(() => {
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && !previewFeaturesEnabled) return;
    const todayNy = getNewYorkDateString();
    const runPrefetch = () => {
      prefetchAccount();
      prefetchLeaderboard(todayNy, 50);
    };

    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(runPrefetch, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(runPrefetch, 800);
    return () => window.clearTimeout(id);
  }, [previewFeaturesEnabled]);

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
    gameControlsRef.current?.setPaused?.(shouldPause);
  }, [shouldPause]);

  useEffect(() => {
    if (!safeDate) {
      setLoadError({ kind: 'invalid', message: 'Invalid date.' });
      return;
    }

    let cancelled = false;
    setLoadError(null);
    setPuzzle(null);
    setPuzzleNumber(null);
    setGameResult(null);
    setShowShareCard(false);
    setShowInlineResult(false);
    setIsPlaying(false);
    setInitialStats(null);

    api
      .archivePuzzle(safeDate)
      .then((res) => {
        if (cancelled) return;
        setPuzzle(res.puzzle);
        setPuzzleNumber(res.puzzleNumber);
      })
      .catch((err) => {
        if (cancelled) return;
        const errorCode = err && typeof err === 'object' ? (err as any).errorCode : null;
        if (errorCode === 'ENTITLEMENT_REQUIRED') {
          setLoadError({ kind: 'locked', message: 'This day is locked. Unlock the archive to play past puzzles.' });
        } else if ((err as any)?.status === 404) {
          setLoadError({ kind: 'missing', message: 'That puzzle is not available.' });
        } else {
          setLoadError({ kind: 'unknown', message: 'Failed to load puzzle.' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [safeDate]);

  useEffect(() => {
    const unsubscribeComplete = onGameEvent('gameComplete', (data) => {
      const result = data as { moveCount: number; timeMs: number; optimalMoves: number; failed?: boolean; attempts?: any[] };
      setGameResult(result);
      setShowShareCard(true);
      setIsPlaying(false);

      const failedAttempts = result.attempts?.length ?? 0;
      const livesRemaining = result.failed ? 0 : 3 - failedAttempts;
      setInitialStats({
        lives: livesRemaining,
        currentAttemptMoves: result.optimalMoves,
        elapsedTimeMs: result.timeMs,
        penaltyTimeMs: 0,
      });
    });

    return () => {
      unsubscribeComplete();
    };
  }, []);

  const puzzleWidth = puzzle?.width ?? 10;
  const puzzleHeight = puzzle?.height ?? 10;
  const BUFFER = 16;
  const baseWidth = puzzleWidth * TILE_SIZE + BUFFER * 2;
  const baseHeight = puzzleHeight * TILE_SIZE + BUFFER * 2;

  useEffect(() => {
    const stage = gameStageRef.current;
    if (!stage) return;

    let rafId: number | null = null;
    const update = () => {
      const computedStyle = window.getComputedStyle(stage);
      const paddingX =
        parseFloat(computedStyle.paddingLeft || '0') + parseFloat(computedStyle.paddingRight || '0');
      const paddingY =
        parseFloat(computedStyle.paddingTop || '0') + parseFloat(computedStyle.paddingBottom || '0');

      const availableWidth = stage.clientWidth - paddingX;
      const availableHeight = stage.clientHeight - paddingY;
      if (availableWidth <= 0 || availableHeight <= 0) return;

      const scale = Math.min(1, availableWidth / baseWidth, availableHeight / baseHeight);
      const width = Math.max(1, Math.floor(baseWidth * scale));
      const height = Math.max(1, Math.floor(baseHeight * scale));

      setGameFrameSizePx((prev) => {
        if (prev && prev.width === width && prev.height === height) return prev;
        return { width, height };
      });
    };

    const scheduleUpdate = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        update();
      });
    };

    scheduleUpdate();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(stage);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [baseWidth, baseHeight]);

  const canAcceptMove = useCallback(() => gameControlsRef.current?.canAcceptMoveInput?.() ?? false, []);
  const move = useCallback((dir: Direction) => gameControlsRef.current?.movePlayer(dir), []);

  useGlobalSwipeMoves({
    enabled: !!puzzle && isGameReady && isPlaying,
    blocked: shouldPause,
    baseWidth,
    baseHeight,
    gameFrameRef,
    canAcceptMove,
    onMove: move,
  });

  const handleGameReady = useCallback((controls: GameControls) => {
    gameControlsRef.current = controls;
    setIsGameReady(true);
    controls.setPaused(shouldPause);

    const hasSeenHelp = localStorage.getItem('mazle_seen_help');
    if (!hasSeenHelp) {
      setShowHelp(true);
      localStorage.setItem('mazle_seen_help', 'true');
    }
  }, [shouldPause]);

  const handleBegin = useCallback(() => {
    setIsPlaying(true);
    gameControlsRef.current?.start();
  }, []);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    gameControlsRef.current?.restart();
    setGameResult(null);
    setShowShareCard(false);
    setShowInlineResult(false);
    setInitialStats(null);
  }, []);

  const showAnalysis = useCallback(() => {
    const attempts = gameResult?.attempts;
    if (attempts && gameControlsRef.current) {
      gameControlsRef.current.showAnalysis(attempts);
    }
  }, [gameResult?.attempts]);

  const handleViewResult = useCallback(() => {
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

  const handleCloseShareCard = useCallback(() => {
    setShowShareCard(false);
    setShowInlineResult(true);
    showAnalysis();
  }, [showAnalysis]);

  const isPostGame = !isPlaying && !!gameResult;
  const shouldBlur = showShareCard || (!isPlaying && isGameReady && !showInlineResult);
  const showResultsButton = showInlineResult;
  const showMenuButton = process.env.NODE_ENV !== 'production' || previewFeaturesEnabled;

  const onBackToToday = useCallback(() => {
    router.push('/');
  }, [router]);

  const onBackToArchive = useCallback(() => {
    window.location.assign('/archive');
  }, []);

  const onUnlockArchive = useCallback(() => {
    if (!safeDate) return;
    router.push(`/archive?paywall=1&d=${encodeURIComponent(safeDate)}`);
  }, [router, safeDate]);

  if (loadError) {
    return (
      <main className={`${baseStyles.main} bg-pattern`} style={{ justifyContent: 'flex-start' }}>
        <Header
          streak={stats.currentStreak || 0}
          onHelpClick={() => setShowHelp(true)}
          onStatsClick={() => setShowStats(true)}
          onMenuClick={showMenuButton ? () => setShowMenu(true) : undefined}
        />
        <MoreMenuModal
          open={showMenu}
          onClose={() => setShowMenu(false)}
          onOpenLeaderboard={() => setShowLeaderboard(true)}
          onOpenAccount={() => setShowAccount(true)}
          onOpenArchive={onBackToArchive}
        />
        <div className={styles.errorCard}>
          <div className={styles.errorTitle}>
            {loadError.kind === 'locked' ? 'Locked day' : loadError.kind === 'invalid' ? 'Invalid date' : 'Unavailable'}
          </div>
          <div className={styles.errorText}>{loadError.message}</div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondaryButton} onClick={onBackToArchive}>
              Back to Archive
            </button>
            <button type="button" className={styles.secondaryButton} onClick={onBackToToday}>
              Back to Today
            </button>
            {loadError.kind === 'locked' && (
              <button type="button" className={styles.primaryButton} onClick={onUnlockArchive}>
                Unlock Archive
              </button>
            )}
          </div>
        </div>
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} hintsEnabled={true} />}
        {showStats && <StatsModal stats={stats} onClose={() => setShowStats(false)} />}
      </main>
    );
  }

  if (!puzzle || puzzleNumber == null || !safeDate) {
    return (
      <main className={`${baseStyles.main} bg-pattern`} style={{ justifyContent: 'center' }}>
        <Loader text="Loading puzzle..." />
      </main>
    );
  }

  const puzzleLabel = `#${puzzleNumber} · ${safeDate} (Archive)`;

  return (
    <ErrorBoundary>
      <main className={`${baseStyles.main} bg-pattern`}>
        <Header
          streak={stats.currentStreak || 0}
          onHelpClick={() => setShowHelp(true)}
          onStatsClick={() => setShowStats(true)}
          onMenuClick={showMenuButton ? () => setShowMenu(true) : undefined}
        />

        <div className={baseStyles.gameWrapper}>
          <div className={styles.topRow}>
            <button type="button" className={styles.backButton} onClick={onBackToArchive}>
              ← Archive
            </button>
            <button type="button" className={styles.backButton} onClick={onBackToToday}>
              Today
            </button>
          </div>

          <div className={baseStyles.puzzleNumberBanner}>
            <div className={styles.puzzleNumberBlock}>
              <span className={baseStyles.puzzleNumberText}>Mazle #{puzzleNumber}</span>
              <span className={styles.puzzleDateText}>{safeDate}</span>
            </div>
          </div>

          <GameUI
            puzzleNumber={puzzleNumber}
            puzzleLabel={puzzleLabel}
            optimalMoves={puzzle.optimalMoves}
            variant="header"
            hidePuzzleNumber={true}
            initialState={initialStats ?? undefined}
            frozen={isPostGame}
          />

          <div ref={gameStageRef} className={baseStyles.gameArea}>
            <div
              ref={gameFrameRef}
              className={baseStyles.gameFrame}
              style={{
                width: gameFrameSizePx ? `${gameFrameSizePx.width}px` : undefined,
                height: gameFrameSizePx ? `${gameFrameSizePx.height}px` : undefined,
              }}
            >
              <PhaserGame
                puzzle={puzzle}
                viewportWidth={baseWidth}
                viewportHeight={baseHeight}
                onReady={handleGameReady}
              />
              <div className={`${baseStyles.blurOverlay} ${!shouldBlur ? baseStyles.blurOverlayHidden : ''}`} />
              {!isPlaying && isGameReady && !showInlineResult && !showShareCard && (
                <div className={baseStyles.startOverlay}>
                  {isPostGame ? (
                    <div className={baseStyles.previousResult}>
                      <p>You already finished this puzzle.</p>
                      <button onClick={handleViewResult} className={baseStyles.viewResultButton}>
                        View Result
                      </button>
                      <button onClick={handleRestart} className={baseStyles.viewResultButton} style={{ marginTop: '0.5rem' }}>
                        Replay
                      </button>
                    </div>
                  ) : (
                    <button className={baseStyles.startButton} onClick={handleBegin}>
                      Begin
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className={baseStyles.controlsArea}>
            <button
              className={baseStyles.shareButton}
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

        <footer className={baseStyles.footer}>
          <p>Use arrow keys or swipe to move</p>
        </footer>

        <MoreMenuModal
          open={showMenu}
          onClose={() => setShowMenu(false)}
          onOpenLeaderboard={() => setShowLeaderboard(true)}
          onOpenAccount={() => setShowAccount(true)}
          onOpenArchive={onBackToArchive}
        />

        {showLeaderboard && (
          <OverlayShell
            title="Leaderboard"
            subtitle="Today"
            variant="overlay"
            onClose={() => setShowLeaderboard(false)}
          >
            <LeaderboardView />
            <AdSlot placement="leaderboard" />
          </OverlayShell>
        )}

        {showAccount && (
          <OverlayShell
            title="Account"
            subtitle="Name, sign-in, settings"
            variant="overlay"
            onClose={() => setShowAccount(false)}
          >
            <AccountView />
            <AdSlot placement="account" />
          </OverlayShell>
        )}

        {showShareCard && gameResult && (
          <ShareCard
            puzzleNumber={puzzleNumber}
            puzzleLabel={puzzleLabel}
            timeMs={gameResult.timeMs}
            optimalMoves={puzzle.optimalMoves}
            failed={gameResult.failed}
            attempts={gameResult.attempts}
            leaderboardDate={(process.env.NODE_ENV !== 'production' || previewFeaturesEnabled) ? safeDate : undefined}
            leaderboardAllowSubmit={false}
            secondaryActionLabel="Back to Archive"
            onSecondaryAction={onBackToArchive}
            footerText="Pick another day in the Archive."
            onClose={handleCloseShareCard}
          />
        )}

        {showStats && <StatsModal stats={stats} onClose={() => setShowStats(false)} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} hintsEnabled={true} />}
      </main>
    </ErrorBoundary>
  );
}
