import Loader from '@/components/Loader';
import styles from '@/components/OverlayShell.module.css';

export default function LeaderboardLoading() {
  return (
    <div className={styles.page} aria-busy="true">
      <div className={`${styles.card} ${styles.cardPage}`}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>Leaderboard</div>
            <div className={styles.subtitle}>Loading...</div>
          </div>
        </div>
        <div className={styles.content}>
          <Loader text="Loading..." />
        </div>
      </div>
    </div>
  );
}
