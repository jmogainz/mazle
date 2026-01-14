import { PlayerStats, DailyStats, PuzzleData, TileType, Position } from '@/game/types';
import { addDays } from '@/lib/date';
import { getPuzzleNumberFromNyDateString } from '@/game/puzzleGenerator';

const STATS_KEY = 'mazle_stats';
const DAILY_KEY = 'mazle_daily';
const PUZZLE_CACHE_KEY = 'mazle_puzzle_cache_v1';
const IN_PROGRESS_KEY = 'mazle_in_progress_v1';
const DEV_STATS_SEEDED_KEY = 'mazle_dev_seeded_stats_v1';

// In-progress game state for resume after refresh
export interface InProgressState {
  date: string;                    // For validating same-day
  seed: string;                    // For validating same puzzle
  playerPos: Position;
  lives: number;
  currentAttemptMoves: number;
  currentAttemptCorrectMoves: number;
  moveCount: number;
  elapsedTimeMs: number;           // Frozen time at save
  penaltyTimeMs: number;
  attempts: {
    moveCount: number;
    correctMoves: number;
    path: Position[];
    failedAt?: Position;
    deviationIndex?: number;
  }[];
  moveHistory: Position[];
  boulderPositions?: string[];     // Legacy field for backward compatibility
  isPlaying: boolean;
  // Hint state
  unlockedHintTiles?: string[];
  unlockedHintEdges?: string[];
  // Per-life hint progress (used to merge into unlockedHint* on life loss)
  unlockedThisLifeTiles?: string[];
  unlockedThisLifeEdges?: string[];
}


// Get default player stats
function getDefaultStats(): PlayerStats {
  return {
    currentStreak: 0,
    maxStreak: 0,
    totalGamesPlayed: 0,
    totalGamesWon: 0,
    lastPlayedDate: null,
    history: [],
  };
}

function isUiDevEnv(): boolean {
  return process.env.NEXT_PUBLIC_ENV === 'dev';
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function devRandomInt(min: number, max: number): number {
  return clampInt(min + Math.random() * (max - min + 1), min, max);
}

function seedDevStatsIfNeeded(): void {
  if (typeof window === 'undefined') return;
  if (!isUiDevEnv()) return;

  try {
    if (localStorage.getItem(DEV_STATS_SEEDED_KEY) === '1') return;

    const existing = localStorage.getItem(STATS_KEY);
    if (existing) {
      const parsed = JSON.parse(existing) as PlayerStats;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.history) && parsed.history.length >= 20) {
        localStorage.setItem(DEV_STATS_SEEDED_KEY, '1');
        return;
      }
    }
  } catch {
    // Ignore seed pre-check failures
  }

  const today = getTodayString();
  const yesterday = addDays(today, -1);

  const history: DailyStats[] = [];
  for (let i = 0; i < 20; i += 1) {
    const date = addDays(yesterday, -i);
    const puzzleNumber = getPuzzleNumberFromNyDateString(date);

    const isStreakDay = i < 5;
    const completed = isStreakDay ? true : Math.random() < 0.72;
    const attemptsUsed = completed ? devRandomInt(1, 3) : undefined;
    const timeMs = completed ? devRandomInt(32_000, 210_000) : devRandomInt(18_000, 260_000);
    const moveCount = completed ? devRandomInt(8, 18) : devRandomInt(8, 26);
    const failed = !completed;

    const leaderboardRank = completed && Math.random() < 0.35 ? devRandomInt(1, 120) : undefined;

    history.push({
      date,
      completed,
      failed,
      attemptsUsed: completed ? attemptsUsed : undefined,
      timeMs,
      moveCount,
      puzzleNumber,
      leaderboardRank,
    });
  }

  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const totalGamesPlayed = history.length;
  const totalGamesWon = history.filter((h) => h.completed).length;
  const currentStreak = 5;
  const maxStreak = Math.max(currentStreak, devRandomInt(6, 12));

  const seeded: PlayerStats = {
    currentStreak,
    maxStreak,
    totalGamesPlayed,
    totalGamesWon,
    lastPlayedDate: yesterday,
    history,
  };

  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(seeded));
    localStorage.setItem(DEV_STATS_SEEDED_KEY, '1');
  } catch {
    // Ignore seed write failures
  }
}

