// Map registry and types
export { MAP_REGISTRY, registerMapType } from './registry';
export type {
  MapTypeDefinition,
  PsychologyMetrics,
  PartialGenerationResult,
  TilesetDefinition,
} from './registry';

// Import map type modules to trigger registration
// These are imported for side effects (they register themselves)
import './ice';
import './ground'; // Registered but disabled (weight: 0)

