import { PlayerStats, DailyStats, PuzzleData, TileType } from '@/game/types';

const STATS_KEY = 'mazle_stats';
const DAILY_KEY = 'mazle_daily';
const PUZZLE_CACHE_KEY = 'mazle_puzzle_cache_v1';

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

// Get player stats from localStorage
export function getPlayerStats(): PlayerStats {
  if (typeof window === 'undefined') return getDefaultStats();
  
  try {
    const stored = localStorage.getItem(STATS_KEY);
    if (stored) {
      return JSON.parse(stored) as PlayerStats;
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

// Get today's date string
function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
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
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
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
    stats.history.push(result);
    
    // Keep only last 30 days of history
    if (stats.history.length > 30) {
      stats.history = stats.history.slice(-30);
    }
    
    savePlayerStats(stats);
  } catch {
    console.error('Failed to save daily result');
  }
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
  if (typeof firstTile !== 'number' || firstTile < TileType.FLOOR || firstTile > TileType.LEDGE_RIGHT) {
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
