import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'How to Play Mazle - Daily Puzzle Game Guide',
  description: 'Learn how to play Mazle, the daily puzzle game inspired by Pokémon ice gym puzzles. Master ice sliding, ledges, and strategic movement to solve puzzles in optimal moves.',
  keywords: ['mazle tutorial', 'how to play mazle', 'puzzle game guide', 'ice puzzle game', 'daily puzzle help'],
  alternates: {
    canonical: 'https://mazle.io/how-to-play',
  },
  openGraph: {
    title: 'How to Play Mazle - Daily Puzzle Game Guide',
    description: 'Learn how to play Mazle, the daily puzzle game inspired by Pokémon ice gym puzzles. Master ice sliding, ledges, and strategic movement.',
    url: 'https://mazle.io/how-to-play',
    siteName: 'Mazle',
    type: 'article',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How to Play Mazle',
    description: 'Learn to master the daily ice puzzle game',
  },
};

export default function HowToPlay() {
  return (
    <main className={styles.main}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'How to Play Mazle',
            description: 'A step-by-step guide to playing Mazle, the daily puzzle game.',
            step: [
              {
                '@type': 'HowToStep',
                position: 1,
                name: 'Understand the Goal',
                text: 'Navigate your character to the star (goal) in exactly 10 moves. You have 3 lives to complete the puzzle.',
              },
              {
                '@type': 'HowToStep',
                position: 2,
                name: 'Learn the Controls',
                text: 'Use arrow keys, WASD, or swipe gestures to move your character in four directions.',
              },
              {
                '@type': 'HowToStep',
                position: 3,
                name: 'Master Ice Tiles',
                text: 'On ice tiles, you slide until hitting a wall, obstacle, or ground tile. Plan your slides carefully.',
              },
              {
                '@type': 'HowToStep',
                position: 4,
                name: 'Use Ledges Strategically',
                text: 'Ledges are one-way entrances - you can step onto them from any direction but can only exit in specific ways.',
              },
              {
                '@type': 'HowToStep',
                position: 5,
                name: 'Solve Optimally',
                text: 'Find the optimal path. Any wrong move costs a life. After losing a life, hints show which moves were correct.',
              },
            ],
          }),
        }}
      />
      
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Mazle</Link>
        <span aria-hidden="true">›</span>
        <span>How to Play</span>
      </nav>

      <article className={styles.article}>
        <header>
          <h1 className={styles.title}>How to Play Mazle</h1>
          <p className={styles.subtitle}>
            Master the daily puzzle game inspired by Pokémon ice gym puzzles
          </p>
        </header>

        <section className={styles.section}>
          <h2>🎯 The Goal</h2>
          <p>
            Navigate your character to the <strong>star</strong> in exactly <strong>10 moves</strong>. 
            You have <strong>3 lives</strong> to find the optimal solution. Complete the puzzle 
            as fast as you can — every wrong move adds a time penalty!
          </p>
        </section>

        <section className={styles.section}>
          <h2>🎮 Controls</h2>
          <div className={styles.controlsGrid}>
            <div className={styles.controlItem}>
              <span className={styles.controlIcon}>⌨️</span>
              <span className={styles.controlLabel}>Arrow Keys</span>
            </div>
            <div className={styles.controlItem}>
              <span className={styles.controlIcon}>🔤</span>
              <span className={styles.controlLabel}>WASD</span>
            </div>
            <div className={styles.controlItem}>
              <span className={styles.controlIcon}>👆</span>
              <span className={styles.controlLabel}>Swipe</span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>🧊 Tile Types</h2>
          <div className={styles.tileList}>
            <div className={styles.tileItem}>
              <div className={styles.tileSwatch} style={{ background: '#5dade2' }} />
              <div>
                <strong>Ice</strong>
                <p>You slide until you hit something — walls, obstacles, or ground tiles stop you.</p>
              </div>
            </div>
            <div className={styles.tileItem}>
              <div className={styles.tileSwatch} style={{ background: '#8b5a2b' }} />
              <div>
                <strong>Ground</strong>
                <p>Normal movement — you stop immediately after stepping onto ground.</p>
              </div>
            </div>
            <div className={styles.tileItem}>
              <div className={styles.tileSwatch} style={{ background: '#4a4a4a' }} />
              <div>
                <strong>Wall</strong>
                <p>Impassable obstacles that block your movement.</p>
              </div>
            </div>
            <div className={styles.tileItem}>
              <div className={styles.tileSwatch} style={{ background: '#2ecc71' }} />
              <div>
                <strong>Ledge</strong>
                <p>One-way tiles — you can enter from any direction but only jump down from the ledge side.</p>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2>💡 Tips for Success</h2>
          <ul className={styles.tipsList}>
            <li>Think ahead — ice sliding means your moves chain together.</li>
            <li>Count moves mentally before committing to a path.</li>
            <li>After losing a life, green highlights show which moves were correct.</li>
            <li>The puzzle resets daily at midnight (Eastern Time).</li>
            <li>Share your results without spoilers!</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>📊 Scoring</h2>
          <p>
            Your time is recorded from when you press &quot;Begin&quot; until you reach the goal. 
            Each life lost adds a <strong>10-second penalty</strong>. The fastest solvers 
            complete puzzles in under 20 seconds!
          </p>
        </section>

        <section className={styles.ctaSection}>
          <Link href="/" className={styles.playButton}>
            Play Today&apos;s Puzzle →
          </Link>
        </section>
      </article>

      <footer className={styles.footer}>
        <Link href="/">← Back to Game</Link>
        <span>·</span>
        <Link href="/about">About Mazle</Link>
      </footer>
    </main>
  );
}
