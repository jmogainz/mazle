import { realApi } from './real';

export const api = realApi;

// Returns 'real' since there's no mock API implementation
export function getApiMode(): 'real' | 'mock' {
    return 'real';
}

export * from './types';
