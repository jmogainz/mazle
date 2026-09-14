'use client';

import Link from 'next/link';
import type { AdventureCatalog, AdventureLevelDefinition } from '@/adventure';
import styles from './AdventureMap.module.css';

export type AdventureProgressSummary = Record<number, {
  stars: number;
  bestMoves: number | null;
  bestTimeMs: number | null;
}>;

type AdventureMapProps = {
  catalog: AdventureCatalog;
  progress: AdventureProgressSummary;
  hearts: number;
  maxHearts: number;
  refillTickets: number;
  nextHeartLabel: string | null;
  onSelectLevel: (level: AdventureLevelDefinition) => void;
  onOpenEnergy: () => void;
};

const PATH_HEIGHT = 720;

function StarRow({ count, compact = false }: { count: number; compact?: boolean }) {
  return (
    <span className={`${styles.stars} ${compact ? styles.starsCompact : ''}`} aria-label={`${count} of 3 stars`}>
      {[1, 2, 3].map((star) => (
        <svg key={star} viewBox="0 0 24 24" aria-hidden="true" className={star <= count ? styles.starEarned : styles.starEmpty}>
          <path d="m12 2.4 2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.21l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.4Z" />
        </svg>
      ))}
    </span>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={filled ? styles.heartFilled : styles.heartEmpty}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l7.78-7.78a5.5 5.5 0 0 0 0-7.78Z" />
    </svg>
  );
}

export default function AdventureMap({
  catalog,
  progress,
  hearts,
  maxHearts,
  refillTickets,
  nextHeartLabel,
  onSelectLevel,
  onOpenEnergy,
}: AdventureMapProps) {
  const completedIds = new Set(Object.keys(progress).map(Number));
  let unlockedThrough = 1;
  while (unlockedThrough <= catalog.levels.length && completedIds.has(unlockedThrough)) unlockedThrough += 1;
  unlockedThrough = Math.min(catalog.levels.length, unlockedThrough);
  const earnedStars = Object.values(progress).reduce((sum, item) => sum + item.stars, 0);
  const totalStars = catalog.levels.length * 3;

  return (
    <main className={styles.screen} data-testid="adventure-map">
      <header className={styles.topBar}>
        <Link href="/" className={styles.backButton} aria-label="Back to Daily Mazle">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <div className={styles.brandBlock}>
          <span className={styles.eyebrow}>MAZLE</span>
          <h1>Adventure</h1>
        </div>
        <button type="button" className={styles.energyPill} onClick={onOpenEnergy} aria-label={`${hearts} of ${maxHearts} hearts`}>
          <span className={styles.heartStrip}>
            {Array.from({ length: maxHearts }, (_, index) => <HeartIcon key={index} filled={index < hearts} />)}
          </span>
          <span className={styles.energyMeta}>
            <strong>{hearts}/{maxHearts}</strong>
            <small>{hearts < maxHearts ? nextHeartLabel ?? 'Recharging' : refillTickets > 0 ? `${refillTickets} refills` : 'Full'}</small>
          </span>
          <span className={styles.plusBadge}>+</span>
        </button>
      </header>

      <section className={styles.hero}>
        <div className={styles.sun} aria-hidden="true" />
        <div className={`${styles.cloud} ${styles.cloudOne}`} aria-hidden="true" />
        <div className={`${styles.cloud} ${styles.cloudTwo}`} aria-hidden="true" />
        <div className={`${styles.mountain} ${styles.mountainBack}`} aria-hidden="true" />
        <div className={`${styles.mountain} ${styles.mountainFront}`} aria-hidden="true" />
        <div className={styles.heroCopy}>
          <span className={styles.chapterPill}>THE FROSTPEAK TRAIL</span>
          <h2>Every path has a perfect route.</h2>
          <p>Solve each gym, collect every star, and climb to the summit.</p>
        </div>
        <div className={styles.progressCard}>
          <div>
            <small>YOUR JOURNEY</small>
            <strong>Level {Math.min(unlockedThrough, catalog.levels.length)}</strong>
          </div>
          <div className={styles.starTotal}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.4 2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.21l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.4Z" /></svg>
            <strong>{earnedStars}</strong><span>/ {totalStars}</span>
          </div>
        </div>
      </section>

      <div className={styles.worlds}>
        {catalog.chapters.map((chapter, chapterIndex) => {
          const levels = catalog.levels.filter((level) => level.chapterId === chapter.id);
          const chapterStars = levels.reduce((sum, level) => sum + (progress[level.id]?.stars ?? 0), 0);
          const chapterComplete = levels.every((level) => completedIds.has(level.id));
          const pathPoints = levels
            .map((level) => `${level.mapPosition.x * 100},${level.mapPosition.y * PATH_HEIGHT}`)
            .join(' ');

          return (
            <section
              key={chapter.id}
              className={`${styles.chapter} ${styles[`chapterTone${(chapterIndex % 5) + 1}`]}`}
              aria-labelledby={`chapter-${chapter.id}`}
            >
              <div className={styles.chapterBackdrop} aria-hidden="true">
                <span className={styles.snowBankOne} />
                <span className={styles.snowBankTwo} />
                <span className={styles.pineOne} />
                <span className={styles.pineTwo} />
                <span className={styles.sparkles}>✦　·　✧</span>
              </div>
              <div className={styles.chapterHeading}>
                <div>
                  <span>CHAPTER {chapterIndex + 1}</span>
                  <h2 id={`chapter-${chapter.id}`}>{chapter.title}</h2>
                  <p>{chapter.subtitle}</p>
                </div>
                <div className={`${styles.chapterMedal} ${chapterComplete ? styles.chapterMedalComplete : ''}`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.4 2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.21l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.94L12 2.4Z" /></svg>
                  <span>{chapterStars}/{levels.length * 3}</span>
                </div>
              </div>

              <div className={styles.pathArea}>
                <svg className={styles.pathLine} viewBox={`0 0 100 ${PATH_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
                  <polyline points={pathPoints} />
                </svg>
                {levels.map((level) => {
                  const levelProgress = progress[level.id];
                  const unlocked = level.id <= unlockedThrough;
                  const current = unlocked && !levelProgress && level.id === unlockedThrough;
                  return (
                    <button
                      type="button"
                      key={level.id}
                      className={`${styles.levelNode} ${unlocked ? styles.levelUnlocked : styles.levelLocked} ${current ? styles.levelCurrent : ''}`}
                      style={{
                        left: `${level.mapPosition.x * 100}%`,
                        top: `${level.mapPosition.y * PATH_HEIGHT - 28}px`,
                      }}
                      onClick={() => unlocked && onSelectLevel(level)}
                      disabled={!unlocked}
                      aria-label={unlocked ? `Level ${level.id}, ${levelProgress?.stars ?? 0} stars` : `Level ${level.id}, locked`}
                      data-testid={`adventure-level-${level.id}`}
                    >
                      {current && <span className={styles.currentFlag}>PLAY</span>}
                      <span className={styles.nodeFace}>
                        {unlocked ? <strong>{level.id}</strong> : (
                          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                        )}
                      </span>
                      {levelProgress ? <StarRow count={levelProgress.stars} compact /> : <span className={styles.nodeShadow} />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
