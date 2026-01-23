'use client';

import { useState, useEffect, useRef } from 'react';
import { GameState } from '@/game/types';
import { onGameEvent } from '@/game/events';
import { formatTime } from '@/utils/storage';
import { STORAGE_KEYS } from '@/constants/game';
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
  analysisAnimationComplete?: boolean; // When true, solution animation has finished
  isResultModalActive?: boolean; // When true, the scorecard/share card is visible
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
  analysisAnimationComplete = false,
  isResultModalActive = false,
}: GameUIProps) {
  const [currentAttemptMoves, setCurrentAttemptMoves] = useState(initialState?.currentAttemptMoves ?? 0);
  const [maxLives, setMaxLives] = useState(propMaxLives ?? initialState?.maxLives ?? 3);
  const [lives, setLives] = useState(initialState?.lives ?? maxLives);
  const [elapsedTime, setElapsedTime] = useState(initialState?.elapsedTimeMs ?? 0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [visualPenaltyTimeMs, setVisualPenaltyTimeMs] = useState(initialState?.penaltyTimeMs ?? 0);
  const [isComplete, setIsComplete] = useState(frozen);
  const [isPaused, setIsPaused] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [penaltyFlash, setPenaltyFlash] = useState(false);
  const [reviewHintTarget, setReviewHintTarget] = useState<number | null>(null);
  const [showLivesTooltip, setShowLivesTooltip] = useState(false);
  const [isTooltipFadingOut, setIsTooltipFadingOut] = useState(false);
  const [flyingPenalty, setFlyingPenalty] = useState<{ x: number, y: number, targetX: number, targetY: number } | null>(null);
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;

  const targetPenaltyTimeMsRef = useRef(initialState?.penaltyTimeMs ?? 0);
  const timerRef = useRef<HTMLSpanElement>(null);
  const penaltyRef = useRef<HTMLDivElement>(null);

  // Track if we've shown the review hint this game
  const hasShownReviewHintRef = useRef(false);
  const hasTriggeredLivesTooltipRef = useRef(false);

  // Sync maxLives and lives when prop changes (dev tools adjustment)
  useEffect(() => {
    if (propMaxLives !== undefined && propMaxLives !== maxLives) {
      setMaxLives(propMaxLives);
      setLives(propMaxLives);
    }
  }, [propMaxLives, maxLives]);

  // Sync frozen prop to isComplete state (stops timer when parent marks game complete)
  useEffect(() => {
    if (frozen) {
      setIsComplete(true);
    }
  }, [frozen]);

  // Reset hint flag when game restarts (lives returns to max)
  useEffect(() => {
    if (lives === maxLives) {
      hasShownReviewHintRef.current = false;
      setReviewHintTarget(null);
    }
  }, [lives, maxLives]);

  // Detect if device supports touch (mobile) or not (desktop)
  const isTouchDevice = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // Tooltip text adapts to device type (touch vs mouse)
  const tooltipText = isTouchDevice ? 'Tap to see failed attempts' : 'Click to see failed attempts';



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
        setVisualPenaltyTimeMs(initialState.penaltyTimeMs);
        targetPenaltyTimeMsRef.current = initialState.penaltyTimeMs;
      }
      if (initialState.maxLives !== undefined) {
        setMaxLives(initialState.maxLives);
      }
    }
  }, [initialState]);

  // Handle lives tooltip hint behavior
  useEffect(() => {
    // Only trigger if game is over (frozen), not loading, and not already triggered
    if (frozen && !loading && !hasTriggeredLivesTooltipRef.current) {
      if (typeof window === 'undefined') return;

      const seen = localStorage.getItem(STORAGE_KEYS.LIVES_TOOLTIP_SEEN);
      if (seen) return;

      const isLoss = lives === 0;

      // TRIGGER CONDITIONS:
      // Loss: Solution animation done AND Scorecard closed
      // Win: Solution animation done (Scorecard is already closed to see analysis)
      const isTriggerReady = isLoss
        ? (analysisAnimationComplete && !isResultModalActive)
        : analysisAnimationComplete;

      if (!isTriggerReady) return;

      hasTriggeredLivesTooltipRef.current = true;

      let fadeTimer: NodeJS.Timeout;
      let cleanupTimer: NodeJS.Timeout;

      // Wait 1 second after trigger condition is met
      const showTimer = setTimeout(() => {
        setShowLivesTooltip(true);

        // Stay for 5.35 seconds then fade out
        fadeTimer = setTimeout(() => {
          setIsTooltipFadingOut(true);

          // Wait for fade animation to finish
          cleanupTimer = setTimeout(() => {
            setShowLivesTooltip(false);
            setIsTooltipFadingOut(false);
            localStorage.setItem(STORAGE_KEYS.LIVES_TOOLTIP_SEEN, 'true');
          }, 400); // Slightly longer than 0.35s animation
        }, 5350);
      }, 1000);

      return () => {
        clearTimeout(showTimer);
        clearTimeout(fadeTimer);
        clearTimeout(cleanupTimer);
      };
    }
  }, [frozen, analysisAnimationComplete, loading, isResultModalActive, lives]);


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
      targetPenaltyTimeMsRef.current = state.penaltyTimeMs;
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
      const { lives: newLives, finalPos } = data as { lives: number; finalPos?: { x: number, y: number } };

      // Calculate screen position for DOM penalty fly-in
      if (finalPos) {
        const canvas = document.querySelector('canvas');
        const timerEl = timerRef.current;
        if (canvas && timerEl) {
          const canvasRect = canvas.getBoundingClientRect();
          const timerRect = timerEl.getBoundingClientRect();

          // The puzzle is centered in the canvas, so we need to account for the offset
          // Canvas displays at CSS size, but Phaser coordinates are at base resolution
          // The canvas CSS size matches the puzzle (no internal offset visible to DOM)
          // Since the canvas shrinks to fit the puzzle, grid coords map directly
          const scaleX = canvasRect.width / (canvas.width || 1);
          const scaleY = canvasRect.height / (canvas.height || 1);

          const startX = canvasRect.left + (finalPos.x * 64 + 32) * scaleX;
          const startY = canvasRect.top + (finalPos.y * 64 + 32) * scaleY;
          const targetX = timerRect.left + timerRect.width / 2;
          const targetY = timerRect.top + timerRect.height / 2;

          // Spawn DOM fly-in after a short delay
          setTimeout(() => {
            setFlyingPenalty({ x: startX, y: startY, targetX, targetY });
          }, 150);
        }
      }

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

  // Handle Flying Penalty Animation (Distance-Based)
  useEffect(() => {
    if (flyingPenalty && penaltyRef.current) {
      const el = penaltyRef.current;
      const { x: sx, y: sy, targetX: tx, targetY: ty } = flyingPenalty;

      const dx = tx - sx;
      const dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Constants
      const TOTAL_DURATION = 1500;
      const POP_DURATION = 225; // 15% of 1500
      const FADE_DISTANCE_PX = 150; // Pixel distance from end to start fading

      // Calculate Fade Timing
      // Flight distance is effectively the whole dist (though visibly starts after pop)
      // We want opacity 1 until we are FADE_DISTANCE_PX away.
      // 0 -> dist. Fade starts at (dist - FADE_DISTANCE_PX).
      // Fraction of journey = (dist - FADE_DISTANCE_PX) / dist.

      let fadeStartRatio = Math.max(0.2, (dist - FADE_DISTANCE_PX) / dist);
      // Ensure fade doesn't start before POP ends implies mapped to time.
      // Flight starts at 10% (after pop/settle).
      // Let's model positions:
      // 0 (0%): Start
      // 0.1 (10%): Start (settled)
      // 1.0 (100%): End
      // Interpolation is linear from 0.1 to 1.0.
      // So time T where pos is FadeStart:
      // T_fade = 0.1 + (1.0 - 0.1) * fadeStartRatio

      const timeFadeStart = 0.1 + (0.9 * fadeStartRatio);

      // Final Opacity keyframes:
      // 0 -> 0.1: Opacity flow (0->1)
      // 0.1 -> timeFadeStart: Opacity 1
      // 1.0: Opacity 0

      // Timer update should happen slightly after fade start
      const timerUpdateRatio = timeFadeStart + 0.05; // 5% later
      const timerUpdateDelay = TOTAL_DURATION * timerUpdateRatio;

      const animation = el.animate([
        { opacity: 0, transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(0.8)`, offset: 0 },
        { opacity: 1, transform: `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(1.2)`, offset: 0.03 },
        { opacity: 1, transform: `translate(${sx}px, ${sy - 20}px) translate(-50%, -50%) scale(1)`, offset: 0.1 },
        { opacity: 1, offset: timeFadeStart }, // Start fading
        { opacity: 0, transform: `translate(${tx}px, ${ty}px) translate(-50%, -50%) scale(1)`, offset: 1 }
      ], {
        duration: TOTAL_DURATION,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        fill: 'forwards'
      });

      // Schedule Timer Update
      const timerTimeout = setTimeout(() => {
        setVisualPenaltyTimeMs(targetPenaltyTimeMsRef.current);
        setPenaltyFlash(true);
        setTimeout(() => setPenaltyFlash(false), 1500);
      }, timerUpdateDelay);

      animation.onfinish = () => {
        setFlyingPenalty(null);
      };

      return () => {
        animation.cancel();
        clearTimeout(timerTimeout);
      };
    }
  }, [flyingPenalty]);

  // Timer
  useEffect(() => {
    if (!startTime || isComplete || isPaused) return;

    const interval = setInterval(() => {
      setElapsedTime(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [startTime, isComplete, isPaused]);

  const movesRemaining = optimalMoves - currentAttemptMoves;
  const totalDisplayTime = elapsedTime + visualPenaltyTimeMs;

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
      {/* Global Flying Penalty (DOM-based to sit above UI) */}
      {flyingPenalty && (
        <div
          ref={penaltyRef}
          className={styles.domPenaltyPopup}
        >
          +30s
        </div>
      )}

      {!hidePuzzleNumber && !loading && (
        <div className={styles.puzzleInfo}>
          <span className={styles.puzzleNumber}>{displayLabel}</span>
        </div>
      )}

      <div className={styles.statsRow}>
        {/* Lives */}
        <div className={styles.statGroup}>
          {showLivesTooltip && (
            <div className={`${styles.livesTooltip} ${isTooltipFadingOut ? styles.tooltipFadeOut : ''}`}>
              {tooltipText}
            </div>
          )}
          <div className={styles.livesContainer}>
            {loading ? (
              // Skeleton lives
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className={`${styles.lifeNode} ${styles.skeletonLife}`} />
              ))
            ) : (
              // Real lives
              Array.from({ length: maxLives }).map((_, i) => {
                /*
                UI overhaul notes (preserved):

                // Logic:
                // i < lives: Active/Remaining lives (usually just one "current" unless we change logic, but let's assume lives=count)
                // i >= lives: Lost lives (history)
                //
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
                //
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
                //
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
                //
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
                */
                const isLost = i >= lives;
                const isActive = i < lives;
                const attemptIndex = (maxLives - 1) - i;
                // Allow reviewing attempts when:
                // 1. Hints are disabled (during gameplay), OR
                // 2. Post-game (frozen) AND solution animation has completed
                const canSelect = (!hintsEnabled || (frozen && analysisAnimationComplete)) && onReviewAttempt;
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
          <span ref={timerRef} className={`${styles.statValue} ${loading ? styles.skeleton : ''} ${!loading && penaltyFlash ? styles.penaltyFlash : ''}`}>
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
          </span>
          {showTooltip && (
            <span className={styles.tooltip}>
              +30s/life penalty
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
