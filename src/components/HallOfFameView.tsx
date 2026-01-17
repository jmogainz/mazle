'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cachedApi, prefetchHallOfFame, readCachedHallOfFamePodium } from '@/lib/api/cached';
import { addDays } from '@/lib/date';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString, LAUNCH_DATE_NY } from '@/game/puzzleGenerator';
import { formatTimeMs } from '@/utils/storage';
import CharacterIcon from './CharacterIcon';
import styles from './HallOfFameView.module.css';
import type { HallOfFamePodiumResponse } from '@/lib/api/types';

type HallOfFameViewProps = {
  initialDate?: string;
};

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function formatDateDisplay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isValidNyDateString(value: string | undefined): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampDateToBounds(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function buildAllDates(min: string, max: string): string[] {
  const dates: string[] = [];
  let cursor = min;
  while (cursor <= max) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

export default function HallOfFameView({ initialDate }: HallOfFameViewProps) {
  const todayDate = useMemo(() => getNewYorkDateString(), []);
  
  const getInitialDate = useCallback(() => {
    if (isValidNyDateString(initialDate)) {
      return clampDateToBounds(initialDate, LAUNCH_DATE_NY, todayDate);
    }
    const yesterday = addDays(todayDate, -1);
    return yesterday >= LAUNCH_DATE_NY ? yesterday : todayDate;
  }, [initialDate, todayDate]);

  // All dates from launch to today - stable array
  const allDates = useMemo(() => buildAllDates(LAUNCH_DATE_NY, todayDate), [todayDate]);
  
  const [visibleDate, setVisibleDate] = useState(getInitialDate);
  const visibleIndex = allDates.indexOf(visibleDate);

  const puzzleNumber = useMemo(() => getPuzzleNumberFromNyDateString(visibleDate), [visibleDate]);
  
  const [podiumStateByDate, setPodiumStateByDate] = useState<
    Record<string, LoadState<HallOfFamePodiumResponse>>
  >({});

  const canPrev = visibleDate > LAUNCH_DATE_NY;
  const canNext = visibleDate < todayDate;

  const trackRef = useRef<HTMLDivElement>(null);
  const didMount = useRef(false);

  // Load podium for a date
  const loadPodium = useCallback((date: string) => {
    setPodiumStateByDate((prev) => {
      if (prev[date] && prev[date].status !== 'error') return prev;
      const cached = readCachedHallOfFamePodium(date);
      if (cached) {
        return { ...prev, [date]: { status: 'loaded', data: cached } };
      }
      return { ...prev, [date]: { status: 'loading' } };
    });
    
    cachedApi
      .hallOfFamePodium(date)
      .then((data) => {
        setPodiumStateByDate((prev) => ({
          ...prev,
          [date]: { status: 'loaded', data },
        }));
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load';
        setPodiumStateByDate((prev) => ({
          ...prev,
          [date]: { status: 'error', message },
        }));
      });
  }, []);

  // Load visible date and nearby dates
  useEffect(() => {
    loadPodium(visibleDate);
    // Load surrounding dates
    for (let i = 1; i <= 3; i++) {
      const prev = addDays(visibleDate, -i);
      const next = addDays(visibleDate, i);
      if (prev >= LAUNCH_DATE_NY) loadPodium(prev);
      if (next <= todayDate) loadPodium(next);
    }
  }, [visibleDate, loadPodium, todayDate]);

  // Initial prefetch
  useEffect(() => {
    const initial = getInitialDate();
    const datesToPrefetch: string[] = [];
    for (let i = -5; i <= 5; i++) {
      const d = addDays(initial, i);
      if (d >= LAUNCH_DATE_NY && d <= todayDate) {
        datesToPrefetch.push(d);
      }
    }
    prefetchHallOfFame(datesToPrefetch);
  }, [getInitialDate, todayDate]);

  // Initial scroll position (no animation)
  useLayoutEffect(() => {
    if (didMount.current) return;
    const track = trackRef.current;
    if (!track || visibleIndex < 0) return;
    const panelWidth = track.offsetWidth;
    if (!panelWidth) return;
    track.scrollLeft = visibleIndex * panelWidth;
    didMount.current = true;
  }, [allDates, visibleIndex]);

  // Handle scroll - just update visible date
  const handleScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    
    const panelWidth = track.offsetWidth;
    if (!panelWidth) return;
    const scrollIndex = Math.round(track.scrollLeft / panelWidth);
    const scrolledDate = allDates[scrollIndex];
    
    if (scrolledDate && scrolledDate !== visibleDate) {
      setVisibleDate(scrolledDate);
    }
  }, [allDates, visibleDate]);

  const navPrev = useCallback(() => {
    if (!canPrev) return;
    const track = trackRef.current;
    if (!track) return;
    const newIndex = visibleIndex - 1;
    if (newIndex >= 0) {
      const panelWidth = track.offsetWidth;
      track.scrollTo({ left: newIndex * panelWidth, behavior: 'smooth' });
    }
  }, [canPrev, visibleIndex]);

  const navNext = useCallback(() => {
    if (!canNext) return;
    const track = trackRef.current;
    if (!track) return;
    const newIndex = visibleIndex + 1;
    if (newIndex < allDates.length) {
      const panelWidth = track.offsetWidth;
      track.scrollTo({ left: newIndex * panelWidth, behavior: 'smooth' });
    }
  }, [canNext, visibleIndex, allDates.length]);

  const renderPanel = (date: string) => {
    const podiumState = podiumStateByDate[date];
    const status = podiumState?.status ?? 'loading';
    const podium = podiumState?.status === 'loaded' ? podiumState.data.podium : [];
    const byRank = new Map(podium.map((p) => [p.rank, p]));
    const first = byRank.get(1);
    const second = byRank.get(2);
    const third = byRank.get(3);

    return (
      <div key={date} className={styles.panel}>
        {status === 'loading' && <div className={styles.hintText}>Loading podium…</div>}
        {podiumState?.status === 'error' && <div className={styles.error}>{podiumState.message}</div>}

        {status === 'loaded' && podium.length === 0 && (
          <div className={styles.hintText}>No podium snapshot for this day yet.</div>
        )}

        {status === 'loaded' && podium.length > 0 && (
          <div className={styles.podium}>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={second?.characterId} skinId={second?.skinId} size={40} />
              </div>
              <div className={styles.podiumName}>{second?.displayName ?? '—'}</div>
              <div className={`${styles.podiumBar} ${styles.podiumSilver}`}>
                <div className={styles.podiumRankBadge}>🥈</div>
                <div className={styles.podiumTime}>{second ? formatTimeMs(second.timeMs) : '—'}</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={first?.characterId} skinId={first?.skinId} size={48} />
              </div>
              <div className={styles.podiumName}>{first?.displayName ?? '—'}</div>
              <div className={`${styles.podiumBar} ${styles.podiumGold}`}>
                <div className={styles.podiumRankBadge}>🥇</div>
                <div className={styles.podiumTime}>{first ? formatTimeMs(first.timeMs) : '—'}</div>
              </div>
            </div>
            <div className={styles.podiumColumn}>
              <div className={styles.podiumAvatar}>
                <CharacterIcon characterId={third?.characterId} skinId={third?.skinId} size={40} />
              </div>
              <div className={styles.podiumName}>{third?.displayName ?? '—'}</div>
              <div className={`${styles.podiumBar} ${styles.podiumBronze}`}>
                <div className={styles.podiumRankBadge}>🥉</div>
                <div className={styles.podiumTime}>{third ? formatTimeMs(third.timeMs) : '—'}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

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
          <div className={styles.dayTitleSub}>{visibleDate === todayDate ? 'Today' : formatDateDisplay(visibleDate)}</div>
        </div>
        <button type="button" className={styles.navButton} onClick={navNext} disabled={!canNext} aria-label="Next day">
          <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 8H19M19 8L12 1M19 8L12 15" />
          </svg>
        </button>
      </div>

      <div className={styles.track} ref={trackRef} onScroll={handleScroll}>
        {allDates.map((date) => renderPanel(date))}
      </div>
    </div>
  );
}
