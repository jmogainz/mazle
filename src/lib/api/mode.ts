export type ApiMode = 'real' | 'mock';

export function getApiMode(): ApiMode {
  const explicit = process.env.NEXT_PUBLIC_MAZLE_API_MODE;
  if (explicit === 'real' || explicit === 'mock') return explicit;
  return process.env.NODE_ENV === 'production' ? 'real' : 'mock';
}

