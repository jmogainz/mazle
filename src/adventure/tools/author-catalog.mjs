#!/usr/bin/env node

/**
 * Deterministic Adventure catalog authoring tool.
 *
 * This is deliberately dependency-free so a catalog can be reproduced with:
 *   node src/adventure/tools/author-catalog.mjs
 *
 * It prints the complete platform-neutral JSON document to stdout. Runtime code
 * consumes the checked-in JSON; it never generates or searches for levels.
 */

const TILE = Object.freeze({
  ground: '.',
  wall: '#',
  start: 'S',
  goal: 'G',
  ice: '~',
  ledgeUp: '^',
  ledgeDown: 'v',
  ledgeLeft: '<',
  ledgeRight: '>',
});

const DIRECTIONS = Object.freeze([
  { name: 'up', token: 'U', dx: 0, dy: -1, ledge: TILE.ledgeDown },
  { name: 'right', token: 'R', dx: 1, dy: 0, ledge: TILE.ledgeRight },
  { name: 'down', token: 'D', dx: 0, dy: 1, ledge: TILE.ledgeUp },
  { name: 'left', token: 'L', dx: -1, dy: 0, ledge: TILE.ledgeLeft },
]);

const LEDGE_ENTRY = new Map([
  [TILE.ledgeUp, 'down'],
  [TILE.ledgeDown, 'up'],
  [TILE.ledgeLeft, 'left'],
  [TILE.ledgeRight, 'right'],
]);

const CHAPTERS = Object.freeze([
  {
    id: 'snowdrop-trail',
    index: 1,
    title: 'Snowdrop Trail',
    subtitle: 'Learn the rhythm of every step.',
    theme: 'alpine-dawn',
    colors: { primary: '#78BDE7', accent: '#FFF0A8', background: '#EAF7FF' },
  },
  {
    id: 'glacier-gardens',
    index: 2,
    title: 'Glacier Gardens',
    subtitle: 'Let the ice carry you.',
    theme: 'frozen-garden',
    colors: { primary: '#63A9DB', accent: '#B9F2E6', background: '#DBF2FF' },
  },
  {
    id: 'arrowhead-pass',
    index: 3,
    title: 'Arrowhead Pass',
    subtitle: 'Read the ledges before you leap.',
    theme: 'mountain-pass',
    colors: { primary: '#7987C7', accent: '#FFD083', background: '#E9E9FF' },
  },
  {
    id: 'aurora-ascent',
    index: 4,
    title: 'Aurora Ascent',
    subtitle: 'Mix every lesson on the climb.',
    theme: 'aurora-night',
    colors: { primary: '#6772C8', accent: '#8FF0C7', background: '#E4E9FF' },
  },
  {
    id: 'crown-of-winter',
    index: 5,
    title: 'Crown of Winter',
    subtitle: 'Master the mountain at its peak.',
    theme: 'summit',
    colors: { primary: '#6557A8', accent: '#FFE18A', background: '#EFEAFF' },
  },
]);

const LEVEL_TITLES = Object.freeze([
  'First Footprints', 'Around the Bend', 'Trail Markers', 'A Touch of Ice', 'Easy Does It',
  'Long Way Home', 'Frozen Corner', 'Crossing Paths', 'Bluebird Run', 'Trailhead Test',
  'Garden Gate', 'Glass River', 'Snowbell Sweep', 'Frosted Fork', 'Crystal Steps',
  'Icy Switchback', 'Winter Bloom', 'Mirror Pond', 'Glacier Run', 'Garden Guardian',
  'One Way In', 'Follow the Arrow', 'Passage North', 'Ridge Runner', 'Narrow Landing',
  'Arrow Dance', 'Cloudbreak', 'High Traverse', 'Point of No Return', 'Pass Keeper',
  'Northern Lights', 'Skybridge', 'Prism Path', 'Moonlit Ice', 'Aurora Turn',
  'Polar Crossing', 'Starlight Slalom', 'Night Climb', 'Dancing Ribbons', 'Aurora Guardian',
  'Summit Steps', 'Crown Jewel', 'Whiteout', 'Peak Passage', 'Royal Ridge',
  'Winter Labyrinth', 'Golden Compass', 'Final Approach', 'Top of the World', 'Winter Crown',
]);

const PATH_X = Object.freeze([0.5, 0.7, 0.8, 0.67, 0.42, 0.2, 0.16, 0.32, 0.58, 0.74]);

