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
  // We use a ref so it persists across renders but resets logic manually
  const hasShownReviewHint = useState(false); // Using state actually better for reset logic? No, ref is fine. 
  // Wait, I can't reset useState easily inside useEffect without triggering re-renders. 
  // Let's use a ref for "has shown" flag.
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
  }, [frozen]);

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
  return (
    <div className={styles.headerContainer}>
      {!hidePuzzleNumber && (
        <div className={styles.puzzleInfo}>
          <span className={styles.puzzleNumber}>{displayLabel}</span>
        </div>
      )}

      <div className={styles.statsRow}>
        {/* Lives */}
        <div className={styles.statGroup}>
          <div className={styles.livesContainer}>
            {Array.from({ length: maxLives }).map((_, i) => {
              // Logic:
              // i < lives: Active/Remaining lives (usually just one "current" unless we change logic, but let's assume lives=count)
              // i >= lives: Lost lives (history)

              // Actually, standard logic:
              // lives = 3. i=0,1,2.
              // If lives=3 (start), all active.
              // If lives=2, index 0,1 active? Or index 2 lost?
              // Usually: 3 lives means we have 3 attempts.
              // If lives=2, we have used 1.
              // The visual is typically: "Remaining Lives".
              // So if lives=3: [X] [X] [X]
              // If lives=2: [X] [X] [ ]
              // So index < lives are active. index >= lives are lost.

              // Mapping attempt index to life node:
              // Attempt 0 corresponds to the *first* lost life node?
              // Let's say maxLives=3.
              // Attempt 1 fails. lives -> 2. We have 1 attempt in history (index 0).
              // Which node represents attempt 0?
              // Standard approach: Right-to-left or Left-to-right loss?
              // Current CSS: i < lives ? lifeActive : lifeLost.
              // This implies "Active" ones are on the left (0..lives-1).
              // "Lost" ones are on the right (lives..maxLives-1).
              // Example: Start (lives=3): [0:Active] [1:Active] [2:Active]
              // Lose 1 (lives=2): [0:Active] [1:Active] [2:Lost] -> Attempt 0 stored.
              // So "Lost" node at index 2 corresponds to Attempt 0?
              // Lose another (lives=1): [0:Active] [1:Lost] [2:Lost] -> Attempt 1 stored.
              // So "Lost" node at index 1 corresponds to Attempt 1.
              // This reverse mapping is confusing for selection.

              // Better Mapping:
              // Let's say attempts are pushed to an array: [Attempt0, Attempt1].
              // We have `maxLives` slots.
              // Slot 0: Attempt 0 (if lost) OR Current Life (if active).
              // Slot 1: Attempt 1 (if lost) OR Current Life (if active).
              // This suggests we should render slots based on *attempts made*.
              // But the current UI is "Lives Remaining".
              // Let's stick to the visual: "Lost lives are clickable".
              // If I have 3 lives, and I lose one, I have 2 left.
              // The "Lost" indicator is distinct.
              // Let's make *any* lost life clickable to see the attempt that *caused* that loss.

              // Calculating the attempt index for a lost life node:
              // If we fill from right-to-left (standard for hearts/lives):
              // lives=3: [ ][ ][ ]
              // lives=2: [ ][ ][X] (X is index 2. Attempt #0).
              // lives=1: [ ][X][X] (Index 1 is Attempt #1. Index 2 is Attempt #0).
              // lives=0: [X][X][X] (Index 0 is Attempt #2).
              // Formula: attemptIndex = (maxLives - 1) - i
              // Check:
              // i=2, max=3 -> 2-2 = 0. Correct.
              // i=1, max=3 -> 2-1 = 1. Correct.
              // i=0, max=3 -> 2-0 = 2. Correct.

              const isLost = i >= lives;
              const isActive = i < lives;
              const isCurrent = i === lives - 1; // The right-most active life

              // Attempt index for this slot (if lost)
              const attemptIndex = (maxLives - 1) - i;

              // Selection Logic:
              // Can select if: Hints OFF AND (It's a lost life OR It's the current life to cancel review)
              // AND onReviewAttempt is provided.
              const canSelect = !hintsEnabled && onReviewAttempt;
              
              const isSelected = reviewAttemptIndex === attemptIndex;
              const isHintTarget = reviewHintTarget === i;

              // Click handler
              const handleClick = () => {
                if (!canSelect) return;
                
                if (isLost) {
                  if (isSelected) {
                    // Toggle off if already selected
                    onReviewAttempt(null);
                  } else {
                    // Review this specific attempt
                    onReviewAttempt(attemptIndex);
                    // Dismiss hint if clicked
                    if (isHintTarget) setReviewHintTarget(null);
                  }
                } else {
                  // Clicking an active life (or specifically the current one) clears review
                  // to return to "live" view.
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
            })}
          </div>
          <span className={styles.statLabel}>LIVES</span>
        </div>

        {/* Divider */}
        <div className={styles.statDivider} />

        {/* Moves */}
        <div className={styles.statGroup}>
          <span className={`${styles.statValue} ${movesRemaining <= 3 ? styles.danger : ''}`}>{Math.max(0, movesRemaining)}</span>
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
            onTouchStart={(e) => {
              e.preventDefault();
              setShowTooltip(prev => !prev);
            }}
          >
            ?
            {showTooltip && (
              <span className={styles.tooltip}>
                +15s/life penalty
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
