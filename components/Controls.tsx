'use client';

import { Direction } from '../lib/types';

type Props = {
  onMove: (direction: Direction) => void;
  disabled?: boolean;
};

const directions: { dir: Direction; label: string; symbol: string }[] = [
  { dir: 'up', label: 'Up', symbol: '↑' },
  { dir: 'left', label: 'Left', symbol: '←' },
  { dir: 'right', label: 'Right', symbol: '→' },
  { dir: 'down', label: 'Down', symbol: '↓' },
];

export function Controls({ onMove, disabled }: Props) {
  const handle = (dir: Direction) => {
    if (disabled) return;
    onMove(dir);
  };

  return (
    <div>
      <div className="controls-grid">
        <div />
        <button type="button" className="button secondary" aria-label="Move up" onClick={() => handle('up')}>
          ↑
        </button>
        <div />
        <button type="button" className="button secondary" aria-label="Move left" onClick={() => handle('left')}>
          ←
        </button>
        <button type="button" className="button secondary" aria-label="Move right" onClick={() => handle('right')}>
          →
        </button>
        <div />
        <button type="button" className="button secondary" aria-label="Move down" onClick={() => handle('down')}>
          ↓
        </button>
        <div />
      </div>
      <p style={{ textAlign: 'center', color: 'var(--muted)', marginTop: 8 }}>Tap or swipe. Arrow keys / WASD also work.</p>
    </div>
  );
}
