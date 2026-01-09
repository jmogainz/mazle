'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { addDays } from '@/lib/date';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { formatTime } from '@/utils/storage';
import CharacterIcon from './CharacterIcon';
import styles from './HallOfFameView.module.css';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function formatDateDisplay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HallOfFameView() {
  const todayDate = useMemo(() => getNewYorkDateString(), []);
  const [selectedDate, setSelectedDate] = useState(() => {
    const yesterday = addDays(todayDate, -1);
    return yesterday >= LAUNCH_DATE_NY ? yesterday : todayDate;
  });

  const puzzleNumber = useMemo(() => getPuzzleNumberFromNyDateString(selectedDate), [selectedDate]);
  const [podiumState, setPodiumState] = useState<LoadState<Awaited<ReturnType<typeof api.hallOfFamePodium>>>>({
    status: 'loading',
  });

  const canPrev = selectedDate > LAUNCH_DATE_NY;
  const canNext = selectedDate < todayDate;

  const navPrev = useCallback(() => {
    if (!canPrev) return;
    setSelectedDate((prev) => addDays(prev, -1));
  }, [canPrev]);

  const navNext = useCallback(() => {
    if (!canNext) return;
    setSelectedDate((prev) => addDays(prev, 1));
  }, [canNext]);

  useEffect(() => {
    setPodiumState({ status: 'loading' });
    api
      .hallOfFamePodium(selectedDate)
      .then((data) => setPodiumState({ status: 'loaded', data }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load Hall of Fame';
        setPodiumState({ status: 'error', message });
      });
  }, [selectedDate]);

  const podium = useMemo(() => (podiumState.status === 'loaded' ? podiumState.data.podium : []), [podiumState]);
  const byRank = useMemo(() => new Map(podium.map((p) => [p.rank, p])), [podium]);
  const first = byRank.get(1);
  const second = byRank.get(2);
  const third = byRank.get(3);

  return (
    <div className={styles.grid}>
      <div className={styles.header}>
        <button type="button" className={styles.navButton} onClick={navPrev} disabled={!canPrev} aria-label="Previous day">
          <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 8H1M1 8L8 1M1 8L8 15" />
          </svg>
        </button>
        <div className={styles.dayTitle}>
          <div className={styles.dayTitleMain}>Mazle #{puzzleNumber}</div>
          <div className={styles.dayTitleSub}>{selectedDate === todayDate ? 'Today' : formatDateDisplay(selectedDate)}</div>
        </div>
        <button type="button" className={styles.navButton} onClick={navNext} disabled={!canNext} aria-label="Next day">
          <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 8H19M19 8L12 1M19 8L12 15" />
          </svg>
        </button>
      </div>

      <div className={styles.panel}>
        {podiumState.status === 'loading' && <div className={styles.hintText}>Loading podium…</div>}
        {podiumState.status === 'error' && <div className={styles.error}>{podiumState.message}</div>}

        {podiumState.status === 'loaded' && podium.length === 0 && (
          <div className={styles.hintText}>No podium snapshot for this day yet.</div>
        )}

        {podiumState.status === 'loaded' && podium.length > 0 && (
          <div className={styles.podium}>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={second?.characterId} skinId={second?.skinId} size={34} />
              </div>
              <div className={styles.podiumName}>{second?.displayName ?? '—'}</div>
              <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
                <div className={styles.podiumRankBadge}>🥈</div>
                <div className={styles.podiumTime}>{second ? formatTime(second.timeMs) : '—'}</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={first?.characterId} skinId={first?.skinId} size={36} />
              </div>
              <div className={styles.podiumName}>{first?.displayName ?? '—'}</div>
              <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
                <div className={styles.podiumRankBadge}>🥇</div>
                <div className={styles.podiumTime}>{first ? formatTime(first.timeMs) : '—'}</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={third?.characterId} skinId={third?.skinId} size={34} />
              </div>
              <div className={styles.podiumName}>{third?.displayName ?? '—'}</div>
              <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
                <div className={styles.podiumRankBadge}>🥉</div>
                <div className={styles.podiumTime}>{third ? formatTime(third.timeMs) : '—'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
