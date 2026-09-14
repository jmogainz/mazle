import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidAdventureAttemptId,
  isValidAdventureIdempotencyKey,
  validateAdventureMutationRequest,
} from './adventureRequest.ts';

function mutationRequest(headers = {}) {
  return new Request('https://mazle.test/api/adventure/start', {
    method: 'POST',
    headers,
    body: '{}',
  });
}

test('idempotency keys accept UUIDs and namespaced client request IDs', () => {
  assert.equal(isValidAdventureIdempotencyKey('f2dd48f5-0eb2-45ee-994a-5adf2d26fcda'), true);
  assert.equal(isValidAdventureIdempotencyKey('complete:f2dd48f5-0eb2-45ee-994a-5adf2d26fcda'), true);
  assert.equal(isValidAdventureIdempotencyKey('12345678'), true);
});

test('idempotency key boundaries reject unsafe or ambiguous values', () => {
  assert.equal(isValidAdventureIdempotencyKey('1234567'), false);
  assert.equal(isValidAdventureIdempotencyKey('a'.repeat(129)), false);
  assert.equal(isValidAdventureIdempotencyKey('request with spaces'), false);
  assert.equal(isValidAdventureIdempotencyKey('request/with/slashes'), false);
  assert.equal(isValidAdventureIdempotencyKey(null), false);
});

test('attempt IDs must be canonical UUID values', () => {
  assert.equal(isValidAdventureAttemptId('f2dd48f5-0eb2-45ee-994a-5adf2d26fcda'), true);
  assert.equal(isValidAdventureAttemptId('local-attempt-f2dd48f5-0eb2-45ee-994a-5adf2d26fcda'), false);
  assert.equal(isValidAdventureAttemptId('00000000-0000-0000-0000-000000000000'), false);
});

test('mutation requests accept same-origin browser JSON', () => {
  const request = mutationRequest({
    Origin: 'https://mazle.test',
    'Content-Type': 'application/json; charset=UTF-8',
  });
  assert.deepEqual(validateAdventureMutationRequest(request), { ok: true });
});

test('mutation requests accept originless native bearer JSON', () => {
  const request = mutationRequest({
    Authorization: 'Bearer signed-mobile-session',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(validateAdventureMutationRequest(request), { ok: true });
});

test('mutation requests preserve originless JSON clients', () => {
  const request = mutationRequest({ 'Content-Type': 'application/json' });
  assert.deepEqual(validateAdventureMutationRequest(request), { ok: true });
});

test('mutation requests reject a present cross-origin browser origin', () => {
  const request = mutationRequest({
    Origin: 'https://attacker.test',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(validateAdventureMutationRequest(request), {
    ok: false,
    status: 403,
    errorCode: 'CROSS_ORIGIN_REQUEST',
    message: 'Adventure updates must come from this site.',
  });
});

test('mutation requests reject opaque or malformed origins', () => {
  for (const origin of ['null', '', 'not a URL']) {
    const request = mutationRequest({ Origin: origin, 'Content-Type': 'application/json' });
    assert.equal(validateAdventureMutationRequest(request).ok, false, origin);
    assert.equal(validateAdventureMutationRequest(request).status, 403, origin);
  }
});

test('mutation requests reject missing and non-JSON media types', () => {
  for (const contentType of [undefined, 'text/plain', 'application/x-www-form-urlencoded']) {
    const headers = contentType ? { 'Content-Type': contentType } : {};
    const request = mutationRequest(headers);
    assert.deepEqual(validateAdventureMutationRequest(request), {
      ok: false,
      status: 415,
      errorCode: 'JSON_CONTENT_TYPE_REQUIRED',
      message: 'Adventure updates require Content-Type: application/json.',
    });
  }
});