// Get player stats from localStorage
export function getPlayerStats(): PlayerStats {
  if (typeof window === 'undefined') return getDefaultStats();

  seedDevStatsIfNeeded();

  try {
    const stored = localStorage.getItem(STATS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as PlayerStats;
      if (!parsed || typeof parsed !== 'object') return getDefaultStats();
      if (!Array.isArray(parsed.history)) {
        const next: PlayerStats = { ...getDefaultStats(), ...parsed, history: [] };
        savePlayerStats(next);
        return next;
      }

      // Sanitize legacy entries that stored full attempt paths in history (can get large).
      // Keep the daily result fields, but drop attempts payloads (keep attemptsUsed count).
      let changed = false;
      const sanitizedHistory: DailyStats[] = [];
      for (const raw of parsed.history) {
        if (!raw || typeof raw !== 'object') continue;
        const entry = raw as DailyStats & { attempts?: unknown[] };
        const { attempts, ...rest } = entry as any;
        // Compute attemptsUsed from attempts array if not already set
        if (rest.attemptsUsed === undefined && Array.isArray(attempts)) {
          rest.attemptsUsed = Math.min(3, Math.max(1, attempts.length + 1));
          changed = true;
        }
        if (attempts != null) changed = true;
        sanitizedHistory.push(rest as DailyStats);
      }

      if (changed) {
        const next: PlayerStats = { ...parsed, history: sanitizedHistory };
        savePlayerStats(next);
        return next;
      }

      return parsed;
    }
  } catch {
    console.error('Failed to load stats');
  }

  return getDefaultStats();
}

// Save player stats to localStorage
export function savePlayerStats(stats: PlayerStats): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    console.error('Failed to save stats');
  }
}

// Get today's date string in New York timezone
// This ensures daily puzzle tracking matches the puzzle rollover time
function getTodayString(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function sortByDateAsc<T extends { date: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function recomputeStatsFromHistory(history: DailyStats[]): PlayerStats {
  const sorted = sortByDateAsc(history);
  const totalGamesPlayed = sorted.length;
  const totalGamesWon = sorted.filter((h) => h.completed).length;
  const lastPlayedDate = sorted.length > 0 ? sorted[sorted.length - 1]!.date : null;

  // Max streak over all time.
  let maxStreak = 0;
  let currentRun = 0;
  let prevWinDate: string | null = null;
  for (const entry of sorted) {
    if (entry.completed) {
      if (prevWinDate && entry.date === addDays(prevWinDate, 1)) {
        currentRun += 1;
      } else {
        currentRun = 1;
      }
      prevWinDate = entry.date;
      maxStreak = Math.max(maxStreak, currentRun);
    } else {
      currentRun = 0;
      prevWinDate = null;
    }
  }

  // Current streak (wins only), only if last played is today or yesterday.
  const today = getTodayString();
  const yesterday = addDays(today, -1);
  let currentStreak = 0;
  if (lastPlayedDate === today || lastPlayedDate === yesterday) {
    // Walk backwards in date order and count consecutive wins.
    const desc = [...sorted].reverse();
    for (let i = 0; i < desc.length; i += 1) {
      const row = desc[i]!;
      if (!row.completed) break;
      if (i === 0) {
        currentStreak = 1;
        continue;
      }
      const prev = desc[i - 1]!;
      if (row.date !== addDays(prev.date, -1)) break;
      currentStreak += 1;
    }
  }

  return {
    currentStreak,
    maxStreak,
    totalGamesPlayed,
    totalGamesWon,
    lastPlayedDate,
    history: sorted,
  };
}

export function setTodaysResultForDev(result: DailyStats | null): void {
  if (typeof window === 'undefined') return;
  if (!isUiDevEnv()) return;

  try {
    if (result == null) {
      localStorage.removeItem(DAILY_KEY);
    } else {
      localStorage.setItem(DAILY_KEY, JSON.stringify(result));
    }
  } catch {
    // ignore
  }

  try {
    const stats = getPlayerStats();
    const today = getTodayString();

    const filtered = stats.history.filter((h) => h.date !== today);
    const nextHistory = result ? [...filtered, result] : filtered;
    const nextStats = recomputeStatsFromHistory(nextHistory);
    savePlayerStats(nextStats);
  } catch {
    // ignore
  }

  try {
    localStorage.setItem(DEV_STATS_SEEDED_KEY, '1');
  } catch {
    // ignore
  }
}

// Check if player has played today
export function hasPlayedToday(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const stored = localStorage.getItem(DAILY_KEY);
    if (stored) {
      const daily = JSON.parse(stored);
      return daily.date === getTodayString();
    }
  } catch {
    console.error('Failed to check daily status');
  }

  return false;
}

// Get today's result if already played
export function getTodaysResult(): DailyStats | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(DAILY_KEY);
    if (stored) {
      const daily = JSON.parse(stored);
      if (daily.date === getTodayString()) {
        return daily as DailyStats;
      }
    }
  } catch {
    console.error('Failed to get daily result');
  }

  return null;
}

