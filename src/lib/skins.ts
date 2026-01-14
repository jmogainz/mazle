export type SkinDefinition = {
  id: string;
  name: string;
  face: string;
  edge: string;
  locked: boolean;
};

const SKINS: readonly SkinDefinition[] = [
  { id: 'default', name: 'Classic', face: '#ff4d4d', edge: '#cc0000', locked: false },
  { id: 'glacier', name: 'Glacier', face: '#55c1ff', edge: '#1b76b6', locked: false },
  { id: 'forest', name: 'Forest', face: '#34d399', edge: '#059669', locked: true },
  { id: 'shadow', name: 'Shadow', face: '#a78bfa', edge: '#6d28d9', locked: true },
] as const;

export function getAllSkins(): SkinDefinition[] {
  return [...SKINS];
}

export function getSkinById(id: string | null | undefined): SkinDefinition | null {
  if (!id) return null;
  return SKINS.find((skin) => skin.id === id) ?? null;
}

export function getUnlockedSkins(): SkinDefinition[] {
  return SKINS.filter((skin) => !skin.locked);
}

