'use client';

import React from 'react';
import { MapType, HINTS_ENABLED } from '@/game/types';
import styles from './HelpModal.module.css';
import { HELP_CONTENT } from './helpContent';
import Image from 'next/image';

interface HelpModalProps {
  onClose: () => void;
  hintsEnabled?: boolean;
}

function HelpModal({
  onClose,
  hintsEnabled = HINTS_ENABLED,
}: HelpModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeButton} onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24" className={styles.closeIcon}>
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
                {/* Phosphor Icon: Hand Swipe Right (Official) */}
                <svg viewBox="0 0 256 256" className={styles.swipeIconStatic}>
                  <path
                    d="M216,140v36c0,25.59-8.49,42.85-8.85,43.58A8,8,0,0,1,200,224a7.9,7.9,0,0,1-3.57-.85,8,8,0,0,1-3.58-10.73c.06-.12,7.16-14.81,7.16-36.42V140a12,12,0,0,0-24,0v4a8,8,0,0,1-16,0V124a12,12,0,0,0-24,0v12a8,8,0,0,1-16,0V68a12,12,0,0,0-24,0V176a8,8,0,0,1-14.79,4.23l-18.68-30-.14-.23A12,12,0,1,0,41.6,162L70.89,212A8,8,0,1,1,57.08,220l-29.32-50a28,28,0,0,1,48.41-28.17L80,148V68a28,28,0,0,1,56,0V98.7a28,28,0,0,1,38.65,16.69A28,28,0,0,1,216,140Zm37.66-89.66-32-32a8,8,0,0,0-11.31,11.32L228.68,48H176a8,8,0,0,0,0,16h52.69L210.34,82.34a8,8,0,0,0,11.31,11.32l32-32A8,8,0,0,0,253.66,50.34Z"
                    fill="currentColor"
                  />
                </svg>
              </div>
              <span className={`${styles.controlLabelKeys} ${styles.controlLabelSwipe}`}>
                {HELP_CONTENT.controls.labels.swipe}
              </span>
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
          <div className={styles.animationGridColumns}>
            <div className={styles.animationColumn}>
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
            </div>

            <div className={styles.animationColumn}>
              {/* Ledge Bounce - blocks from side */}
              <div className={styles.animationDemo}>
                <div className={styles.demoRow}>
                  <div className={styles.demoTile}>
                    <div className={styles.tileIceEx} />
                    <div className={styles.playerBumps} />
                  </div>
                  <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                  <div className={styles.demoTile}>
                    <div className={styles.tileLedgeEx}>
                      <span className={styles.ledgeArrowUp}></span>
                    </div>
                  </div>
                </div>
                <span className={styles.demoLabel}>Blocked</span>
              </div>

              {/* Ledge - one way entry only */}
              <div className={styles.animationDemo}>
                <div className={styles.demoLedgeGrid}>
                  <div className={styles.demoRow}>
                    <div className={styles.demoTile}>
                      <div className={styles.tileIceEx} />
                      <div className={styles.playerLedge} />
                    </div>
                    <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                    <div className={styles.demoTile}>
                      <div className={styles.tileLedgeEx}>
                        <span className={styles.ledgeArrowRight}></span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.demoRow}>
                    <div className={styles.demoTile} style={{ visibility: 'hidden' }} />
                    <div className={styles.demoTile} style={{ visibility: 'hidden' }} />
                    <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
                  </div>
                  <div className={styles.demoRow}>
                    <div className={styles.demoTile} style={{ visibility: 'hidden' }} />
                    <div className={styles.demoTile} style={{ visibility: 'hidden' }} />
                    <div className={styles.demoTile}><div className={styles.tileIceEx} /></div>
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

export default React.memo(HelpModal);
