'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdventureLevelDefinition } from '@/adventure';
import { getAdventureChapter, starsForMoves, toPuzzleData } from '@/adventure';
import GameUI from '@/components/GameUI';
import type { GameControls } from '@/game/PhaserGame';
import { onGameEvent } from '@/game/events';
import { Direction, TILE_SIZE, type GameState } from '@/game/types';
import { useGlobalSwipeMoves } from '@/game/useGlobalSwipeMoves';
import { useAdventureDialog } from './useAdventureDialog';
import styles from './AdventureGame.module.css';

const PhaserGame = dynamic(() => import('@/game/PhaserGame'), { ssr: false });

export type AdventureGameResult = {
  completed: boolean;
  moves: number;
  timeMs: number;
  stars: number;
};

type AdventureGameProps = {
  level: AdventureLevelDefinition;
  heartAtRisk: boolean;
  onFinish: (result: AdventureGameResult) => void;
  onQuit: (hadStarted: boolean, moves: number, timeMs: number) => void;
};

const ACCESSIBLE_DIRECTIONS: Array<{ direction: Direction; label: string }> = [
  { direction: Direction.UP, label: 'Move up' },
  { direction: Direction.LEFT, label: 'Move left' },
  { direction: Direction.DOWN, label: 'Move down' },
  { direction: Direction.RIGHT, label: 'Move right' },
];

