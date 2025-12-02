// Web Worker that runs puzzle generation with configurable attempt ranges
// This allows parallelization across multiple workers

import { generatePuzzlePartial } from './puzzleGenerator';
import type { PuzzleData } from './types';

export interface WorkerRequest {
  type: 'generate';
  seed: string;
  workerId: number;
  constraintStart: number;
  constraintEnd: number;
  traditionalStart: number;
  traditionalEnd: number;
}

export interface WorkerResponse {
  type: 'result' | 'error';
  workerId: number;
  puzzle?: PuzzleData;
  score?: number;
  error?: string;
}

// Handle messages from main thread
self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  if (e.data.type === 'generate') {
    const { seed, workerId, constraintStart, constraintEnd, traditionalStart, traditionalEnd } = e.data;
    
    try {
      const result = generatePuzzlePartial(
        seed,
        constraintStart,
        constraintEnd,
        traditionalStart,
        traditionalEnd
      );
      
      const response: WorkerResponse = {
        type: 'result',
        workerId,
        puzzle: result.puzzle ?? undefined,
        score: result.score,
      };
      self.postMessage(response);
    } catch (error) {
      const response: WorkerResponse = {
        type: 'error',
        workerId,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      self.postMessage(response);
    }
  }
};

export {};
