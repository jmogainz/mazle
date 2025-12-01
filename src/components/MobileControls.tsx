'use client';

import { useCallback, useState } from 'react';
import { Direction } from '@/game/types';
import styles from './MobileControls.module.css';

interface MobileControlsProps {
  onMove: (direction: Direction) => void;
  disabled?: boolean;
}

export default function MobileControls({ onMove, disabled }: MobileControlsProps) {
  const [pressedDir, setPressedDir] = useState<Direction | null>(null);

  const handleTouchStart = useCallback((dir: Direction) => {
    if (!disabled) {
      setPressedDir(dir);
    }
  }, [disabled]);

  const handleTouchEnd = useCallback((dir: Direction) => {
    if (!disabled && pressedDir === dir) {
      onMove(dir);
    }
    setPressedDir(null);
  }, [disabled, onMove, pressedDir]);

  const handleClick = useCallback((dir: Direction) => {
    // Fallback for non-touch devices
    if (!disabled) {
      onMove(dir);
    }
  }, [disabled, onMove]);

  const getButtonClass = (dir: Direction) => {
    const dirClass = styles[dir];
    const pressed = pressedDir === dir ? styles.pressed : '';
    return `${styles.button} ${dirClass} ${pressed}`;
  };

  return (
    <div className={styles.container}>
      <div className={styles.dpad}>
        <button
          className={getButtonClass(Direction.UP)}
          onTouchStart={() => handleTouchStart(Direction.UP)}
          onTouchEnd={() => handleTouchEnd(Direction.UP)}
          onClick={() => handleClick(Direction.UP)}
          disabled={disabled}
          aria-label="Move up"
        >
          ▲
        </button>
        <button
          className={getButtonClass(Direction.LEFT)}
          onTouchStart={() => handleTouchStart(Direction.LEFT)}
          onTouchEnd={() => handleTouchEnd(Direction.LEFT)}
          onClick={() => handleClick(Direction.LEFT)}
          disabled={disabled}
          aria-label="Move left"
        >
          ◀
        </button>
        <div className={styles.center} />
        <button
          className={getButtonClass(Direction.RIGHT)}
          onTouchStart={() => handleTouchStart(Direction.RIGHT)}
          onTouchEnd={() => handleTouchEnd(Direction.RIGHT)}
          onClick={() => handleClick(Direction.RIGHT)}
          disabled={disabled}
          aria-label="Move right"
        >
          ▶
        </button>
        <button
          className={getButtonClass(Direction.DOWN)}
          onTouchStart={() => handleTouchStart(Direction.DOWN)}
          onTouchEnd={() => handleTouchEnd(Direction.DOWN)}
          onClick={() => handleClick(Direction.DOWN)}
          disabled={disabled}
          aria-label="Move down"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

