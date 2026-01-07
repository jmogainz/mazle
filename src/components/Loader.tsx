import styles from './Loader.module.css';

interface LoaderProps {
  text?: string;
  progress?: number;
}

export default function Loader({ text = "Loading...", progress }: LoaderProps) {
  return (
    <div className={styles.container}>
      <div className={styles.mazeGrid}>
        {/* Row 1 */}
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />
        
        {/* Row 2 */}
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.goal}`} /> {/* Center Goal */}
        <div className={`${styles.tile} ${styles.floor}`} />
        
        {/* Row 3 */}
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />

        {/* Moving Player */}
        <div className={styles.player} />
      </div>
      
      <div className={styles.progressStack}>
        <p className={styles.text}>{text}</p>
        
        {/* Always render progress bar container to prevent layout shift */}
        <div
          className={styles.progressBar}
          style={{
          opacity: progress !== undefined ? 1 : 0,
          transition: 'opacity 0.2s ease-out',
          }}
        >
          <div
            className={styles.progressFill}
            style={{
              width: `${Math.min(100, Math.max(0, progress ?? 0))}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/*
UI overhaul variant (preserved):

import React from 'react';
import styles from './Loader.module.css';

function Loader({ text = "Loading...", progress }: LoaderProps) {
  return (
    <div className={styles.container}>
      ...
      {progress !== undefined && (
        <div style={{ width: '120px', height: '4px', background: 'var(--color-surface)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${Math.min(100, Math.max(0, progress))}%`, height: '100%', background: 'var(--color-primary)', transition: 'width 0.3s ease-out' }} />
        </div>
      )}
    </div>
  );
}

export default React.memo(Loader);
*/
