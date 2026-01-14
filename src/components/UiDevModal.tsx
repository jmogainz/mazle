'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, getApiMode, setApiMode } from '@/lib/api';
import { getNewYorkDateString, getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';
import { getPlayerStats, getTodaysResult, recordLeaderboardRank } from '@/utils/storage';
import styles from './UiDevModal.module.css';

type UiDevModalProps = {
  open: boolean;
  onClose: () => void;
  onOpenStats: () => void;
  onOpenAccount: () => void;
  onOpenLeaderboard: () => void;
  onOpenHallOfFame: () => void;
  onOpenArchive: () => void;
  onApplyTodayResult: (kind: 'clear' | 'win' | 'loss') => void;
};

export default function UiDevModal({
  open,
  onClose,
  onOpenStats,
  onOpenAccount,
  onOpenLeaderboard,
  onOpenHallOfFame,
  onOpenArchive,
  onApplyTodayResult,
}: UiDevModalProps) {
  const [mode, setMode] = useState<'real' | 'mock'>(() => getApiMode());
  const [meMode, setMeMode] = useState<'unknown' | 'guest' | 'user'>('unknown');
  const [busy, setBusy] = useState<'idle' | 'switching' | 'submitting'>('idle');
  const [toast, setToast] = useState<string | null>(null);

  const todayNy = useMemo(() => getNewYorkDateString(), []);
  const puzzleNumber = useMemo(() => getPuzzleNumberFromNyDateString(todayNy), [todayNy]);
  const todayResult = useMemo(() => getTodaysResult(), [open, toast]);

  useEffect(() => {
    if (!open) return;
    setMode(getApiMode());
    api
      .me()
      .then((me) => setMeMode(me.mode))
      .catch(() => setMeMode('unknown'));
  }, [open, toast]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const setApiModeAndReload = useCallback((next: 'real' | 'mock') => {
    setApiMode(next);
    window.location.reload();
  }, []);

  const switchIdentity = useCallback(async () => {
    if (mode !== 'mock') {
      setToast('Switch API mode to Mock first.');
      return;
    }
    setBusy('switching');
    try {
      if (meMode === 'user') {
        await api.guest();
        setToast('Switched to Guest.');
      } else {
        await api.claim({});
        setToast('Switched to Account.');
      }
      window.location.reload();
    } finally {
      setBusy('idle');
    }
  }, [meMode, mode]);

  const submitToLeaderboard = useCallback(async () => {
    const result = getTodaysResult();
    const today = getNewYorkDateString();
    if (!result || result.date !== today) {
      setToast('No result for today.');
      return;
    }
    if (result.failed || !result.completed) {
      setToast('Only wins can be submitted.');
      return;
    }

    const failedAttempts = result.attempts?.length ?? 0;
    const attemptsUsed = Math.min(3, Math.max(1, failedAttempts + 1));

    setBusy('submitting');
    try {
      await api.resultsRecord({ date: today, completed: true, timeMs: result.timeMs, attemptsUsed });
      const res = await api.leaderboardSubmit({ date: today });
      if (res.rank != null) {
        recordLeaderboardRank(today, res.rank);
      }
      setToast(res.rank != null ? `Submitted. Rank #${res.rank}.` : 'Submitted.');
      onOpenLeaderboard();
    } catch {
      setToast('Submit failed.');
    } finally {
      setBusy('idle');
    }
  }, [onOpenLeaderboard]);

  if (!open) return null;

  const currentStats = getPlayerStats();

  const activeResultLabel = (() => {
    if (!todayResult || todayResult.date !== todayNy) return 'None';
    if (todayResult.failed || !todayResult.completed) return 'Loss';
    return 'Win';
  })();

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="UI Dev Tools" onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>UI Dev Tools</div>
            <div className={styles.subtitle}>
              Fast UI scenarios for `ENV=dev` (trigger: type `UIUIUIUI`)
            </div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" className={styles.closeIcon}>
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {toast && <div className={styles.notice}>{toast}</div>}

        <div className={styles.section}>
          <div className={styles.sectionTitle}>API</div>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowTitle}>Data source</div>
              <div className={styles.rowHint}>Mock gives full UI data (80 LB, podium history, dummy archive).</div>
            </div>
            <div className={styles.radioGroup}>
              <button
                type="button"
                className={`${styles.radioButton} ${mode === 'mock' ? styles.radioButtonActive : ''}`}
                onClick={() => setApiModeAndReload('mock')}
              >
                <span className={`${styles.radioDot} ${mode === 'mock' ? styles.radioDotActive : ''}`} aria-hidden="true" />
                Mock
              </button>
              <button
                type="button"
                className={`${styles.radioButton} ${mode === 'real' ? styles.radioButtonActive : ''}`}
                onClick={() => setApiModeAndReload('real')}
              >
                <span className={`${styles.radioDot} ${mode === 'real' ? styles.radioDotActive : ''}`} aria-hidden="true" />
                Real
              </button>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Identity</div>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowTitle}>Mode</div>
              <div className={styles.rowHint}>UI-only guest/account toggle (no real auth).</div>
            </div>
            <div className={styles.controls}>
              <span className={`${styles.pill} ${meMode === 'unknown' ? styles.pillMuted : ''}`}>
                {meMode === 'unknown' ? 'Loading…' : meMode === 'user' ? 'Account' : 'Guest'}
              </span>
              <button
                type="button"
                className={styles.button}
                onClick={switchIdentity}
                disabled={busy !== 'idle'}
              >
                {busy === 'switching' ? 'Switching…' : meMode === 'user' ? 'Switch to Guest' : 'Switch to Account'}
              </button>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Today</div>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowTitle}>Result</div>
              <div className={styles.rowHint}>Quickly force win/loss UI states for today.</div>
            </div>
            <div className={styles.controls}>
              <span className={styles.pill}>{activeResultLabel}</span>
              <button type="button" className={styles.button} onClick={() => onApplyTodayResult('clear')}>
                Clear
              </button>
              <button type="button" className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => onApplyTodayResult('win')}>
                Win
              </button>
              <button type="button" className={`${styles.button} ${styles.buttonDanger}`} onClick={() => onApplyTodayResult('loss')}>
                Loss
              </button>
            </div>
          </div>
          <div className={styles.row} style={{ marginTop: '0.6rem' }}>
            <div className={styles.rowLabel}>
              <div className={styles.rowTitle}>Submit</div>
              <div className={styles.rowHint}>Submits today (requires Account + win).</div>
            </div>
            <div className={styles.controls}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={submitToLeaderboard}
                disabled={busy !== 'idle'}
              >
                {busy === 'submitting' ? 'Submitting…' : 'Submit to Leaderboard'}
              </button>
              <button type="button" className={styles.button} onClick={onOpenLeaderboard}>
                Open Leaderboard
              </button>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <div className={styles.sectionTitle}>Navigate</div>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <div className={styles.rowTitle}>Overlays</div>
              <div className={styles.rowHint}>Jump straight to any UI surface.</div>
            </div>
            <div className={styles.controls}>
              <button type="button" className={styles.button} onClick={onOpenStats}>
                Stats
              </button>
              <button type="button" className={styles.button} onClick={onOpenAccount}>
                Account
              </button>
              <button type="button" className={styles.button} onClick={onOpenHallOfFame}>
                Hall of Fame
              </button>
              <button type="button" className={styles.button} onClick={onOpenArchive}>
                Archive
              </button>
            </div>
          </div>

          <div className={styles.notice}>
            Demo streak: <strong>{currentStats.currentStreak}</strong> · Demo history: <strong>{currentStats.history.length}</strong> days · Today: <strong>Mazle #{puzzleNumber}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

