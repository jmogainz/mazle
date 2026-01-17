'use client';

import React, { useEffect, useRef } from 'react';
import PullToRefreshLib from 'pulltorefreshjs';
import styles from './PullToRefresh.module.css';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

const PULL_THRESHOLD = 80;
const MAX_PULL = 140;
const REFRESH_HOLD = 70;
const PTR_CLASS_PREFIX = 'ptr--';
const PTR_MARKUP = `
  <div class="__PREFIX__box">
    <div class="__PREFIX__content">
      <div class="__PREFIX__icon"></div>
    </div>
  </div>
`;
const PTR_REFRESH_ICON = `
  <div class="${PTR_CLASS_PREFIX}mazeGrid">
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}goal"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}tile ${PTR_CLASS_PREFIX}floor"></div>
    <div class="${PTR_CLASS_PREFIX}player"></div>
  </div>
`;
const PTR_STYLES = `
.__PREFIX__ptr {
  pointer-events: none;
  top: 0;
  height: 0;
  transition: height 0.3s, min-height 0.3s;
  text-align: center;
  width: 100%;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}

.__PREFIX__box {
  padding: 10px;
  flex-basis: 100%;
}

.__PREFIX__pull {
  transition: none;
}

.__PREFIX__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(52px * var(--ui-scale, 1));
  color: var(--color-secondary);
  font-size: calc(1.1rem * var(--ui-scale, 1));
  transition: transform .3s;
}

.__PREFIX__release .__PREFIX__icon {
  transform: rotate(180deg);
}

.__PREFIX__mazeGrid {
  --ptr-scale: calc(var(--ui-scale, 1) * 0.9);
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, calc(14px * var(--ptr-scale)));
  grid-template-rows: repeat(3, calc(14px * var(--ptr-scale)));
  gap: calc(3px * var(--ptr-scale));
  padding: calc(4px * var(--ptr-scale));
}

.__PREFIX__tile {
  width: calc(14px * var(--ptr-scale));
  height: calc(14px * var(--ptr-scale));
  border-radius: calc(2px * var(--ptr-scale));
}

.__PREFIX__floor {
  background-color: var(--color-surface);
  box-shadow: inset 0 0 0 calc(1px * var(--ptr-scale)) rgba(0, 0, 0, 0.05);
}

.__PREFIX__goal {
  background-color: #6aaa64;
  position: relative;
  overflow: hidden;
  box-shadow: 0 calc(2px * var(--ptr-scale)) 0 #538d4e;
}

.__PREFIX__goal::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: calc(8px * var(--ptr-scale));
  height: calc(8px * var(--ptr-scale));
  background-color: #ffd700;
  transform: translate(-50%, -50%) rotate(0deg);
  clip-path: polygon(
    50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%,
    50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%
  );
}

.__PREFIX__player {
  position: absolute;
  top: calc(4px * var(--ptr-scale));
  left: calc(4px * var(--ptr-scale));
  width: calc(14px * var(--ptr-scale));
  height: calc(14px * var(--ptr-scale));
  background-color: #ff4d4d;
  border-radius: calc(3px * var(--ptr-scale));
  box-shadow:
    0 calc(2px * var(--ptr-scale)) 0 #cc0000,
    0 calc(3px * var(--ptr-scale)) calc(3px * var(--ptr-scale)) rgba(0, 0, 0, 0.15);
  z-index: 10;
  animation: __PREFIX__solveLoop 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

.__PREFIX__player::before,
.__PREFIX__player::after {
  content: '';
  position: absolute;
  top: calc(4px * var(--ptr-scale));
  width: calc(3px * var(--ptr-scale));
  height: calc(3px * var(--ptr-scale));
  background-color: #ffffff;
  border-radius: 50%;
  box-shadow:
    inset calc(0.5px * var(--ptr-scale)) calc(-0.5px * var(--ptr-scale)) 0
    calc(0.5px * var(--ptr-scale)) rgba(0, 0, 0, 0.2);
}

.__PREFIX__player::before {
  left: calc(3px * var(--ptr-scale));
}

.__PREFIX__player::after {
  right: calc(3px * var(--ptr-scale));
}

@keyframes __PREFIX__solveLoop {
  0%, 15% { transform: translate(0px, 0px); }
  25%, 40% { transform: translate(calc(34px * var(--ptr-scale)), 0px); }
  50%, 65% { transform: translate(calc(34px * var(--ptr-scale)), calc(34px * var(--ptr-scale))); }
  75%, 90% { transform: translate(0px, calc(34px * var(--ptr-scale))); }
  100% { transform: translate(0px, 0px); }
}

/*
When at the top of the page, disable vertical overscroll so passive touch
listeners can take over.
*/
.__PREFIX__top {
  touch-action: pan-x pan-down pinch-zoom;
}
`;

export default function PullToRefresh({ onRefresh, children, className = '', disabled = false }: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) return;
    const container = containerRef.current;
    if (!container) return;

    const ptr = PullToRefreshLib.init({
      mainElement: container,
      triggerElement: container,
      distThreshold: PULL_THRESHOLD,
      distMax: MAX_PULL,
      distReload: REFRESH_HOLD,
      classPrefix: PTR_CLASS_PREFIX,
      getMarkup: () => PTR_MARKUP,
      getStyles: () => PTR_STYLES,
      iconArrow: '&#8675;',
      iconRefreshing: PTR_REFRESH_ICON,
      instructionsPullToRefresh: '',
      instructionsReleaseToRefresh: '',
      instructionsRefreshing: '',
      shouldPullToRefresh: () => container.scrollTop <= 0,
      onRefresh: () => onRefresh(),
    });

    return () => {
      ptr.destroy();
    };
  }, [disabled, onRefresh]);

  return (
    <div ref={containerRef} className={`${styles.container} ${className}`}>
      {children}
    </div>
  );
}
