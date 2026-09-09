'use client';

import Link from 'next/link';
import type { AdventureLevelDefinition } from '@/adventure';
import type { AdventureGameResult } from './AdventureGame';
import type { AdventureProgressSummary } from './AdventureMap';
import { useAdventureDialog } from './useAdventureDialog';
import styles from './AdventureSheets.module.css';

function Star({ active, delay = 0 }: { active: boolean; delay?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={active ? styles.starActive : styles.starInactive}
      style={{ animationDelay: `${delay}ms` }}
    >
      <path d="m12 2.4 2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.21l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.4Z" />
    </svg>
  );
}

function DifficultyPips({ difficulty }: { difficulty: AdventureLevelDefinition['difficulty'] }) {
  const count = difficulty === 'super-hard' ? 4 : difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1;
  return <span className={styles.difficultyPips}>{[1, 2, 3, 4].map((pip) => <i key={pip} className={pip <= count ? styles.pipOn : ''} />)}</span>;
}

type LevelIntroSheetProps = {
  level: AdventureLevelDefinition;
  progress?: AdventureProgressSummary[number];
  hearts: number;
  nextHeartLabel: string | null;
  protectedThroughLevel: number;
  onClose: () => void;
  onPlay: () => void;
  onOpenEnergy: () => void;
};

export function LevelIntroSheet({ level, progress, hearts, nextHeartLabel, protectedThroughLevel, onClose, onPlay, onOpenEnergy }: LevelIntroSheetProps) {
  const freeLevel = level.id <= protectedThroughLevel;
  const canPlay = freeLevel || hearts > 0;
  const dialogRef = useAdventureDialog(true, onClose);
  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="level-sheet-title"
        aria-describedby="level-sheet-description"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        data-testid="adventure-level-sheet"
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close"><span>×</span></button>
        <div className={styles.levelOrb}>
          <span>{level.id}</span>
          <div>{[1, 2, 3].map((star) => <Star key={star} active={star <= (progress?.stars ?? 0)} />)}</div>
        </div>
        <span className={styles.kicker}>LEVEL {level.id}</span>
        <h2 id="level-sheet-title">{level.title}</h2>
        <div className={styles.difficultyRow}><DifficultyPips difficulty={level.difficulty} /><strong>{level.difficulty}</strong></div>

        <div className={styles.goalPanel}>
          <div className={styles.goalIcon}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.4 2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.21l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.4Z" /></svg>
          </div>
          <div><small>GOAL</small><strong>Reach the star</strong><span id="level-sheet-description">Find the perfect route through the maze.</span></div>
        </div>

        <div className={styles.levelStats}>
          <div><small>PERFECT ROUTE</small><strong>{level.optimalMoves} moves</strong></div>
          <div><small>MOVE LIMIT</small><strong>{level.moveLimit} moves</strong></div>
          <div><small>BEST</small><strong>{progress?.bestMoves ? `${progress.bestMoves} moves` : '—'}</strong></div>
        </div>

        <div className={styles.mechanics}>
          {level.mechanics.map((mechanic) => <span key={mechanic}>{mechanic.replaceAll('_', ' ')}</span>)}
        </div>

        {canPlay ? (
          <button type="button" className={styles.primaryButton} onClick={onPlay} data-testid="adventure-play-level" data-dialog-autofocus>
            <span>{freeLevel ? 'Play free' : 'Play level'}</span>
            {!freeLevel && <span className={styles.buttonHeart}>♥</span>}
          </button>
        ) : (
          <button type="button" className={styles.primaryButton} onClick={onOpenEnergy} data-dialog-autofocus>
            <span>Get more hearts</span><span className={styles.buttonHeart}>♥</span>
          </button>
        )}
        <p className={styles.energyNote}>{freeLevel ? 'Starter levels never use hearts.' : hearts > 0 ? 'A heart is only used if you fail or leave after moving.' : `Next heart ${nextHeartLabel ?? 'is recharging'}.`}</p>
      </section>
    </div>
  );
}

export type EnergyOffer = { id: string; quantity: number; formattedPrice: string; priceId?: string };
export type AdventureSheetError = { code: string | null; message: string };

type EnergySheetProps = {
  hearts: number;
  maxHearts: number;
  nextHeartLabel: string | null;
  refillTickets: number;
  dailyRefillAvailable: boolean;
  offers: EnergyOffer[];
  purchasing: boolean;
  refilling: boolean;
  error: AdventureSheetError | null;
  onClose: () => void;
  onUseTicket: () => void;
  onUseDaily: () => void;
  onPurchase: (offer: EnergyOffer) => void;
};