// Save today's result
export function saveTodaysResult(result: DailyStats): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(result));

    // Update overall stats
    const stats = getPlayerStats();
    const today = getTodayString();
    const yesterday = addDays(today, -1);

    const alreadyRecorded = stats.history.some((h) => h.date === today);
    if (alreadyRecorded) {
      return;
    }

    stats.totalGamesPlayed++;

    if (result.completed) {
      stats.totalGamesWon++;

      // Update streak
      if (stats.lastPlayedDate === yesterday || stats.lastPlayedDate === today) {
        if (stats.lastPlayedDate !== today) {
          stats.currentStreak++;
        }
      } else {
        stats.currentStreak = 1;
      }

      stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
    } else {
      stats.currentStreak = 0;
    }

    stats.lastPlayedDate = today;
    const { attempts, ...rest } = result as any;
    stats.history.push(rest as DailyStats);

    if (stats.history.length > 2000) {
      stats.history = stats.history.slice(-2000);
    }

    savePlayerStats(stats);
  } catch {
    console.error('Failed to save daily result');
  }
}

export function recordLeaderboardRank(date: string, rank: number): void {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(rank) || rank < 1) return;
  const normalizedRank = Math.floor(rank);

  try {
    const stored = localStorage.getItem(DAILY_KEY);
    if (stored) {
      const daily = JSON.parse(stored) as DailyStats;
      if (daily?.date === date) {
        const next: DailyStats = { ...daily, leaderboardRank: normalizedRank };
        localStorage.setItem(DAILY_KEY, JSON.stringify(next));
      }
    }
  } catch {
    // Ignore localStorage update failures
  }

  try {
    const stats = getPlayerStats();
    let changed = false;
    for (const entry of stats.history) {
      if (entry.date !== date) continue;
      if (entry.leaderboardRank !== normalizedRank) {
        entry.leaderboardRank = normalizedRank;
        changed = true;
      }
      break;
    }
    if (changed) savePlayerStats(stats);
  } catch {
    // Ignore localStorage update failures
  }
}

export function getGuestHistoryForAccountImport(): Array<{
  date: string;
  completed: boolean;
  timeMs: number | null;
  attemptsUsed: number | null;
}> {
  const stats = getPlayerStats();
  const byDate = new Map<string, DailyStats>();
  for (const entry of stats.history) {
    if (!entry?.date || typeof entry.date !== 'string') continue;
    if (!byDate.has(entry.date)) {
      byDate.set(entry.date, entry);
    }
  }

  const today = getTodayString();
  const todayResult = getTodaysResult();
  if (todayResult && todayResult.date === today) {
    byDate.set(today, todayResult);
  }

  const rows = Array.from(byDate.values());
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return rows.map((r) => {
    const completed = !!r.completed;
    const timeMs = completed && typeof r.timeMs === 'number' && Number.isFinite(r.timeMs) && r.timeMs > 0 ? Math.round(r.timeMs) : null;
    const attemptsUsed = (() => {
      const rawAttempts = (r as any).attempts;
      if (!completed || !Array.isArray(rawAttempts)) return null;
      const failedAttempts = rawAttempts.length ?? 0;
      return Math.min(3, Math.max(1, failedAttempts + 1));
    })();

    return {
      date: r.date,
      completed,
      timeMs,
      attemptsUsed,
    };
  });
}

