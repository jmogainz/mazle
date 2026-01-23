import React, { forwardRef } from 'react';
import styles from './MenuButton.module.css';

interface MenuButtonProps {
  isOpen: boolean;
  onClick: () => void;
  className?: string;
  ariaLabel?: string;
}

const MenuButton = forwardRef<HTMLButtonElement, MenuButtonProps>(
  ({ isOpen, onClick, className, ariaLabel }, ref) => {
    return (
      <button
        ref={ref}
        className={`${styles.button} ${isOpen ? styles.buttonActive : ''} ${className || ''}`.trim()}
        onClick={onClick}
        aria-label={ariaLabel || (isOpen ? 'Close menu' : 'Menu')}
        type="button"
      >
        <div className={`${styles.lines} ${isOpen ? styles.open : ''}`}>
          <span className={`${styles.line} ${styles.lineTop}`} />
          <span className={`${styles.line} ${styles.lineMiddle}`} />
          <span className={`${styles.line} ${styles.lineBottom}`} />
        </div>
      </button>
    );
  }
);

MenuButton.displayName = 'MenuButton';

export default MenuButton;
