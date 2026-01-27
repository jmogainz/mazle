'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PlayerStats, DailyStats } from '@/game/types';
import { getPuzzleNumberFromNyDateString, getNewYorkDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { RECENT_PUZZLE_DAYS } from '@/constants';
import { addDays } from '@/lib/date';
import { getRecentPuzzlePlays } from '@/utils/storage';
import styles from './RecentPuzzlesModal.module.css';

interface RecentPuzzlesModalProps {
  stats: PlayerStats;
  onClose: () => void;
  onPlay?: (date: string) => void;
  onShare?: (result: DailyStats) => void;
  dailyInProgress?: boolean;
}

function formatRelativeDate(dateStr: string, todayStr: string): string {
  const daysAgo = Math.round(
    (new Date(`${todayStr}T00:00:00Z`).getTime() - new Date(`${dateStr}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000)
  );
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo === 2) return '2 days ago';
  if (daysAgo === 3) return '3 days ago';
  return `${daysAgo} days ago`;
}

function formatDateNice(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function RecentPuzzlesModal({ stats, onClose, onPlay, onShare, dailyInProgress = false }: RecentPuzzlesModalProps) {
  const router = useRouter();
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const todayNy = useMemo(() => getNewYorkDateString(), []);
  const recentPlays = useMemo(() => new Set(getRecentPuzzlePlays()), []);

  // Map date -> history entry for completed puzzles
  const historyByDate = useMemo(() => {
    const map = new Map<string, DailyStats>();
    for (const entry of stats.history) {
      if (entry.date) map.set(entry.date, entry);
    }
    return map;
  }, [stats.history]);

  const completedDates = useMemo(() => {
    const set = new Set<string>();
    for (const entry of stats.history) {
      if (entry.date) set.add(entry.date);
    }
    for (const date of recentPlays) {
      set.add(date);
    }
    return set;
  }, [stats.history, recentPlays]);

  const recentDays = useMemo(() => {
    const days: Array<{
      date: string;
      puzzleNumber: number;
      relativeLabel: string;
      dateLabel: string;
      completed: boolean;
      isAvailable: boolean;
      historyEntry?: DailyStats;
    }> = [];

    for (let i = 1; i <= RECENT_PUZZLE_DAYS; i++) {
      const date = addDays(todayNy, -i);
      // Don't show dates before launch
      if (date < LAUNCH_DATE_NY) continue;

      const puzzleNumber = getPuzzleNumberFromNyDateString(date);
      const historyEntry = historyByDate.get(date);
      const completed = completedDates.has(date);

      days.push({
        date,
        puzzleNumber,
        relativeLabel: formatRelativeDate(date, todayNy),
        dateLabel: formatDateNice(date),
        completed,
        isAvailable: !completed,
        historyEntry,
      });
    }

    return days;
  }, [todayNy, completedDates, historyByDate]);

  useEffect(() => {
    if (onPlay) return;
    for (const day of recentDays) {
      router.prefetch(`/play/${day.date}`);
    }
  }, [recentDays, router, onPlay]);

  const handlePlay = (date: string) => {
    if (pendingDate || dailyInProgress) return;
    setPendingDate(date);
    if (onPlay) {
      onPlay(date);
      onClose();
      return;
    }
    startTransition(() => {
      router.push(`/play/${date}`);
    });
    onClose();
  };

  const availableCount = recentDays.filter((d) => d.isAvailable).length;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className={styles.closeIcon}>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>

        <div className={styles.header}>
          <div className={styles.iconContainer}>
            <svg viewBox="0 0 24 24" className={styles.headerIcon} fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
              <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
            </svg>
          </div>
          <div className={styles.headerText}>
            <h2 className={styles.title}>Recent Puzzles</h2>
            <p className={styles.subtitle}>
              {availableCount > 0
                ? `${availableCount} puzzle${availableCount !== 1 ? 's' : ''} to play`
                : 'All caught up!'}
            </p>
          </div>
        </div>

        {dailyInProgress && (
          <div className={styles.dailyFirstBanner}>
            Finish current puzzle first
          </div>
        )}

        <div className={styles.puzzleList}>
          {recentDays.length === 0 ? (
            <div className={styles.emptyState}>
              <p>No recent puzzles available yet.</p>
            </div>
          ) : (
            recentDays.map((day, index) => (
              <div
                key={day.date}
                className={`${styles.puzzleCard} ${day.completed ? styles.puzzleCardCompleted : styles.puzzleCardAvailable} ${dailyInProgress && !day.completed ? styles.puzzleCardLocked : ''}`}
                style={{ animationDelay: `${index * 0.08}s` }}
              >
                <div className={styles.puzzleInfo}>
                  <div className={styles.puzzleNumber}>#{day.puzzleNumber}</div>
                  <div className={styles.puzzleDates}>
                    <span className={styles.relativeDate}>{day.relativeLabel}</span>
                    <span className={styles.absoluteDate}>{day.dateLabel}</span>
                  </div>
                </div>

                <div className={styles.puzzleAction}>
                  {day.completed ? (
                    <div className={styles.completedActions}>
                      <div className={styles.completedBadge}>
                        <svg viewBox="0 0 24 24" className={styles.checkIcon}>
                          <path
                            d="M20 6L9 17l-5-5"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      </div>
                      {day.historyEntry && onShare && (
                        <button
                          className={styles.shareButton}
                          onClick={() => onShare(day.historyEntry!)}
                        >
                          <svg viewBox="0 0 24 24" className={styles.shareIcon} fill="currentColor">
                            <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" />
                          </svg>
                          <span>Share</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      className={`${styles.playButton} ${pendingDate === day.date || isPending ? styles.playButtonPending : ''}`}
                      onClick={() => handlePlay(day.date)}
                      disabled={dailyInProgress || pendingDate === day.date || isPending}
                    >
                      <span>{pendingDate === day.date || isPending ? 'Loading' : 'Play'}</span>
                      <svg viewBox="0 0 24 24" className={styles.playIcon}>
                        <path d="M5 3l14 9-14 9V3z" fill="currentColor" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {availableCount === 0 && recentDays.length > 0 && (
          <div className={styles.allDoneMessage}>
            <span className={styles.sparkle}>✦</span>
            You&apos;ve completed all recent puzzles!
            <span className={styles.sparkle}>✦</span>
          </div>
        )}

        <div className={styles.footer}>
          <p>These puzzles are always free to play</p>
        </div>
      </div>
    </div>
  );
}

export default React.memo(RecentPuzzlesModal);
