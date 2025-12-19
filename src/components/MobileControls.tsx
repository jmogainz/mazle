'use client';

import styles from './MobileControls.module.css';

interface MobileControlsProps {
  showResults?: boolean;
  onShowResults?: () => void;
}

export default function MobileControls({ showResults, onShowResults }: MobileControlsProps) {
  if (showResults) {
    return (
      <div className={styles.container}>
        <button 
          className={styles.resultsButton}
          onClick={onShowResults}
        >
          Share Score
        </button>
      </div>
    );
  }

  return (
    <div className={styles.container} aria-hidden="true">
      <div className={styles.placeholder} />
    </div>
  );
}
