import { BASELINE_DATE } from './constants';

function startOfUtcDay(date: Date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dateKey(date: Date = new Date()) {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function puzzleNumberForDate(date: Date = new Date()) {
  const base = new Date(`${BASELINE_DATE}T00:00:00Z`);
  const diff = Math.floor((startOfUtcDay(date) - startOfUtcDay(base)) / 86_400_000);
  return diff + 1;
}

export function nextResetTimestamp(date: Date = new Date()) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
  return next.getTime();
}
