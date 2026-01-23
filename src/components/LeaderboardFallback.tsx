'use client';

import React from 'react';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';
import styles from './LeaderboardView.module.css';

export default function LeaderboardFallback() {
  const todayDate = getNewYorkDateString();
  const puzzleNumber = getPuzzleNumberFromNyDateString(todayDate);

  return (
    <div className={styles.grid}>
      <div className={styles.dayTitle}>
        <div className={styles.dayTitleMain}>Mazle #{puzzleNumber}</div>
        <div className={styles.dayTitleSub}>Today</div>
      </div>

      <div className={`${styles.podium} ${styles.podiumLoading}`}>
        <div className={styles.podiumColumn}>
          <div className={styles.podiumAvatar}>
            <div className={styles.skeletonAvatar} style={{ width: 40, height: 40 }} />
          </div>
          <div className={styles.skeletonText} style={{ width: '70%', marginBottom: 4 }} />
          <div className={styles.skeletonBar} style={{ width: '100%', height: 45 }} />
        </div>
        <div className={styles.podiumColumn}>
          <div className={styles.podiumAvatar}>
            <div className={styles.skeletonAvatar} style={{ width: 48, height: 48 }} />
          </div>
          <div className={styles.skeletonText} style={{ width: '70%', marginBottom: 4 }} />
          <div className={styles.skeletonBar} style={{ width: '100%', height: 60 }} />
        </div>
        <div className={styles.podiumColumn}>
          <div className={styles.podiumAvatar}>
            <div className={styles.skeletonAvatar} style={{ width: 40, height: 40 }} />
          </div>
          <div className={styles.skeletonText} style={{ width: '70%', marginBottom: 4 }} />
          <div className={styles.skeletonBar} style={{ width: '100%', height: 35 }} />
        </div>
      </div>

      <div className={styles.scrollArea}>
        <div className={styles.list}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.row}>
              <div className={styles.rowRank}>#{i + 4}</div>
              <div className={styles.skeletonText} style={{ width: '60%' }} />
              <div className={styles.skeletonText} style={{ width: 50 }} />
              <div className={styles.skeletonText} style={{ width: 28 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
