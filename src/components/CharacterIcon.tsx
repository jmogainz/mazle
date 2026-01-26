'use client';

import React, { useMemo } from 'react';
import { getSkinById, isSkinDisabled } from '@/lib/skins';
import styles from './CharacterIcon.module.css';

type CharacterIconProps = {
  characterId?: string | null;
  skinId?: string | null;
  size?: number | string;
  title?: string;
  locked?: boolean;
};

const LOCKED_COLORS = { face: '#9ca3af', edge: '#6b7280' };

function colorsFor(characterId: string, skinId: string): { face: string; edge: string } {
  const skin = getSkinById(skinId);
  if (skin) return { face: skin.face, edge: skin.edge };

  const hash = `${characterId}:${skinId}`;
  let acc = 2166136261;
  for (let i = 0; i < hash.length; i += 1) {
    acc ^= hash.charCodeAt(i);
    acc = Math.imul(acc, 16777619);
  }
  const hue = acc % 360;
  return { face: `hsl(${hue} 85% 60%)`, edge: `hsl(${hue} 85% 40%)` };
}

export default function CharacterIcon({ characterId, skinId, size = 34, title, locked = false }: CharacterIconProps) {
  const cId = (characterId ?? 'default') || 'default';
  const rawSkinId = (skinId ?? 'default') || 'default';
  const sId = isSkinDisabled(rawSkinId) ? 'default' : rawSkinId;

  if (sId === 'obsidian' && !locked) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role={title ? 'img' : 'presentation'}
        aria-label={title}
        focusable="false"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {title && <title>{title}</title>}
        <ellipse cx="16" cy="27" rx="9" ry="3" className={styles.shadow} />
        <image href="/assets/images/obsidian.svg" x="-0.5" y="-0.5" width="33" height="33" shapeRendering="geometricPrecision" />
      </svg>
    );
  }

  if (sId === 'penguin' && !locked) {
    const PENGUIN_ICON_SIZE = 20;
    const PENGUIN_ICON_OFFSET = (32 - PENGUIN_ICON_SIZE) / 2;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        role={title ? 'img' : 'presentation'}
        aria-label={title}
        focusable="false"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {title && <title>{title}</title>}
        <ellipse cx="16" cy="27" rx="9" ry="3" className={styles.shadow} />
        <image
          href="/assets/images/penguin.svg"
          x={PENGUIN_ICON_OFFSET}
          y={PENGUIN_ICON_OFFSET}
          width={PENGUIN_ICON_SIZE}
          height={PENGUIN_ICON_SIZE}
          shapeRendering="geometricPrecision"
        />
      </svg>
    );
  }

  const colors = useMemo(() => locked ? LOCKED_COLORS : colorsFor(cId, sId), [cId, sId, locked]);

  const shape = cId.toLowerCase();

  const renderShape = () => {
    switch (shape) {
      case 'cylinder':
        return (
          <>
            <path
              d="M8 10v12c0 1.66 3.58 3 8 3s8-1.34 8-3V10"
              fill={colors.face}
              stroke={colors.edge}
              strokeWidth="2"
            />
            <ellipse
              cx="16"
              cy="10"
              rx="8"
              ry="3"
              fill={colors.face}
              stroke={colors.edge}
              strokeWidth="2"
            />
          </>
        );
      case 'pyramid':
        return (
          <path
            d="M16 4 L26 24 H6 Z"
            fill={colors.face}
            stroke={colors.edge}
            strokeWidth="2"
            strokeLinejoin="round"
          />
        );
      case 'cube':
      default:
        return (
          <rect
            x="8"
            y="6"
            width="16"
            height="18"
            rx="3"
            fill={colors.face}
            stroke={colors.edge}
            strokeWidth="2"
          />
        );
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      focusable="false"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {title ? <title>{title}</title> : null}
      <ellipse cx="16" cy="27" rx="9" ry="3" className={styles.shadow} />
      {renderShape()}
      {/* Eyes - adjusted for pyramid */}
      <g transform={shape === 'pyramid' ? 'translate(0, 2)' : ''}>
        <circle cx="13" cy="13" r="3" fill="#ffffff" />
        <circle cx="19" cy="13" r="3" fill="#ffffff" />
        <circle cx="14" cy="13" r="1.5" fill="#000000" />
        <circle cx="20" cy="13" r="1.5" fill="#000000" />
      </g>
    </svg>
  );
}
