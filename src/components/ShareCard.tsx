'use client';

import { useCallback, useState } from 'react';
import Image from 'next/image';
import { MapType } from '@/game/types';
import { formatTime } from '@/utils/storage';
import styles from './ShareCard.module.css';

interface ShareCardProps {
  puzzleNumber: number;
  puzzleLabel?: string;
  timeMs: number;
  optimalMoves: number;
  failed?: boolean;
  attempts?: any[]; // Keep flexible for now
  maxLives?: number; // Dynamic lives count (default 3)
  solutionPath?: { x: number; y: number }[];
  mapType?: MapType;
  onClose: () => void;
  inline?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  footerText?: string;
  countdownText?: string; // "Next puzzle in Xh Ym"
}

// Get emoji for map type
function getMapEmoji(mapType: MapType): string {
  switch (mapType) {
    case MapType.ICE:
      return '🧊';
    case MapType.GROUND:
      return '🟤';
    default:
      return '🧩';
  }
}

// Fallback copy method using execCommand for older browsers
function fallbackCopyToClipboard(text: string): boolean {
  const textArea = document.createElement('textarea');
  textArea.value = text;

  // Avoid scrolling to bottom
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let success = false;
  try {
    success = document.execCommand('copy');
  } catch {
    success = false;
  }

  document.body.removeChild(textArea);
  return success;
}

