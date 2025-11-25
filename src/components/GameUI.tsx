'use client';

import { useState, useEffect } from 'react';
import { GameState } from '@/game/types';
import { onGameEvent } from '@/game/events';
import { formatTime } from '@/utils/storage';
import styles from './GameUI.module.css';

interface GameUIProps {
  puzzleNumber: number;
  puzzleLabel?: string;
}

export default function GameUI({ puzzleNumber, puzzleLabel }: GameUIProps) {
  const [moveCount, setMoveCount] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;

  useEffect(() => {
    const unsubscribe = onGameEvent('stateUpdate', (data) => {
      const state = data as GameState;
      setMoveCount(state.moveCount);
      setStartTime(state.startTime);
      setIsComplete(state.isComplete);
    });

    return unsubscribe;
  }, []);

  // Timer
  useEffect(() => {
    if (!startTime || isComplete) return;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, isComplete]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.puzzleInfo}>
          <span className={styles.puzzleNumber}>{displayLabel}</span>
        </div>
      </div>
      
      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statValue}>{moveCount}</span>
          <span className={styles.statLabel}>MOVES</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statValue}>{formatTime(elapsedTime)}</span>
          <span className={styles.statLabel}>TIME</span>
        </div>
      </div>
    </div>
  );
}
