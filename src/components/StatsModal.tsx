'use client';

import React from 'react';
import { PlayerStats, MapType } from '@/game/types';
import styles from './StatsModal.module.css';

interface StatsModalProps {
  stats: PlayerStats;
  onClose: () => void;
}

// Get emoji for map type (for history display)
function getMapEmoji(mapType?: MapType): string {
  switch (mapType) {
    case MapType.ICE:
      return '🧊';
    case MapType.GROUND:
      return '🟤';
    default:
      return ''; // Legacy entries without map type
  }
}

function StatsModal({ stats, onClose }: StatsModalProps) {
  const winRate = stats.totalGamesPlayed > 0
    ? Math.round((stats.totalGamesWon / stats.totalGamesPlayed) * 100)
    : 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className={styles.closeIcon}>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        <h2 className={styles.title}>Statistics</h2>

        <div className={styles.statsGrid}>
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

        {stats.history.length > 0 && (
          <div className={styles.history}>
            <h3 className={styles.historyTitle}>Recent Games</h3>
            <div className={styles.historyList}>
              {stats.history.slice(-7).reverse().map((game, index) => (
                <div key={index} className={styles.historyItem}>
                  <span className={styles.historyDate}>
                    #{game.puzzleNumber}
                  </span>
                  <span className={styles.historyMoves}>
                    {game.completed ? `${game.moveCount} moves` : 'DNF'}
                  </span>
                  <span className={game.completed ? styles.historyWin : styles.historyLoss}>
                    {game.completed ? (
                      <svg viewBox="0 0 24 24" className={styles.statusIcon}>
                        <path d="M5 12l5 5L20 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className={styles.statusIcon}>
                        <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                      </svg>
                    )}
                  </span>
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
