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
  variant?: 'header' | 'footer';
}

export default function GameUI({ puzzleNumber, puzzleLabel, optimalMoves, variant = 'header' }: GameUIProps) {
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

  if (variant === 'footer') {
    return (
      <div className={styles.footerContainer}>
        <div className={styles.movesRemainingContainer}>
          <span className={`${styles.movesValue} ${movesRemaining <= 5 ? styles.danger : ''}`}>
            {Math.max(0, movesRemaining)}
          </span>
          <span className={styles.movesLabel}>MOVES REMAINING</span>
        </div>
      </div>
    );
  }

  // Header Variant (Lives, Time, Puzzle Info)
  return (
    <div className={styles.headerContainer}>
      <div className={styles.puzzleInfo}>
        <span className={styles.puzzleNumber}>{displayLabel}</span>
      </div>
      
      <div className={styles.statsRow}>
        {/* Lives */}
        <div className={styles.statGroup}>
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

        {/* Divider */}
        <div className={styles.statDivider} />

        {/* Moves */}
        <div className={styles.statGroup}>
          <span className={`${styles.statValue} ${movesRemaining <= 5 ? styles.danger : ''}`}>{Math.max(0, movesRemaining)}</span>
          <span className={styles.statLabel}>MOVES LEFT</span>
        </div>

        {/* Divider */}
        <div className={styles.statDivider} />

        {/* Time */}
        <div className={styles.statGroup}>
          <span className={`${styles.statValue} ${penaltyFlash ? styles.penaltyFlash : ''}`}>{formatTime(totalDisplayTime)}</span>
          <span className={styles.statLabel}>TIME</span>
          
          {/* Penalty Tooltip */}
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
    </div>
  );
}
