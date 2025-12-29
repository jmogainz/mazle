'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapType } from '@/game/types';
import { api } from '@/lib/api';
import type { LeaderboardEntry, LeaderboardMeResponse, LeaderboardTopResponse } from '@/lib/api/types';
import { formatTime } from '@/utils/storage';
import styles from './ShareCard.module.css';

type LoadState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

interface ShareCardProps {
  puzzleNumber: number;
  puzzleLabel?: string;
  moveCount: number;
  timeMs: number;
  optimalMoves: number;
  failed?: boolean;
  attempts?: any[]; // Keep flexible for now
  mapType?: MapType;
  onClose: () => void;
  inline?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  footerText?: string;
  leaderboardDate?: string; // NY YYYY-MM-DD
  leaderboardAllowSubmit?: boolean;
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
  moveCount,
  timeMs,
  optimalMoves,
  failed = false,
  attempts = [],
  mapType = MapType.ICE,
  onClose,
  inline = false,
  secondaryActionLabel,
  onSecondaryAction,
  footerText = 'Come back tomorrow for a new puzzle!',
  leaderboardDate,
  leaderboardAllowSubmit = true,
}: ShareCardProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const hasLeaderboard = !!leaderboardDate;
  const [activeTab, setActiveTab] = useState<'share' | 'leaderboard'>('share');
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeIgnoreRef = useRef(false);

  const [leaderboardTopState, setLeaderboardTopState] = useState<LoadState<LeaderboardTopResponse>>({ status: 'idle' });
  const [leaderboardMeState, setLeaderboardMeState] = useState<LoadState<LeaderboardMeResponse>>({ status: 'idle' });
  const [leaderboardSubmitState, setLeaderboardSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');

  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;
  const mapEmoji = getMapEmoji(mapType);
  const maxBlocks = Math.max(optimalMoves, 1);

  const attemptsUsed = useMemo(() => {
    if (failed) return null;
    const failedAttempts = attempts?.length ?? 0;
    return Math.min(3, Math.max(1, failedAttempts + 1));
  }, [attempts, failed]);

  // Calculate best attempt for failed runs (using correctMoves if available)
  const bestAttempt = attempts && attempts.length > 0
    ? Math.max(...attempts.map(a => {
      // Prefer correctMoves (new system), fall back to deviationIndex (legacy)
      if (a.correctMoves !== undefined) {
        return a.correctMoves;
      }
      if (a.deviationIndex !== undefined && a.deviationIndex !== -1) {
        return Math.max(0, a.deviationIndex - 1);
      }
      return a.moveCount;
    }))
    : 0;

  // Generate progress blocks - one row per attempt/life
  const generateProgressBlocks = (): string => {
    const getAttemptProgress = (attempt: any): number => {
      // Prefer correctMoves (new system), fall back to deviationIndex (legacy)
      if (attempt.correctMoves !== undefined) {
        return attempt.correctMoves;
      }
      if (attempt.deviationIndex !== undefined && attempt.deviationIndex !== -1) {
        return Math.max(0, attempt.deviationIndex - 1);
      }
      return attempt.moveCount;
    };

    if (failed) {
      // Show each attempt as a separate row
      const rows: string[] = [];

      for (let i = 0; i < attempts.length; i++) {
        const progress = getAttemptProgress(attempts[i]);

        const filledBlocks = Math.min(progress, optimalMoves - 1);
        const remainingBlocks = optimalMoves - filledBlocks - 1;
        rows.push('🟥'.repeat(filledBlocks) + '💀' + '⬛'.repeat(remainingBlocks));
      }

      // Always show 3 rows for failed attempts
      while (rows.length < 3) {
        rows.push('⬛'.repeat(optimalMoves));
      }

      return rows.join('\n');
    } else {
      // Success: show each attempt as a row
      const rows: string[] = [];

      // Add rows for failed attempts (only if there were any)
      for (let i = 0; i < attempts.length; i++) {
        const progress = getAttemptProgress(attempts[i]);

        const filledBlocks = Math.min(progress, optimalMoves - 1);
        const remainingBlocks = optimalMoves - filledBlocks - 1;
        rows.push('🟥'.repeat(filledBlocks) + '💀' + '⬛'.repeat(remainingBlocks));
      }

      // Final successful attempt (always present)
      rows.push('🟩'.repeat(optimalMoves) + '🏆');

      return rows.join('\n');
    }
  };

  const shareText = failed
    ? `${mapEmoji} Mazle ${displayLabel}

${generateProgressBlocks()}
⏱️ ${formatTime(timeMs)}`
    : `${mapEmoji} Mazle ${displayLabel}

${generateProgressBlocks()}
⏱️ ${formatTime(timeMs)}`;

  const reloadLeaderboard = useCallback(async () => {
    if (!leaderboardDate) return;
    setLeaderboardTopState({ status: 'loading' });
    setLeaderboardMeState({ status: 'loading' });

    try {
      const [top, me] = await Promise.all([api.leaderboardTop(leaderboardDate, 20), api.leaderboardMe(leaderboardDate)]);
      setLeaderboardTopState({ status: 'loaded', data: top });
      setLeaderboardMeState({ status: 'loaded', data: me });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load leaderboard';
      setLeaderboardTopState({ status: 'error', message });
      setLeaderboardMeState({ status: 'error', message });
    }
  }, [leaderboardDate]);

  useEffect(() => {
    if (!hasLeaderboard) {
      setActiveTab('share');
      return;
    }
    setLeaderboardTopState({ status: 'idle' });
    setLeaderboardMeState({ status: 'idle' });
    setLeaderboardSubmitState('idle');
  }, [hasLeaderboard, leaderboardDate]);

  useEffect(() => {
    if (!hasLeaderboard) return;
    if (activeTab !== 'leaderboard') return;
    if (leaderboardTopState.status !== 'idle') return;
    reloadLeaderboard();
  }, [activeTab, hasLeaderboard, leaderboardTopState.status, reloadLeaderboard]);

  const canSubmitLeaderboard = hasLeaderboard && leaderboardAllowSubmit && attemptsUsed != null;
  const alreadySubmitted = leaderboardMeState.status === 'loaded' && !!leaderboardMeState.data;

  const handleLeaderboardSubmit = useCallback(async () => {
    if (!leaderboardDate || !canSubmitLeaderboard || attemptsUsed == null || failed) return;
    setLeaderboardSubmitState('submitting');
    try {
      await api.leaderboardSubmit({ date: leaderboardDate, timeMs, attemptsUsed });
      setLeaderboardSubmitState('submitted');
      await reloadLeaderboard();
    } catch {
      setLeaderboardSubmitState('failed');
    }
  }, [attemptsUsed, canSubmitLeaderboard, failed, leaderboardDate, reloadLeaderboard, timeMs]);

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
          title: `Mazle ${displayLabel}`,
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
    if (!feedbackText.trim() || feedbackState === 'sending') return;

    setFeedbackState('sending');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: feedbackText.trim(),
          puzzleLabel: `${mapEmoji} Mazle ${displayLabel}`,
          failed,
          attempts: failed ? attempts.length : attempts.length + 1,
          timeMs,
          optimalMoves,
          attemptScores: attempts.map((a: any) => calcProgress(a)),
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

  const getCopyButtonText = () => {
    switch (copyState) {
      case 'copied': return 'Copied!';
      case 'failed': return 'Failed';
      default: return 'Copy';
    }
  };

  const getShareButtonText = () => {
    switch (shareState) {
      case 'copied': return 'Copied!';
      case 'failed': return 'Failed';
      default: return 'Share';
    }
  };

  const getFeedbackButtonText = () => {
    switch (feedbackState) {
      case 'sending': return 'Sending...';
      case 'sent': return 'Sent! ✓';
      case 'error': return 'Failed';
      default: return 'Send Feedback';
    }
  };

  // Single button - behavior changes based on device
  const showSeparateCopyButton = false;

  const calcProgress = (attempt: any) => {
    if (!attempt) return 0;
    // Prefer correctMoves (new system), fall back to deviationIndex (legacy)
    if (attempt.correctMoves !== undefined) {
      return attempt.correctMoves;
    }
    if (attempt.deviationIndex !== undefined && attempt.deviationIndex !== -1) {
      return Math.max(0, attempt.deviationIndex - 1);
    }
    return attempt.moveCount ?? 0;
  };

  const attemptBars = () => {
    const rows: { progress: number; status: 'fail' | 'success' | 'empty' }[] = [];

    attempts.forEach((attempt: any) => {
      rows.push({ progress: Math.min(calcProgress(attempt), maxBlocks), status: 'fail' });
    });

    if (!failed) {
      rows.push({ progress: Math.min(moveCount, maxBlocks), status: 'success' });
    }

    while (rows.length < 3) {
      rows.push({ progress: 0, status: 'empty' });
    }

    return rows.slice(0, 3);
  };

  const bars = attemptBars();

  const renderLeaderboardRows = (entries: LeaderboardEntry[]) => {
    return (
      <div className={styles.leaderboardList}>
        {entries.map((e) => (
          <div
            key={`${e.rank}-${e.displayName}`}
            className={`${styles.leaderboardRow} ${e.isMe ? styles.leaderboardRowMe : ''}`.trim()}
          >
            <div className={styles.leaderboardRank}>#{e.rank}</div>
            <div className={styles.leaderboardName}>{e.displayName}</div>
            <div className={styles.leaderboardTime}>{formatTime(e.timeMs)}</div>
            <div className={styles.leaderboardTries}>{e.attemptsUsed}/3</div>
          </div>
        ))}
      </div>
    );
  };

  const leaderboardTab = () => {
    if (!leaderboardDate) return null;

    const submissionNote = !leaderboardAllowSubmit
      ? 'Archive plays don’t submit to the leaderboard.'
      : failed
        ? 'Only successful solves can be submitted.'
        : null;

    const mePanel = () => {
      switch (leaderboardMeState.status) {
        case 'idle':
        case 'loading':
          return <div className={styles.leaderboardHint}>Loading your rank…</div>;
        case 'error':
          return <div className={styles.leaderboardHint}>Unable to load your rank.</div>;
        case 'loaded': {
          const me = leaderboardMeState.data;
          if (!me) {
            return <div className={styles.leaderboardHint}>Not submitted for this day.</div>;
          }

          return (
            <div className={styles.meRow}>
              <div className={styles.meMetaLeft}>
                <div className={styles.meName}>{me.displayName}</div>
                <div className={styles.meMeta}>
                  {formatTime(me.timeMs)} • {me.attemptsUsed}/3 tries
                </div>
              </div>
              <div className={styles.meRank}>#{me.rank}</div>
            </div>
          );
        }
      }
    };

    const submitPanel = () => {
      if (!leaderboardAllowSubmit) return null;
      if (!canSubmitLeaderboard) return null;
      if (alreadySubmitted) return null;
      if (leaderboardMeState.status !== 'loaded') return null;

      const label =
        leaderboardSubmitState === 'submitting'
          ? 'Submitting…'
          : leaderboardSubmitState === 'submitted'
            ? 'Submitted ✓'
            : 'Submit my time';

      return (
        <button
          type="button"
          className={styles.leaderboardSubmitButton}
          onClick={handleLeaderboardSubmit}
          disabled={leaderboardSubmitState === 'submitting'}
        >
          {label}
        </button>
      );
    };

    return (
      <div className={styles.leaderboardPanel}>
        <div className={styles.leaderboardHeader}>
          <div>
            <div className={styles.leaderboardTitle}>Leaderboard</div>
            <div className={styles.leaderboardSubtitle}>
              Mazle #{puzzleNumber} • {leaderboardDate} (ET)
            </div>
          </div>
          <button
            type="button"
            className={styles.leaderboardRefreshButton}
            onClick={reloadLeaderboard}
            disabled={leaderboardTopState.status === 'loading'}
            aria-label="Refresh leaderboard"
            title="Refresh"
          >
            ↻
          </button>
        </div>

        <div className={styles.leaderboardCard}>
          <div className={styles.leaderboardSectionTitle}>Me</div>
          {mePanel()}
          {submitPanel()}
          {leaderboardSubmitState === 'failed' && <div className={styles.leaderboardError}>Couldn’t submit. Try again.</div>}
          {submissionNote && (
            <div className={styles.leaderboardHint} style={{ marginTop: '0.6rem' }}>
              {submissionNote}
            </div>
          )}
        </div>

        <div className={styles.leaderboardCard}>
          <div className={styles.leaderboardSectionTitle}>Top</div>
          {(() => {
            switch (leaderboardTopState.status) {
              case 'idle':
              case 'loading':
                return <div className={styles.leaderboardHint}>Loading…</div>;
              case 'error':
                return <div className={styles.leaderboardError}>{leaderboardTopState.message}</div>;
              case 'loaded': {
                const entries = leaderboardTopState.data.entries;
                if (entries.length === 0) {
                  return <div className={styles.leaderboardHint}>No submissions yet.</div>;
                }
                return renderLeaderboardRows(entries);
              }
            }
          })()}

          <div className={styles.leaderboardHint} style={{ marginTop: '0.75rem' }}>
            Ranking: time • tries • submitted
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={inline ? styles.inlineContainer : styles.overlay} onClick={!inline ? onClose : undefined}>
      <div
        className={`${styles.card} ${failed ? styles.cardFailed : styles.cardSuccess} ${inline ? styles.cardInline : ''}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          if (!hasLeaderboard) return;
          const target = e.target as HTMLElement | null;
          if (target?.closest('textarea, input, select')) {
            swipeIgnoreRef.current = true;
            swipeStartRef.current = null;
            return;
          }
          swipeIgnoreRef.current = false;
          swipeStartRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerCancel={() => {
          swipeIgnoreRef.current = false;
          swipeStartRef.current = null;
        }}
        onPointerUp={(e) => {
          if (!hasLeaderboard) return;
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          if (!start || swipeIgnoreRef.current) return;

          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (Math.abs(dx) < 60) return;
          if (Math.abs(dx) < Math.abs(dy) * 1.2) return;

          if (dx < 0) setActiveTab('leaderboard');
          if (dx > 0) setActiveTab('share');
        }}
      >
        {!inline && (
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        )}

        <div className={styles.header}>
          <h2 className={styles.title}>{failed ? '💀 Game Over' : '🏆 Victory!'}</h2>
          <span className={styles.puzzleNumber}>{mapEmoji} Mazle {displayLabel}</span>
        </div>

        {hasLeaderboard && (
          <div className={styles.tabBar} role="tablist" aria-label="Share or leaderboard">
            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'share' ? styles.tabButtonActive : ''}`.trim()}
              role="tab"
              aria-selected={activeTab === 'share'}
              onClick={() => setActiveTab('share')}
            >
              Share
            </button>
            <button
              type="button"
              className={`${styles.tabButton} ${activeTab === 'leaderboard' ? styles.tabButtonActive : ''}`.trim()}
              role="tab"
              aria-selected={activeTab === 'leaderboard'}
              onClick={() => setActiveTab('leaderboard')}
            >
              Leaderboard
            </button>
          </div>
        )}

        {activeTab === 'leaderboard' && hasLeaderboard ? (
          leaderboardTab()
        ) : (
          <>
            <div className={styles.mainStat}>
              <span className={styles.mainStatValue}>{formatTime(timeMs)}</span>
              <span className={styles.mainStatLabel}>TOTAL TIME</span>
            </div>

            {failed && (
              <div className={styles.subStat}>
                <span>Best Attempt: {bestAttempt}/{optimalMoves} moves</span>
              </div>
            )}

            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>Attempts</div>
              <div className={styles.progressList}>
                {bars.map((bar, idx) => (
                  <div className={styles.progressRow} key={idx}>
                    <span className={styles.progressLabel}>
                      {bar.status === 'success' ? 'Win' : `${idx + 1}`}
                    </span>
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

            <div className={styles.actions}>
              <button
                className={`${styles.shareButton} ${shareState === 'copied' ? styles.copied : ''} ${shareState === 'failed' ? styles.failed : ''}`}
                onClick={handleShare}
              >
                {getShareButtonText()}
              </button>
              {secondaryActionLabel && onSecondaryAction && (
                <button className={styles.secondaryActionButton} onClick={onSecondaryAction}>
                  {secondaryActionLabel}
                </button>
              )}
              {showSeparateCopyButton && (
                <button
                  className={`${styles.copyButton} ${copyState === 'copied' ? styles.copied : ''} ${copyState === 'failed' ? styles.failed : ''}`}
                  onClick={async () => {
                    const success = await handleCopy();
                    if (success) {
                      setCopyState('copied');
                      setTimeout(() => setCopyState('idle'), 2500);
                    } else {
                      setCopyState('failed');
                      setTimeout(() => setCopyState('idle'), 2500);
                    }
                  }}
                >
                  {getCopyButtonText()}
                </button>
              )}
            </div>

            {/* Feedback Button - outline style, same width as Share */}
            {!feedbackOpen && (
              <>
                <p className={styles.feedbackHelper}>Help the developers improve the game:</p>
                <button
                  className={styles.feedbackButton}
                  onClick={() => setFeedbackOpen(true)}
                >
                  💬 Send Feedback
                </button>
              </>
            )}

            {/* Feedback Form - shows when expanded */}
            {feedbackOpen && (
              <div className={styles.feedbackForm}>
                {/* Star Rating - optional */}
                <div className={styles.starRating}>
                  <span className={styles.starLabel}>Rate your experience (optional):</span>
                  <div className={styles.stars}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        className={`${styles.star} ${feedbackRating && feedbackRating >= star ? styles.starFilled : ''}`}
                        onClick={() => setFeedbackRating(feedbackRating === star ? null : star)}
                        disabled={feedbackState === 'sending' || feedbackState === 'sent'}
                      >
                        ★
                      </button>
                    ))}
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
                    disabled={!feedbackText.trim() || feedbackState === 'sending' || feedbackState === 'sent'}
                  >
                    {getFeedbackButtonText()}
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

            {footerText && <p className={styles.comeback}>{footerText}</p>}
          </>
        )}
      </div>
    </div>
  );
}