function hashSeed(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const next = Math.floor(random() * (index + 1));
    [copy[index], copy[next]] = [copy[next], copy[index]];
  }
  return copy;
}

function keyOf(position) {
  return `${position.x},${position.y}`;
}

function samePosition(left, right) {
  return left.x === right.x && left.y === right.y;
}

function canEnter(tile, direction) {
  const allowed = LEDGE_ENTRY.get(tile);
  return allowed === undefined || allowed === direction.name;
}

function simulateMove(rows, start, direction) {
  const height = rows.length;
  const width = rows[0].length;
  let x = start.x + direction.dx;
  let y = start.y + direction.dy;
  if (x < 0 || x >= width || y < 0 || y >= height) return null;
  let tile = rows[y][x];
  if (tile === TILE.wall || !canEnter(tile, direction)) return null;

  const path = [{ x, y }];
  if (tile === TILE.ice) {
    for (let step = 0; step < 100; step += 1) {
      const nextX = x + direction.dx;
      const nextY = y + direction.dy;
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) break;
      tile = rows[nextY][nextX];
      if (tile === TILE.wall) break;
      if (LEDGE_ENTRY.has(tile)) {
        if (!canEnter(tile, direction)) break;
        x = nextX;
        y = nextY;
        path.push({ x, y });
        break;
      }
      x = nextX;
      y = nextY;
      path.push({ x, y });
      if (tile !== TILE.ice) break;
    }
  }
  return { position: { x, y }, path };
}

function findMarker(rows, marker) {
  for (let y = 0; y < rows.length; y += 1) {
    const x = rows[y].indexOf(marker);
    if (x >= 0) return { x, y };
  }
  throw new Error(`Missing marker ${marker}`);
}

function solve(rows) {
  const start = findMarker(rows, TILE.start);
  const goal = findMarker(rows, TILE.goal);
  const queue = [start];
  const distance = new Map([[keyOf(start), 0]]);
  const ways = new Map([[keyOf(start), 1]]);
  const previous = new Map();
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentKey = keyOf(current);
    const nextDistance = distance.get(currentKey) + 1;
    for (const direction of DIRECTIONS) {
      const result = simulateMove(rows, current, direction);
      if (!result || samePosition(result.position, current)) continue;
      const nextKey = keyOf(result.position);
      if (!distance.has(nextKey)) {
        distance.set(nextKey, nextDistance);
        ways.set(nextKey, ways.get(currentKey));
        previous.set(nextKey, { from: current, direction, path: result.path });
        queue.push(result.position);
      } else if (distance.get(nextKey) === nextDistance) {
        ways.set(nextKey, Math.min(1_000_000, ways.get(nextKey) + ways.get(currentKey)));
      }
    }
  }

  const goalKey = keyOf(goal);
  if (!distance.has(goalKey)) return null;
  const steps = [];
  let cursor = goal;
  while (!samePosition(cursor, start)) {
    const edge = previous.get(keyOf(cursor));
    if (!edge) throw new Error('Broken solver predecessor chain');
    steps.push({
      direction: edge.direction,
      from: edge.from,
      to: cursor,
      path: edge.path,
    });
    cursor = edge.from;
  }
  steps.reverse();
  return {
    optimalMoves: distance.get(goalKey),
    shortestSolutionCount: ways.get(goalKey),
    reachableStateCount: distance.size,
    steps,
    solution: steps.map((step) => step.direction.token).join(''),
  };
}

function makePerfectMaze(width, height, random) {
  const grid = Array.from({ length: height }, () => Array(width).fill(TILE.wall));
  const cells = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      grid[y][x] = TILE.ice;
      cells.push({ x, y });
    }
  }

  const start = cells[Math.floor(random() * cells.length)];
  const stack = [start];
  const visited = new Set([keyOf(start)]);
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = shuffle(DIRECTIONS, random)
      .map((direction) => ({
        direction,
        next: { x: current.x + direction.dx * 2, y: current.y + direction.dy * 2 },
      }))
      .filter(({ next }) => (
        next.x > 0 && next.x < width - 1 && next.y > 0 && next.y < height - 1 &&
        !visited.has(keyOf(next))
      ));

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const { direction, next } = candidates[0];
    grid[current.y + direction.dy][current.x + direction.dx] = TILE.ice;
    grid[next.y][next.x] = TILE.ice;
    visited.add(keyOf(next));
    stack.push(next);
  }
  return { grid, cells };
}

