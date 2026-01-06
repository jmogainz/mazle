import styles from './Loader.module.css';

interface LoaderProps {
  text?: string;
  progress?: number;
}

export default function Loader({ text = "Loading...", progress }: LoaderProps) {
  return (
    <div className={styles.container}>
      <div className={styles.mazeGrid}>
        {/* Row 1 */}
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />
        
        {/* Row 2 */}
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.goal}`} /> {/* Center Goal */}
        <div className={`${styles.tile} ${styles.floor}`} />
        
        {/* Row 3 */}
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />
        <div className={`${styles.tile} ${styles.floor}`} />

        {/* Moving Player */}
        <div className={styles.player} />
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
        <p className={styles.text}>{text}</p>
        
        {/* Always render progress bar container to prevent layout shift */}
        <div style={{ 
          width: '120px', 
          height: '4px', 
          background: 'var(--color-surface)', 
          borderRadius: '2px',
          overflow: 'hidden',
          opacity: progress !== undefined ? 1 : 0,
          transition: 'opacity 0.2s ease-out',
        }}>
          <div style={{
            width: `${Math.min(100, Math.max(0, progress ?? 0))}%`,
            height: '100%',
            background: 'var(--color-primary)',
            transition: 'width 0.3s ease-out'
          }} />
        </div>
      </div>
    </div>
  );
}
