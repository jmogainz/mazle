'use client';

import { useState } from 'react';
import { formatTime } from '@/utils/storage';
import styles from './ShareCard.module.css';

interface ShareCardProps {
  puzzleNumber: number;
  puzzleLabel?: string;
  moveCount: number;
  timeMs: number;
  optimalMoves: number;
  onClose: () => void;
  onPlayAgain: () => void;
}

// Generate a clean efficiency bar
function generateEfficiencyBar(efficiency: number): string {
  const totalBlocks = 10;
  const filledBlocks = Math.round((Math.min(efficiency, 100) / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  
  // Use colored squares for a clean look
  const filled = '🟩';
  const empty = '⬜';
  
  return filled.repeat(filledBlocks) + empty.repeat(emptyBlocks);
}

// Fallback copy method using execCommand for older browsers
function fallbackCopyToClipboard(text: string): boolean {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  
  // Avoid scrolling to bottom
  textArea.style.top = '0';
  textArea.style.left = '0';
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch {
    success = false;
  }
  
  document.body.removeChild(textArea);
  return success;
}

export default function ShareCard({
  puzzleNumber,
  puzzleLabel,
  moveCount,
  timeMs,
  optimalMoves,
  onClose,
  onPlayAgain,
}: ShareCardProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;
  
  const efficiency = Math.round((optimalMoves / moveCount) * 100);
  const rating = efficiency >= 100 ? '⭐⭐⭐' : efficiency >= 80 ? '⭐⭐' : efficiency >= 60 ? '⭐' : '';
  
  // Calculate move difference from optimal
  const moveDiff = moveCount - optimalMoves;

  const shareText = `🧊 Mazle ${displayLabel}

${generateEfficiencyBar(efficiency)} ${efficiency}%

🎯 ${moveCount} moves${moveDiff === 0 ? ' · PERFECT!' : ` · +${moveDiff}`}
⏱️ ${formatTime(timeMs)}`;

  const handleCopy = async (): Promise<boolean> => {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(shareText);
        return true;
      } catch {
        // Fall through to fallback
      }
    }
    
    // Fallback for older browsers or when clipboard API fails
    return fallbackCopyToClipboard(shareText);
  };

  const handleShare = async () => {
    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Mazle ${displayLabel}`,
          text: shareText,
        });
        return; // Native share succeeded, no need to show copied state
      } catch (err) {
        // User cancelled or share failed - fall through to copy
        if (err instanceof Error && err.name === 'AbortError') {
          return; // User cancelled, don't copy
        }
      }
    }
    
    // Fall back to clipboard copy
    const success = await handleCopy();
    if (success) {
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2500);
    } else {
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2500);
    }
  };
  
  const getButtonText = () => {
    switch (copyState) {
      case 'copied': return '✓ Copied!';
      case 'failed': return '✗ Copy failed';
      default: return '📋 Share';
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
          <span className={styles.puzzleNumber}>Mazle {displayLabel}</span>
        </div>

        <div className={styles.rating}>{rating}</div>

        <div className={styles.efficiencySection}>
          <div className={styles.efficiencyBar}>
            {generateEfficiencyBar(efficiency)}
          </div>
          <span className={styles.efficiencyValue}>{efficiency}%</span>
        </div>

        <div className={styles.statsRow}>
          <div className={styles.statItem}>
            <span className={styles.statValue}>{moveCount}</span>
            <span className={styles.statLabel}>moves{moveDiff === 0 ? '' : ` (+${moveDiff})`}</span>
          </div>
          <div className={styles.statDivider} />
          <div className={styles.statItem}>
            <span className={styles.statValue}>{formatTime(timeMs)}</span>
            <span className={styles.statLabel}>time</span>
          </div>
        </div>

        <div className={styles.actions}>
          <button 
            className={`${styles.shareButton} ${copyState === 'copied' ? styles.copied : ''} ${copyState === 'failed' ? styles.failed : ''}`} 
            onClick={handleShare}
          >
            {getButtonText()}
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
