import { useEffect } from 'react';
import type { Direction } from '@/game/types';
import { getSwipeDirection, SWIPE_MIN_DISTANCE_PX } from '@/game/swipe';

type UseGlobalSwipeMovesOptions = {
  enabled: boolean;
  blocked?: boolean;
  baseWidth: number;
  baseHeight: number;
  gameFrameRef: React.RefObject<HTMLElement | null>;
  canAcceptMove: () => boolean;
  onMove: (dir: Direction) => void;
};

export function useGlobalSwipeMoves({
  enabled,
  blocked = false,
  baseWidth,
  baseHeight,
  gameFrameRef,
  canAcceptMove,
  onMove,
}: UseGlobalSwipeMovesOptions) {
  useEffect(() => {
    const isTouchCapable =
      typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator as any).maxTouchPoints > 0);

    if (!isTouchCapable) return;
    if (!enabled) return;
    if (blocked) return;

    let active: { kind: 'touch' | 'pointer'; id: number } | null = null;
    let startX = 0;
    let startY = 0;
    let consumed = false;
    let lastTouchTs = 0;

    const getScale = () => {
      const rect = gameFrameRef.current?.getBoundingClientRect();
      const scaleX = rect && rect.width > 0 ? rect.width / baseWidth : 1;
      const scaleY = rect && rect.height > 0 ? rect.height / baseHeight : 1;
      return {
        scaleX: Math.max(scaleX, 1e-6),
        scaleY: Math.max(scaleY, 1e-6),
      };
    };

    const capture = { capture: true } as const;
    const capturePassive = { capture: true, passive: true } as const;

    const onTouchStartCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (active) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      active = { kind: 'touch', id: touch.identifier };
      startX = touch.clientX;
      startY = touch.clientY;
      consumed = false;
    };

    const onTouchMoveCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (!active || active.kind !== 'touch') return;
      if (consumed) return;

      const t = Array.from(e.touches).find((touch) => touch.identifier === active!.id);
      if (!t) return;

      const { scaleX, scaleY } = getScale();
      const dx = (t.clientX - startX) / scaleX;
      const dy = (t.clientY - startY) / scaleY;
      const dir = getSwipeDirection(dx, dy, SWIPE_MIN_DISTANCE_PX);
      if (!dir) return;
      if (!canAcceptMove()) return;

      onMove(dir);
      consumed = true;
    };

    const onTouchEndCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (!active || active.kind !== 'touch') return;
      const t = Array.from(e.changedTouches).find((touch) => touch.identifier === active!.id);
      if (!t) return;
      active = null;
      consumed = false;
    };

    const onTouchCancelCapture = (e: TouchEvent) => {
      lastTouchTs = Date.now();
      if (!active || active.kind !== 'touch') return;
      const t = Array.from(e.changedTouches).find((touch) => touch.identifier === active!.id);
      if (!t) return;
      active = null;
      consumed = false;
    };

    const onPointerDownCapture = (e: PointerEvent) => {
      if (Date.now() - lastTouchTs < 700) return;
      if (active) return;

      active = { kind: 'pointer', id: e.pointerId };
      startX = e.clientX;
      startY = e.clientY;
      consumed = false;
    };

    const onPointerMoveCapture = (e: PointerEvent) => {
      if (!active || active.kind !== 'pointer' || active.id !== e.pointerId) return;
      if (consumed) return;

      const { scaleX, scaleY } = getScale();
      const dx = (e.clientX - startX) / scaleX;
      const dy = (e.clientY - startY) / scaleY;
      const dir = getSwipeDirection(dx, dy, SWIPE_MIN_DISTANCE_PX);
      if (!dir) return;
      if (!canAcceptMove()) return;

      onMove(dir);
      consumed = true;
    };

    const onPointerUpCapture = (e: PointerEvent) => {
      if (!active || active.kind !== 'pointer' || active.id !== e.pointerId) return;
      active = null;
      consumed = false;
    };

    const onPointerCancelCapture = (e: PointerEvent) => {
      if (!active || active.kind !== 'pointer' || active.id !== e.pointerId) return;
      active = null;
      consumed = false;
    };

    document.addEventListener('touchstart', onTouchStartCapture, capturePassive);
    document.addEventListener('touchmove', onTouchMoveCapture, capturePassive);
    document.addEventListener('touchend', onTouchEndCapture, capture);
    document.addEventListener('touchcancel', onTouchCancelCapture, capture);
    document.addEventListener('pointerdown', onPointerDownCapture, capture);
    document.addEventListener('pointermove', onPointerMoveCapture, capture);
    document.addEventListener('pointerup', onPointerUpCapture, capture);
    document.addEventListener('pointercancel', onPointerCancelCapture, capture);

    return () => {
      document.removeEventListener('touchstart', onTouchStartCapture, capturePassive as any);
      document.removeEventListener('touchmove', onTouchMoveCapture, capturePassive as any);
      document.removeEventListener('touchend', onTouchEndCapture, capture as any);
      document.removeEventListener('touchcancel', onTouchCancelCapture, capture as any);
      document.removeEventListener('pointerdown', onPointerDownCapture, capture as any);
      document.removeEventListener('pointermove', onPointerMoveCapture, capture as any);
      document.removeEventListener('pointerup', onPointerUpCapture, capture as any);
      document.removeEventListener('pointercancel', onPointerCancelCapture, capture as any);
    };
  }, [baseHeight, baseWidth, blocked, canAcceptMove, enabled, gameFrameRef, onMove]);
}

