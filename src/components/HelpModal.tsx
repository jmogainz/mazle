'use client';

import { MapType } from '@/game/types';
import styles from './HelpModal.module.css';

interface HelpModalProps {
  onClose: () => void;
  mapType?: MapType;
}

export default function HelpModal({ onClose, mapType = MapType.ICE }: HelpModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose}>
          ✕
        </button>
        
        <h2 className={styles.title}>How to Play</h2>

        <div className={styles.goalSection}>
          <p className={styles.goalText}>
            Reach the <span className={styles.tileGoal}></span> in 10 moves or less.
          </p>
          <p className={styles.goalSubtext}>
            Miss it? You have 3 lives.
          </p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Controls</h3>
          <p className={styles.controlsText}>
            Swipe or Arrow Keys / WASD
          </p>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Tiles</h3>
          <div className={styles.animationGrid}>
            {/* Ice - slides through and disappears */}
            <div className={styles.animationDemo}>
              <div className={styles.demoRow}>
                <div className={styles.demoTile}>
                  <div className={styles.tileIceEx} />
                  <div className={styles.playerSlides} />
                </div>
                <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
              </div>
              <span className={styles.demoLabel}>Ice slides</span>
            </div>

            {/* Ground - stops on ground */}
            <div className={styles.animationDemo}>
              <div className={styles.demoRow}>
                <div className={styles.demoTile}>
                  <div className={styles.tileIceEx} />
                  <div className={styles.playerStops} />
                </div>
                <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                <div className={styles.demoTile}><div className={styles.tileFloorEx} /></div>
              </div>
              <span className={styles.demoLabel}>Ground stops</span>
            </div>

            {/* Wall - blocks in middle */}
            <div className={styles.animationDemo}>
              <div className={styles.demoRow}>
                <div className={styles.demoTile}>
                  <div className={styles.tileIceEx} />
                  <div className={styles.playerBumps} />
                </div>
                <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                <div className={styles.demoTile}><div className={styles.tileWallEx} /></div>
              </div>
              <span className={styles.demoLabel}>Wall blocks</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Hints</h3>
          <div className={styles.exampleRow}>
            <div className={styles.exampleTile}>
              <div className={styles.tileHintDark} />
            </div>
            <div className={styles.exampleTile}>
              <div className={styles.tileHintLight} />
            </div>
            <div className={styles.exampleTile}>
              <div className={styles.tileHintLight} />
            </div>
            <div className={styles.exampleTile}>
              <div className={styles.tileHintDark} />
            </div>
            <div className={styles.exampleTile}>
              <div className={styles.tileIceEx} />
            </div>
          </div>
          <p className={styles.exampleCaption}>Lost a life? Green shows correct path</p>
        </div>
      </div>
    </div>
  );
}