function openLoops(grid, random, count) {
  const height = grid.length;
  const width = grid[0].length;
  const candidates = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (grid[y][x] !== TILE.wall) continue;
      const horizontal = grid[y][x - 1] !== TILE.wall && grid[y][x + 1] !== TILE.wall;
      const vertical = grid[y - 1][x] !== TILE.wall && grid[y + 1][x] !== TILE.wall;
      if (horizontal !== vertical) candidates.push({ x, y });
    }
  }
  for (const position of shuffle(candidates, random).slice(0, count)) {
    grid[position.y][position.x] = TILE.ice;
  }
}

function chooseStartAndGoal(grid, cells, random) {
  const shuffled = shuffle(cells, random);
  const start = shuffled[0];
  const goal = shuffled.find((candidate) => (
    Math.abs(start.x - candidate.x) + Math.abs(start.y - candidate.y) >= 2
  ));
  if (!goal) throw new Error('Maze did not contain two distinct cells');
  return {
    start,
    goal,
    distance: Math.abs(start.x - goal.x) + Math.abs(start.y - goal.y),
  };
}

function rowsFromGrid(grid) {
  return grid.map((row) => row.join(''));
}

function insertSolutionLedges(grid, solution, desiredCount, random) {
  const options = [];
  for (const step of solution.steps) {
    for (const position of step.path) {
      const tile = grid[position.y][position.x];
      if (tile !== TILE.ice) continue;
      options.push({ position, ledge: step.direction.ledge });
    }
  }
  const used = new Set();
  let inserted = 0;
  for (const option of shuffle(options, random)) {
    if (inserted >= desiredCount) break;
    const key = keyOf(option.position);
    if (used.has(key)) continue;
    grid[option.position.y][option.position.x] = option.ledge;
    used.add(key);
    inserted += 1;
  }
  return inserted;
}

function solutionUses(rows, solution, predicate) {
  return solution.steps.some((step) => step.path.some((position) => predicate(rows[position.y][position.x])));
}

function levelSpec(levelId) {
  const chapter = Math.ceil(levelId / 10);
  const inChapter = ((levelId - 1) % 10) + 1;
  const sizes = [7, 9, 9, 11, 13];
  const width = sizes[chapter - 1];
  const height = sizes[chapter - 1];
  const bases = [2, 5, 6, 8, 10];
  const targetMin = bases[chapter - 1] + Math.floor((inChapter - 1) * (chapter === 1 ? 0.55 : 0.4));
  const targetMax = targetMin + (chapter < 3 ? 2 : 3);
  const groundChance = levelId <= 3 ? 1 : levelId <= 6 ? 0.35 : chapter === 1 ? 0.12 : chapter === 2 ? 0.05 : 0.02;
  const ledges = chapter < 3 ? 0 : chapter === 3 ? 1 + Number(inChapter >= 7) : chapter === 4 ? 2 : 2 + Number(inChapter >= 5);
  return {
    chapter,
    inChapter,
    width,
    height,
    targetMin,
    targetMax,
    groundChance,
    ledges,
    loops: Math.min(3, Math.floor(inChapter / 4)),
  };
}

function buildCandidate(levelId, attempt) {
  const spec = levelSpec(levelId);
  const seed = `mazle-adventure-v1-${String(levelId).padStart(3, '0')}-candidate-${attempt}`;
  const random = mulberry32(hashSeed(seed));
  const { grid, cells } = makePerfectMaze(spec.width, spec.height, random);
  openLoops(grid, random, spec.loops);
  const markers = chooseStartAndGoal(grid, cells, random);

  for (let y = 1; y < spec.height - 1; y += 1) {
    for (let x = 1; x < spec.width - 1; x += 1) {
      if (grid[y][x] === TILE.ice && random() < spec.groundChance) grid[y][x] = TILE.ground;
    }
  }
  grid[markers.start.y][markers.start.x] = TILE.start;
  grid[markers.goal.y][markers.goal.x] = TILE.goal;

  let rows = rowsFromGrid(grid);
  let solution = solve(rows);
  if (!solution) return null;

  if (spec.ledges > 0) {
    const inserted = insertSolutionLedges(grid, solution, spec.ledges, random);
    if (inserted < spec.ledges) return null;
    rows = rowsFromGrid(grid);
    solution = solve(rows);
    if (!solution) return null;
  }

  if (solution.optimalMoves < spec.targetMin || solution.optimalMoves > spec.targetMax) return null;
  if (solution.shortestSolutionCount !== 1) return null;
  if (solution.reachableStateCount < solution.optimalMoves + 2) return null;
  if (levelId >= 4 && !solutionUses(rows, solution, (tile) => tile === TILE.ice)) return null;
  if (spec.ledges > 0 && !solutionUses(rows, solution, (tile) => LEDGE_ENTRY.has(tile))) return null;

  return { seed, rows, solution, spec };
}

