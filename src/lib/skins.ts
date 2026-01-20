export type SkinTier = 'guest' | 'account' | 'plus';

export type SkinCatalogEntry = {
  id: string;
  name: string;
  face: string;
  edge: string;
  minTier: SkinTier;
};

export type SkinDefinition = SkinCatalogEntry & { locked: boolean };

const SKINS: readonly SkinCatalogEntry[] = [
  // Guest (default only)
  { id: 'default', name: 'Classic', face: '#ff4d4d', edge: '#cc0000', minTier: 'guest' },

  // Signed-in free (account tier)
  // Based on `localdocs/skin_mint.svg`
  { id: 'mint', name: 'Mint', face: '#a8d8a8', edge: '#538d4e', minTier: 'account' },
  // Based on `localdocs/skin_royal.svg`
  { id: 'royal', name: 'Royal', face: '#4f2db3', edge: '#a78bfa', minTier: 'account' },

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

export function isSkinUnlockedForTier(skinId: string | null | undefined, tier: SkinTier): boolean {
  if (!skinId) return false;
  const skin = getSkinById(skinId);
  if (!skin) return false;
  return tierRank(tier) >= tierRank(skin.minTier);
}

export function getAllSkins(): SkinCatalogEntry[] {
  return [...SKINS];
}

export function getAllSkinsForTier(tier: SkinTier): SkinDefinition[] {
  const rank = tierRank(tier);
  return SKINS.map((s) => ({
    ...s,
    locked: rank < tierRank(s.minTier),
  }));
}

export function getSkinById(id: string | null | undefined): SkinCatalogEntry | null {
  if (!id) return null;
  return SKINS.find((skin) => skin.id === id) ?? null;
}

export function getUnlockedSkinsForTier(tier: SkinTier): SkinCatalogEntry[] {
  const rank = tierRank(tier);
  return SKINS.filter((s) => rank >= tierRank(s.minTier));
}