export function EnergySheet({ hearts, maxHearts, nextHeartLabel, refillTickets, dailyRefillAvailable, offers, purchasing, refilling, error, onClose, onUseTicket, onUseDaily, onPurchase }: EnergySheetProps) {
  const full = hearts >= maxHearts;
  const busy = purchasing || refilling;
  const dialogRef = useAdventureDialog(true, onClose);
  return (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        className={`${styles.sheet} ${styles.energySheet}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="energy-title"
        aria-describedby="energy-description"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        data-testid="adventure-energy-sheet"
      >
        <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close"><span>×</span></button>
        <div className={styles.bigHeart}>♥<span>+</span></div>
        <span className={styles.kicker}>ADVENTURE ENERGY</span>
        <h2 id="energy-title">Keep exploring</h2>
        <p id="energy-description" className={styles.sheetLead}>Hearts recharge automatically. Winning never uses one.</p>

        {error && (
          <div className={styles.actionError} role="alert">
            <span>{error.message}</span>
            {error.code === 'AUTH_REQUIRED' && <Link href="/account">Sign in</Link>}
          </div>
        )}

        <div className={styles.heartMeter}>
          <div>{Array.from({ length: maxHearts }, (_, index) => <span key={index} className={index < hearts ? styles.meterHeartOn : styles.meterHeartOff}>♥</span>)}</div>
          <strong>{hearts}/{maxHearts}</strong>
          <small>{full ? 'Energy full' : `Next heart ${nextHeartLabel ?? 'in 30:00'}`}</small>
        </div>

        {dailyRefillAvailable && (
          <button type="button" className={styles.freeRefill} onClick={onUseDaily} disabled={full || busy}>
            <span><strong>Daily Plus refill</strong><small>Fill every heart</small></span><b>FREE</b>
          </button>
        )}

        {refillTickets > 0 && (
          <button type="button" className={styles.ticketRefill} onClick={onUseTicket} disabled={full || busy}>
            <span><strong>Use a refill ticket</strong><small>{refillTickets} available</small></span><b>USE</b>
          </button>
        )}

        <div className={styles.offerList}>
          {offers.map((offer, index) => (
            <button type="button" key={offer.id} className={styles.offer} onClick={() => onPurchase(offer)} disabled={busy}>
              {index === 1 && <span className={styles.popular}>POPULAR</span>}
              <span className={styles.ticketStack}>🎟️</span>
              <span><strong>{offer.quantity} refill{offer.quantity === 1 ? '' : 's'}</strong><small>Never expires</small></span>
              <b>{offer.formattedPrice}</b>
            </button>
          ))}
          {offers.length === 0 && <div className={styles.offersLoading}>Refill purchases are available after store setup.</div>}
        </div>
        <p className={styles.purchaseNote}>Purchases are saved to your Mazle account and shared across devices.</p>
      </section>
    </div>
  );
}

type ResultSheetProps = {
  level: AdventureLevelDefinition;
  result: AdventureGameResult;
  bestStars: number;
  heartConsumed: boolean;
  nextLevelAvailable: boolean;
  onMap: () => void;
  onReplay: () => void;
  onNext: () => void;
};

export function ResultSheet({ level, result, bestStars, heartConsumed, nextLevelAvailable, onMap, onReplay, onNext }: ResultSheetProps) {
  const won = result.completed;
  const dialogRef = useAdventureDialog(true, onMap);
  return (
    <div className={`${styles.resultBackdrop} ${won ? styles.resultWon : styles.resultLost}`}>
      <div className={styles.confetti} aria-hidden="true">✦　◆　✧　●　✦　◆　✧</div>
      <section ref={dialogRef} className={styles.resultCard} role="dialog" aria-modal="true" aria-labelledby="result-title" tabIndex={-1} data-testid="adventure-result">
        <span className={styles.resultKicker}>{won ? 'LEVEL COMPLETE' : 'SO CLOSE'}</span>
        <h2 id="result-title">{won ? level.title : 'The trail reset'}</h2>
        <div className={styles.resultStars}>
          {[1, 2, 3].map((star) => <Star key={star} active={won && star <= result.stars} delay={180 + star * 170} />)}
        </div>
        {won ? (
          <>
            <div className={styles.resultStats}>
              <div><small>MOVES</small><strong>{result.moves}</strong></div>
              <div><small>PERFECT</small><strong>{level.optimalMoves}</strong></div>
              <div><small>BEST STARS</small><strong>{Math.max(bestStars, result.stars)}/3</strong></div>
            </div>
            <p>{result.stars === 3 ? 'A perfect route. Brilliant!' : result.stars === 2 ? 'Great path—there is an even cleaner route.' : 'Trail cleared! Replay anytime to find the perfect route.'}</p>
            {nextLevelAvailable && <button type="button" className={styles.primaryButton} onClick={onNext}>Next level</button>}
            <button type="button" className={styles.secondaryButton} onClick={onReplay}>Replay for more stars</button>
          </>
        ) : (
          <>
            <div className={heartConsumed ? styles.lostHeart : styles.safeHeart}>♥<span>{heartConsumed ? '−1' : 'SAFE'}</span></div>
            <p>{heartConsumed ? 'You reached the move limit. A new route is waiting.' : 'Starter levels are heart-free. No heart was used.'}</p>
            <button type="button" className={styles.primaryButton} onClick={onReplay}>Try again</button>
          </>
        )}
        <button type="button" className={styles.mapButton} onClick={onMap}>Back to map</button>
      </section>
    </div>
  );
}
