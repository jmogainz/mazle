import { Direction, type Position } from '../game/types';
import { iceMovementConfig, positionKey, positionsEqual, simulateMove } from '../game/movement';
import type {
  AdventureLevelDefinition,
  AdventureSolveStep,
  AdventureSolverResult,
} from './types';

/** Stable order keeps canonical solver output identical on every platform/run. */
export const ADVENTURE_DIRECTION_ORDER: readonly Direction[] = Object.freeze([
  Direction.UP,
  Direction.RIGHT,
  Direction.DOWN,
  Direction.LEFT,
]);

interface SearchEdge {
  from: Position;
  direction: Direction;
  path: Position[];
}

interface SearchGraph {
  positions: Map<string, Position>;
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
}

function buildReachableGraph(level: AdventureLevelDefinition): SearchGraph {
  const positions = new Map<string, Position>();
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const queue: Position[] = [{ ...level.start }];
  positions.set(positionKey(level.start), { ...level.start });
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentKey = positionKey(current);
    const nextKeys = new Set<string>();
    for (const direction of ADVENTURE_DIRECTION_ORDER) {
      const result = simulateMove(
        level.tiles,
        current,
        direction,
        level.width,
        level.height,
        iceMovementConfig,
      );
      if (!result.valid || positionsEqual(result.pos, current)) continue;
      const nextKey = positionKey(result.pos);
      nextKeys.add(nextKey);
      if (!positions.has(nextKey)) {
        positions.set(nextKey, { ...result.pos });
        queue.push({ ...result.pos });
      }
      const predecessors = incoming.get(nextKey) ?? [];
      if (!predecessors.includes(currentKey)) predecessors.push(currentKey);
      incoming.set(nextKey, predecessors);
    }
    outgoing.set(currentKey, [...nextKeys]);
  }
  return { positions, outgoing, incoming };
}

function countDeadStates(level: AdventureLevelDefinition, graph: SearchGraph): number {
  const goalKey = positionKey(level.goal);
  if (!graph.positions.has(goalKey)) return graph.positions.size;
  const canReachGoal = new Set<string>([goalKey]);
  const queue = [goalKey];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    for (const predecessor of graph.incoming.get(current) ?? []) {
      if (canReachGoal.has(predecessor)) continue;
      canReachGoal.add(predecessor);
      queue.push(predecessor);
    }
  }
  let deadStates = 0;
  for (const key of graph.positions.keys()) {
    if (!canReachGoal.has(key)) deadStates += 1;
  }
  return deadStates;
}

export function solveAdventureLevel(level: AdventureLevelDefinition): AdventureSolverResult {
  const start = { ...level.start };
  const startKey = positionKey(start);
  const goalKey = positionKey(level.goal);
  const queue: Position[] = [start];
  const distances = new Map<string, number>([[startKey, 0]]);
  const shortestPathCounts = new Map<string, number>([[startKey, 1]]);
  const previous = new Map<string, SearchEdge>();
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentKey = positionKey(current);
    const nextDistance = (distances.get(currentKey) ?? 0) + 1;
    for (const direction of ADVENTURE_DIRECTION_ORDER) {
      const result = simulateMove(
        level.tiles,
        current,
        direction,
        level.width,
        level.height,
        iceMovementConfig,
      );
      if (!result.valid || positionsEqual(result.pos, current)) continue;

      const nextKey = positionKey(result.pos);
      if (!distances.has(nextKey)) {
        distances.set(nextKey, nextDistance);
        shortestPathCounts.set(nextKey, shortestPathCounts.get(currentKey) ?? 1);
        previous.set(nextKey, {
          from: { ...current },
          direction,
          path: (result.path ?? [{ ...result.pos }]).map((position) => ({ ...position })),
        });
        queue.push({ ...result.pos });
      } else if (distances.get(nextKey) === nextDistance) {
        const paths = (shortestPathCounts.get(nextKey) ?? 0) + (shortestPathCounts.get(currentKey) ?? 0);
        shortestPathCounts.set(nextKey, Math.min(Number.MAX_SAFE_INTEGER, paths));
      }
    }
  }

  const graph = buildReachableGraph(level);
  const deadStateCount = countDeadStates(level, graph);
  if (!distances.has(goalKey)) {
    return {
      solvable: false,
      optimalMoves: null,
      directions: [],
      stops: [start],
      steps: [],
      shortestSolutionCount: 0,
      reachableStateCount: distances.size,
      deadStateCount,
    };
  }

  const reversedSteps: AdventureSolveStep[] = [];
  let cursor = { ...level.goal };
  while (!positionsEqual(cursor, start)) {
    const edge = previous.get(positionKey(cursor));
    if (!edge) throw new Error(`Solver predecessor chain is incomplete for level ${level.id}.`);
    reversedSteps.push({
      direction: edge.direction,
      from: { ...edge.from },
      to: { ...cursor },
      path: edge.path.map((position) => ({ ...position })),
    });
    cursor = { ...edge.from };
  }
  const steps = reversedSteps.reverse();
  return {
    solvable: true,
    optimalMoves: distances.get(goalKey) ?? steps.length,
    directions: steps.map((step) => step.direction),
    stops: [start, ...steps.map((step) => ({ ...step.to }))],
    steps,
    shortestSolutionCount: shortestPathCounts.get(goalKey) ?? 1,
    reachableStateCount: distances.size,
    deadStateCount,
  };
}

export function playAdventureSolution(
  level: AdventureLevelDefinition,
  directions: readonly Direction[],
): { valid: boolean; finalPosition: Position; stops: Position[]; steps: AdventureSolveStep[] } {
  let current = { ...level.start };
  const stops: Position[] = [{ ...current }];
  const steps: AdventureSolveStep[] = [];
  for (const direction of directions) {
    const result = simulateMove(
      level.tiles,
      current,
      direction,
      level.width,
      level.height,
      iceMovementConfig,
    );
    if (!result.valid || positionsEqual(result.pos, current)) {
      return { valid: false, finalPosition: current, stops, steps };
    }
    steps.push({
      direction,
      from: { ...current },
      to: { ...result.pos },
      path: (result.path ?? [{ ...result.pos }]).map((position) => ({ ...position })),
    });
    current = { ...result.pos };
    stops.push({ ...current });
  }
  return { valid: true, finalPosition: current, stops, steps };
}
