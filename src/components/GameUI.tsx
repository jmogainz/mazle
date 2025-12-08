'use client';

import { useState, useEffect } from 'react';
import { GameState } from '@/game/types';
import { onGameEvent } from '@/game/events';
import { formatTime } from '@/utils/storage';
import styles from './GameUI.module.css';

interface GameUIProps {
  puzzleNumber: number;
  puzzleLabel?: string;
  optimalMoves: number;
}

export default function GameUI({ puzzleNumber, puzzleLabel, optimalMoves }: GameUIProps) {
  const [currentAttemptMoves, setCurrentAttemptMoves] = useState(0);
  const [lives, setLives] = useState(3);
  const [penaltyVisible, setPenaltyVisible] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [penaltyTimeMs, setPenaltyTimeMs] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;

  useEffect(() => {
    const unsubscribeState = onGameEvent('stateUpdate', (data) => {
      const state = data as GameState;
      setCurrentAttemptMoves(state.currentAttemptMoves);
      setLives(state.lives);
      setStartTime(state.startTime);
      setPenaltyTimeMs(state.penaltyTimeMs);
      setIsComplete(state.isComplete);
    });

    const unsubscribeLifeLost = onGameEvent('lifeLost', () => {
        setPenaltyVisible(true);
        setTimeout(() => setPenaltyVisible(false), 2000);
    });

    return () => {
        unsubscribeState();
        unsubscribeLifeLost();
    };
  }, []);

  // Timer
  useEffect(() => {
    if (!startTime || isComplete) return;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, isComplete]);

  const movesRemaining = optimalMoves - currentAttemptMoves;
  const totalDisplayTime = elapsedTime + penaltyTimeMs;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.puzzleInfo}>
          <span className={styles.puzzleNumber}>{displayLabel}</span>
        </div>
      </div>
      
      <div className={styles.stats}>
        <div className={styles.stat}>
            <div className={styles.livesContainer}>
                {Array.from({ length: 3 }).map((_, i) => (
                    <div 
                        key={i} 
                        className={`${styles.lifeNode} ${i < lives ? styles.lifeActive : styles.lifeLost}`}
                        title={i < lives ? "Active Life" : "Lost Life"}
                    />
                ))}
            </div>
            <span className={styles.statLabel}>LIVES</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${movesRemaining <= 5 ? styles.danger : ''}`}>
            {Math.max(0, movesRemaining)}
          </span>
          <span className={styles.statLabel}>REMAINING</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat} style={{ position: 'relative' }}>
          <span className={styles.statValue}>{formatTime(totalDisplayTime)}</span>
          <span className={styles.statLabel}>TIME</span>
          {penaltyVisible && (
              <span className={styles.penaltyPopup}>+20s</span>
          )}
        </div>
      </div>
    </div>
  );
}
