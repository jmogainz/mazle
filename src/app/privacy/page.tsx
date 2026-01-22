import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../about/page.module.css';

export const metadata: Metadata = {
  title: 'Privacy Policy - Mazle',
  description: 'Privacy Policy for Mazle, the daily puzzle game. Learn how we collect, use, and protect your data.',
  alternates: {
    canonical: 'https://mazle.io/privacy',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function Privacy() {
  return (
    <main className={styles.main}>
      <nav className={styles.breadcrumb} aria-label="Breadcrumb">
        <Link href="/">Mazle</Link>
        <span aria-hidden="true">›</span>
        <span>Privacy Policy</span>
      </nav>

      <article className={styles.article}>
        <header>
          <h1 className={styles.title}>Privacy Policy</h1>
          <p className={styles.subtitle}>
            Last updated: December 2025
          </p>
        </header>

        <section className={styles.section}>
          <h2>Introduction</h2>
          <p>
            Mazle (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) is committed to protecting your privacy. 
            This Privacy Policy explains how we collect, use, and safeguard information when you 
            use our website at mazle.io (the &quot;Service&quot;).
          </p>
        </section>

        <section className={styles.section}>
          <h2>Information We Collect</h2>
          
          <h3>Information Stored Locally</h3>
          <p>
            Mazle stores game data locally in your browser using localStorage. This includes:
          </p>
          <ul>
            <li>Your game progress and statistics (wins, streaks, completion times)</li>
            <li>Preferences (such as whether you&apos;ve seen the help menu)</li>
            <li>Daily puzzle completion status</li>
          </ul>
          <p>
            This data never leaves your device and is not transmitted to our servers.
          </p>

          <h3>Analytics</h3>
          <p>
            We use Vercel Analytics to collect anonymous usage data to improve our Service. 
            This may include pages visited, browser type, device type, and general geographic region. 
            This data is aggregated and cannot be used to identify individual users.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Advertising</h2>
          <p>
            We use Google AdSense to display advertisements on our Service. Google and its partners 
            may use cookies and similar technologies to serve ads based on your prior visits to our 
            website or other websites. 
          </p>
          <p>
            Google&apos;s use of advertising cookies enables it and its partners to serve ads based on 
            your visit to our site and/or other sites on the Internet.
          </p>
          <p>
            You may opt out of personalized advertising by visiting{' '}
            <a href="https://www.google.com/settings/ads" target="_blank" rel="noopener noreferrer">
              Google Ads Settings
            </a>. Alternatively, you can opt out of third-party vendor cookies by visiting{' '}
            <a href="https://optout.networkadvertising.org/" target="_blank" rel="noopener noreferrer">
              Network Advertising Initiative opt-out page
            </a>.
          </p>
          <p>
            For more information about how Google uses data when you use our site, please visit{' '}
            <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">
              How Google uses information from sites or apps that use our services
            </a>.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Cookies and Similar Technologies</h2>
          <p>
            Our Service and third-party partners (including Google AdSense) may use cookies, 
            web beacons, and similar technologies to:
          </p>
          <ul>
            <li>Serve and measure the effectiveness of ads</li>
            <li>Remember your preferences</li>
            <li>Analyze site traffic and usage patterns</li>
            <li>Provide social media features</li>
          </ul>
          <p>
            You can control cookies through your browser settings. Note that disabling cookies 
            may affect the functionality of certain features.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Data Retention</h2>
          <p>
            Game data stored in your browser remains until you clear your browser&apos;s localStorage 
            or uninstall the application. We do not store personal data on our servers.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Children&apos;s Privacy</h2>
          <p>
            Our Service is intended for general audiences and does not knowingly collect personal 
            information from children under 13. If you believe we have inadvertently collected 
            such information, please contact us so we can promptly remove it.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Your Rights (EEA/UK Users)</h2>
          <p>
            If you are located in the European Economic Area, United Kingdom, or Switzerland, 
            you have certain rights regarding your personal data under GDPR, including:
          </p>
          <ul>
            <li>The right to access your personal data</li>
            <li>The right to rectification of inaccurate data</li>
            <li>The right to erasure (&quot;right to be forgotten&quot;)</li>
            <li>The right to restrict processing</li>
            <li>The right to data portability</li>
            <li>The right to object to processing</li>
          </ul>
          <p>
            Since we primarily store data locally on your device, you can exercise these rights 
            by clearing your browser data at any time.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes 
            by posting the new Privacy Policy on this page and updating the &quot;Last updated&quot; date.
          </p>
        </section>

        <section className={styles.section}>
          <h2>Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy, please contact us at:{' '}
            <a href="mailto:jmaullc@gmail.com">jmaullc@gmail.com</a>
          </p>
        </section>

        <section className={styles.ctaSection}>
          <Link href="/" className={styles.playButton}>
            Play Mazle →
          </Link>
        </section>
      </article>

      <footer className={styles.footer}>
        <Link href="/">← Back to Game</Link>
        <span>·</span>
        <Link href="/about">About</Link>
      </footer>
    </main>
  );
}