// Format time for display (mm:ss)
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// Format time with milliseconds (mm:ss.mmm)
export function formatTimeDetailed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(millis / 100)}`;
}

interface CachedPuzzle {
  seed: string;
  puzzle: PuzzleData;
  generatedAt: number;
}

function isPuzzleData(value: unknown): value is PuzzleData {
  if (!value || typeof value !== 'object') return false;
  const puzzle = value as PuzzleData;
  if (typeof puzzle.width !== 'number' || typeof puzzle.height !== 'number') return false;
  if (!Array.isArray(puzzle.tiles) || puzzle.tiles.length === 0) return false;
  if (typeof puzzle.start?.x !== 'number' || typeof puzzle.start?.y !== 'number') return false;
  if (typeof puzzle.goal?.x !== 'number' || typeof puzzle.goal?.y !== 'number') return false;

  // Spot check a tile to make sure it looks like serialized enum values
  const firstRow = puzzle.tiles[0];
  if (!Array.isArray(firstRow) || firstRow.length === 0) return false;
  const firstTile = firstRow[0];
  if (typeof firstTile !== 'number' || firstTile < TileType.GROUND || firstTile > TileType.LEDGE_RIGHT) {
    return false;
  }

  return true;
}

// Get cached puzzle if it matches the seed
export function getCachedPuzzle(seed: string): PuzzleData | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(PUZZLE_CACHE_KEY);
    if (!stored) return null;

    const cached = JSON.parse(stored) as CachedPuzzle;
    if (cached.seed !== seed) {
      return null;
    }

    if (!isPuzzleData(cached.puzzle)) {
      // Corrupted cache, clear it so we don't keep returning bad data
      localStorage.removeItem(PUZZLE_CACHE_KEY);
      return null;
    }

    return cached.puzzle;
  } catch (error) {
    console.error('Failed to load cached puzzle', error);
    return null;
  }
}

// Save puzzle to cache (overwrites previous seed)
export function cachePuzzle(seed: string, puzzle: PuzzleData): void {
  if (typeof window === 'undefined') return;

  try {
    const cached: CachedPuzzle = {
      seed,
      puzzle,
      generatedAt: Date.now(),
    };
    localStorage.setItem(PUZZLE_CACHE_KEY, JSON.stringify(cached));
  } catch (error) {
    console.error('Failed to cache puzzle', error);
  }
}

// Save in-progress game state for resume after refresh
export function saveInProgressState(seed: string, state: Omit<InProgressState, 'date' | 'seed'>): void {
  if (typeof window === 'undefined') return;

  try {
    const fullState: InProgressState = {
      ...state,
      date: getTodayString(),
      seed,
    };
    localStorage.setItem(IN_PROGRESS_KEY, JSON.stringify(fullState));
  } catch (error) {
    console.error('Failed to save in-progress state', error);
  }
}

// Get in-progress game state if it matches today's date and seed
export function getInProgressState(seed: string): InProgressState | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = localStorage.getItem(IN_PROGRESS_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as InProgressState;

    // Validate it's for today and the same puzzle
    if (state.date !== getTodayString() || state.seed !== seed) {
      // Stale state, clear it
      localStorage.removeItem(IN_PROGRESS_KEY);
      return null;
    }

    // Basic validation
    if (typeof state.playerPos?.x !== 'number' || typeof state.playerPos?.y !== 'number') {
      localStorage.removeItem(IN_PROGRESS_KEY);
      return null;
    }

    return state;
  } catch (error) {
    console.error('Failed to get in-progress state', error);
    return null;
  }
}

// Clear in-progress state (called on game complete)
export function clearInProgressState(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(IN_PROGRESS_KEY);
  } catch (error) {
    console.error('Failed to clear in-progress state', error);
  }
}
