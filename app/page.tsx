'use client';

import dynamic from 'next/dynamic';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controls } from '../components/Controls';
import { formatDuration, pluralize } from '../lib/format';
import { generateDailyPuzzle } from '../lib/generator';
import { simulateMove } from '../lib/movement';
import { buildShareCard } from '../lib/share';
import { dateKey, nextResetTimestamp } from '../lib/puzzleNumber';
import { Direction, GameState, TileType } from '../lib/types';

const tileLabels: { tile: TileType; label: string; hint: string }[] = [
  { tile: TileType.Floor, label: 'Floor', hint: 'Step normally' },
  { tile: TileType.Ice, label: 'Ice', hint: 'Slide until you hit something' },
  { tile: TileType.Ledge, label: 'Ledge', hint: 'Only cross downward' },
  { tile: TileType.Wall, label: 'Wall', hint: 'Blocks movement' },
  { tile: TileType.Goal, label: 'Goal', hint: 'Reach to finish' },
];

const GameCanvas = dynamic(() => import('../components/GameCanvas').then((mod) => mod.GameCanvas), { ssr: false });

export default function HomePage() {
  const puzzle = useMemo(() => generateDailyPuzzle(), []);
  const [gameState, setGameState] = useState<GameState>(() => ({
    position: puzzle.start,
    moves: 0,
    status: 'playing',
    startedAt: Date.now(),
  }));
  const [lastMove, setLastMove] = useState<{
    path: { x: number; y: number }[];
    bumped: boolean;
    direction: Direction;
    id: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [snapVersion, setSnapVersion] = useState(0);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const resetRun = useCallback(() => {
    setGameState({
      position: puzzle.start,
      moves: 0,
      status: 'playing',
      startedAt: Date.now(),
    });
    setLastMove(null);
    setSnapVersion((v) => v + 1);
  }, [puzzle.start]);

  const handleMove = useCallback(
    (direction: Direction) => {
      setGameState((state) => {
        if (state.status === 'won') return state;
        const moveResult = simulateMove(puzzle, state.position, direction);
        const nextMoves = state.moves + 1;
        const finalPosition = moveResult.path[moveResult.path.length - 1];
        const nowTs = Date.now();
        const nextState: GameState = {
          ...state,
          moves: nextMoves,
          position: finalPosition,
        };
        if (moveResult.reachedGoal) {
          nextState.status = 'won';
          nextState.completedAt = nowTs;
        }
        setLastMove({
          path: moveResult.path,
          bumped: moveResult.bumped || moveResult.path.length <= 1,
          direction,
          id: nextMoves,
        });
        return nextState;
      });
    },
    [puzzle],
  );

  const elapsedMs = (gameState.completedAt ?? now) - gameState.startedAt;
  const resetIn = Math.max(0, nextResetTimestamp() - now);

  const shareText = useMemo(
    () =>
      buildShareCard({
        puzzle,
        moves: gameState.moves,
        durationMs: gameState.completedAt ? (gameState.completedAt - gameState.startedAt) : elapsedMs,
        won: gameState.status === 'won',
      }),
    [elapsedMs, gameState.completedAt, gameState.moves, gameState.startedAt, gameState.status, puzzle],
  );

  const handleShare = useCallback(async () => {
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        setToast('Shared successfully');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText);
        setToast('Copied results to clipboard');
      } else {
        setToast('Sharing not supported here');
      }
    } catch (err) {
      setToast('Could not share right now');
    }
  }, [shareText]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (['arrowup', 'w'].includes(key)) handleMove('up');
      else if (['arrowdown', 's'].includes(key)) handleMove('down');
      else if (['arrowleft', 'a'].includes(key)) handleMove('left');
      else if (['arrowright', 'd'].includes(key)) handleMove('right');
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleMove]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const threshold = 24;
    if (absX < threshold && absY < threshold) return;
    if (absX > absY) {
      handleMove(dx > 0 ? 'right' : 'left');
    } else {
      handleMove(dy > 0 ? 'down' : 'up');
    }
  };

  const countdownMinutes = Math.floor(resetIn / 60000);
  const countdownSeconds = Math.floor((resetIn % 60000) / 1000);

  return (
    <main>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <span className="tag">Daily #{puzzle.number}</span>
        <span className="tag" style={{ background: 'rgba(244, 197, 66, 0.12)', color: 'var(--accent-2)' }}>
          {dateKey()}
        </span>
        {isClient && (
          <span className="tag" style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text)' }}>
            Reset in {`${countdownMinutes}:${`${countdownSeconds}`.padStart(2, '0')}`}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 28, marginBottom: 10 }}>Mazle</h1>
        <p style={{ maxWidth: 780, color: 'var(--muted)', fontSize: 16 }}>
          A daily, Pokémon-inspired micro-maze. Slide across ice, drop one-way ledges, and reach the glowing goal in as few moves as possible. Arrow keys, WASD, or swipe on mobile.
        </p>
      </div>

      <div className="grid-two">
        <div className="card game-shell" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ letterSpacing: 1 }}>Goal: reach ⭐️</strong>
            </div>
            <button className="button secondary" type="button" onClick={resetRun}>
              Reset run
            </button>
          </div>

          <GameCanvas
            puzzle={puzzle}
            playerPosition={gameState.position}
            moveAnimation={lastMove}
            snapVersion={snapVersion}
          />

          <div style={{ marginTop: 12 }}>
            <Controls onMove={handleMove} disabled={gameState.status === 'won'} />
          </div>

          <div className="stats" style={{ marginTop: 16 }}>
            <div className="stat-block">
              <span className="stat-label">Moves</span>
              <div className="stat-value">{gameState.moves}</div>
            </div>
            <div className="stat-block">
              <span className="stat-label">Time</span>
              <div className="stat-value">{formatDuration(elapsedMs)}</div>
            </div>
            <div className="stat-block">
              <span className="stat-label">Par target</span>
              <div className="stat-value">{puzzle.parMoves > 0 ? `${puzzle.parMoves} moves` : 'Auto-fit'}</div>
            </div>
            <div className="stat-block">
              <span className="stat-label">Tiles</span>
              <div className="stat-value">Ice {puzzle.iceCount} · Ledges {puzzle.ledgeCount}</div>
            </div>
          </div>

          {gameState.status === 'won' ? (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16, marginBottom: 8 }}>You cleared it!</h3>
              <p style={{ color: 'var(--muted)' }}>
                {pluralize(gameState.moves, 'move')}, finished in {formatDuration(elapsedMs)}. Share your result or run it back for a cleaner line.
              </p>
              <div className="share-card" style={{ marginTop: 8 }}>{shareText}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button className="button" type="button" onClick={handleShare}>
                  Share / Copy
                </button>
                <button className="button secondary" type="button" onClick={resetRun}>
                  Try again
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, color: 'var(--muted)' }}>
              Optimize your route: move count is the primary score. Bumps still cost a move.
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h3 style={{ fontSize: 16 }}>How to play</h3>
          <ul style={{ paddingLeft: 20, margin: 0, color: 'var(--muted)' }}>
            <li>Step on floor tiles one space at a time.</li>
            <li>Ice slides you straight until you hit a wall or non-ice tile.</li>
            <li>🔽 ledges are one-way: you can only enter from above (moving down) and cannot climb back up.</li>
            <li>Walls are solid; bumping them still costs a move.</li>
            <li>Keyboard: arrows / WASD. Mobile: swipe or tap the pad.</li>
          </ul>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            {tileLabels.map(({ tile, label, hint }) => (
              <div
                key={label}
                className="stat-block"
                style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 8, background: 'rgba(255,255,255,0.05)', display: 'grid', placeItems: 'center' }}>
                  {tile === TileType.Ice && '🧊'}
                  {tile === TileType.Ledge && '🔽'}
                  {tile === TileType.Wall && '⬛'}
                  {tile === TileType.Goal && '⭐'}
                  {tile === TileType.Floor && '▫️'}
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{label}</div>
                  <div style={{ color: 'var(--muted)', fontSize: 13 }}>{hint}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 6, borderColor: 'rgba(82,224,193,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>Daily target</div>
                <div style={{ color: 'var(--muted)', fontSize: 14 }}>
                  Best route is usually ~20 moves. Par is the shortest path our generator found.
                </div>
              </div>
              <div className="tag">Seed {puzzle.seed.slice(-6)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3 style={{ fontSize: 16, marginBottom: 10 }}>Daily notes</h3>
        <div style={{ color: 'var(--muted)' }}>
          <p>One global puzzle per day. Everyone sees the same layout (seeded from date + salt). Leaderboards and friend races will arrive later; for now it is pure practice and bragging rights.</p>
          <p style={{ marginTop: 6 }}>Share card shows your move count and time along with a tiny minimap of the room.</p>
        </div>
      </div>

      <footer>
        Built with Next.js + Phaser. Maze logic is deterministic (seeded by UTC date). Deploy-ready for Vercel.
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
