// Movement module - shared movement simulation

export { createLedgeRules } from './types';
export type { MovementConfig, MoveResult, TileBehavior } from './types';

export {
  simulateMove,
  simulateMoveLegacy,
  getDelta,
  getAllDirections,
  isValidPosition,
  isInnerPosition,
  positionKey,
  positionsEqual,
} from './simulateMove';

export { iceMovementConfig } from './configs/ice';
