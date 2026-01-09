/**
 * Tileset rendering utilities.
 * 
 * Provides a unified interface for rendering tiles based on tileset definitions.
 */

import { TileType } from '../types';
import { TilesetDefinition } from '../maps/registry';

/**
 * Get the primary color for a tile type from a tileset.
 * Falls back to a default color if not defined.
 */
export function getTileColor(tileset: TilesetDefinition, tile: TileType): number {
  return tileset.tileColors.get(tile) ?? 0x888888;
}

/**
 * Get the alternate color for a tile type (used for patterns like checkerboard).
 * Falls back to primary color if not defined.
 */
export function getTileColorAlt(tileset: TilesetDefinition, tile: TileType): number {
  return tileset.tileColorsAlt?.get(tile) ?? getTileColor(tileset, tile);
}

/**
 * Get the highlight color for a tile type (used for 3D effects, shine, etc.).
 * Returns undefined if not defined.
 */
export function getTileHighlight(tileset: TilesetDefinition, tile: TileType): number | undefined {
  return tileset.tileHighlights?.get(tile);
}

/**
 * Check if a tile should use alternating colors (checkerboard pattern).
 */
export function shouldUseAltColor(gridX: number, gridY: number): boolean {
  return (gridX + gridY) % 2 === 0;
}

/**
 * Tile rendering information for a specific tile.
 */
export interface TileRenderInfo {
  primaryColor: number;
  altColor?: number;
  highlightColor?: number;
  useAlt: boolean;
}

/**
 * Get complete rendering information for a tile.
 */
export function getTileRenderInfo(
  tileset: TilesetDefinition,
  tile: TileType,
  gridX: number,
  gridY: number
): TileRenderInfo {
  return {
    primaryColor: getTileColor(tileset, tile),
    altColor: tileset.tileColorsAlt?.get(tile),
    highlightColor: getTileHighlight(tileset, tile),
    useAlt: shouldUseAltColor(gridX, gridY),
  };
}


