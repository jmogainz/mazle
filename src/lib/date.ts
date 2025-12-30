export type MonthId = `${number}-${string}`;

function parseDateUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00Z`);
}

function formatDateUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDateUtc(dateStr);
  return formatDateUtc(new Date(date.getTime() + days * 24 * 60 * 60 * 1000));
}

export function monthIdFromDate(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function monthStart(monthId: string): string {
  return `${monthId}-01`;
}

export function monthEnd(monthId: string): string {
  const [y, m] = monthId.split('-').map((v) => parseInt(v, 10));
  const last = new Date(Date.UTC(y, m, 0));
  return formatDateUtc(last);
}

export function shiftMonth(monthId: string, delta: number): string {
  const [y, m] = monthId.split('-').map((v) => parseInt(v, 10));
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return formatDateUtc(date).slice(0, 7);
}

export function monthLabel(monthId: string): string {
  const [y, m] = monthId.split('-').map((v) => parseInt(v, 10));
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function weekdayIndexOfDate(dateStr: string): number {
  return parseDateUtc(dateStr).getUTCDay(); // 0=Sun..6=Sat
}

export function daysInMonth(monthId: string): number {
  const [y, m] = monthId.split('-').map((v) => parseInt(v, 10));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

