import React, { memo } from 'react';
import CharacterIcon from './CharacterIcon';
import styles from './AccountView.module.css';
import { SkinDefinition } from '@/lib/skins';

type SkinWheelItemProps = {
    skin: SkinDefinition;
    isActive: boolean;
    characterId: string;
    onClick: () => void;
    showUnlockHint: boolean;
};

const SkinWheelItem = memo(({ skin, isActive, characterId, onClick, showUnlockHint }: SkinWheelItemProps) => {
    const isLocked = skin.locked;

    return (
        <button
            type="button"
            className={`${styles.skinWheelItem} ${isActive ? styles.skinWheelItemCenter : styles.skinWheelItemSide} ${isLocked ? styles.skinWheelItemLocked : ''}`}
            onClick={onClick}
            aria-label={isLocked ? `${skin.name} (locked)` : `Select ${skin.name}`}
        >
            <div className={styles.skinWheelItemIcon}>
                <CharacterIcon
                    characterId={characterId}
                    skinId={skin.id}
                    size="100%"
                />
            </div>
            {isLocked && (
                <span className={styles.skinWheelLock}>
                    <svg width={isActive ? "22" : "18"} height={isActive ? "22" : "18"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
