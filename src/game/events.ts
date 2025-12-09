// Game event emitter for React communication
// This is separate from the Phaser scene to avoid SSR issues

type GameEventCallback = (data: unknown) => void;
const gameEvents: Map<string, GameEventCallback[]> = new Map();

export function emitGameEvent(event: string, data: unknown) {
  const callbacks = gameEvents.get(event) || [];
  callbacks.forEach((cb) => cb(data));
}

export function onGameEvent(event: string, callback: GameEventCallback) {
  const callbacks = gameEvents.get(event) || [];
  callbacks.push(callback);
  gameEvents.set(event, callbacks);
  return () => {
    const cbs = gameEvents.get(event) || [];
    const idx = cbs.indexOf(callback);
    if (idx >= 0) cbs.splice(idx, 1);
  };
}

