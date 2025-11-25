import { formatDuration } from './format';
import { Puzzle, TileType } from './types';

const tileEmoji: Record<TileType, string> = {
  [TileType.Floor]: '▫️',
  [TileType.Wall]: '⬛️',
  [TileType.Start]: '🚩',
  [TileType.Goal]: '⭐️',
  [TileType.Ice]: '🧊',
  [TileType.Ledge]: '🔽',
};

export function miniMap(puzzle: Puzzle) {
  return puzzle.tiles
    .map((row) => row.map((tile) => tileEmoji[tile] || '▫️').join(''))
    .join('\n');
}

export function buildShareCard(options: {
  puzzle: Puzzle;
  moves: number;
  durationMs: number;
  won: boolean;
}) {
  const { puzzle, moves, durationMs, won } = options;
  const headline = `Mazle #${puzzle.number} ${won ? `${moves}M · ${formatDuration(durationMs)}` : 'DNF'}`;
  const footer = 'mazle (alpha)';
  return `${headline}\n${miniMap(puzzle)}\n${footer}`;
}
