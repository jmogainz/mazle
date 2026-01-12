'use client';

import { HINTS_ENABLED } from '@/game/types';
import styles from './HelpModal.module.css';
import { HELP_CONTENT } from './helpContent';

interface HelpModalProps {
  onClose: () => void;
  hintsEnabled?: boolean;
}

export default function HelpModal({
  onClose,
  hintsEnabled = HINTS_ENABLED,
}: HelpModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className={styles.closeIcon}>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        
        <h2 className={styles.title}>{HELP_CONTENT.title}</h2>

        <div className={styles.goalSection}>
          <div className={styles.tileGoalLarge}></div>
          <div className={styles.goalTextWrapper}>
            <p className={styles.goalText}>{HELP_CONTENT.goal.primary}</p>
            <p className={styles.goalSubtext}>{HELP_CONTENT.goal.secondary[0]}</p>
            <p className={styles.goalSubtext}>{HELP_CONTENT.goal.secondary[1]}</p>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitleCentered}>{HELP_CONTENT.controls.title}</h3>
          <div className={styles.controlsRow}>
            <div className={styles.controlOption}>
              <div className={styles.controlIcon}>
                <svg viewBox="0 0 24 24" className={styles.swipeIcon}>
                  <path d="M12 2v14m0 0l-4-4m4 4l4-4M8 22h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
              </div>
              <span className={styles.controlLabelKeys}>{HELP_CONTENT.controls.labels.swipe}</span>
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
              <span className={styles.controlLabelKeys}>{HELP_CONTENT.controls.labels.arrows}</span>
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
              <span className={styles.controlLabelKeys}>{HELP_CONTENT.controls.labels.wasd}</span>
            </div>
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitleCentered}>{HELP_CONTENT.tiles.title}</h3>
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
                <span className={styles.demoLabel}>{HELP_CONTENT.tiles.labels.ice}</span>
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
                <span className={styles.demoLabel}>{HELP_CONTENT.tiles.labels.ground}</span>
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
                <span className={styles.demoLabel}>{HELP_CONTENT.tiles.labels.wall}</span>
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
                <span className={styles.demoLabel}>{HELP_CONTENT.tiles.labels.ledge}</span>
              </div>
            </div>
          </div>
        </div>

        {hintsEnabled && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitleCentered}>{HELP_CONTENT.hints.title}</h3>
            <p className={styles.hintSubtext}>{HELP_CONTENT.hints.intro}</p>
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
            <p className={styles.exampleCaption}>{HELP_CONTENT.hints.caption}</p>
          </div>
        )}

        <button className={styles.gotItButton} onClick={onClose}>
          {HELP_CONTENT.cta}
        </button>
      </div>
    </div>
  );
}
