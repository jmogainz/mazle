'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import {
  cachedApi,
  fetchLeaderboardAroundFresh,
  fetchLeaderboardMeFresh,
  fetchLeaderboardTopFresh,
  readCachedLeaderboardAround,
  readCachedLeaderboardMe,
  readCachedLeaderboardTop,
} from '@/lib/api/cached';
import { getNewYorkDateString, getPuzzleNumber } from '@/game/puzzleGenerator';
import { formatTime } from '@/utils/storage';
import { getTodaysResult } from '@/utils/storage';
import styles from './LeaderboardView.module.css';

const DEVTOOLS_PREVIEW_FEATURES_KEY = 'mazle_devtools_preview_features_v1';

type LoadState<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'error'; message: string };

function computeAttemptsUsed(result: ReturnType<typeof getTodaysResult>): number | null {
  if (!result) return null;
  if (result.failed) return null;
  const failedAttempts = result.attempts?.length ?? 0;
  return Math.min(3, Math.max(1, failedAttempts + 1));
}

export default function LeaderboardView() {
  const todayDate = useMemo(() => getNewYorkDateString(), []);
  const puzzleNumber = useMemo(() => getPuzzleNumber(), []);
  const todayResult = useMemo(() => getTodaysResult(), []);
  const [previewFeaturesEnabled, setPreviewFeaturesEnabled] = useState(false);
  const cachedTop = useMemo(() => readCachedLeaderboardTop(todayDate, 50), [todayDate]);
  const cachedMe = useMemo(() => readCachedLeaderboardMe(todayDate), [todayDate]);
  const cachedAround = useMemo(() => {
    if (!cachedMe?.rank) return null;
    return readCachedLeaderboardAround(todayDate, cachedMe.rank, 5);
  }, [todayDate, cachedMe?.rank]);

  const showLockedFeatures = useMemo(() => {
    if (process.env.NODE_ENV !== 'production') return true;
    return previewFeaturesEnabled;
  }, [previewFeaturesEnabled]);

  const [topState, setTopState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardTop>>>>(
    cachedTop ? { status: 'loaded', data: cachedTop } : { status: 'loading' }
  );
  const [meState, setMeState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardMe>>>>(
    cachedMe ? { status: 'loaded', data: cachedMe } : { status: 'loading' }
  );
  const [aroundState, setAroundState] = useState<LoadState<Awaited<ReturnType<typeof api.leaderboardAround>>>>(
    cachedAround ? { status: 'loaded', data: cachedAround } : { status: 'idle' }
  );
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'failed'>('idle');

  const reload = useCallback(async (silent = false, force = false) => {
    if (!showLockedFeatures) return;
    if (!silent) {
      setTopState({ status: 'loading' });
      setMeState({ status: 'loading' });
      setAroundState({ status: 'idle' });
    }

    try {
      const [top, me] = await Promise.all([
        force ? fetchLeaderboardTopFresh(todayDate, 50) : cachedApi.leaderboardTop(todayDate, 50),
        force ? fetchLeaderboardMeFresh(todayDate) : cachedApi.leaderboardMe(todayDate),
      ]);
      setTopState({ status: 'loaded', data: top });
      setMeState({ status: 'loaded', data: me });

      if (me?.rank) {
        if (!silent) {
          setAroundState({ status: 'loading' });
        }
        const around = force
          ? await fetchLeaderboardAroundFresh(todayDate, me.rank, 5)
          : await cachedApi.leaderboardAround(todayDate, me.rank, 5);
        setAroundState({ status: 'loaded', data: around });
      } else if (!silent) {
        setAroundState({ status: 'idle' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load leaderboard';
      setTopState({ status: 'error', message });
      setMeState({ status: 'error', message });
    }
  }, [showLockedFeatures, todayDate]);

  useEffect(() => {
    reload(!!cachedTop || !!cachedMe);
  }, [reload, cachedTop, cachedMe]);

  useEffect(() => {
    try {
      setPreviewFeaturesEnabled(localStorage.getItem(DEVTOOLS_PREVIEW_FEATURES_KEY) === '1');
    } catch {
      setPreviewFeaturesEnabled(false);
    }
  }, []);

  const attemptsUsed = computeAttemptsUsed(todayResult);
  const canSubmit = !!todayResult && todayResult.date === todayDate && !todayResult.failed && attemptsUsed != null;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !todayResult || attemptsUsed == null) return;
    setSubmitState('submitting');
    try {
      await api.leaderboardSubmit({
        date: todayDate,
        timeMs: todayResult.timeMs,
        attemptsUsed,
      });
      setSubmitState('submitted');
      await reload(false, true);
    } catch {
      setSubmitState('failed');
    }
  }, [canSubmit, todayResult, attemptsUsed, todayDate, reload]);

  if (!showLockedFeatures) {
    return (
      <div className={styles.grid}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>Leaderboard coming soon</div>
          <div className={styles.hintText}>We’re still polishing this feature.</div>
        </div>
      </div>
    );
  }

  const mePanel = () => {
    switch (meState.status) {
      case 'loading':
      case 'idle':
        return <div className={styles.hintText}>Loading your rank…</div>;
      case 'error':
        return <div className={styles.hintText}>Unable to load your rank.</div>;
      case 'loaded': {
        const me = meState.data;
        if (!me) {
          if (!todayResult || todayResult.date !== todayDate) {
            return <div className={styles.hintText}>Play today’s puzzle to join the leaderboard.</div>;
          }
          if (todayResult.failed) {
            return <div className={styles.hintText}>Only successful solves can be submitted.</div>;
          }
          return <div className={styles.hintText}>Not submitted yet.</div>;
        }

        return (
          <div className={styles.meRow}>
            <div className={styles.meLeft}>
              <div className={styles.meName}>{me.displayName}</div>
              <div className={styles.meMeta}>
                {formatTime(me.timeMs)} • {me.attemptsUsed}/3 tries
              </div>
            </div>
            <div className={styles.meRight}>
              <div className={styles.rank}>#{me.rank}</div>
            </div>
          </div>
        );
      }
    }
  };

  const submitPanel = () => {
    if (meState.status !== 'loaded') return null;
    if (meState.data) return null;
    if (!canSubmit) return null;

    return (
      <div className={styles.buttonRow}>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleSubmit}
          disabled={submitState === 'submitting'}
        >
          {submitState === 'submitting' ? 'Submitting…' : 'Submit my time'}
        </button>
      </div>
    );
  };

  const renderEntries = (entries: Array<{ rank: number; displayName: string; timeMs: number; attemptsUsed: number; isMe?: boolean }>) => {
    return (
      <div className={styles.list}>
        {entries.map((e) => (
          <div key={`${e.rank}-${e.displayName}`} className={`${styles.row} ${e.isMe ? styles.rowMe : ''}`.trim()}>
            <div className={styles.rowRank}>#{e.rank}</div>
            <div className={styles.rowName}>{e.displayName}</div>
            <div className={styles.rowTime}>{formatTime(e.timeMs)}</div>
            <div className={styles.rowAttempts}>{e.attemptsUsed}/3</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={styles.grid}>
      <div className={styles.panel}>
        <div className={styles.sectionTitle}>Today</div>
        <div className={styles.hintText}>
          Mazle #{puzzleNumber} • {todayDate} (ET)
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.sectionTitle}>Me</div>
        {mePanel()}
        {submitPanel()}
        {submitState === 'failed' && <div className={styles.error}>Couldn’t submit. Try again.</div>}
        <div className={styles.hintText} style={{ marginTop: '0.75rem' }}>
          Ranking: time • tries • submitted
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.sectionTitle}>Top</div>
        {topState.status === 'loading' && <div className={styles.hintText}>Loading…</div>}
        {topState.status === 'error' && <div className={styles.error}>{topState.message}</div>}
        {topState.status === 'loaded' && renderEntries(topState.data.entries)}
      </div>

      {aroundState.status !== 'idle' && (
        <div className={styles.panel}>
          <div className={styles.sectionTitle}>Around Me</div>
          {aroundState.status === 'loading' && <div className={styles.hintText}>Loading…</div>}
          {aroundState.status === 'loaded' && renderEntries(aroundState.data.entries)}
        </div>
      )}
    </div>
  );
}
