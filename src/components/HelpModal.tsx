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
          <div className={styles.tileGoalLarge}></div>
          <div className={styles.goalTextWrapper}>
            <p className={styles.goalText}>Reach the star in 10 moves.</p>
            <p className={styles.goalSubtext}>Solve as fast as you can!</p>
            <p className={styles.goalSubtext}>3 Lives. Losing a life adds a time penalty!</p>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitleCentered}>Controls</h3>
          <div className={styles.controlsRow}>
            <div className={styles.controlOption}>
              <div className={styles.controlIcon}>👆</div>
              <span className={styles.controlLabelKeys}>Swipe</span>
            </div>
            <div className={styles.controlOption}>
              <div className={styles.controlKeys}>
                <span className={styles.keySmall}><span className={styles.arrowUp}></span></span>
                <div className={styles.keyRow}>
                  <span className={styles.keySmall}><span className={styles.arrowLeft}></span></span>
                  <span className={styles.keySmall}><span className={styles.arrowDown}></span></span>
                  <span className={styles.keySmall}><span className={styles.arrowRight}></span></span>
                </div>
              </div>
              <span className={styles.controlLabelKeys}>Arrow Keys</span>
            </div>
            <div className={styles.controlOption}>
              <div className={styles.controlKeys}>
                <span className={styles.keySmall}>W</span>
                <div className={styles.keyRow}>
                  <span className={styles.keySmall}>A</span>
                  <span className={styles.keySmall}>S</span>
                  <span className={styles.keySmall}>D</span>
                </div>
              </div>
              <span className={styles.controlLabelKeys}>WASD</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitleCentered}>Tiles</h3>
          <div className={styles.animationGridTwoRows}>
            <div className={styles.animationRow}>
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
            </div>

            <div className={styles.animationRow}>
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

              {/* Ledge - one way entry only */}
              <div className={styles.animationDemo}>
                <div className={styles.demoRow}>
                  <div className={styles.demoTile}>
                    <div className={styles.tileFloorEx} />
                    <div className={styles.playerLedge} />
                  </div>
                  <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                  <div className={styles.demoTile}>
                    <div className={styles.tileLedgeEx}>
                      <span className={styles.ledgeArrowRight}></span>
                      <span className={styles.ledgeArrowDown}></span>
                    </div>
                  </div>
                </div>
                <span className={styles.demoLabel}>One-way in, any out</span>
              </div>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitleCentered}>Hints</h3>
          <p className={styles.hintSubtext}>After you lose a life:</p>
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
          <p className={styles.exampleCaption}>Correct moves from previous attempts turn green</p>
        </div>

        <button className={styles.gotItButton} onClick={onClose}>
          Got it!
        </button>
      </div>
    </div>
  );
}
