'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, getApiMode } from '@/lib/api';
import { LAUNCH_DATE_NY, getNewYorkDateString, getPuzzleNumber } from '@/game/puzzleGenerator';
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
};

export default function ArchiveView({ presentation = 'overlay' }: ArchiveViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const todayNy = useMemo(() => getNewYorkDateString(), []);
  const yesterdayNy = useMemo(() => addDays(todayNy, -1), [todayNy]);

  const minMonthId = useMemo(() => monthIdFromDate(LAUNCH_DATE_NY), []);
  const maxMonthId = useMemo(() => monthIdFromDate(yesterdayNy), [yesterdayNy]);

  const requestedDateParam = searchParams.get('d');
  const requestedDate = isValidNyDateString(requestedDateParam)
    ? clampDateToBounds(requestedDateParam, LAUNCH_DATE_NY, yesterdayNy)
    : null;

  const initialMonthId = useMemo(() => {
    if (requestedDate) return monthIdFromDate(requestedDate);
    return monthIdFromDate(yesterdayNy);
  }, [requestedDate, yesterdayNy]);

  const [monthId, setMonthId] = useState(initialMonthId);
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.me>>>>({ status: 'loading' });
  const [daysState, setDaysState] = useState<LoadState<Awaited<ReturnType<typeof api.archiveDays>>>>({ status: 'loading' });
  const [offerState, setOfferState] = useState<LoadState<Awaited<ReturnType<typeof api.archiveOffer>>>>({ status: 'loading' });
  const [paywallBusy, setPaywallBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [checkoutState, setCheckoutState] = useState<'idle' | 'unlocking' | 'failed'>('idle');

  const paywallOpen = searchParams.get('paywall') === '1' && !!requestedDate;
  const checkoutParam = searchParams.get('checkout');

  const refreshMe = useCallback(async () => {
    setMeState({ status: 'loading' });
    try {
      const me = await api.me();
      setMeState({ status: 'loaded', data: me });
      return me;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load account';
      setMeState({ status: 'error', message });
      return null;
    }
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

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

    setDaysState({ status: 'loading' });
    api
      .archiveDays(from, to)
      .then((data) => setDaysState({ status: 'loaded', data }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load archive';
        setDaysState({ status: 'error', message });
      });
  }, [monthId, yesterdayNy]);

  useEffect(() => {
    if (!paywallOpen) return;
    setOfferState({ status: 'loading' });
    api
      .archiveOffer()
      .then((offer) => setOfferState({ status: 'loaded', data: offer }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load price';
        setOfferState({ status: 'error', message });
      });
  }, [paywallOpen]);

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
        const me = await api.me().catch(() => null);
        if (me) {
          setMeState({ status: 'loaded', data: me });
          if (me.entitlements.archiveAccess) {
            if (requestedDate) {
              const href = `/play/${requestedDate}`;
              if (presentation === 'overlay') {
                window.location.replace(href);
                return;
              }
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
  }, [checkoutParam, presentation, requestedDate, router]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const entitled = meState.status === 'loaded' ? meState.data.entitlements.archiveAccess : false;
  const isSignedIn = meState.status === 'loaded' ? meState.data.mode === 'user' : false;

  const onBackToToday = useCallback(() => {
    router.push('/');
  }, [router]);

  const navPrev = useCallback(() => setMonthId((prev) => shiftMonth(prev, -1)), []);
  const navNext = useCallback(() => setMonthId((prev) => shiftMonth(prev, 1)), []);

  const canPrev = monthId > minMonthId;
  const canNext = monthId < maxMonthId;

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
      const locked = dayLockByDate.get(date) ?? true;
      if (locked) {
        openPaywallForDate(date);
        return;
      }
      const href = `/play/${encodeURIComponent(date)}`;
      if (presentation === 'overlay') {
        window.location.assign(href);
        return;
      }
      router.push(href);
    },
    [dayLockByDate, openPaywallForDate, presentation, router],
  );

  const closePaywall = useCallback(() => {
    router.replace('/archive');
  }, [router]);

  const handleSignIn = useCallback(() => {
    if (getApiMode() === 'mock') {
      setPaywallBusy(true);
      api
        .claim({})
        .then(() => refreshMe())
        .finally(() => setPaywallBusy(false));
      return;
    }

    const callbackUrl = requestedDate
      ? `/archive?paywall=1&d=${encodeURIComponent(requestedDate)}`
      : '/archive?paywall=1';
    window.location.href = `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  }, [refreshMe, requestedDate]);

  const handleCheckout = useCallback(async () => {
    if (!requestedDate) return;
    if (offerState.status !== 'loaded') return;

    setPaywallBusy(true);
    try {
      const origin = window.location.origin;
      const successUrl = `${origin}/archive?checkout=success&d=${encodeURIComponent(requestedDate)}`;
      const cancelUrl = `${origin}/archive?checkout=canceled&d=${encodeURIComponent(requestedDate)}`;
      const { url, alreadyOwned } = await api.createCheckout({
        priceId: offerState.data.priceId,
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
  }, [offerState, requestedDate, refreshMe, router]);

  const monthStartDate = monthStart(monthId);
  const leadingBlankDays = weekdayIndexOfDate(monthStartDate);
  const count = daysInMonth(monthId);

  const monthCells = useMemo(() => {
    const cells: Array<{ kind: 'blank' } | { kind: 'day'; date: string; dayNumber: number; disabled: boolean; locked: boolean }> = [];

    for (let i = 0; i < leadingBlankDays; i++) {
      cells.push({ kind: 'blank' });
    }

    for (let day = 1; day <= count; day++) {
      const date = monthIdToDate(monthId, day);
      const inBounds = date >= LAUNCH_DATE_NY && date <= yesterdayNy;
      const locked = inBounds ? (dayLockByDate.get(date) ?? true) : true;
      cells.push({
        kind: 'day',
        date,
        dayNumber: day,
        disabled: !inBounds || daysState.status !== 'loaded',
        locked,
      });
    }

    // Trailing blanks to fill the last row.
    while (cells.length % 7 !== 0) cells.push({ kind: 'blank' });
    return cells;
  }, [count, dayLockByDate, daysState.status, leadingBlankDays, monthId, yesterdayNy]);

  const paywallSubtitle = offerState.status === 'loaded'
    ? 'Play any past Mazle puzzle. Removes ads.'
    : 'Loading price…';

  const selectedPuzzleNumber = requestedDate
    ? getPuzzleNumber(new Date(`${requestedDate}T00:00:00`))
    : null;

  return (
    <div>
      {toast && <div className={styles.banner}>{toast}</div>}

      <div className={styles.headerRow}>
        <div className={styles.monthNav}>
          <button type="button" className={styles.navButton} onClick={navPrev} disabled={!canPrev}>
            ‹
          </button>
          <div className={styles.monthLabel}>{monthLabel(monthId)}</div>
          <button type="button" className={styles.navButton} onClick={navNext} disabled={!canNext}>
            ›
          </button>
        </div>

        <button type="button" className={styles.navButton} onClick={onBackToToday}>
          Today
        </button>
      </div>

      <div className={styles.subtle}>
        {entitled ? (
          <>Unlocked • No ads</>
        ) : (
          <>Locked days require a one-time unlock.</>
        )}
      </div>

      <div className={styles.calendar} style={{ marginTop: '0.75rem' }}>
        <div className={styles.weekdays}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className={styles.weekday}>
              {d}
            </div>
          ))}
        </div>
        <div className={styles.grid}>
          {monthCells.map((cell, idx) => {
            if (cell.kind === 'blank') {
              return <div key={`b-${idx}`} className={styles.cell} />;
            }
            return (
              <div key={cell.date} className={styles.cell}>
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
                    🔒
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!entitled && (
        <div className={styles.hintBar}>
          <div>
            <div className={styles.hintTitle}>Unlock the Archive</div>
            <div className={styles.subtle}>One-time purchase • removes ads</div>
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
            <div className={styles.paywallTitle}>Unlock the Archive</div>
            <div className={styles.paywallSubtitle}>
              {paywallSubtitle}
              {requestedDate && selectedPuzzleNumber != null && (
                <div style={{ marginTop: '0.35rem' }}>
                  Mazle #{selectedPuzzleNumber} • {requestedDate}
                </div>
              )}
            </div>

            <div className={styles.paywallPrice}>
              {offerState.status === 'loaded' ? offerState.data.formattedPrice : offerState.status === 'error' ? '—' : '…'}
            </div>

            <div className={styles.paywallActions}>
              {!isSignedIn ? (
                <button type="button" className={styles.primary} onClick={handleSignIn} disabled={paywallBusy}>
                  {paywallBusy ? 'Signing in…' : 'Sign in to unlock'}
                </button>
              ) : entitled ? (
                <button type="button" className={styles.primary} disabled>
                  Owned
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primary}
                  onClick={handleCheckout}
                  disabled={paywallBusy || offerState.status !== 'loaded'}
                >
                  {paywallBusy ? 'Opening checkout…' : `Unlock — ${offerState.status === 'loaded' ? offerState.data.formattedPrice : ''}`.trim()}
                </button>
              )}

              <button type="button" className={styles.secondary} onClick={closePaywall} disabled={paywallBusy}>
                Not now
              </button>
            </div>

            {meState.status === 'error' && (
              <div className={styles.inlineNotice}>Unable to load account state.</div>
            )}
            {offerState.status === 'error' && (
              <div className={styles.inlineNotice}>Unable to load price. Try again later.</div>
            )}

            <div className={styles.inlineNotice}>
              Purchases require an account so you can access the archive on any device.
            </div>
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
