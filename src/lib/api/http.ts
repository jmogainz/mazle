import type { ApiError } from './types';

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let errorBody: ApiError | null = null;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // ignore
    }
    const message = errorBody?.message || `${response.status} ${response.statusText}`;
    const errorCode = errorBody?.errorCode || 'HTTP_ERROR';
    const error = new Error(message) as Error & { errorCode?: string; status?: number };
    error.errorCode = errorCode;
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

