import React, { memo } from 'react';
import CharacterIcon from './CharacterIcon';
import styles from './AccountView.module.css';
import { SkinDefinition } from '@/lib/skins';

type SkinWheelItemProps = {
    skin: SkinDefinition;
    isCentered?: boolean;
    style?: React.CSSProperties;
    characterId: string;
    onClick: () => void;
};

const SkinWheelItem = memo(({ skin, isCentered = false, style, characterId, onClick }: SkinWheelItemProps) => {
    const isLocked = skin.locked;
    const isComingSoon = !!skin.comingSoon;

    return (
        <button
            type="button"
            className={`${styles.skinWheelItem} ${isCentered ? styles.skinWheelItemCenter : ''} ${isLocked ? styles.skinWheelItemLocked : ''} ${isComingSoon ? styles.skinWheelItemComingSoon : ''}`}
            onClick={onClick}
            aria-label={isLocked ? `${skin.name} (locked)` : `Select ${skin.name}`}
            style={style}
        >

            <div className={styles.skinWheelItemIcon}>
                <CharacterIcon
                    characterId={characterId}
                    skinId={skin.id}
                    size="100%"
                />
            </div>
            {isLocked && !isComingSoon && (
                <span className={styles.skinWheelLock}>
                    <svg width={isCentered ? "22" : "18"} height={isCentered ? "22" : "18"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 11V8a5 5 0 0 1 10 0v3" />
                        <rect x="6" y="11" width="12" height="10" rx="2" />
                    </svg>
                </span>
            )}
        </button>
    );
});

SkinWheelItem.displayName = 'SkinWheelItem';

export default SkinWheelItem;