export default function AdventureGame({ level, heartAtRisk, onFinish, onQuit }: AdventureGameProps) {
  const puzzle = useMemo(() => ({ ...toPuzzleData(level), variant: 'adventure' as const, moveLimit: level.moveLimit }), [level]);
  const chapterTitle = getAdventureChapter(level.chapterId)?.title ?? 'Frostpeak Trail';
  const controlsRef = useRef<GameControls | null>(null);
  const boardShellRef = useRef<HTMLDivElement>(null);
  const gameFrameRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const exitHandledRef = useRef(false);
  const startedAtRef = useRef<number | null>(null);
  const onFinishRef = useRef(onFinish);
  const onQuitRef = useRef(onQuit);
  const [ready, setReady] = useState(false);
  const [moves, setMoves] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [showQuit, setShowQuit] = useState(false);

  const baseWidth = puzzle.width * TILE_SIZE;
  const baseHeight = puzzle.height * TILE_SIZE;
  const maximumFrameScale = Math.min(1, 520 / baseWidth);
  const [frameSize, setFrameSize] = useState(() => ({
    width: Math.round(baseWidth * maximumFrameScale),
    height: Math.round(baseHeight * maximumFrameScale),
  }));
  const quitDialogRef = useAdventureDialog(showQuit, () => setShowQuit(false));

  useEffect(() => {
    onFinishRef.current = onFinish;
    onQuitRef.current = onQuit;
  }, [onFinish, onQuit]);

  useEffect(() => {
    const shell = boardShellRef.current;
    if (!shell) return;
    const updateSize = () => {
      const bounds = shell.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const scale = Math.max(0.01, Math.min(
        maximumFrameScale,
        bounds.width / baseWidth,
        bounds.height / baseHeight,
      ));
      const next = {
        width: Math.floor(baseWidth * scale),
        height: Math.floor(baseHeight * scale),
      };
      setFrameSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [baseHeight, baseWidth, maximumFrameScale]);

  useEffect(() => {
    const unsubscribeState = onGameEvent('stateUpdate', (payload) => {
      const state = payload as GameState;
      setMoves(state.currentAttemptMoves);
      if (state.startTime > 0 && startedAtRef.current == null) startedAtRef.current = state.startTime;
      setIsComplete(state.isComplete);
    });
    const unsubscribeComplete = onGameEvent('gameComplete', (payload) => {
      if (finishedRef.current) return;
      const result = payload as { moveCount?: number; timeMs?: number; failed?: boolean };
      const finalMoves = Math.max(0, Math.round(result.moveCount ?? 0));
      const completed = !result.failed;
      finishedRef.current = true;
      setIsComplete(true);
      onFinishRef.current({
        completed,
        moves: finalMoves,
        timeMs: Math.max(0, Math.round(result.timeMs ?? 0)),
        stars: starsForMoves(level, finalMoves, completed),
      });
    });
    return () => {
      unsubscribeState();
      unsubscribeComplete();
    };
  }, [level]);

  const onReady = useCallback((controls: GameControls) => {
    controlsRef.current = controls;
    controls.setMaxLives(1);
    controls.setHintsEnabled(false);
    controls.start();
    startedAtRef.current = Date.now();
    setReady(true);
  }, []);

  const move = useCallback((direction: Direction) => {
    if (!ready || isComplete) return;
    controlsRef.current?.movePlayer(direction);
  }, [isComplete, ready]);

  useGlobalSwipeMoves({
    enabled: ready,
    blocked: isComplete || showQuit,
    baseWidth,
    baseHeight,
    gameFrameRef,
    canAcceptMove: () => controlsRef.current?.canAcceptMoveInput() ?? false,
    onMove: move,
  });

  useEffect(() => {
    if (!ready) return;
    controlsRef.current?.setPaused(showQuit);
    return () => {
      if (showQuit) controlsRef.current?.setPaused(false);
    };
  }, [ready, showQuit]);

  useEffect(() => {
    // React development Strict Mode immediately replays effect setup/cleanup.
    // Only treat cleanup as a real navigation after the mount has committed.
    let committedMount = false;
    const commitTimer = window.setTimeout(() => { committedMount = true; }, 0);
    const abandonUnfinishedAttempt = () => {
      if (finishedRef.current || exitHandledRef.current) return;
      exitHandledRef.current = true;
      const state = controlsRef.current?.getSerializableState();
      const moveCount = state?.currentAttemptMoves ?? 0;
      const timeMs = state?.elapsedTimeMs
        ?? (startedAtRef.current ? Date.now() - startedAtRef.current : 0);
      onQuitRef.current(moveCount > 0, moveCount, timeMs);
    };
    window.addEventListener('pagehide', abandonUnfinishedAttempt);
    return () => {
      window.clearTimeout(commitTimer);
      window.removeEventListener('pagehide', abandonUnfinishedAttempt);
      if (committedMount) abandonUnfinishedAttempt();
    };
  }, []);

  const confirmQuit = () => {
    const state = controlsRef.current?.getSerializableState();
    const moveCount = state?.currentAttemptMoves ?? moves;
    const timeMs = state?.elapsedTimeMs
      ?? (startedAtRef.current ? Date.now() - startedAtRef.current : 0);
    exitHandledRef.current = true;
    onQuitRef.current(moveCount > 0, moveCount, timeMs);
  };

  return (
    <main className={styles.gameScreen} data-testid="adventure-game">
      <header className={styles.gameHeader}>
        <button type="button" className={styles.closeButton} onClick={() => setShowQuit(true)} aria-label="Leave level">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
        <div className={styles.levelTitle}>
          <span>{chapterTitle}</span>
          <strong>Level {level.id}</strong>
        </div>
      </header>

      <section className={styles.gameContent}>
        <div className={styles.objectiveCard}>
          <div className={styles.goalBadge}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.4 2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.21l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.4Z" /></svg>
          </div>
          <div><span>OBJECTIVE</span><strong>Reach the star before moves run out</strong></div>
          <div className={styles.parBadge}><small>PERFECT</small><strong>{level.optimalMoves}</strong></div>
        </div>

        <GameUI
          puzzleNumber={level.id}
          puzzleLabel={`LEVEL ${level.id}`}
          optimalMoves={level.moveLimit}
          hidePuzzleNumber
          maxLives={1}
          hintsEnabled={false}
          frozen={isComplete}
          loading={!ready}
          adventureScoreboard={{ starThresholds: level.starThresholds }}
        />

        <div ref={boardShellRef} className={styles.boardShell}>
          <div className={styles.boardGlow} />
          <div
            ref={gameFrameRef}
            className={styles.gameFrame}
            style={{ width: frameSize.width, height: frameSize.height, aspectRatio: `${puzzle.width} / ${puzzle.height}` }}
          >
            <PhaserGame puzzle={puzzle} viewportWidth={baseWidth} viewportHeight={baseHeight} onReady={onReady} />
            {!ready && <div className={styles.loadingBoard}><span /><p>Preparing the trail…</p></div>}
          </div>
        </div>

        <p className={styles.swipeHint}>Swipe the maze to move</p>
        <div className={styles.accessibleControls} aria-label="Accessible movement controls">
          {ACCESSIBLE_DIRECTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              className={styles.srOnlyControl}
              onClick={() => move(item.direction)}
              aria-label={item.label}
              disabled={!ready || isComplete}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      {showQuit && (
        <div className={styles.dialogBackdrop} role="presentation" onClick={() => setShowQuit(false)}>
          <section
            ref={quitDialogRef}
            className={styles.quitDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="quit-title"
            aria-describedby="quit-description"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.quitIcon}>↩</div>
            <h2 id="quit-title">Leave this level?</h2>
            <p id="quit-description">{
              moves > 0 && heartAtRisk
                ? 'Leaving now uses one heart. Your map progress is safe.'
                : moves > 0
                  ? 'Starter levels are heart-free, so leaving will not use one.'
                  : 'You have not moved yet, so no heart will be used.'
            }</p>
            <button type="button" className={styles.keepPlaying} onClick={() => setShowQuit(false)} data-dialog-autofocus>Keep playing</button>
            <button type="button" className={styles.leaveButton} onClick={confirmQuit}>Leave level</button>
          </section>
        </div>
      )}
    </main>
  );
}