function makeThresholds(optimalMoves) {
  const two = optimalMoves + Math.max(1, Math.ceil(optimalMoves * 0.25));
  const one = optimalMoves + Math.max(3, Math.ceil(optimalMoves * 0.6));
  return { three: optimalMoves, two, one };
}

function difficultyFor(levelId, optimalMoves) {
  if (levelId <= 5) return 'tutorial';
  if (levelId % 10 === 0) return levelId >= 40 ? 'super-hard' : 'hard';
  const chapter = Math.ceil(levelId / 10);
  if (chapter === 1) return 'easy';
  if (chapter <= 3 && optimalMoves <= 9) return 'normal';
  return levelId % 10 === 9 || optimalMoves >= 13 ? 'hard' : 'normal';
}

function mechanicsFor(levelId) {
  if (levelId <= 3) return ['ground'];
  if (levelId <= 6) return ['ground', 'ice'];
  if (levelId <= 20) return ['ice'];
  return ['ice', 'ledge'];
}

function createCatalog() {
  const levels = [];
  for (let levelId = 1; levelId <= 50; levelId += 1) {
    let candidate = null;
    for (let attempt = 0; attempt < 100_000 && !candidate; attempt += 1) {
      candidate = buildCandidate(levelId, attempt);
    }
    if (!candidate) throw new Error(`Could not author level ${levelId}`);
    const chapter = CHAPTERS[candidate.spec.chapter - 1];
    const thresholds = makeThresholds(candidate.solution.optimalMoves);
    const reversePath = chapter.index % 2 === 0;
    const x = reversePath ? 1 - PATH_X[candidate.spec.inChapter - 1] : PATH_X[candidate.spec.inChapter - 1];
    levels.push({
      id: levelId,
      key: `adventure-v1-${String(levelId).padStart(3, '0')}`,
      chapterId: chapter.id,
      chapterIndex: chapter.index,
      levelInChapter: candidate.spec.inChapter,
      title: LEVEL_TITLES[levelId - 1],
      difficulty: difficultyFor(levelId, candidate.solution.optimalMoves),
      seed: candidate.seed,
      mechanics: mechanicsFor(levelId),
      prerequisiteLevelId: levelId === 1 ? null : levelId - 1,
      mapPosition: {
        x: Number(x.toFixed(2)),
        y: Number((0.05 + (candidate.spec.inChapter - 1) * 0.1).toFixed(2)),
      },
      rows: candidate.rows,
      optimalMoves: candidate.solution.optimalMoves,
      solution: candidate.solution.solution,
      moveLimit: thresholds.one,
      starThresholds: thresholds,
    });
  }

  return {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    campaignId: 'mazle-adventure',
    tileLegend: {
      '#': 'wall',
      '.': 'ground',
      S: 'start',
      G: 'goal',
      '~': 'ice',
      '^': 'ledgeUp',
      v: 'ledgeDown',
      '<': 'ledgeLeft',
      '>': 'ledgeRight',
    },
    energyPolicy: {
      maximumHearts: 3,
      regenerationIntervalSeconds: 1800,
      failureCost: 1,
      protectedThroughLevel: 5,
      abandonAfterMoveCostsHeart: true,
      successfulAttemptCostsHeart: false,
    },
    chapters: CHAPTERS.map((chapter) => ({
      ...chapter,
      levelIds: Array.from({ length: 10 }, (_, offset) => (chapter.index - 1) * 10 + offset + 1),
      unlockAfterLevelId: chapter.index === 1 ? null : (chapter.index - 1) * 10,
    })),
    levels,
  };
}

const catalog = createCatalog();
if (process.argv.includes('--summary')) {
  for (const level of catalog.levels) {
    process.stdout.write(
      `${String(level.id).padStart(2, '0')} ${level.rows[0].length}x${level.rows.length} ` +
      `opt=${String(level.optimalMoves).padStart(2, ' ')} limit=${String(level.moveLimit).padStart(2, ' ')} ` +
      `${level.difficulty.padEnd(10)} ${level.solution}\n`,
    );
  }
} else {
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
}
