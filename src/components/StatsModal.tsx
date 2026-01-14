'use client';

import React from 'react';
import { PlayerStats } from '@/game/types';
import { formatTime } from '@/utils/storage';
import styles from './StatsModal.module.css';

interface StatsModalProps {
  stats: PlayerStats;
  onClose: () => void;
}

function StatsModal({ stats, onClose }: StatsModalProps) {
  const winRate = stats.totalGamesPlayed > 0
    ? Math.round((stats.totalGamesWon / stats.totalGamesPlayed) * 100)
    : 0;

  const podium1 = stats.history.reduce((acc, game) => acc + (game.leaderboardRank === 1 ? 1 : 0), 0);
  const podium2 = stats.history.reduce((acc, game) => acc + (game.leaderboardRank === 2 ? 1 : 0), 0);
  const podium3 = stats.history.reduce((acc, game) => acc + (game.leaderboardRank === 3 ? 1 : 0), 0);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className={styles.closeIcon}>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        <h2 className={styles.title}>Statistics</h2>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Overview</div>
          <div className={styles.overviewGrid}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.totalGamesPlayed}</span>
              <span className={styles.statLabel}>Played</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{winRate}%</span>
              <span className={styles.statLabel}>Win Rate</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.currentStreak}</span>
              <span className={styles.statLabel}>Current Streak</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.maxStreak}</span>
              <span className={styles.statLabel}>Max Streak</span>
            </div>
          </div>
        </div>

        <div className={styles.section} style={{ marginTop: '1rem' }}>
          <div className={styles.sectionTitle}>Podiums</div>
          <div className={styles.podiumGrid}>
            <div className={`${styles.stat} ${styles.podiumStat}`}>
              <span className={styles.statValue}>{podium1}</span>
              <span className={styles.statLabel}>🥇 1st</span>
            </div>
            <div className={`${styles.stat} ${styles.podiumStat}`}>
              <span className={styles.statValue}>{podium2}</span>
              <span className={styles.statLabel}>🥈 2nd</span>
            </div>
            <div className={`${styles.stat} ${styles.podiumStat}`}>
              <span className={styles.statValue}>{podium3}</span>
              <span className={styles.statLabel}>🥉 3rd</span>
            </div>
          </div>
        </div>

        {stats.history.length > 0 && (
          <div className={styles.history}>
            <h3 className={styles.historyTitle}>Recent Games</h3>
            <div className={styles.historyList}>
              {stats.history.slice(-7).reverse().map((game, index) => (
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
  );
}

export default React.memo(StatsModal);
