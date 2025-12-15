'use client';

import { useState } from 'react';
import { MapType } from '@/game/types';
import { formatTime } from '@/utils/storage';
import styles from './ShareCard.module.css';

interface ShareCardProps {
  puzzleNumber: number;
  puzzleLabel?: string;
  moveCount: number;
  timeMs: number;
  optimalMoves: number;
  failed?: boolean;
  attempts?: any[]; // Keep flexible for now
  mapType?: MapType;
  onClose: () => void;
  inline?: boolean;
}

// Get emoji for map type
function getMapEmoji(mapType: MapType): string {
  switch (mapType) {
    case MapType.ICE:
      return '🧊';
    case MapType.GROUND:
      return '🟤';
    default:
      return '🧩';
  }
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
  failed = false,
  attempts = [],
  mapType = MapType.ICE,
  onClose,
  inline = false,
}: ShareCardProps) {
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const displayLabel = puzzleLabel ?? `#${puzzleNumber}`;
  const mapEmoji = getMapEmoji(mapType);
  const maxBlocks = Math.max(optimalMoves, 1);
  
  // Calculate best attempt for failed runs (using correctMoves if available)
  const bestAttempt = attempts && attempts.length > 0 
    ? Math.max(...attempts.map(a => {
        // Prefer correctMoves (new system), fall back to deviationIndex (legacy)
        if (a.correctMoves !== undefined) {
            return a.correctMoves;
        }
        if (a.deviationIndex !== undefined && a.deviationIndex !== -1) {
            return Math.max(0, a.deviationIndex - 1);
        }
        return a.moveCount;
    })) 
    : 0;

  // Generate progress blocks - one row per attempt/life
  const generateProgressBlocks = (): string => {
    const getAttemptProgress = (attempt: any): number => {
      // Prefer correctMoves (new system), fall back to deviationIndex (legacy)
      if (attempt.correctMoves !== undefined) {
        return attempt.correctMoves;
      }
      if (attempt.deviationIndex !== undefined && attempt.deviationIndex !== -1) {
        return Math.max(0, attempt.deviationIndex - 1);
      }
      return attempt.moveCount;
    };

    if (failed) {
      // Show each attempt as a separate row
      const rows: string[] = [];
      
      for (let i = 0; i < attempts.length; i++) {
        const progress = getAttemptProgress(attempts[i]);
        
        const filledBlocks = Math.min(progress, optimalMoves - 1);
        const remainingBlocks = optimalMoves - filledBlocks - 1;
        rows.push('🟥'.repeat(filledBlocks) + '💀' + '⬛'.repeat(remainingBlocks));
      }
      
      // Always show 3 rows for failed attempts
      while (rows.length < 3) {
        rows.push('⬛'.repeat(optimalMoves));
      }
      
      return rows.join('\n');
    } else {
      // Success: show each attempt as a row
      const rows: string[] = [];
      
      // Add rows for failed attempts (only if there were any)
      for (let i = 0; i < attempts.length; i++) {
        const progress = getAttemptProgress(attempts[i]);
        
        const filledBlocks = Math.min(progress, optimalMoves - 1);
        const remainingBlocks = optimalMoves - filledBlocks - 1;
        rows.push('🟥'.repeat(filledBlocks) + '💀' + '⬛'.repeat(remainingBlocks));
      }
      
      // Final successful attempt (always present)
      rows.push('🟩'.repeat(optimalMoves) + '🏆');
      
      return rows.join('\n');
    }
  };

  const shareText = failed
    ? `${mapEmoji} Mazle ${displayLabel}

${generateProgressBlocks()}
⏱️ ${formatTime(timeMs)}`
    : `${mapEmoji} Mazle ${displayLabel}

${generateProgressBlocks()}
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
    // Only use native share on mobile - desktop share sheets are limited to Apple apps
    const isMobileDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    if (isMobileDevice && navigator.share) {
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
    
    // Fall back to clipboard copy (for desktop or if native share fails)
    const success = await handleCopy();
    if (success) {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2500);
    } else {
      setShareState('failed');
      setTimeout(() => setShareState('idle'), 2500);
    }
  };

  const getCopyButtonText = () => {
    switch (copyState) {
      case 'copied': return 'Copied!';
      case 'failed': return 'Failed';
      default: return 'Copy';
    }
  };

  const getShareButtonText = () => {
    switch (shareState) {
      case 'copied': return 'Copied!';
      case 'failed': return 'Failed';
      default: return 'Share';
    }
  };

  // Single button - behavior changes based on device
  const showSeparateCopyButton = false;

  const calcProgress = (attempt: any) => {
    if (!attempt) return 0;
    // Prefer correctMoves (new system), fall back to deviationIndex (legacy)
    if (attempt.correctMoves !== undefined) {
      return attempt.correctMoves;
    }
    if (attempt.deviationIndex !== undefined && attempt.deviationIndex !== -1) {
      return Math.max(0, attempt.deviationIndex - 1);
    }
    return attempt.moveCount ?? 0;
  };

  const attemptBars = () => {
    const rows: { progress: number; status: 'fail' | 'success' | 'empty' }[] = [];

    attempts.forEach((attempt: any) => {
      rows.push({ progress: Math.min(calcProgress(attempt), maxBlocks), status: 'fail' });
    });

    if (!failed) {
      rows.push({ progress: Math.min(moveCount, maxBlocks), status: 'success' });
    }

    while (rows.length < 3) {
      rows.push({ progress: 0, status: 'empty' });
    }

    return rows.slice(0, 3);
  };

  const bars = attemptBars();

  return (
    <div className={inline ? styles.inlineContainer : styles.overlay} onClick={!inline ? onClose : undefined}>
      <div className={`${styles.card} ${failed ? styles.cardFailed : styles.cardSuccess} ${inline ? styles.cardInline : ''}`} onClick={(e) => e.stopPropagation()}>
        {!inline && (
            <button className={styles.closeButton} onClick={onClose}>
            ✕
            </button>
        )}
        
        <div className={styles.header}>
          <h2 className={styles.title}>{failed ? '💀 Game Over' : '🏆 Victory!'}</h2>
          <span className={styles.puzzleNumber}>{mapEmoji} Mazle {displayLabel}</span>
        </div>

        <div className={styles.mainStat}>
            <span className={styles.mainStatValue}>{formatTime(timeMs)}</span>
            <span className={styles.mainStatLabel}>TOTAL TIME</span>
        </div>

        {failed && (
            <div className={styles.subStat}>
                <span>Best Attempt: {bestAttempt}/{optimalMoves} moves</span>
            </div>
        )}

        <div className={styles.progressSection}>
          <div className={styles.progressHeader}>Attempts</div>
          <div className={styles.progressList}>
            {bars.map((bar, idx) => (
              <div className={styles.progressRow} key={idx}>
                <span className={styles.progressLabel}>
                  {bar.status === 'success' ? 'Win' : `${idx + 1}`}
                </span>
                <div className={styles.progressBar}>
                  <div
                    className={`
                      ${styles.progressFill}
                      ${bar.status === 'success' ? styles.progressFillSuccess : ''}
                      ${bar.status === 'fail' ? styles.progressFillFail : ''}
                      ${bar.status === 'empty' ? styles.progressFillEmpty : ''}
                    `}
                    style={{ width: `${Math.max(0, Math.min((bar.progress / maxBlocks) * 100, 100))}%` }}
                  />
                </div>
                <span className={styles.progressValue}>
                  {bar.progress}/{optimalMoves}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.actions}>
          <button 
            className={`${styles.shareButton} ${shareState === 'copied' ? styles.copied : ''} ${shareState === 'failed' ? styles.failed : ''}`} 
            onClick={handleShare}
          >
            {getShareButtonText()}
          </button>
          {showSeparateCopyButton && (
            <button 
              className={`${styles.copyButton} ${copyState === 'copied' ? styles.copied : ''} ${copyState === 'failed' ? styles.failed : ''}`} 
              onClick={async () => {
                const success = await handleCopy();
                if (success) {
                  setCopyState('copied');
                  setTimeout(() => setCopyState('idle'), 2500);
                } else {
                  setCopyState('failed');
                  setTimeout(() => setCopyState('idle'), 2500);
                }
              }}
            >
              {getCopyButtonText()}
            </button>
          )}
        </div>

        <p className={styles.comeback}>Come back tomorrow for a new puzzle!</p>
      </div>
    </div>
  );
}
