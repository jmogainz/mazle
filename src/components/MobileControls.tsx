'use client';

import { useCallback } from 'react';
import { Direction } from '@/game/types';
import styles from './MobileControls.module.css';

interface MobileControlsProps {
  onMove: (direction: Direction) => void;
  disabled?: boolean;
}

export default function MobileControls({ onMove, disabled }: MobileControlsProps) {
  const handleMove = useCallback((dir: Direction) => {
    if (!disabled) {
      onMove(dir);
    }
  }, [onMove, disabled]);

  return (
    <div className={styles.container}>
      <div className={styles.dpad}>
        <button
          className={`${styles.button} ${styles.up}`}
          onClick={() => handleMove(Direction.UP)}
          disabled={disabled}
          aria-label="Move up"
        >
          ▲
        </button>
        <button
          className={`${styles.button} ${styles.left}`}
          onClick={() => handleMove(Direction.LEFT)}
          disabled={disabled}
          aria-label="Move left"
        >
          ◀
        </button>
        <div className={styles.center} />
        <button
          className={`${styles.button} ${styles.right}`}
          onClick={() => handleMove(Direction.RIGHT)}
          disabled={disabled}
          aria-label="Move right"
        >
          ▶
        </button>
        <button
          className={`${styles.button} ${styles.down}`}
          onClick={() => handleMove(Direction.DOWN)}
          disabled={disabled}
          aria-label="Move down"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

