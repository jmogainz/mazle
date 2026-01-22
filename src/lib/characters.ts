export type CharacterDefinition = {
    id: string;
    name: string;
    locked: boolean;
};

const CHARACTERS: readonly CharacterDefinition[] = [
    { id: 'default', name: 'Cube', locked: false },
    { id: 'cylinder', name: 'Cylinder', locked: true },
    { id: 'pyramid', name: 'Pyramid', locked: true },
] as const;

export function getAllCharacters(): CharacterDefinition[] {
    return [...CHARACTERS];
}

export function getCharacterById(id: string | null | undefined): CharacterDefinition | null {
    if (!id) return null;
    return CHARACTERS.find((c) => c.id === id) ?? null;
}

export function getUnlockedCharacters(): CharacterDefinition[] {
    return CHARACTERS.filter((c) => !c.locked);
}
