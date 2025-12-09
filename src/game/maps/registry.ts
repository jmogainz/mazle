import { MapType, PuzzleData, TileType } from '../types';
import { MovementConfig } from '../movement';

/**
 * Psychology-based difficulty metrics for a puzzle
 */
export interface PsychologyMetrics {
  counterIntuitiveMoves: number;      // Moves that go away from goal
  attractiveDecoys: number;           // Wrong moves that look better than optimal
  commitmentGates: number;            // Points where wrong choice is very costly
  falseProgressPaths: number;         // Paths that look good but dead-end or add moves
  optimalMoves?: number;              // Optional - optimal path length
  psychologyScore?: number;           // Optional - computed difficulty score
  difficultyScore?: number;           // Alias for psychologyScore (for compatibility)
}

/**
 * Tileset definition for rendering a map type
 */
export interface TilesetDefinition {
  /** Map of tile type to color (primary fill) */
  tileColors: Map<TileType, number>;
  /** Map of tile type to alternate color (for patterns) */
  tileColorsAlt?: Map<TileType, number>;
  /** Map of tile type to highlight color (for 3D effects) */
  tileHighlights?: Map<TileType, number>;
  /** Background color for the map */
  backgroundColor: number;
}

/**
 * Definition of a map type in the registry.
 * Each map type has its own movement config, tileset, and scoring.
 * 
 * Note: Puzzle generation is handled by WASM/Rust backend.
 * This definition provides runtime config for movement and rendering.
 */
export interface MapTypeDefinition {
  /** The map type identifier */
  type: MapType;
  
  /** Display name for UI */
  displayName: string;
  
  /** Movement configuration for this map type */
  movementConfig: MovementConfig;
  
  /** Tileset for rendering */
  tileset: TilesetDefinition;
  
  /** Selection weight (0 = disabled, higher = more likely to be selected) */
  weight: number;
  
  /** Calculate psychology-based difficulty metrics */
  psychologyScorer?: (puzzle: PuzzleData) => PsychologyMetrics;
}

/**
 * The global map type registry.
 * All available map types are registered here.
 */
class MapRegistry {
  private definitions: Map<MapType, MapTypeDefinition> = new Map();

  /**
   * Register a map type definition
   */
  register(definition: MapTypeDefinition): void {
    this.definitions.set(definition.type, definition);
  }

  /**
   * Get a map type definition by type
   */
  get(type: MapType): MapTypeDefinition | undefined {
    return this.definitions.get(type);
  }

  /**
   * Get all registered map types
   */
  getAll(): MapTypeDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * Get all enabled map types (weight > 0)
   */
  getEnabled(): MapTypeDefinition[] {
    return this.getAll().filter(def => def.weight > 0);
  }

  /**
   * Select a map type using weighted random selection.
   * Uses a separate RNG stream to avoid perturbing puzzle generation.
   * 
   * @param rng - Random number generator (should be seeded with seed + ':maptype')
   * @returns The selected map type definition, or undefined if none enabled
   */
  selectWeighted(rng: { random: () => number }): MapTypeDefinition | undefined {
    const enabled = this.getEnabled();
    if (enabled.length === 0) return undefined;
    
    const totalWeight = enabled.reduce((sum, def) => sum + def.weight, 0);
    if (totalWeight === 0) return undefined;
    
    let random = rng.random() * totalWeight;
    for (const def of enabled) {
      random -= def.weight;
      if (random <= 0) {
        return def;
      }
    }
    
    // Fallback to last enabled (shouldn't happen)
    return enabled[enabled.length - 1];
  }

  /**
   * Check if a map type is registered
   */
  has(type: MapType): boolean {
    return this.definitions.has(type);
  }
}

// Global singleton instance
export const MAP_REGISTRY = new MapRegistry();

/**
 * Helper function to register a map type.
 * Use this in map type index files.
 */
export function registerMapType(definition: MapTypeDefinition): void {
  MAP_REGISTRY.register(definition);
}