export default function ShareCard({
  puzzleNumber,
  puzzleLabel,
  timeMs,
  optimalMoves,
  failed = false,
  attempts = [],
  maxLives = 3,
  mapType,
  onClose,
  inline = false,
  secondaryActionLabel,
  onSecondaryAction,
  footerText,
  countdownText,
}: ShareCardProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const displayLabel = puzzleLabel ?? String(puzzleNumber);
  const mapEmoji = mapType != null ? getMapEmoji(mapType) : null;

  // Build share text (same format as before)
  const failedAttempts = attempts.length;
  const attemptsUsed = Math.min(maxLives, Math.max(1, failedAttempts + (failed ? 0 : 1)));

  const shareTitle = `Mazle ${displayLabel}`;

  // Build attempt indicator
  const attemptIndicator = failed
    ? Array(maxLives).fill('❌').join('')
    : Array(attemptsUsed - 1)
        .fill('❌')
        .concat('✅')
        .concat(Array(maxLives - attemptsUsed).fill('⬜'))
        .join('');

  const shareText = failed
    ? `${shareTitle}\n${attemptIndicator}\n\nhttps://mazle.me`
    : `${shareTitle}\n${attemptIndicator} ${formatTime(timeMs)}\n\nhttps://mazle.me`;

  const resolveAttemptProgress = (attempt: any): number => {
    if (typeof attempt?.deviationIndex === 'number' && attempt.deviationIndex >= 0) {
      const movesBeforeDeviation = Math.max(0, attempt.deviationIndex - 1);
      return Math.min(optimalMoves, movesBeforeDeviation);
    }
    if (typeof attempt?.correctMoves === 'number' && Number.isFinite(attempt.correctMoves)) {
      return Math.min(optimalMoves, Math.max(0, Math.round(attempt.correctMoves)));
    }
    return typeof attempt?.moveCount === 'number' ? Math.max(0, Math.round(attempt.moveCount)) : 0;
  };

  const progressValues = attempts.map((a: any) => resolveAttemptProgress(a));

  // Calculate max blocks for progress bar visualization
  const maxBlocks = Math.max(optimalMoves, ...progressValues);

  // Calculate the best attempt progress
  const bestAttempt = Math.max(...progressValues, 0);

  // Build the attempt bars data
  const attemptBars = (): { progress: number; status: 'success' | 'fail' | 'empty' }[] => {
    const rows: { progress: number; status: 'success' | 'fail' | 'empty' }[] = [];

    // Failed attempts
    for (const attempt of attempts) {
      rows.push({ progress: resolveAttemptProgress(attempt), status: 'fail' });
    }

    // Success row (if not failed)
    if (!failed) {
      rows.push({ progress: optimalMoves, status: 'success' });
    }

    while (rows.length < maxLives) {
      rows.push({ progress: 0, status: 'empty' });
    }

    return rows.slice(0, maxLives);
  };

  const bars = attemptBars();

  const handleCopy = async (): Promise<boolean> => {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
        return true;
      } catch {
        // Fall through to fallback
      }
    }

    // Fallback for older browsers or when clipboard API fails
    return fallbackCopyToClipboard(shareText);
  };

  const handleShare = async () => {
    // Only use native share on mobile - desktop share sheets are limited to Apple apps
    const isMobileDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (isMobileDevice && navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
        });
        return; // Native share succeeded, no need to show copied state
      } catch (err) {
        // User cancelled or share failed - fall through to copy
        if (err instanceof Error && err.name === 'AbortError') {
          return; // User cancelled, don't copy
        }
      }
    }

    // Fall back to clipboard copy (for desktop or if native share fails)
    const success = await handleCopy();
    if (success) {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2500);
    } else {
      setShareState('failed');
      setTimeout(() => setShareState('idle'), 2500);
    }
  };

  const handleFeedback = async () => {
    if ((!feedbackText.trim() && feedbackRating === null) || feedbackState === 'sending') return;

    setFeedbackState('sending');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: feedbackText.trim(),
          puzzleLabel: `Mazle ${displayLabel}`,
          failed,
          attempts: failed ? attempts.length : attempts.length + 1,
          timeMs,
          optimalMoves,
          attemptScores: attempts.map((a: any) => resolveAttemptProgress(a)),
          rating: feedbackRating,
        }),
      });

      if (response.ok) {
        setFeedbackState('sent');
        setFeedbackText('');
        setFeedbackRating(null);
        setTimeout(() => {
          setFeedbackState('idle');
          setFeedbackOpen(false);
        }, 2000);
      } else {
        setFeedbackState('error');
        setTimeout(() => setFeedbackState('idle'), 3000);
      }
    } catch {
      setFeedbackState('error');
      setTimeout(() => setFeedbackState('idle'), 3000);
    }
  };

  const getShareButtonText = () => {
    switch (shareState) {
      case 'copied':
        return 'Copied!';
      case 'failed':
        return 'Failed';
      default:
        return 'Share';
    }
  };

  const getFeedbackButtonText = () => {
    switch (feedbackState) {
      case 'sending':
        return ''; // Handled in JSX to allow spinner
      case 'sent':
        return 'Sent!';
      case 'error':
        return 'Try Again';
      default:
        return 'Send Feedback';
    }
  };

  return (
    <div className={inline ? styles.inlineContainer : styles.overlay} onClick={!inline ? onClose : undefined}>
      <div
        className={`${styles.card} ${failed ? styles.cardFailed : styles.cardSuccess} ${inline ? styles.cardInline : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {!inline && (
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        )}

        <div className={styles.header}>
          {failed ? (
            <Image
              src="/assets/images/dead_character.svg"
              alt="Game Over"
              width={64}
              height={64}
              className={styles.characterIcon}
              priority
            />
          ) : (
            <div className={styles.victoryCharacterContainer}>
              <svg viewBox="0 -16 64 80" className={styles.victoryCharacterSvg} width="64" height="80">
                {/* Shadow */}
                <ellipse cx="32" cy="48" rx="32" ry="12" fill="black" fillOpacity="0.25" />

                {/* Body */}
                <rect x="16" y="12" width="32" height="36" rx="6" fill="#FF4D4D" stroke="#CC0000" strokeWidth="2.5" />

                {/* Eyes */}
                <circle cx="26" cy="24" r="6" fill="white" />
                <circle cx="38" cy="24" r="6" fill="white" />

                {/* Pupils */}
                <circle cx="28" cy="24" r="3" fill="black" />
                <circle cx="40" cy="24" r="3" fill="black" />

                {/* Animated Crown */}
                <g className={styles.crownGroup}>
                  {/* Glow Effect - dilated and blurred */}
                  <path
                    d="M16 12 L16 0 L24 8 L32 0 L40 8 L48 0 L48 12 Z"
                    fill="#FFE082"
                    stroke="#FFE082"
                    strokeWidth="8"
                    strokeLinejoin="round"
                    transform="translate(0, -6)"
                    className={styles.crownGlow}
                    filter="url(#softGlow)"
                  />
                  {/* Main Crown */}
                  <path
                    d="M16 12 L16 0 L24 8 L32 0 L40 8 L48 0 L48 12 Z"
                    fill="#FFD700"
                    stroke="#DAA520"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    transform="translate(0, -6)"
                  />
                </g>

                <defs>
                  <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation="6" result="coloredBlur" />
                  </filter>
                </defs>
              </svg>
            </div>
          )}
          <h2 className={styles.title}>{failed ? 'Game Over' : 'Victory'}</h2>
          <span className={styles.puzzleNumber}>
            {mapEmoji ? `${mapEmoji} ` : ''}Mazle {displayLabel}
          </span>
        </div>

        <div className={styles.mainStat}>
          <span className={styles.mainStatValue}>{formatTime(timeMs)}</span>
          <span className={styles.mainStatLabel}>TOTAL TIME</span>
        </div>

        {failed && (
          <div className={styles.subStat}>
            <span>
              Best Attempt: {bestAttempt}/{optimalMoves} moves
            </span>
          </div>
        )}

        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>Attempts</div>
          <div className={styles.progressList}>
            {bars.map((bar, idx) => (
              <div className={styles.progressRow} key={idx}>
                <span className={styles.progressLabel}>{idx + 1}</span>
                <div className={styles.progressBar}>
                  <div
                    className={`
                      ${styles.progressFill}
                      ${bar.status === 'success' ? styles.progressFillSuccess : ''}
                      ${bar.status === 'fail' ? styles.progressFillFail : ''}
                      ${bar.status === 'empty' ? styles.progressFillEmpty : ''}
                    `}
                    style={{ width: `${Math.max(0, Math.min((bar.progress / maxBlocks) * 100, 100))}%` }}
                  />
                </div>
                <span className={styles.progressValue}>
                  {bar.progress}/{optimalMoves}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Share & Feedback Section */}
        <div className={styles.shareSection}>
          <button
            className={`${styles.shareButton} ${shareState === 'copied' ? styles.copied : ''} ${shareState === 'failed' ? styles.failed : ''}`}
            onClick={handleShare}
          >
            <span className={styles.shareBtnIcon}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
              </svg>
            </span>
            {getShareButtonText()}
          </button>

          {secondaryActionLabel && onSecondaryAction && (
            <button className={styles.secondaryActionButton} onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          )}
        </div>

        {/* Feedback Section */}
        <div className={styles.feedbackSection}>
          {!feedbackOpen ? (
            <button className={styles.feedbackTriggerSimple} onClick={() => setFeedbackOpen(true)}>
              Share feedback
            </button>
          ) : (
            <div className={styles.feedbackForm}>
              {/* Star Rating - optional */}
              <div className={styles.starRating}>
                <span className={styles.starLabel}>Rate your experience (optional):</span>
                <div className={styles.stars} onMouseLeave={() => setHoverRating(null)}>
                  {[1, 2, 3, 4, 5].map((star) => {
                    const isFilled =
                      (hoverRating !== null ? hoverRating : feedbackRating) !== null &&
                      (hoverRating !== null ? hoverRating : feedbackRating!) >= star;
                    return (
                      <button
                        key={star}
                        type="button"
                        className={`${styles.star} ${isFilled ? styles.starFilled : ''}`}
                        onClick={() => setFeedbackRating(star)}
                        onMouseEnter={() => setHoverRating(star)}
                        disabled={feedbackState === 'sending' || feedbackState === 'sent'}
                        aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
                      >
                        <svg viewBox="0 0 24 24" className={styles.starIcon}>
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                        </svg>
                      </button>
                    );
                  })}
                </div>
              </div>
              <textarea
                className={styles.feedbackTextarea}
                placeholder="Bug report, suggestion, or just say hi..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                maxLength={1000}
                disabled={feedbackState === 'sending' || feedbackState === 'sent'}
              />
              <div className={styles.feedbackActions}>
                <button
                  className={`${styles.feedbackSubmit} ${styles[feedbackState]}`}
                  onClick={handleFeedback}
                  disabled={(!feedbackText.trim() && feedbackRating === null) || feedbackState === 'sending' || feedbackState === 'sent'}
                >
                  {feedbackState === 'sending' ? (
                    <>
                      <span className={styles.spinner} />
                      Sending...
                    </>
                  ) : (
                    getFeedbackButtonText()
                  )}
                </button>
                <button
                  className={styles.feedbackCancel}
                  onClick={() => {
                    setFeedbackOpen(false);
                    setFeedbackText('');
                    setFeedbackRating(null);
                    setFeedbackState('idle');
                  }}
                  disabled={feedbackState === 'sending'}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(footerText || countdownText) && (
          <div className={styles.footer}>
            {countdownText && <span className={styles.footerCountdown}>{countdownText}</span>}
            {footerText && <span className={styles.footerText}>{footerText}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
