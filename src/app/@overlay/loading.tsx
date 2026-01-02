import Loader from '@/components/Loader';
import styles from '@/components/OverlayShell.module.css';

export default function OverlayLoading() {
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Loading">
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <div className={styles.title}>Loading</div>
            <div className={styles.subtitle}>Preparing view</div>
          </div>
          <div className={styles.closeButton} aria-hidden="true" />
        </div>
        <div className={styles.content}>
          <Loader text="Loading..." />
        </div>
      </div>
    </div>
  );
}
