import { getApiMode } from './mode';
import { mockApi } from './mock';
import { realApi } from './real';

export const api = getApiMode() === 'mock' ? mockApi : realApi;

export { getApiMode, type ApiMode } from './mode';
export * from './types';

