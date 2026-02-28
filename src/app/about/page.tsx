import type { Metadata } from 'next';
import Link from 'next/link';
import { PENALTY_MS } from '@/constants';
import styles from './page.module.css';

export const metadata: Metadata = {
  title: 'About Mazle - Daily Puzzle Game',
  description: 'Mazle is a daily sliding puzzle game. Navigate ice, ledges, and walls to reach the goal in optimal moves. New puzzle every day!',
  keywords: ['mazle game', 'daily puzzle', 'ice puzzle', 'sliding puzzle', 'puzzle game', 'wordle alternative', 'logic game'],
  alternates: {
    canonical: 'https://mazle.io/about',
  },
  openGraph: {
    title: 'About Mazle - Daily Puzzle Game',
    description: 'A daily sliding puzzle game. New puzzle every day!',
    url: 'https://mazle.io/about',
    siteName: 'Mazle',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'About Mazle',
    description: 'The daily ice puzzle game everyone is talking about',
  },
};

export default function About() {
  return (
    <main className={styles.main}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VideoGame',
            name: 'Mazle',
            description: 'A daily puzzle game where you navigate ice, ledges, and walls to reach the goal.',
            url: 'https://mazle.io',
            genre: ['Puzzle', 'Strategy', 'Casual'],
            gamePlatform: ['Web Browser', 'Mobile Web'],
            applicationCategory: 'Game',
            operatingSystem: 'Any',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
            },
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: '4.8',
              ratingCount: '1000',
              bestRating: '5',
              worstRating: '1',
            },
          }),
        }}
      />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: [
              {
                '@type': 'Question',
                name: 'What is Mazle?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Mazle is a daily sliding puzzle game. Players navigate through ice, ledges, and walls to reach the goal in exactly 10 optimal moves.',
                },
              },
              {
                '@type': 'Question',
                name: 'How often is there a new puzzle?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'A new puzzle is released every day at midnight Eastern Time. Everyone around the world plays the same puzzle on the same day.',
                },
              },
              {
                '@type': 'Question',
                name: 'Is Mazle free to play?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes! Mazle is completely free to play. Just visit mazle.io to start playing.',
                },
              },
              {
                '@type': 'Question',
                name: 'Can I play Mazle on mobile?',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Yes, Mazle works great on mobile devices. Use swipe gestures to move your character. You can also install it as a Progressive Web App for an app-like experience.',
                },
              },
            ],
          }),
        }}
      />
      
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Mazle</Link>
        <span aria-hidden="true">›</span>
        <span>About</span>
      </nav>

      <article className={styles.article}>
        <header>
          <h1 className={styles.title}>About Mazle</h1>
          <p className={styles.subtitle}>
            The daily puzzle game that&apos;ll make you think twice about every move
          </p>
        </header>

        <section className={styles.section}>
          <h2>What is Mazle?</h2>
          <p>
            Mazle is a <strong>daily puzzle game</strong> inspired by classic sliding puzzle 
            mechanics. Each day, players around the world tackle the same puzzle, 
            navigating a character through ice tiles, ledges, and obstacles to reach the goal.
          </p>
          <p>
            The twist? You have exactly <strong>10 moves</strong> to solve it, and you only get <strong>5 lives</strong>. 
            Make a wrong move, lose a life, and get a time penalty. 
            It&apos;s simple to learn but challenging to master.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Why Play Mazle?</h2>
          <ul className={styles.featureList}>
            <li>
              <span className={styles.featureIcon}>🧠</span>
              <div>
                <strong>Brain Training</strong>
                <p>Exercise spatial reasoning and planning skills daily.</p>
              </div>
            </li>
            <li>
              <span className={styles.featureIcon}>🌍</span>
              <div>
                <strong>Global Competition</strong>
                <p>Everyone plays the same puzzle — compare with friends!</p>
              </div>
            </li>
            <li>
              <span className={styles.featureIcon}>⚡</span>
              <div>
                <strong>Quick Sessions</strong>
                <p>Most puzzles take 1-3 minutes. Perfect for a break.</p>
              </div>
            </li>
            <li>
              <span className={styles.featureIcon}>📱</span>
              <div>
                <strong>Play Anywhere</strong>
                <p>Works on any device with a browser. No download needed.</p>
              </div>
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>Frequently Asked Questions</h2>
          
          <div className={styles.faqItem}>
            <h3>When does the puzzle reset?</h3>
            <p>A new puzzle is available every day at midnight Eastern Time (ET).</p>
          </div>
          
          <div className={styles.faqItem}>
            <h3>Can I play previous puzzles?</h3>
            <p>Currently, only the daily puzzle is available. Each day brings a new challenge!</p>
          </div>
          
          <div className={styles.faqItem}>
            <h3>How is my score calculated?</h3>
            <p>Your score is based on time. Each life lost adds a {PENALTY_MS / 1000}-second penalty. 
               Completing the puzzle perfectly (on your first attempt) gives the best score.</p>
          </div>
          
          <div className={styles.faqItem}>
            <h3>Is there an app?</h3>
            <p>Mazle is a Progressive Web App (PWA). On mobile, tap &quot;Add to Home Screen&quot; 
               in your browser to install it like a native app!</p>
          </div>
        </section>

        <section className={styles.ctaSection}>
          <Link href="/" className={styles.playButton}>
            Play Today&apos;s Puzzle →
          </Link>
          <Link href="/how-to-play" className={styles.secondaryButton}>
            Learn How to Play
          </Link>
        </section>
      </article>

      <footer className={styles.footer}>
        <Link href="/">← Back to Game</Link>
        <span>·</span>
        <Link href="/how-to-play">How to Play</Link>
        <span>·</span>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </main>
  );
}
