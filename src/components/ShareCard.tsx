'use client';

import { useState } from 'react';
import { PuzzleData, TileType } from '@/game/types';
import { formatTime } from '@/utils/storage';
import styles from './ShareCard.module.css';

interface ShareCardProps {
  puzzleNumber: number;
  moveCount: number;
  timeMs: number;
  optimalMoves: number;
  puzzle: PuzzleData;
  onClose: () => void;
  onPlayAgain: () => void;
}

// Generate emoji minimap of the puzzle
function generateMinimap(puzzle: PuzzleData): string {
  const emojiMap: Record<number, string> = {
    [TileType.FLOOR]: '⬜',
    [TileType.WALL]: '⬛',
    [TileType.START]: '🟢',
    [TileType.GOAL]: '⭐',
    [TileType.ICE]: '🟦',
    [TileType.LEDGE_UP]: '🔽',
    [TileType.LEDGE_DOWN]: '🔼',
    [TileType.LEDGE_LEFT]: '▶️',
    [TileType.LEDGE_RIGHT]: '◀️',
  };

  // Simplified minimap (sample every 2 tiles for smaller representation)
  const rows: string[] = [];
  for (let y = 0; y < puzzle.height; y += 2) {
    let row = '';
    for (let x = 0; x < puzzle.width; x += 2) {
      const tile = puzzle.tiles[y][x];
      row += emojiMap[tile] || '⬜';
    }
    rows.push(row);
  }

  return rows.join('\n');
}

export default function ShareCard({
  puzzleNumber,
  moveCount,
  timeMs,
  optimalMoves,
  puzzle,
  onClose,
  onPlayAgain,
}: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  
  const efficiency = Math.round((optimalMoves / moveCount) * 100);
  const rating = efficiency >= 100 ? '⭐⭐⭐' : efficiency >= 80 ? '⭐⭐' : efficiency >= 60 ? '⭐' : '';

  const shareText = `Mazle #${puzzleNumber} ${rating}

🎯 Moves: ${moveCount} (optimal: ${optimalMoves})
⏱️ Time: ${formatTime(timeMs)}
📊 Efficiency: ${efficiency}%

${generateMinimap(puzzle)}

Play at mazle.vercel.app`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.error('Failed to copy');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Mazle #${puzzleNumber}`,
          text: shareText,
        });
      } catch {
        // User cancelled or error
        handleCopy();
      }
    } else {
      handleCopy();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>
          ✕
        </button>
        
        <div className={styles.header}>
          <h2 className={styles.title}>Puzzle Complete!</h2>
          <span className={styles.puzzleNumber}>Mazle #{puzzleNumber}</span>
        </div>

        <div className={styles.rating}>{rating}</div>

        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>🎯</span>
            <span className={styles.statValue}>{moveCount}</span>
            <span className={styles.statLabel}>Moves</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>⏱️</span>
            <span className={styles.statValue}>{formatTime(timeMs)}</span>
            <span className={styles.statLabel}>Time</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>📊</span>
            <span className={styles.statValue}>{efficiency}%</span>
            <span className={styles.statLabel}>Efficiency</span>
          </div>
        </div>

        <div className={styles.minimapContainer}>
          <pre className={styles.minimap}>{generateMinimap(puzzle)}</pre>
        </div>

        <div className={styles.actions}>
          <button className={styles.shareButton} onClick={handleShare}>
            {copied ? '✓ Copied!' : '📤 Share'}
          </button>
          <button className={styles.playAgainButton} onClick={onPlayAgain}>
            🔄 Play Again
          </button>
        </div>

        <p className={styles.comeback}>Come back tomorrow for a new puzzle!</p>
      </div>
    </div>
  );
}

