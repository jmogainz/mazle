'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { cachedApi, fetchLeaderboardMeFresh, fetchLeaderboardTopFresh, prefetchLeaderboard } from '@/lib/api/cached';
import type { LeaderboardEntry, LeaderboardMeResponse, LeaderboardTopResponse } from '@/lib/api/types';
import { MapType } from '@/game/types';
import { formatTime } from '@/utils/storage';
import CharacterIcon from './CharacterIcon';
import styles from './ShareCard.module.css';

type LoadState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

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
  leaderboardDate?: string; // NY YYYY-MM-DD
  leaderboardAllowSubmit?: boolean;
}

function isSamePos(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x === b.x && a.y === b.y;
}

function positionKey(pos: { x: number; y: number }) {
  return `${pos.x},${pos.y}`;
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
  solutionPath,
  mapType,
  onClose,
  inline = false,
  secondaryActionLabel,
  onSecondaryAction,
  footerText = 'Come back tomorrow for a new puzzle!',
  leaderboardDate,
  leaderboardAllowSubmit = true,
}: ShareCardProps) {
  const router = useRouter();
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [feedbackState, setFeedbackState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const hasLeaderboard = !!leaderboardDate;
  const [activeTab, setActiveTab] = useState<'share' | 'leaderboard'>('share');
  const [viewerMode, setViewerMode] = useState<'unknown' | 'guest' | 'user'>('unknown');
  const [viewerName, setViewerName] = useState<string | null>(null);

  const [leaderboardTopState, setLeaderboardTopState] = useState<LoadState<LeaderboardTopResponse>>({ status: 'idle' });
  const [leaderboardMeState, setLeaderboardMeState] = useState<LoadState<LeaderboardMeResponse>>({ status: 'idle' });
  const [leaderboardSubmitState, setLeaderboardSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');

  // Height adjustment state
  const [carouselHeight, setCarouselHeight] = useState<number | undefined>(undefined);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shareContentRef = useRef<HTMLDivElement>(null);
  const leaderboardContentRef = useRef<HTMLDivElement>(null);

  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;
  const maxBlocks = Math.max(optimalMoves, 1);

  // Resize logic
  const updateHeight = useCallback(() => {
    // Always lock height to the Share tab content
    if (shareContentRef.current) {
      const targetHeight = shareContentRef.current.offsetHeight;
      if (targetHeight > 0) {
        setCarouselHeight(targetHeight);
      }
    }
  }, []); // No dependencies - we only care about share tab

  // Update height on mount and when content might change (feedback open)
  useEffect(() => {
    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });

    if (shareContentRef.current) observer.observe(shareContentRef.current);

    return () => observer.disconnect();
  }, [updateHeight, feedbackOpen]); // Re-run when feedback toggles

  const attemptsUsed = useMemo(() => {
    if (failed) return null;
    const failedAttempts = attempts?.length ?? 0;
    return Math.min(maxLives, Math.max(1, failedAttempts + 1));
  }, [attempts, failed, maxLives]);

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
    if (solutionPath) {
      const getContiguousCorrectMoves = (attempt: any): number => {
        if (!attempt) return 0;

        if (typeof attempt.deviationIndex === 'number') {
          if (attempt.deviationIndex === -1) {
            return Math.min(optimalMoves, solutionPath.length - 1);
          }
          return Math.max(0, attempt.deviationIndex - 1);
        }

        if (!Array.isArray(attempt.path)) {
          if (attempt.correctMoves !== undefined) return attempt.correctMoves;
          if (attempt.moveCount !== undefined) return attempt.moveCount;
          return 0;
        }

        const maxSteps = Math.min(optimalMoves, solutionPath.length - 1, attempt.path.length - 1);
        let correct = 0;
        for (let i = 1; i <= maxSteps; i++) {
          if (isSamePos(attempt.path[i], solutionPath[i])) correct++;
          else break;
        }
        return correct;
      };

      const getAttemptStatuses = (attempt: any): ('correct' | 'present' | 'empty')[] => {
        const hasPathData = attempt && Array.isArray(attempt.path) && attempt.path.length > 0;

        if (!hasPathData) {
          const correct = getContiguousCorrectMoves(attempt);
          const statuses: ('correct' | 'present' | 'empty')[] = [];
          for (let i = 0; i < optimalMoves; i++) statuses.push(i < correct ? 'correct' : 'empty');
          return statuses;
        }

        const attemptPath = attempt.path;
        const attemptKeys = new Set(attemptPath.map((pos: any) => positionKey(pos)));
        const contiguousCorrect = getContiguousCorrectMoves(attempt);

        const statuses: ('correct' | 'present' | 'empty')[] = [];
        for (let i = 1; i <= optimalMoves; i++) {
          const solutionTile = solutionPath[i];
          if (!solutionTile) {
            statuses.push('empty');
            continue;
          }

          if (i <= contiguousCorrect) statuses.push('correct');
          else if (attemptKeys.has(positionKey(solutionTile))) statuses.push('present');
          else statuses.push('empty');
        }
        return statuses;
      };

      const rows: string[] = [];
      const hasWinRow = !failed;

      for (let i = 0; i < maxLives; i++) {
        if (i < attempts.length) {
          const statuses = getAttemptStatuses(attempts[i]);
          const rowStr = statuses.map((s) => {
            if (s === 'correct') return '🟩';
            if (s === 'present') return '🟨';
            return '⬜';
          }).join('');
          rows.push(rowStr);
        } else if (hasWinRow && i === attempts.length) {
          rows.push('🟩'.repeat(optimalMoves) + '🏆');
        } else {
          rows.push('⬜'.repeat(optimalMoves));
        }
      }

      return rows.join('\n');
    }

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
        rows.push('🟥'.repeat(filledBlocks) + '❌' + '⬜'.repeat(remainingBlocks));
      }

      // Show rows up to maxLives for failed attempts
      while (rows.length < maxLives) {
        rows.push('⬜'.repeat(optimalMoves));
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
        rows.push('🟥'.repeat(filledBlocks) + '❌' + '⬜'.repeat(remainingBlocks));
      }

      // Final successful attempt (always present)
      rows.push('🟩'.repeat(optimalMoves) + '🏆');

      return rows.join('\n');
    }
  };

  const attemptsUsedForScore = attemptsUsed ?? maxLives;
  const scoreText = failed ? `X/${maxLives}` : `${attemptsUsedForScore}/${maxLives}`;
  const mapEmoji = mapType ? getMapEmoji(mapType) : '';
  const shareTitle = mapEmoji ? `Mazle ${displayLabel} ${mapEmoji}` : `Mazle ${displayLabel}`;
  const shareText = `${shareTitle}\n\n${generateProgressBlocks()}\n\n${formatTime(timeMs)} • ${scoreText}\nmazle.io`;

  // UI overhaul: warm leaderboard cache for instant tab switching.
  useEffect(() => {
    if (!leaderboardDate) return;
    prefetchLeaderboard(leaderboardDate, 20);
  }, [leaderboardDate]);

  const reloadLeaderboard = useCallback(async (force = false) => {
    if (!leaderboardDate) return;
    setLeaderboardTopState({ status: 'loading' });
    setLeaderboardMeState({ status: 'loading' });

    try {
      const [top, me] = await Promise.all([
        force ? fetchLeaderboardTopFresh(leaderboardDate, 20) : cachedApi.leaderboardTop(leaderboardDate, 20),
        force ? fetchLeaderboardMeFresh(leaderboardDate) : cachedApi.leaderboardMe(leaderboardDate),
      ]);
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
    if (!leaderboardAllowSubmit) return;
    cachedApi
      .me()
      .then((me) => {
        setViewerMode(me.mode);
        setViewerName(me.displayName);
      })
      .catch(() => {
        setViewerMode('unknown');
        setViewerName(null);
      });
  }, [hasLeaderboard, leaderboardAllowSubmit]);

  useEffect(() => {
    if (!hasLeaderboard) return;
    if (activeTab !== 'leaderboard') return;
    if (leaderboardTopState.status !== 'idle') return;
    reloadLeaderboard();
  }, [activeTab, hasLeaderboard, leaderboardTopState.status, reloadLeaderboard]);

  const canSubmitLeaderboard = hasLeaderboard && leaderboardAllowSubmit && attemptsUsed != null && viewerMode === 'user';
  const alreadySubmitted = leaderboardMeState.status === 'loaded' && !!leaderboardMeState.data;

  const handleLeaderboardSubmit = useCallback(async () => {
    if (!leaderboardDate || !canSubmitLeaderboard || attemptsUsed == null || failed) return;
    setLeaderboardSubmitState('submitting');
    try {
      await api.resultsRecord({ date: leaderboardDate, completed: true, timeMs, attemptsUsed });
      await api.leaderboardSubmit({ date: leaderboardDate });
      setLeaderboardSubmitState('submitted');
      await reloadLeaderboard(true);
    } catch {
      setLeaderboardSubmitState('failed');
    }
  }, [attemptsUsed, canSubmitLeaderboard, failed, leaderboardDate, reloadLeaderboard, timeMs]);

  const handleOpenAccount = useCallback(() => {
    onClose();
    router.push('/account');
  }, [onClose, router]);

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

  const getShareButtonText = () => {
    switch (shareState) {
      case 'copied': return 'Copied!';
      case 'failed': return 'Failed';
      default: return 'Share';
    }
  };

  const getFeedbackButtonText = () => {
    switch (feedbackState) {
      case 'sending': return ''; // Handled in JSX to allow spinner
      case 'sent': return 'Sent!';
      case 'error': return 'Try Again';
      default: return 'Send Feedback';
    }
  };

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
      rows.push({ progress: optimalMoves, status: 'success' });
    }

    while (rows.length < maxLives) {
      rows.push({ progress: 0, status: 'empty' });
    }

    return rows.slice(0, maxLives);
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
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div className={styles.meRow}>
                  <div className={styles.meName}>{viewerName || (viewerMode === 'user' ? 'You' : 'Guest')}</div>
                  <div className={styles.rank}>{formatTime(timeMs)}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', width: '100%', marginTop: '0.2rem' }}>
                  {submitPanel()}
                </div>
              </div>
            );
          }

          return (
            <div className={styles.meRow}>
              <div className={styles.meLeft}>
                <div className={styles.meName}>{me.displayName}</div>
                <div className={styles.meMeta}>
                  {me.attemptsUsed}/3 tries • #{me.rank}
                </div>
              </div>
              <div className={styles.meRight}>
                <div className={styles.rank}>{formatTime(me.timeMs)}</div>
              </div>
            </div>
          );
        }
      }
    };

    const submitPanel = () => {
      if (!leaderboardAllowSubmit) return null;
      if (alreadySubmitted) return null;
      if (leaderboardMeState.status !== 'loaded') return null;
      if (failed) return null;
      if (attemptsUsed == null) return null;

      if (viewerMode !== 'user') {
        return (
          <button type="button" className={styles.submitButtonSmall} onClick={handleOpenAccount}>
            Sign in to submit
          </button>
        );
      }

      const label =
        leaderboardSubmitState === 'submitting'
          ? 'Submitting…'
          : leaderboardSubmitState === 'submitted'
            ? 'Submitted ✓'
            : 'Submit my time';

      return (
        <button
          type="button"
          className={styles.submitButtonSmall}
          onClick={handleLeaderboardSubmit}
          disabled={leaderboardSubmitState === 'submitting'}
        >
          {label}
        </button>
      );
    };

    const podiumEntries = (() => {
      if (leaderboardTopState.status !== 'loaded') return [];
      const podium = leaderboardTopState.data.podium;
      if (podium && podium.length > 0) return podium;
      return leaderboardTopState.data.entries.slice(0, 3).map((entry) => ({
        rank: entry.rank as 1 | 2 | 3,
        displayName: entry.displayName,
        timeMs: entry.timeMs,
        attemptsUsed: entry.attemptsUsed,
        characterId: 'default',
        skinId: 'default',
        isMe: entry.isMe,
      }));
    })();

    const podiumByRank = new Map(podiumEntries.map((entry) => [entry.rank, entry]));
    const first = podiumByRank.get(1);
    const second = podiumByRank.get(2);
    const third = podiumByRank.get(3);

    return (
      <div className={styles.leaderboardPanelNew} style={{ height: carouselHeight }}>
        <div className={styles.leaderboardDayTitle}>
          <div className={styles.leaderboardDayTitleMain}>Mazle {displayLabel}</div>
        </div>
        <div className={styles.leaderboardRefreshRow}>
          <button
            type="button"
            className={styles.leaderboardRefreshButton}
            onClick={() => reloadLeaderboard(true)}
            disabled={leaderboardTopState.status === 'loading'}
            aria-label="Refresh leaderboard"
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {leaderboardTopState.status === 'loaded' && podiumEntries.length >= 3 && (
          <div className={styles.podium}>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={second?.characterId} skinId={second?.skinId} size={40} />
              </div>
              <div className={styles.podiumName}>{second?.displayName}</div>
              <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
                <div className={styles.podiumRankBadge}>🥈</div>
                <div className={styles.podiumTime}>{second ? formatTime(second.timeMs) : ''}</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={first?.characterId} skinId={first?.skinId} size={48} />
              </div>
              <div className={styles.podiumName}>{first?.displayName}</div>
              <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
                <div className={styles.podiumRankBadge}>🥇</div>
                <div className={styles.podiumTime}>{first ? formatTime(first.timeMs) : ''}</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={third?.characterId} skinId={third?.skinId} size={40} />
              </div>
              <div className={styles.podiumName}>{third?.displayName}</div>
              <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
                <div className={styles.podiumRankBadge}>🥉</div>
                <div className={styles.podiumTime}>{third ? formatTime(third.timeMs) : ''}</div>
              </div>
            </div>
          </div>
        )}

        {leaderboardTopState.status === 'loading' && (
          <div className={styles.podium} style={{ opacity: 0.4, filter: 'blur(2px)' }}>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon size={40} />
              </div>
              <div className={styles.podiumName}>Player2</div>
              <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
                <div className={styles.podiumRankBadge}>🥈</div>
                <div className={styles.podiumTime}>0:00</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon size={48} />
              </div>
              <div className={styles.podiumName}>Player1</div>
              <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
                <div className={styles.podiumRankBadge}>🥇</div>
                <div className={styles.podiumTime}>0:00</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon size={40} />
              </div>
              <div className={styles.podiumName}>Player3</div>
              <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
                <div className={styles.podiumRankBadge}>🥉</div>
                <div className={styles.podiumTime}>0:00</div>
              </div>
            </div>
          </div>
        )}

        {leaderboardTopState.status === 'error' && <div className={styles.leaderboardError}>{leaderboardTopState.message}</div>}

        <div className={styles.leaderboardScrollArea}>
          {(() => {
            switch (leaderboardTopState.status) {
              case 'idle':
              case 'loading':
                return <div className={styles.leaderboardHint}>Loading…</div>;
              case 'error':
                return null;
              case 'loaded': {
                const entries = leaderboardTopState.data.entries.filter(e => e.rank > 3);
                if (entries.length === 0) {
                  return <div className={styles.leaderboardHint}></div>;
                }
                return renderLeaderboardRows(entries);
              }
            }
          })()}
        </div>

        <div className={styles.leaderboardFooter}>
          <div className={styles.leaderboardSectionTitle} style={{ marginBottom: '0.5rem' }}>
            You
          </div>
          {mePanel()}
          {leaderboardSubmitState === 'failed' && <div className={styles.leaderboardError}>Couldn’t submit. Try again.</div>}
          {submissionNote && (
            <div className={styles.leaderboardHint} style={{ marginTop: '0.6rem' }}>
              {submissionNote}
            </div>
          )}
          {alreadySubmitted && (
            <div className={styles.leaderboardHint} style={{ marginTop: '0.75rem' }}>
              Ranking: time • tries • submitted
            </div>
          )}
        </div>
      </div>
    );
  };

  const scrollToTab = (tab: 'share' | 'leaderboard') => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (tab === 'share') {
      container.scrollTo({ left: 0, behavior: 'smooth' });
    } else {
      container.scrollTo({ left: container.offsetWidth, behavior: 'smooth' });
    }
  };

  // Scroll handler to sync tabs with carousel position
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollLeft = container.scrollLeft;
    const width = container.offsetWidth;
    const index = Math.round(scrollLeft / width);

    if (index === 0 && activeTab !== 'share') {
      setActiveTab('share');
    } else if (index === 1 && activeTab !== 'leaderboard') {
      setActiveTab('leaderboard');
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

        {hasLeaderboard && (
          <div className={styles.tabBarWrapper}>
            <div className={styles.tabBar} role="tablist" aria-label="Share or leaderboard">
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === 'share' ? (failed ? styles.tabButtonActiveFailed : styles.tabButtonActive) : ''}`.trim()}
                role="tab"
                aria-selected={activeTab === 'share'}
                onClick={() => scrollToTab('share')}
              >
                Share
              </button>
              <button
                type="button"
                className={`${styles.tabButton} ${activeTab === 'leaderboard' ? (failed ? styles.tabButtonActiveFailed : styles.tabButtonActive) : ''}`.trim()}
                role="tab"
                aria-selected={activeTab === 'leaderboard'}
                onClick={() => scrollToTab('leaderboard')}
              >
                Leaderboard
              </button>
            </div>
          </div>
        )}

        <div
          className={styles.carousel}
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={carouselHeight ? { height: carouselHeight } : undefined}
        >
          {/* Share Tab */}
          <div className={styles.tabPanel}>
            <div ref={shareContentRef}>
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
                  <Image
                    src="/assets/images/alive_character.svg"
                    alt="Victory"
                    width={64}
                    height={80}
                    className={styles.characterIcon}
                    priority
                  />
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
                  <span>Best Attempt: {bestAttempt}/{optimalMoves} moves</span>
                </div>
              )}

              <div className={styles.progressSection}>
                <div className={styles.progressHeader}>Attempts</div>
                <div className={styles.progressList}>
                  {bars.map((bar, idx) => (
                    <div className={styles.progressRow} key={idx}>
                      <span className={styles.progressLabel}>
                        {idx + 1}
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
                  <button
                    className={styles.feedbackTriggerSimple}
                    onClick={() => setFeedbackOpen(true)}
                  >
                    Share feedback
                  </button>
                ) : (
                  <div className={styles.feedbackForm}>
                    {/* Star Rating - optional */}
                    <div className={styles.starRating}>
                      <span className={styles.starLabel}>Rate your experience (optional):</span>
                      <div
                        className={styles.stars}
                        onMouseLeave={() => setHoverRating(null)}
                      >
                        {[1, 2, 3, 4, 5].map((star) => {
                          const isFilled = (hoverRating !== null ? hoverRating : feedbackRating) !== null &&
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
              {footerText && (
                <div className={styles.footer}>
                  <span className={styles.footerText}>{footerText}</span>
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard Tab (always rendered if hasLeaderboard, just scrolled to) */}
          {hasLeaderboard && (
            <div className={styles.tabPanel}>
              <div ref={leaderboardContentRef}>
                {leaderboardTab()}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}