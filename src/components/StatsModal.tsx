'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { PlayerStats } from '@/game/types';
import { formatTime } from '@/utils/storage';
import { readCachedMe, fetchMeFresh } from '@/lib/api/cached';
import CharacterIcon from './CharacterIcon';
import styles from './StatsModal.module.css';

interface StatsModalProps {
  stats: PlayerStats;
  onClose: () => void;
}

function StatsModal({ stats, onClose }: StatsModalProps) {
  const [me, setMe] = useState(() => readCachedMe());

  useEffect(() => {
    fetchMeFresh().then(setMe).catch(() => null);
  }, []);

  const accountStats = me?.mode === 'user' ? me.stats : null;
  const totalPlayed = accountStats ? accountStats.totalPlayed : stats.totalGamesPlayed;
  const totalWins = accountStats ? accountStats.totalWins : stats.totalGamesWon;
  const winRate = totalPlayed > 0 ? Math.round((totalWins / totalPlayed) * 100) : 0;

  const times = stats.history.filter(h => h.completed && h.timeMs > 0).map(h => h.timeMs);
  const localAvgTimeMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
  const avgTimeMs = accountStats ? (accountStats.avgSolveTimeMs ?? 0) : localAvgTimeMs;

  // Podium counts from hall of fame snapshot (only shown for logged-in users)
  const podium1 = accountStats?.goldCount ?? 0;
  const podium2 = accountStats?.silverCount ?? 0;
  const podium3 = accountStats?.bronzeCount ?? 0;

  const displayName = me?.displayName || 'Guest Trainer';
  const profile = me?.profile || { characterId: 'default', skinId: 'default' };
  const displayStreak = accountStats ? accountStats.playedStreak : stats.currentStreak;

  const recentHistory = useMemo(() => stats.history.slice(-20).reverse(), [stats.history]);

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
                <span className={styles.statValue}>{displayStreak}</span>
                <span className={styles.statLabel}>Streak</span>
              </div>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{stats.maxStreak}</span>
                <span className={styles.statLabel}>{accountStats ? 'Max (This device)' : 'Max'}</span>
              </div>
              <div className={styles.statChip}>
                <span className={styles.statValue}>{avgTimeMs > 0 ? formatTime(avgTimeMs) : '—'}</span>
                <span className={styles.statLabel}>Avg Time</span>
              </div>
            </div>
          </div>

          {/* Recent Games */}
          {recentHistory.length > 0 && (
            <div className={styles.historySection}>
              <div className={styles.sectionTitle}>
                Recent Games
                {accountStats && <span className={styles.sectionNote}>(This device)</span>}
              </div>
              <div className={styles.historyList}>
                {recentHistory.map((game, index) => (
                  <div key={index} className={`${styles.historyItem} ${game.completed ? '' : styles.historyItemFailed}`}>
                    <span className={styles.historyLeft}>
                      <span className={styles.historyPuzzle}>#{game.puzzleNumber}</span>
                      <span className={styles.historyTime}>{game.completed ? formatTime(game.timeMs) : '—'}</span>
                    </span>
                    {game.completed ? (
                      <span className={styles.historyAttempts}>{game.attemptsUsed ?? 1}/3</span>
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
