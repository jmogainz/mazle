import { NextResponse } from 'next/server';
import type { ApiError } from '@/lib/api/types';

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

export function jsonError(status: number, errorCode: string, message: string, init?: ResponseInit): NextResponse<ApiError> {
  return NextResponse.json(
    { errorCode, message },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...init?.headers,
      },
    }
  );
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) throw new Error('Missing JSON body');
  return JSON.parse(text) as T;
}

