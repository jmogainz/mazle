export type SkinTier = 'guest' | 'account' | 'plus';

export type SkinCatalogEntry = {
  id: string;
  name: string;
  face: string;
  edge: string;
  minTier: SkinTier;
  requiresUnlock?: boolean;
  hidden?: boolean;
  comingSoon?: boolean;
};

export type SkinDefinition = SkinCatalogEntry & { locked: boolean };

const SKINS: readonly SkinCatalogEntry[] = [
  // Guest (default only)
  { id: 'default', name: 'Classic', face: '#ff4d4d', edge: '#cc0000', minTier: 'guest' },

  // Signed-in free (account tier)
  { id: 'mustard', name: 'Mustard', face: '#ffdb58', edge: '#daa520', minTier: 'account' },
  { id: 'teal', name: 'Lagoon', face: '#008080', edge: '#004d4d', minTier: 'account' },
  // Streak unlock
  { id: 'royal', name: 'Royal', face: '#4f2db3', edge: '#a78bfa', minTier: 'account', requiresUnlock: true },

  // Mazle+ placeholders (hidden from carousel)
  { id: 'mystery_plus_1', name: '???', face: '#c8d4dd', edge: '#8b98a5', minTier: 'guest', comingSoon: true, hidden: true },
  { id: 'mystery_plus_2', name: '???', face: '#d1d7de', edge: '#9aa4af', minTier: 'guest', comingSoon: true, hidden: true },

  // Mazle+ tier
  { id: 'arctic', name: 'Arctic', face: '#ffffff', edge: '#b8e0f0', minTier: 'plus', hidden: true },
  { id: 'void', name: 'Void', face: '#1a1a1b', edge: '#3a3d41', minTier: 'plus', hidden: true },

  // ========== Hidden trial skins (kept in code, not shown in UI) ==========
  // Warm tones
  { id: 'coral', name: 'Coral', face: '#ff6b6b', edge: '#c44d4d', minTier: 'account', hidden: true },
  { id: 'sunset', name: 'Sunset', face: '#ff9f43', edge: '#e17055', minTier: 'account', hidden: true },
  { id: 'ember', name: 'Ember', face: '#dc2f02', edge: '#ffba08', minTier: 'account', hidden: true },
  { id: 'blush', name: 'Blush', face: '#f8b4c4', edge: '#c77b8b', minTier: 'account', hidden: true },
  { id: 'peach', name: 'Peach', face: '#ffb997', edge: '#f67e7d', minTier: 'account', hidden: true },
  { id: 'rust', name: 'Rust', face: '#b7410e', edge: '#5c2c06', minTier: 'account', hidden: true },

  // Cool tones
  { id: 'mint', name: 'Mint', face: '#4ecdc4', edge: '#2a9d8f', minTier: 'account', hidden: true },
  { id: 'lavender', name: 'Lavender', face: '#b39ddb', edge: '#7e57c2', minTier: 'account', hidden: true },
  { id: 'slate', name: 'Slate', face: '#74b9ff', edge: '#0984e3', minTier: 'account', hidden: true },
  { id: 'electric', name: 'Electric', face: '#00d4ff', edge: '#9d4edd', minTier: 'account', hidden: true },
  { id: 'ice', name: 'Ice', face: '#a8dadc', edge: '#457b9d', minTier: 'account', hidden: true },
  { id: 'cobalt', name: 'Cobalt', face: '#1d3557', edge: '#0a1628', minTier: 'account', hidden: true },
  { id: 'orchid', name: 'Orchid', face: '#da70d6', edge: '#9932cc', minTier: 'account', hidden: true },

  // Metallics & neutrals
  { id: 'bronze', name: 'Bronze', face: '#cd7f32', edge: '#8b4513', minTier: 'account', hidden: true },
  { id: 'onyx', name: 'Onyx', face: '#2d2d34', edge: '#6c5ce7', minTier: 'account', hidden: true },
  { id: 'silver', name: 'Silver', face: '#c0c0c0', edge: '#808080', minTier: 'account', hidden: true },
  { id: 'gold', name: 'Gold', face: '#ffd700', edge: '#b8860b', minTier: 'account', hidden: true },
  { id: 'platinum', name: 'Platinum', face: '#e5e4e2', edge: '#a9a9a9', minTier: 'account', hidden: true },
  { id: 'graphite', name: 'Graphite', face: '#41424c', edge: '#1a1a2e', minTier: 'account', hidden: true },
  { id: 'charcoal', name: 'Charcoal', face: '#36454f', edge: '#1c2833', minTier: 'account', hidden: true },

  // Vibrant/neon
  { id: 'neon', name: 'Neon', face: '#ff2d95', edge: '#00f5d4', minTier: 'account', hidden: true },
  { id: 'toxic', name: 'Toxic', face: '#39ff14', edge: '#0d7d00', minTier: 'account', hidden: true },
  { id: 'plasma', name: 'Plasma', face: '#e040fb', edge: '#00e5ff', minTier: 'account', hidden: true },
  { id: 'cyber', name: 'Cyber', face: '#0ff0fc', edge: '#ff00ff', minTier: 'account', hidden: true },
  { id: 'aurora', name: 'Aurora', face: '#00c9a7', edge: '#845ec2', minTier: 'account', hidden: true },
  { id: 'vapor', name: 'Vapor', face: '#ff6fd8', edge: '#3bf0e4', minTier: 'account', hidden: true },

  // Earth tones
  { id: 'forest', name: 'Forest', face: '#228b22', edge: '#0b3d0b', minTier: 'account', hidden: true },
  { id: 'sage', name: 'Sage', face: '#9caf88', edge: '#6b7f5a', minTier: 'account', hidden: true },
  { id: 'terracotta', name: 'Terracotta', face: '#e2725b', edge: '#a0522d', minTier: 'account', hidden: true },
  { id: 'clay', name: 'Clay', face: '#b66a50', edge: '#8b4513', minTier: 'account', hidden: true },
  { id: 'moss', name: 'Moss', face: '#8a9a5b', edge: '#556b2f', minTier: 'account', hidden: true },

  // Premium/luxury vibes
  { id: 'champagne', name: 'Champagne', face: '#f7e7ce', edge: '#d4af37', minTier: 'account', hidden: true },
  { id: 'rosegold', name: 'Rose Gold', face: '#e8b4b8', edge: '#b76e79', minTier: 'account', hidden: true },
  { id: 'obsidian', name: 'Obsidian', face: '#1a1a1a', edge: '#4a0080', minTier: 'account', hidden: true },
  { id: 'amethyst', name: 'Amethyst', face: '#9966cc', edge: '#5b3a8c', minTier: 'account', hidden: true },
  { id: 'sapphire', name: 'Sapphire', face: '#0f52ba', edge: '#082567', minTier: 'account', hidden: true },
  { id: 'ruby', name: 'Ruby', face: '#e0115f', edge: '#8b0000', minTier: 'account', hidden: true },
  { id: 'emerald', name: 'Emerald', face: '#50c878', edge: '#046307', minTier: 'account', hidden: true },

  // Unique/themed
  { id: 'midnight', name: 'Midnight', face: '#191970', edge: '#000033', minTier: 'account', hidden: true },
  { id: 'dusk', name: 'Dusk', face: '#4a4e69', edge: '#22223b', minTier: 'account', hidden: true },
  { id: 'dawn', name: 'Dawn', face: '#ffc8dd', edge: '#ffafcc', minTier: 'account', hidden: true },
  { id: 'storm', name: 'Storm', face: '#4f5d75', edge: '#2d3142', minTier: 'account', hidden: true },
  { id: 'phantom', name: 'Phantom', face: '#3d3d5c', edge: '#1a1a2e', minTier: 'account', hidden: true },
  { id: 'nova', name: 'Nova', face: '#ff4500', edge: '#ff8c00', minTier: 'account', hidden: true },
  { id: 'glacier', name: 'Glacier', face: '#e0ffff', edge: '#87ceeb', minTier: 'account', hidden: true },
  { id: 'velvet', name: 'Velvet', face: '#722f37', edge: '#3c1518', minTier: 'account', hidden: true },
] as const;

