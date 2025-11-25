'use client';

import styles from './HelpModal.module.css';

interface HelpModalProps {
  onClose: () => void;
}

export default function HelpModal({ onClose }: HelpModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>
          ✕
        </button>
        
        <h2 className={styles.title}>How to Play</h2>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Goal</h3>
          <p className={styles.text}>
            Navigate from the start <span className={styles.start}>●</span> to the goal <span className={styles.goal}>★</span> in as few moves as possible.
          </p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Controls</h3>
          <div className={styles.controls}>
            <div className={styles.controlItem}>
              <span className={styles.keys}>↑ ↓ ← →</span>
              <span className={styles.controlLabel}>Arrow keys</span>
            </div>
            <div className={styles.controlItem}>
              <span className={styles.keys}>W A S D</span>
              <span className={styles.controlLabel}>WASD keys</span>
            </div>
            <div className={styles.controlItem}>
              <span className={styles.swipe}>👆</span>
              <span className={styles.controlLabel}>Swipe on mobile</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Tiles</h3>
          <div className={styles.tiles}>
            <div className={styles.tileItem}>
              <div className={styles.tileFloor} />
              <span>Floor - Normal movement</span>
            </div>
            <div className={styles.tileItem}>
              <div className={styles.tileWall} />
              <span>Wall - Blocks movement</span>
            </div>
            <div className={styles.tileItem}>
              <div className={styles.tileIce} />
              <span>Ice - Slide until hitting a wall</span>
            </div>
            <div className={styles.tileItem}>
              <div className={styles.tileLedge}>▼</div>
              <span>Ledge - One-way only</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Daily Challenge</h3>
          <p className={styles.text}>
            A new puzzle is available each day. Complete it to build your streak!
          </p>
        </div>
      </div>
    </div>
  );
}

