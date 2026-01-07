'use client';

import { useState, useEffect, useRef } from 'react';
import { GameState } from '@/game/types';
import { onGameEvent } from '@/game/events';
import { formatTime } from '@/utils/storage';
import styles from './GameUI.module.css';

interface InitialGameState {
  lives?: number;
  currentAttemptMoves?: number;
  elapsedTimeMs?: number;
  penaltyTimeMs?: number;
  maxLives?: number;
}

interface GameUIProps {
  puzzleNumber: number;
  puzzleLabel?: string;
  optimalMoves: number;
  variant?: 'header' | 'footer';
  hidePuzzleNumber?: boolean;
  initialState?: InitialGameState;
  frozen?: boolean; // When true, ignore game events (for completed game display)
  maxLives?: number; // Override default 3 lives (for dev tools)
  hintsEnabled?: boolean;
  onReviewAttempt?: (index: number | null) => void;
  reviewAttemptIndex?: number | null;
  loading?: boolean; // When true, show skeleton placeholders
}

export default function GameUI({
  puzzleNumber,
  puzzleLabel,
  optimalMoves,
  variant = 'header',
  hidePuzzleNumber = false,
  initialState,
  frozen = false,
  maxLives: propMaxLives,
  hintsEnabled = true,
  onReviewAttempt,
  reviewAttemptIndex,
  loading = false,
}: GameUIProps) {
  const [currentAttemptMoves, setCurrentAttemptMoves] = useState(initialState?.currentAttemptMoves ?? 0);
  const [maxLives, setMaxLives] = useState(propMaxLives ?? initialState?.maxLives ?? 3);
  const [lives, setLives] = useState(initialState?.lives ?? maxLives);
  const [elapsedTime, setElapsedTime] = useState(initialState?.elapsedTimeMs ?? 0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [penaltyTimeMs, setPenaltyTimeMs] = useState(initialState?.penaltyTimeMs ?? 0);
  const [isComplete, setIsComplete] = useState(frozen);
  const [isPaused, setIsPaused] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [penaltyFlash, setPenaltyFlash] = useState(false);
  const [reviewHintTarget, setReviewHintTarget] = useState<number | null>(null);
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;

  // Track if we've shown the review hint this game
  const hasShownReviewHintRef = useRef(false);

  // Sync maxLives and lives when prop changes (dev tools adjustment)
  useEffect(() => {
    if (propMaxLives !== undefined && propMaxLives !== maxLives) {
      setMaxLives(propMaxLives);
      setLives(propMaxLives);
    }
  }, [propMaxLives, maxLives]);
  
  // Reset hint flag when game restarts (lives returns to max)
  useEffect(() => {
    if (lives === maxLives) {
      hasShownReviewHintRef.current = false;
      setReviewHintTarget(null);
    }
  }, [lives, maxLives]);
  
  // ... existing useEffects ...

  // Initialize startTime on client only to avoid hydration mismatch
  useEffect(() => {
    if (initialState?.elapsedTimeMs) {
      setStartTime(Date.now() - initialState.elapsedTimeMs);
    }
  }, [initialState?.elapsedTimeMs]);

  // Sync state when initialState changes (for completed game reload)
  // This handles the case where initialState is set asynchronously after mount
  useEffect(() => {
    if (initialState) {
      if (initialState.lives !== undefined) {
        setLives(initialState.lives);
      }
      if (initialState.currentAttemptMoves !== undefined) {
        setCurrentAttemptMoves(initialState.currentAttemptMoves);
      }
      if (initialState.elapsedTimeMs !== undefined) {
        setElapsedTime(initialState.elapsedTimeMs);
      }
      if (initialState.penaltyTimeMs !== undefined) {
        setPenaltyTimeMs(initialState.penaltyTimeMs);
      }
      if (initialState.maxLives !== undefined) {
        setMaxLives(initialState.maxLives);
      }
    }
  }, [initialState]);


  useEffect(() => {
    // When frozen, don't subscribe to game events - scoreboard stays static
    if (frozen) return;

    const unsubscribeState = onGameEvent('stateUpdate', (data) => {
      const state = data as GameState & { maxLives?: number };
      setCurrentAttemptMoves(state.currentAttemptMoves);
      setLives(state.lives);
      if (state.maxLives !== undefined) {
        setMaxLives(state.maxLives);
      }
      setStartTime(state.startTime);
      setPenaltyTimeMs(state.penaltyTimeMs);
      setIsComplete(state.isComplete);
      setIsPaused(state.isPaused);

      if (state.startTime === 0) {
        setElapsedTime(0);
      }
    });

    const unsubscribeComplete = onGameEvent('gameComplete', () => {
      setIsComplete(true);
    });

    const unsubscribeLifeLost = onGameEvent('lifeLost', (data) => {
      const { lives: newLives } = data as { lives: number };
      setPenaltyFlash(true);
      setTimeout(() => setPenaltyFlash(false), 1500);

      // Trigger "Select" animation on first loss if hints are disabled
      if (!hintsEnabled && !hasShownReviewHintRef.current) {
        hasShownReviewHintRef.current = true;
        setReviewHintTarget(newLives); // The index of the just-lost life is 'newLives'
        
        // Clear after 5 seconds
        setTimeout(() => {
          setReviewHintTarget(null);
        }, 5000);
      }
    });

    return () => {
      unsubscribeState();
      unsubscribeComplete();
      unsubscribeLifeLost();
    };
  }, [frozen, hintsEnabled]);

  // Timer
  useEffect(() => {
    if (!startTime || isComplete || isPaused) return;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, isComplete, isPaused]);

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
  // Single return with conditional content to prevent DOM tree swapping
  return (
    <div className={styles.headerContainer}>
      {!hidePuzzleNumber && !loading && (
        <div className={styles.puzzleInfo}>
          <span className={styles.puzzleNumber}>{displayLabel}</span>
        </div>
      )}

      <div className={styles.statsRow}>
        {/* Lives */}
        <div className={styles.statGroup}>
          <div className={styles.livesContainer}>
            {loading ? (
              // Skeleton lives
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`${styles.lifeNode} ${styles.skeletonLife}`} />
              ))
            ) : (
              // Real lives
              Array.from({ length: maxLives }).map((_, i) => {
                const isLost = i >= lives;
                const isActive = i < lives;
                const attemptIndex = (maxLives - 1) - i;
                const canSelect = !hintsEnabled && onReviewAttempt;
                const isSelected = reviewAttemptIndex === attemptIndex;
                const isHintTarget = reviewHintTarget === i;

                const handleClick = () => {
                  if (!canSelect) return;
                  if (isLost) {
                    if (isSelected) {
                      onReviewAttempt(null);
                    } else {
                      onReviewAttempt(attemptIndex);
                      if (isHintTarget) setReviewHintTarget(null);
                    }
                  } else {
                    onReviewAttempt(null);
                  }
                };

                const selectionClass = canSelect
                  ? (isSelected ? styles.lifeReviewing : (isLost ? styles.lifeSelectable : styles.lifeReturn))
                  : '';
                const hintClass = isHintTarget ? styles.lifeReviewHint : '';

                return (
                  <div
                    key={i}
                    className={`
                      ${styles.lifeNode}
                      ${isActive ? styles.lifeActive : styles.lifeLost}
                      ${selectionClass}
                      ${hintClass}
                    `}
                    onClick={handleClick}
                    role={canSelect ? "button" : undefined}
                    aria-label={isLost ? `Review attempt ${attemptIndex + 1}` : "Current life"}
                    tabIndex={canSelect ? 0 : undefined}
                  >
                    {isHintTarget && (
                      <span className={styles.selectTooltip}>SELECT</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <span className={styles.statLabel}>LIVES</span>
        </div>

        {/* Divider */}
        <div className={styles.statDivider} />

        {/* Moves */}
        <div className={styles.statGroup}>
          <span className={`${styles.statValue} ${loading ? styles.skeleton : ''} ${!loading && movesRemaining <= 3 ? styles.danger : ''}`}>
            {loading ? '00' : Math.max(0, movesRemaining)}
          </span>
          <span className={styles.statLabel}>MOVES LEFT</span>
        </div>

        {/* Divider */}
        <div className={styles.statDivider} />

        {/* Time */}
        <div className={styles.statGroup}>
          <span className={`${styles.statValue} ${loading ? styles.skeleton : ''} ${!loading && penaltyFlash ? styles.penaltyFlash : ''}`}>
            {loading ? '0:00' : formatTime(totalDisplayTime)}
          </span>
          <span className={styles.statLabel}>TIME</span>

          {/* Penalty Tooltip - hidden during loading */}
          <span
            className={styles.infoIcon}
            style={loading ? { visibility: 'hidden' } : undefined}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onTouchStart={(e) => {
              e.preventDefault();
              setShowTooltip(prev => !prev);
            }}
          >
            ?
            {showTooltip && (
              <span className={styles.tooltip}>
                +30s/life penalty
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
