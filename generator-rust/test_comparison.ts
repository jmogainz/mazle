/**
 * Test script to compare TypeScript and Rust generator outputs
 * 
 * Usage:
 *   1. Start the Rust server: cd generator-rust && cargo run --release
 *   2. Run this test: npx ts-node generator-rust/test_comparison.ts
 */

import { generatePuzzle as generateIcePuzzle } from '../src/game/maps/ice/generator';
import { generatePuzzle as generateGroundPuzzle } from '../src/game/maps/ground/generator';

const RUST_SERVER = process.env.RUST_GENERATOR_URL || 'http://localhost:3001';
const TEST_SEEDS = [
  '2024-01-01',
  '2024-01-02', 
  '2024-01-15',
  '2024-02-14',
  '2024-12-25',
  'test-seed-abc',
  'random-puzzle-123',
];

interface PuzzleData {
  width: number;
  height: number;
  tiles: number[][];
  start: { x: number; y: number };
  goal: { x: number; y: number };
  optimalMoves: number;
  mapType: string;
  difficultyScore?: number;
  counterIntuitiveMoves?: number;
}

// Type for the real TS puzzle data
type TSPuzzleData = ReturnType<typeof generateIcePuzzle>;

interface GenerateResponse {
  puzzle: PuzzleData;
  generationTimeMs: number;
}

async function fetchRustPuzzle(seed: string, mapType: string): Promise<GenerateResponse | null> {
  try {
    const response = await fetch(`${RUST_SERVER}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed, mapType }),
    });
    
    if (!response.ok) {
      console.error(`Rust server error: ${response.status}`);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Failed to connect to Rust server:', error);
    return null;
  }
}

function comparePuzzles(ts: PuzzleData, rust: PuzzleData, seed: string): boolean {
  const issues: string[] = [];
  
  // Compare dimensions
  if (ts.width !== rust.width || ts.height !== rust.height) {
    issues.push(`Dimension mismatch: TS ${ts.width}x${ts.height}, Rust ${rust.width}x${rust.height}`);
  }
  
  // Compare start/goal positions
  if (ts.start.x !== rust.start.x || ts.start.y !== rust.start.y) {
    issues.push(`Start mismatch: TS (${ts.start.x},${ts.start.y}), Rust (${rust.start.x},${rust.start.y})`);
  }
  
  if (ts.goal.x !== rust.goal.x || ts.goal.y !== rust.goal.y) {
    issues.push(`Goal mismatch: TS (${ts.goal.x},${ts.goal.y}), Rust (${rust.goal.x},${rust.goal.y})`);
  }
  
  // Compare optimal moves (allow small variance due to algorithm differences)
  const moveDiff = Math.abs(ts.optimalMoves - rust.optimalMoves);
  if (moveDiff > 5) {
    issues.push(`Optimal moves differ significantly: TS ${ts.optimalMoves}, Rust ${rust.optimalMoves}`);
  }
  
  // Note: We don't expect tile-by-tile identical results because:
  // 1. RNG implementations may differ slightly
  // 2. Order of operations may produce different valid puzzles
  // Both should produce valid, solvable puzzles with similar characteristics
  
  if (issues.length > 0) {
    console.log(`  ⚠️  Seed "${seed}" has differences:`);
    issues.forEach(issue => console.log(`      - ${issue}`));
    return false;
  }
  
  return true;
}

async function testMapType(mapType: 'ice' | 'ground') {
  console.log(`\n📊 Testing ${mapType.toUpperCase()} map generator`);
  console.log('━'.repeat(50));
  
  const generateTS = mapType === 'ice' ? generateIcePuzzle : generateGroundPuzzle;
  
  let passed = 0;
  let failed = 0;
  let tsTotal = 0;
  let rustTotal = 0;
  
  for (const seed of TEST_SEEDS) {
    process.stdout.write(`  Testing seed "${seed}"... `);
    
    // Generate with TypeScript
    const tsStart = Date.now();
    const tsPuzzle = generateTS(seed);
    const tsTime = Date.now() - tsStart;
    tsTotal += tsTime;
    
    // Generate with Rust
    const rustResult = await fetchRustPuzzle(seed, mapType);
    
    if (!rustResult) {
      console.log('⚠️  Rust server unavailable');
      continue;
    }
    
    rustTotal += rustResult.generationTimeMs;
    
    // Compare - cast to common interface
    const match = comparePuzzles(tsPuzzle as PuzzleData, rustResult.puzzle, seed);
    
    if (match) {
      console.log(`✓ (TS: ${tsTime}ms, Rust: ${rustResult.generationTimeMs}ms)`);
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`Average time - TS: ${Math.round(tsTotal / TEST_SEEDS.length)}ms, Rust: ${Math.round(rustTotal / TEST_SEEDS.length)}ms`);
  
  if (rustTotal > 0) {
    const speedup = (tsTotal / rustTotal).toFixed(2);
    console.log(`Rust speedup: ${speedup}x faster`);
  }
}

async function main() {
  console.log('🧊 Mazle Generator Comparison Test');
  console.log('===================================');
  console.log(`Rust server: ${RUST_SERVER}`);
  
  // Check Rust server is running
  try {
    const health = await fetch(`${RUST_SERVER}/health`);
    if (!health.ok) throw new Error('Health check failed');
    console.log('✓ Rust server is running');
  } catch (error) {
    console.error('❌ Rust server is not running!');
    console.error('   Start it with: cd generator-rust && cargo run --release');
    process.exit(1);
  }
  
  await testMapType('ice');
  await testMapType('ground');
  
  console.log('\n✅ Comparison tests complete!');
}

main().catch(console.error);
