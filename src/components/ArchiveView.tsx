'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { api } from '@/lib/api';
import { cachedApi, fetchMeFresh, readCachedMe, readCachedArchiveDays, getCachedArchiveDays } from '@/lib/api/cached';
import { LAUNCH_DATE_NY, getPuzzleNumber } from '@/game/puzzleGenerator';
import { formatTime, getPlayerStats, getStorageScope, setStorageScope } from '@/utils/storage';
import {
  addDays,
  daysInMonth,
  monthEnd,
  monthIdFromDate,
  monthLabel,
  monthStart,
  shiftMonth,
  weekdayIndexOfDate,
} from '@/lib/date';
import styles from './ArchiveView.module.css';

type LoadState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function formatDateDisplay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function isValidNyDateString(value: string | null): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampDateToBounds(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function monthIdToDate(monthId: string, day: number): string {
  const dd = day.toString().padStart(2, '0');
  return `${monthId}-${dd}`;
}

type ArchiveViewProps = {
  presentation?: 'overlay' | 'page';
  initialTodayNy: string;
  onClose?: () => void;
};

const ARCHIVE_VIEW_MODE_KEY = 'mazle_archive_view_mode_v1';

function ArchiveView({ presentation = 'overlay', initialTodayNy, onClose }: ArchiveViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const todayNy = initialTodayNy;
  const yesterdayNy = useMemo(() => addDays(todayNy, -1), [todayNy]);

  const minMonthId = useMemo(() => monthIdFromDate(LAUNCH_DATE_NY), []);
  const maxMonthId = useMemo(() => monthIdFromDate(todayNy), [todayNy]);

  const requestedDateParam = searchParams.get('d');
  const requestedDate = isValidNyDateString(requestedDateParam)
    ? clampDateToBounds(requestedDateParam, LAUNCH_DATE_NY, todayNy)
    : null;

  const initialMonthId = useMemo(() => {
    if (requestedDate) return monthIdFromDate(requestedDate);
    return monthIdFromDate(yesterdayNy);
  }, [requestedDate, yesterdayNy]);

  const [monthId, setMonthId] = useState(initialMonthId);
  const cachedMe = useMemo(() => readCachedMe(), []);
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.me>>>>(
    cachedMe ? { status: 'loaded', data: cachedMe } : { status: 'loading' }
  );
  const [daysState, setDaysState] = useState<LoadState<Awaited<ReturnType<typeof api.archiveDays>>>>({ status: 'loading' });
  const [offerState, setOfferState] = useState<LoadState<Awaited<ReturnType<typeof api.archiveOffer>>>>({ status: 'loading' });
  const [paywallBusy, setPaywallBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState<'idle' | 'unlocking' | 'failed'>('idle');
  const [selectedPlanId, setSelectedPlanId] = useState<'monthly' | 'lifetime' | null>(null);
  const [signInExpanded, setSignInExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [localStats, setLocalStats] = useState(() => getPlayerStats());
  const localHistoryByDate = useMemo(() => new Map(localStats.history.map((h) => [h.date, h])), [localStats]);

  // Use cached entitlements immediately so entitled users never see locks
  const entitled = meState.status === 'loaded'
    ? meState.data.entitlements.archiveAccess
    : (cachedMe?.entitlements?.archiveAccess ?? false);
  const isSignedIn = meState.status === 'loaded' ? meState.data.mode === 'user' : false;

  const paywallOpen = searchParams.get('paywall') === '1' && !!requestedDate;
  const checkoutParam = searchParams.get('checkout');

  const refreshMe = useCallback(async (silent = false, force = false) => {
    if (!silent) {
      setMeState({ status: 'loading' });
    }
    try {
      const me = force ? await fetchMeFresh() : await cachedApi.me();
      setMeState({ status: 'loaded', data: me });
      return me;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load account';
      setMeState({ status: 'error', message });
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe(!!cachedMe);
  }, [refreshMe, cachedMe]);

  useEffect(() => {
    let cancelled = false;
    cachedApi
      .me()
      .then((me) => {
        const scope = me?.mode === 'user' && me.userId ? `user:${me.userId}` : 'guest';
        setStorageScope(scope);
        if (!cancelled) {
          setLocalStats(getPlayerStats(scope));
        }
      })
      .catch(() => {
        const fallbackScope = getStorageScope();
        setStorageScope(fallbackScope);
        if (!cancelled) {
          setLocalStats(getPlayerStats(fallbackScope));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!requestedDate) return;
    const nextMonth = monthIdFromDate(requestedDate);
    setMonthId((prev) => (prev === nextMonth ? prev : nextMonth));
  }, [requestedDate]);

  useEffect(() => {
    if (monthId < minMonthId) setMonthId(minMonthId);
    if (monthId > maxMonthId) setMonthId(maxMonthId);
  }, [monthId, minMonthId, maxMonthId]);

  useEffect(() => {
    const from = clampDateToBounds(monthStart(monthId), LAUNCH_DATE_NY, yesterdayNy);
    const to = clampDateToBounds(monthEnd(monthId), LAUNCH_DATE_NY, yesterdayNy);

    // Check cache first to avoid flash
    const cached = readCachedArchiveDays(from, to);
    if (cached) {
      setDaysState({ status: 'loaded', data: cached });
      return;
    }

    // Only show loading if we don't have data yet
    if (daysState.status !== 'loaded') {
      setDaysState({ status: 'loading' });
    }

    getCachedArchiveDays(from, to)
      .then((data) => setDaysState({ status: 'loaded', data }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load archive';
        setDaysState({ status: 'error', message });
      });
  }, [monthId, yesterdayNy]);

  useEffect(() => {
    if (entitled) return;
    setOfferState({ status: 'loading' });
    api
      .archiveOffer()
      .then((offer) => {
        setOfferState({ status: 'loaded', data: offer });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load price';
        setOfferState({ status: 'error', message });
      });
  }, [entitled]);

  useEffect(() => {
    if (!checkoutParam) return;

    if (checkoutParam === 'canceled') {
      setToast('Checkout canceled.');
      router.replace('/archive');
      return;
    }

    if (checkoutParam !== 'success') return;

    let cancelled = false;
    const run = async () => {
      setCheckoutState('unlocking');

      const startedAt = Date.now();
      let delayMs = 250;

      while (!cancelled && Date.now() - startedAt < 15_000) {
        const me = await fetchMeFresh().catch(() => null);
        if (me) {
          setMeState({ status: 'loaded', data: me });
          if (me.entitlements.archiveAccess) {
            if (requestedDate) {
              const href = `/play/${requestedDate}`;
              if (presentation === 'overlay') onClose?.();
              router.replace(href);
              return;
            }
            setToast('Archive unlocked.');
            router.replace('/archive');
            setCheckoutState('idle');
            return;
          }
        }

        await new Promise((r) => setTimeout(r, delayMs));
        delayMs = Math.min(2000, Math.round(delayMs * 1.6));
      }

      if (cancelled) return;
      setCheckoutState('failed');
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [checkoutParam, onClose, presentation, requestedDate, router]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ARCHIVE_VIEW_MODE_KEY);
      if (stored === 'calendar' || stored === 'list') {
        setViewMode(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);



  // Scroll container ref for carousel
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Months to render in the carousel: prev, current, next
  const prevMonthId = useMemo(() => (monthId > minMonthId ? shiftMonth(monthId, -1) : null), [monthId, minMonthId]);
  const nextMonthId = useMemo(() => (monthId < maxMonthId ? shiftMonth(monthId, 1) : null), [monthId, maxMonthId]);

  // Scroll to center panel on mount and when monthId changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    // Center panel is always index 1 when prev exists, else index 0
    const centerIndex = prevMonthId ? 1 : 0;
    const panelWidth = container.offsetWidth;
    container.scrollLeft = centerIndex * panelWidth;
  }, [monthId, prevMonthId]);

  // Handle scroll end to sync monthId with carousel position
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const panelWidth = container.offsetWidth;
    const scrollLeft = container.scrollLeft;
    const panelIndex = Math.round(scrollLeft / panelWidth);

    // Determine which month is at this index
    const monthIds = [prevMonthId, monthId, nextMonthId].filter(Boolean) as string[];
    const visibleMonthId = monthIds[panelIndex];
    if (visibleMonthId && visibleMonthId !== monthId) {
      setMonthId(visibleMonthId);
    }
  }, [monthId, prevMonthId, nextMonthId]);

  const canPrev = monthId > minMonthId;
  const canNext = monthId < maxMonthId;

  const navPrev = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !canPrev) return;
    const panelWidth = container.offsetWidth;
    container.scrollTo({ left: container.scrollLeft - panelWidth, behavior: 'smooth' });
  }, [canPrev]);

  const navNext = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !canNext) return;
    const panelWidth = container.offsetWidth;
    container.scrollTo({ left: container.scrollLeft + panelWidth, behavior: 'smooth' });
  }, [canNext]);

  const dayLockByDate = useMemo(() => {
    if (daysState.status !== 'loaded') return new Map<string, boolean>();
    return new Map(daysState.data.days.map((d) => [d.date, d.locked]));
  }, [daysState]);

  const openPaywallForDate = useCallback(
    (date: string) => {
      router.push(`/archive?paywall=1&d=${encodeURIComponent(date)}`);
    },
    [router],
  );

  const onDayClick = useCallback(
    (date: string) => {
      // If clicking Today, go to main game
      if (date === todayNy) {
        if (onClose) {
          onClose();
          return;
        }
        if (presentation === 'overlay') {
          if (window.history.length > 1) {
            router.back();
            return;
          }
        }
        router.push('/');
        return;
      }

      // If entitled, default to unlocked; otherwise default to locked
      const defaultLocked = !entitled;
      const locked = dayLockByDate.get(date) ?? defaultLocked;
      if (locked) {
        openPaywallForDate(date);
        return;
      }
      const href = `/play/${encodeURIComponent(date)}`;
      if (presentation === 'overlay' && !onClose) {
        router.push(href);
        return;
      }
      onClose?.();
      if (presentation === 'overlay') {
        requestAnimationFrame(() => router.push(href));
        return;
      }
      router.push(href);
    },
    [dayLockByDate, entitled, onClose, openPaywallForDate, presentation, router, todayNy],
  );

  const setViewModeAndPersist = useCallback((next: 'calendar' | 'list') => {
    setViewMode(next);
    try {
      localStorage.setItem(ARCHIVE_VIEW_MODE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const closePaywall = useCallback(() => {
    router.replace('/archive');
  }, [router]);

  const handleSignIn = useCallback((provider: 'google' | 'apple') => {
    const callbackUrl = requestedDate
      ? `/archive?paywall=1&d=${encodeURIComponent(requestedDate)}`
      : '/archive?paywall=1';
    signIn(provider, { callbackUrl });
  }, [requestedDate]);

  const handleCheckout = useCallback(async () => {
    if (!requestedDate) return;
    if (offerState.status !== 'loaded') return;

    const selectedPlan = offerState.data.plans.find((p) => p.id === selectedPlanId) ?? offerState.data.plans[0];
    if (!selectedPlan) {
      setToast('Unable to load plans.');
      return;
    }

    setPaywallBusy(true);
    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/archive?checkout=success&d=${encodeURIComponent(requestedDate)}`;
      const cancelUrl = `${origin}/archive?checkout=canceled&d=${encodeURIComponent(requestedDate)}`;
      const { url, alreadyOwned } = await api.createCheckout({
        priceId: selectedPlan.priceId,
        successUrl,
        cancelUrl,
      });
      if (alreadyOwned) {
        setToast('Archive already unlocked.');
        await refreshMe();
        router.replace('/archive');
        return;
      }
      if (url) {
        window.location.href = url;
        return;
      }
      setToast('Unable to start checkout.');
    } finally {
      setPaywallBusy(false);
    }
  }, [offerState, requestedDate, refreshMe, router, selectedPlanId]);

  const monthStartDate = monthStart(monthId);
  const leadingBlankDays = weekdayIndexOfDate(monthStartDate);
  const count = daysInMonth(monthId);

  const monthCells = useMemo(() => {
    const cells: Array<{ kind: 'blank' } | { kind: 'day'; date: string; dayNumber: number; disabled: boolean; locked: boolean }> = [];

    for (let i = 0; i < leadingBlankDays; i++) {
      cells.push({ kind: 'blank' });
    }

    // If entitled, default to unlocked; otherwise default to locked
    const defaultLocked = !entitled;

    for (let day = 1; day <= count; day++) {
      const date = monthIdToDate(monthId, day);
      const isToday = date === todayNy;
      const inBounds = date >= LAUNCH_DATE_NY && date <= todayNy;
      // Today is never locked
      const locked = isToday ? false : (inBounds ? (dayLockByDate.get(date) ?? defaultLocked) : true);
      cells.push({
        kind: 'day',
        date,
        dayNumber: day,
        disabled: !inBounds || (!isToday && daysState.status !== 'loaded'),
        locked,
      });
    }

    // Trailing blanks to fill the last row.
    while (cells.length % 7 !== 0) cells.push({ kind: 'blank' });
    return cells;
  }, [count, dayLockByDate, daysState.status, entitled, leadingBlankDays, monthId, todayNy]);

  const monthDaysDesc = useMemo(() => {
    const days: Array<{
      date: string;
      dayNumber: number;
      disabled: boolean;
      locked: boolean;
      isToday: boolean;
      history: ReturnType<typeof getPlayerStats>['history'][number] | null;
    }> = [];

    const defaultLocked = !entitled;

    for (let day = count; day >= 1; day -= 1) {
      const date = monthIdToDate(monthId, day);
      if (date < LAUNCH_DATE_NY || date > todayNy) continue;
      const isToday = date === todayNy;
      const locked = isToday ? false : (dayLockByDate.get(date) ?? defaultLocked);
      const disabled = !isToday && daysState.status !== 'loaded';
      const history = localHistoryByDate.get(date) ?? null;
      days.push({ date, dayNumber: day, disabled, locked, isToday, history });
    }

    return days;
  }, [count, dayLockByDate, daysState.status, entitled, localHistoryByDate, monthId, todayNy]);

  const paywallSubtitle = offerState.status === 'loaded'
    ? 'Unlock the archive and remove ads. Choose monthly or lifetime.'
    : 'Loading plans…';

  const selectedPlan = offerState.status === 'loaded'
    ? offerState.data.plans.find((p) => p.id === selectedPlanId) ?? null
    : null;

  const selectedPuzzleNumber = requestedDate
    ? getPuzzleNumber(new Date(`${requestedDate}T00:00:00`))
    : null;

  return (
      <div className={styles.container}>
      {toast && <div className={styles.banner}>{toast}</div>}

      {/* Unified Header */}
      <div className={styles.fixedHeader}>
        {/* Row 1: Month Navigation */}
        <div className={styles.navRow}>
          <button
            type="button"
            className={styles.navButton}
            onClick={navPrev}
            disabled={!canPrev}
            aria-label="Previous month"
          >
            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 8H1M1 8L8 1M1 8L8 15" />
            </svg>
          </button>

          <div className={styles.monthTitleMain}>{monthLabel(monthId)}</div>

          <button
            type="button"
            className={styles.navButton}
            onClick={navNext}
            disabled={!canNext}
            aria-label="Next month"
          >
            <svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 8H19M19 8L12 1M19 8L12 15" />
            </svg>
          </button>
        </div>

        {/* Row 2: Actions */}
        <div className={styles.actionRow}>
          <button
            type="button"
            className={styles.todayButton}
            onClick={() => {
              onClose?.();
              router.push('/');
            }}
          >
            Today
          </button>

          <div className={styles.viewToggle} role="group" aria-label="Archive view mode">
            <button
              type="button"
              className={`${styles.viewToggleButton} ${viewMode === 'calendar' ? styles.viewToggleButtonActive : ''}`}
              onClick={() => setViewModeAndPersist('calendar')}
              aria-label="Calendar view"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4.5" width="18" height="16" rx="2" />
                <path d="M16 3v3M8 3v3M3 9h18" />
                <path d="M7 13h3M7 17h3M14 13h3M14 17h3" />
              </svg>
            </button>
            <button
              type="button"
              className={`${styles.viewToggleButton} ${viewMode === 'list' ? styles.viewToggleButtonActive : ''}`}
              onClick={() => setViewModeAndPersist('list')}
              aria-label="List view"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6h12M9 12h12M9 18h12" />
                <path d="M4 6h.01M4 12h.01M4 18h.01" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Carousel container */}
      <div
        ref={scrollContainerRef}
        className={styles.carousel}
        onScroll={handleScroll}
      >
        {/* Previous month panel */}
        {prevMonthId && (
          <div className={styles.monthPanel}>
            <div className={styles.calendar}>
              <div className={styles.weekdays}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={`${prevMonthId}-${i}`} className={styles.weekday}>{d}</div>
                ))}
              </div>
              <div className={styles.grid}>
                {/* Render cells for prev month - simplified for now */}
              </div>
            </div>
          </div>
        )}

        {/* Current month panel */}
        <div className={styles.monthPanel}>
          {viewMode === 'calendar' ? (
            <div className={styles.calendar}>
              <div className={styles.weekdays}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={`cur-${i}`} className={styles.weekday}>{d}</div>
                ))}
              </div>
              <div className={styles.grid}>
                {monthCells.map((cell, idx) => {
                  if (cell.kind === 'blank') {
                    return <div key={`b-${idx}`} className={styles.cell} />;
                  }
                  const isToday = cell.date === todayNy;
                  return (
                    <div key={cell.date} className={`${styles.cell} ${isToday ? styles.todayCell : ''}`.trim()}>
                      <button
                        type="button"
                        className={styles.dayButton}
                        onClick={() => onDayClick(cell.date)}
                        disabled={cell.disabled}
                        aria-label={cell.locked ? `Locked day ${cell.date}` : `Play ${cell.date}`}
                      >
                        {cell.dayNumber}
                      </button>
                      {cell.locked && cell.date >= LAUNCH_DATE_NY && cell.date <= yesterdayNy && (
                        <div className={styles.lockedBadge} aria-hidden="true">
                          <div className={styles.customLock}>
                            <div className={styles.lockShackle} />
                            <div className={styles.lockBody} />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className={styles.list}>
              {monthDaysDesc.map((day) => {
                const hasHistory = !!day.history;
                const solved = hasHistory && !!day.history?.completed;
                const dnf = hasHistory && !day.history?.completed;

                const statusLabel = day.locked
                  ? 'Locked'
                  : solved
                    ? 'Solved'
                    : dnf
                      ? 'DNF'
                      : 'Unplayed';

                const timeLabel = solved && day.history ? formatTime(day.history.timeMs) : null;

                return (
                  <button
                    key={day.date}
                    type="button"
                    className={`${styles.listRow} ${day.isToday ? styles.listRowToday : ''}`}
                    onClick={() => onDayClick(day.date)}
                    disabled={day.disabled}
                  >
                    <div className={styles.listRowLeft}>
                      <div className={styles.listRowTitle}>{day.isToday ? 'Today' : formatDateDisplay(day.date)}</div>
                      <div className={styles.listRowSubtitle}>Day {day.dayNumber}</div>
                    </div>

                    <div className={styles.listRowRight}>
                      <span
                        className={`${styles.statusBadge} ${
                          day.locked
                            ? styles.statusLocked
                            : solved
                              ? styles.statusSolved
                              : dnf
                                ? styles.statusDnf
                                : styles.statusUnplayed
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span className={styles.listRowTime}>{timeLabel ?? '—'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Next month panel */}
        {nextMonthId && (
          <div className={styles.monthPanel}>
            <div className={styles.calendar}>
              <div className={styles.weekdays}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                  <div key={`${nextMonthId}-${i}`} className={styles.weekday}>{d}</div>
                ))}
              </div>
              <div className={styles.grid}>
                {/* Render cells for next month - simplified for now */}
              </div>
            </div>
          </div>
        )}
      </div>



      {!entitled && (
        <div className={styles.hintBar}>
          <div>
            <div className={styles.hintTitle}>Get Mazle+!</div>
            <div className={styles.subtle}>Unlock the archive and remove ads</div>
          </div>
          <button
            type="button"
            className={styles.hintButton}
            onClick={() => openPaywallForDate(requestedDate ?? yesterdayNy)}
          >
            Unlock
          </button>
        </div>
      )}

      {paywallOpen && (
        <div className={styles.paywallBackdrop} role="dialog" aria-modal="true" aria-label="Unlock archive" onClick={closePaywall}>
          <div className={styles.paywallCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.paywallTitle}>Get Mazle+</div>
            <div className={styles.paywallSubtitle}>
              Unlocks the archive to play past mazes and removes ads.
            </div>
            <div className={styles.paywallActions}>
              {entitled ? (
                <button type="button" className={styles.primary} disabled>
                  Owned
                </button>
              ) : (
                <>
                  {offerState.status === 'loaded' ? (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem', maxWidth: '260px', margin: '0 auto 0.75rem' }}>
                        <button
                          type="button"
                          className={`${styles.planOption} ${selectedPlanId === 'monthly' ? styles.planOptionSelected : ''}`}
                          onClick={() => setSelectedPlanId('monthly')}
                          disabled={!offerState.data.plans.some((p) => p.id === 'monthly') || paywallBusy}
                        >
                          <div className={styles.planOptionTitle}>Monthly</div>
                          <div className={styles.planOptionPrice}>
                            {offerState.data.plans.find((p) => p.id === 'monthly')?.formattedPrice ?? '…'}
                          </div>
                        </button>
                        <button
                          type="button"
                          className={`${styles.planOption} ${selectedPlanId === 'lifetime' ? styles.planOptionSelected : ''}`}
                          onClick={() => setSelectedPlanId('lifetime')}
                          disabled={!offerState.data.plans.some((p) => p.id === 'lifetime') || paywallBusy}
                        >
                          <div className={styles.planOptionTitle}>Lifetime</div>
                          <div className={styles.planOptionPrice}>
                            {offerState.data.plans.find((p) => p.id === 'lifetime')?.formattedPrice ?? '…'}
                          </div>
                        </button>
                      </div>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={isSignedIn ? handleCheckout : () => setSignInExpanded(true)}
                        disabled={paywallBusy || !selectedPlan || (signInExpanded && !isSignedIn)}
                        style={{ display: 'block', margin: '0 auto', width: '100%', maxWidth: '280px' }}
                      >
                        {paywallBusy
                          ? 'Processing…'
                          : !selectedPlan
                            ? 'Select a plan'
                            : !isSignedIn
                              ? 'Sign in to Subscribe'
                              : selectedPlan.purchaseType === 'subscription'
                                ? `Subscribe`
                                : `Unlock lifetime`}
                      </button>

                      {!isSignedIn && (
                        <div className={`${styles.signInOptions} ${signInExpanded ? styles.signInOptionsVisible : ''}`}>
                          <button
                            type="button"
                            className={styles.googleButton}
                            onClick={() => handleSignIn('google')}
                            disabled={paywallBusy}
                          >
                            <div className={styles.googleButtonState}></div>
                            <div className={styles.googleButtonContentWrapper}>
                              <div className={styles.googleButtonIcon}>
                                <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"></path>
                                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"></path>
                                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"></path>
                                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"></path>
                                  <path fill="none" d="M0 0h48v48H0z"></path>
                                </svg>
                              </div>
                              <span className={styles.googleButtonContents}>
                                Continue with Google
                              </span>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button type="button" className={styles.primary} disabled>
                      Loading plan info…
                    </button>
                  )}
                </>
              )}

              <button type="button" className={styles.notNowButton} onClick={closePaywall} disabled={paywallBusy}>
                Not now
              </button>
            </div>

            {meState.status === 'error' && (
              <div className={styles.inlineNotice}>Unable to load account state.</div>
            )}
            {offerState.status === 'error' && (
              <div className={styles.inlineNotice}>Unable to load price. Try again later.</div>
            )}


          </div>
        </div>
      )}

      {checkoutState === 'unlocking' && (
        <div className={styles.paywallBackdrop} role="dialog" aria-modal="true" aria-label="Unlocking archive">
          <div className={styles.paywallCard}>
            <div className={styles.paywallTitle}>Unlocking…</div>
            <div className={styles.paywallSubtitle}>Confirming your purchase.</div>
            <div className={styles.inlineNotice}>This usually takes a second.</div>
          </div>
        </div>
      )}

      {checkoutState === 'failed' && (
        <div className={styles.paywallBackdrop} role="dialog" aria-modal="true" aria-label="Unlock failed" onClick={() => setCheckoutState('idle')}>
          <div className={styles.paywallCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.paywallTitle}>Still unlocking…</div>
            <div className={styles.paywallSubtitle}>We couldn’t confirm your entitlement yet.</div>
            <div className={styles.paywallActions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => router.refresh()}
              >
                Refresh
              </button>
              <button type="button" className={styles.secondary} onClick={() => setCheckoutState('idle')}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(ArchiveView);
