export type SkinTier = 'guest' | 'account' | 'plus';

export type SkinCatalogEntry = {
  id: string;
  name: string;
  face: string;
  edge: string;
  minTier: SkinTier;
  requiresUnlock?: boolean;
};

export type SkinDefinition = SkinCatalogEntry & { locked: boolean };

const SKINS: readonly SkinCatalogEntry[] = [
  // Guest (default only)
  { id: 'default', name: 'Classic', face: '#ff4d4d', edge: '#cc0000', minTier: 'guest' },

  // Signed-in free (account tier)
  // Based on `localdocs/skin_mustard.svg`
  { id: 'mustard', name: 'Mustard', face: '#ffdb58', edge: '#daa520', minTier: 'account' },
  // Based on `localdocs/skin_teal.svg`
  { id: 'teal', name: 'Teal', face: '#008080', edge: '#004d4d', minTier: 'account' },
  // Based on `localdocs/skin_royal.svg` (kept for future streak reward)
  { id: 'royal', name: 'Royal', face: '#4f2db3', edge: '#a78bfa', minTier: 'account', requiresUnlock: true },

  // Mazle+ tier
  // Based on `localdocs/skin_arctic.svg`
  { id: 'arctic', name: 'Arctic', face: '#ffffff', edge: '#b8e0f0', minTier: 'plus' },
  // Based on `localdocs/skin_void.svg`
  { id: 'void', name: 'Void', face: '#1a1a1b', edge: '#3a3d41', minTier: 'plus' },
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
  return SKINS.map((s) => ({
    ...s,
    locked:
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