function tierRank(tier: SkinTier): number {
  switch (tier) {
    case 'guest':
      return 0;
    case 'account':
      return 1;
    case 'plus':
      return 2;
  }
}

export type SkinViewer = { tier: SkinTier; unlockedSkins: string[] };

export function isSkinUnlockedForViewer(skinId: string | null | undefined, viewer: SkinViewer): boolean {
  if (!skinId) return false;
  const skin = getSkinById(skinId);
  if (!skin) return false;
  if (skin.comingSoon) return false;
  if (tierRank(viewer.tier) < tierRank(skin.minTier)) return false;
  if (skin.requiresUnlock) {
    return viewer.unlockedSkins.includes(skin.id);
  }
  return true;
}

export function getAllSkins(): SkinCatalogEntry[] {
  return [...SKINS];
}

export function getAllSkinsForViewer(viewer: SkinViewer): SkinDefinition[] {
  const rank = tierRank(viewer.tier);
  return SKINS.filter((s) => !s.hidden).map((s) => ({
    ...s,
    locked:
      !!s.comingSoon ||
      rank < tierRank(s.minTier) ||
      (s.requiresUnlock ? !viewer.unlockedSkins.includes(s.id) : false),
  }));
}

export function getSkinById(id: string | null | undefined): SkinCatalogEntry | null {
  if (!id) return null;
  return SKINS.find((skin) => skin.id === id) ?? null;
}

export function getUnlockedSkinsForViewer(viewer: SkinViewer): SkinCatalogEntry[] {
  return getAllSkinsForViewer(viewer).filter((s) => !s.locked);
}
