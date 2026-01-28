'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { PlayerStats } from '@/game/types';
import { formatTime } from '@/utils/storage';
import { DEFAULT_LIVES } from '@/constants/game';
import CharacterIcon from './CharacterIcon';
import styles from './StatsModal.module.css';

export type StatsModalMeData = {
  mode: string;
  userId?: string;
  displayName?: string;
  profile?: { characterId: string; skinId: string };
  stats?: {
    totalPlayed?: number;
    totalWins?: number;
    avgSolveTimeMs?: number;
    goldCount?: number;
    silverCount?: number;
    bronzeCount?: number;
    playedStreak?: number;
    maxPlayedStreak?: number;
    winStreak?: number;
  };
  provider?: string;
};

export type StatsHistoryEntry = {
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
  puzzleNumber: number;
  attemptScores?: number[] | null;
  isRecent?: boolean;
};

interface StatsModalProps {
  stats: PlayerStats;
  me?: StatsModalMeData | null;
  accountHistory?: StatsHistoryEntry[] | null;
  onClose: () => void;
}

function StatsModal({ stats, me: meProp, accountHistory: accountHistoryProp, onClose }: StatsModalProps) {
  // Fallback: fetch internally if props not provided (e.g. play-client)
  const [internalMe, setInternalMe] = useState<StatsModalMeData | null>(null);
  const [internalHistory, setInternalHistory] = useState<StatsHistoryEntry[] | null>(null);
  const needsInternalFetch = meProp === undefined;

  useEffect(() => {
    if (!needsInternalFetch) return;
    let cancelled = false;
    import('@/lib/api/cached').then(({ fetchMeFresh }) => {
      fetchMeFresh().then((me) => {
        if (cancelled) return;
        setInternalMe(me as StatsModalMeData | null);
        if (me?.mode === 'user' && me?.userId) {
          import('@/lib/api').then(({ api }) => {
            api.resultsHistory().then((res) => {
              if (cancelled) return;
              import('@/game/puzzleGenerator').then(({ getPuzzleNumberFromNyDateString }) => {
                const mapped = res.history
                  .map((row) => ({
                    date: row.date,
                    completed: row.completed,
                    timeMs: row.timeMs ?? null,
                    attemptsUsed: row.attemptsUsed ?? null,
                    attemptScores: row.attemptScores ?? null,
                    isRecent: row.isRecent,
                    puzzleNumber: getPuzzleNumberFromNyDateString(row.date),
                  }))
                  .sort((a: StatsHistoryEntry, b: StatsHistoryEntry) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
                if (!cancelled) setInternalHistory(mapped);
              });
            }).catch(() => { if (!cancelled) setInternalHistory([]); });
          });
        }
      }).catch(() => null);
    });
    return () => { cancelled = true; };
  }, [needsInternalFetch]);

  const me = needsInternalFetch ? internalMe : (meProp ?? null);
  const accountHistory = needsInternalFetch ? internalHistory : (accountHistoryProp ?? null);

  const isAccount = me?.mode === 'user';
  const accountStats = isAccount ? me.stats ?? null : null;
  const totalPlayed = isAccount ? (accountStats?.totalPlayed ?? 0) : stats.totalGamesPlayed;
  const totalWins = isAccount ? (accountStats?.totalWins ?? 0) : stats.totalGamesWon;
  const winRate = totalPlayed > 0 ? Math.round((totalWins / totalPlayed) * 100) : 0;

  const times = stats.history.filter(h => h.completed && h.timeMs > 0).map(h => h.timeMs);
  const localAvgTimeMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const avgTimeMs = isAccount ? (accountStats?.avgSolveTimeMs ?? 0) : localAvgTimeMs;

  // Podium counts from hall of fame snapshot (only shown for logged-in users)
  const podium1 = accountStats?.goldCount ?? 0;
  const podium2 = accountStats?.silverCount ?? 0;
  const podium3 = accountStats?.bronzeCount ?? 0;

  const displayName = me?.displayName || 'Guest Trainer';
  const profile = me?.profile || { characterId: 'default', skinId: 'default' };
  const displayStreak = isAccount ? (accountStats?.playedStreak ?? 0) : stats.currentStreak;
  const displayMaxStreak = isAccount
    ? (accountStats?.maxPlayedStreak ?? accountStats?.playedStreak ?? 0)
    : stats.maxStreak;
  const displayWinStreak = isAccount ? (accountStats?.winStreak ?? 0) : 0;

  const localHistory = useMemo<StatsHistoryEntry[]>(
    () =>
      stats.history.map((entry) => ({
        date: entry.date,
        completed: entry.completed,
        timeMs: entry.timeMs ?? null,
        attemptsUsed: entry.attemptsUsed ?? null,
        puzzleNumber: entry.puzzleNumber,
      })),
    [stats.history]
  );
  const historyEntries = isAccount ? (accountHistory ?? []) : localHistory;
  const recentHistory = useMemo(() => historyEntries.slice(-20).reverse(), [historyEntries]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className={styles.closeIcon}>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Player Header */}
        <div className={styles.passportHeader}>
          <div className={styles.avatarBox}>
            <CharacterIcon characterId={profile.characterId} skinId={profile.skinId} size={64} />
          </div>
          <div className={styles.identityInfo}>
            <div className={styles.passportLabel}>Player Card</div>
            <div className={styles.trainerName}>{displayName}</div>
            <div className={styles.trainerId}>ID #{Math.abs(displayName.split('').reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0)).toString().slice(0, 8)}</div>
          </div>
        </div>

        <div className={styles.scrollableContent}>
          {accountStats && (
          <div className={styles.section}>
            <div className={styles.sectionTitle}>
              Trophy Room
            </div>
              <div className={styles.miniPodium}>
                <div className={styles.podiumColumn}>
                  <div className={styles.podiumCount}>{podium2}</div>
                  <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
                    🥈
                  </div>
                  <div className={styles.podiumLabel}>2nd</div>
                </div>
                <div className={styles.podiumColumn}>
                  <div className={styles.podiumCount}>{podium1}</div>
                  <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
                    🥇
                  </div>
                  <div className={styles.podiumLabel}>1st</div>
                </div>
                <div className={styles.podiumColumn}>
                  <div className={styles.podiumCount}>{podium3}</div>
                  <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
                    🥉
                  </div>
                  <div className={styles.podiumLabel}>3rd</div>
                </div>
              </div>
            </div>
          )}

          {/* Stats Grid */}
          <div className={styles.section} style={{ marginTop: '1.5rem' }}>
            <div className={styles.sectionTitle}>Performance</div>
            <div className={styles.statsGrid}>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{totalPlayed}</span>
                <span className={styles.statLabel}>Solved</span>
              </div>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{winRate}%</span>
                <span className={styles.statLabel}>Win Rate</span>
              </div>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{avgTimeMs > 0 ? formatTime(avgTimeMs) : '—'}</span>
                <span className={styles.statLabel}>Avg Time</span>
              </div>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{displayStreak}</span>
                <span className={styles.statLabel}>Streak</span>
              </div>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{displayMaxStreak}</span>
                <span className={styles.statLabel}>Max Streak</span>
              </div>
              {isAccount && (
                <div className={styles.statChip}>
                  <span className={styles.statValue}>{displayWinStreak}</span>
                  <span className={styles.statLabel}>Win Streak</span>
                </div>
              )}
            </div>
          </div>

          {/* Recent Games */}
          {isAccount && accountHistory === null ? (
            <div className={styles.historySection}>
              <div className={styles.sectionTitle}>Recent Games</div>
              <div className={styles.historyList}>
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className={styles.historyItem}>
                    <span className={styles.historyLeft}>
                      <span className={`${styles.historyPuzzle} ${styles.skeleton}`}>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                      <span className={`${styles.historyTime} ${styles.skeleton}`}>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
                    </span>
                    <span className={`${styles.historyAttempts} ${styles.skeleton}`}>&nbsp;&nbsp;&nbsp;</span>
                  </div>
                ))}
              </div>
            </div>
          ) : recentHistory.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.sectionTitle}>
                Recent Games
              </div>
              <div className={styles.historyList}>
                {recentHistory.map((game, index) => (
                  <div key={index} className={`${styles.historyItem} ${game.completed ? '' : styles.historyItemFailed}`}>
                    <span className={styles.historyLeft}>
                      <span className={styles.historyPuzzle}>#{game.puzzleNumber}</span>
                      <span className={styles.historyTime}>
                        {game.completed && game.timeMs != null ? formatTime(game.timeMs) : '—'}
                      </span>
                    </span>
                    {game.completed ? (
                      <span className={styles.historyAttempts}>{game.attemptsUsed ?? 1}/{DEFAULT_LIVES}</span>
                    ) : (
                      <span className={styles.historyDnf}>DNF</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(StatsModal);
