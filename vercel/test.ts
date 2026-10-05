import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import app from './server.ts';

test('persistent CRUD, retry safety, isolation, validation and CORS', async () => {
  const server = process.env.TEST_BASE_URL ? undefined : app.listen(0, '127.0.0.1');
  if (server) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server?.address();
  const base = process.env.TEST_BASE_URL ?? `http://127.0.0.1:${typeof address === 'object' ? address?.port : 0}`;
  const token = randomBytes(32).toString('hex');
  const id = `verification-${randomUUID()}`;
  const request = (path: string, method = 'GET', body?: unknown, key = token) => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/teams')).status, 401);
    assert.equal((await request('/teams/' + id, 'PUT', { id, name: 'Test' })).status, 404);
    assert.equal((await request('/teams', 'POST', { id, name: 'Test', playerIds: [], extra: { retained: true } })).status, 201);
    assert.equal((await request('/teams', 'POST', { id, name: 'Retry', extra: { retained: true } })).status, 201);
    assert.equal((await (await request('/teams')).json()).length, 1);
    assert.equal((await request('/teams/' + id, 'GET', undefined, randomBytes(32).toString('hex'))).status, 404);
    assert.equal((await request('/teams/' + id, 'PUT', { id: 'wrong' })).status, 400);
    const update = await request('/teams/' + id, 'PUT', { id, name: 'Updated', attendance: { a: false } });
    assert.equal(update.status, 200);
    assert.deepEqual(await (await request('/teams/' + id)).json(), { id, name: 'Updated', attendance: { a: false } });
    assert.equal((await request('/unknown')).status, 404);
    assert.equal((await request('/players', 'POST', [])).status, 400);
    const preflight = await fetch(base + '/teams', { method: 'OPTIONS', headers: { Origin: 'https://lineup-coach-game-day.zachary-j-knight.chatgpt.site', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://lineup-coach-game-day.zachary-j-knight.chatgpt.site');
    assert.equal((await request('/teams/' + id, 'DELETE')).status, 204);
    assert.equal((await request('/teams/' + id, 'DELETE')).status, 404);
  } finally {
    await request('/teams/' + id, 'DELETE');
    server?.close();
  }
});
