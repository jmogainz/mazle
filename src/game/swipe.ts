import { Direction } from './types';

// Keep swipe feel consistent across Phaser + DOM handlers.
export const SWIPE_MIN_DISTANCE_PX = 30;

export function getSwipeDirection(dx: number, dy: number, minSwipe = SWIPE_MIN_DISTANCE_PX): Direction | null {
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > minSwipe) {
    return dx > 0 ? Direction.RIGHT : Direction.LEFT;
  }
  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > minSwipe) {
    return dy > 0 ? Direction.DOWN : Direction.UP;
  }
  return null;
}

