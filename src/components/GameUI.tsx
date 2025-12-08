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
  const [elapsedTime, setElapsedTime] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [penaltyTimeMs, setPenaltyTimeMs] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [penaltyFlash, setPenaltyFlash] = useState(false);
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;

  useEffect(() => {
    const unsubscribeState = onGameEvent('stateUpdate', (data) => {
      const state = data as GameState;
      setCurrentAttemptMoves(state.currentAttemptMoves);
      setLives(state.lives);
      setStartTime(state.startTime);
      setPenaltyTimeMs(state.penaltyTimeMs);
      setIsComplete(state.isComplete);
      
      // Reset timer when new puzzle starts (startTime goes from 0 to a value or resets to 0)
      if (state.startTime === 0) {
        setElapsedTime(0);
      }
    });
    
    const unsubscribeComplete = onGameEvent('gameComplete', () => {
      setIsComplete(true);
    });

    const unsubscribeLifeLost = onGameEvent('lifeLost', () => {
      setPenaltyFlash(true);
      setTimeout(() => setPenaltyFlash(false), 1500);
    });

    return () => {
        unsubscribeState();
        unsubscribeComplete();
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
  const livesLost = 3 - lives;

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
        <div className={styles.stat}>
          <span className={`${styles.statValue} ${penaltyFlash ? styles.penaltyFlash : ''}`}>{formatTime(totalDisplayTime)}</span>
          <span className={styles.statLabel}>TIME</span>
        </div>
        <span 
          className={styles.infoIcon}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onClick={() => setShowTooltip(!showTooltip)}
        >
          ?
          {showTooltip && (
            <span className={styles.tooltip}>
              +5s/life penalty
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
