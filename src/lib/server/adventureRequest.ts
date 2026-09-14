export type AdventureMutationRequestValidation =
  | { ok: true }
  | {
      ok: false;
      status: 403 | 415;
      errorCode: 'CROSS_ORIGIN_REQUEST' | 'JSON_CONTENT_TYPE_REQUIRED';
      message: string;
    };

export function validateAdventureMutationRequest(request: Request): AdventureMutationRequestValidation {
  const suppliedOrigin = request.headers.get('origin');
  if (suppliedOrigin !== null) {
    try {
      const requestUrl = new URL(request.url);
      const originUrl = new URL(suppliedOrigin);
      const isHttpOrigin = originUrl.protocol === 'http:' || originUrl.protocol === 'https:';
      if (!isHttpOrigin || originUrl.origin !== requestUrl.origin) {
        return {
          ok: false,
          status: 403,
          errorCode: 'CROSS_ORIGIN_REQUEST',
          message: 'Adventure updates must come from this site.',
        };
      }
    } catch {
      return {
        ok: false,
        status: 403,
        errorCode: 'CROSS_ORIGIN_REQUEST',
        message: 'Adventure updates must come from this site.',
      };
    }
  }

  const mediaType = request.headers.get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== 'application/json') {
    return {
      ok: false,
      status: 415,
      errorCode: 'JSON_CONTENT_TYPE_REQUIRED',
      message: 'Adventure updates require Content-Type: application/json.',
    };
  }

  return { ok: true };
}

export function isValidAdventureIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value);
}

export function isValidAdventureAttemptId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
