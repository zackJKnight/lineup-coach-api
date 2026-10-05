import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

const app = express();
app.disable('x-powered-by');
const origins = new Set(['https://lineup-coach-game-day.zachary-j-knight.chatgpt.site', 'https://lineup-coach-mvp.vercel.app']);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !!origin && origins.has(origin);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (allowed && origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') { res.sendStatus(allowed ? 204 : 403); return; }
  next();
});
app.use(express.json({ limit: '256kb' }));
let client: NeonQueryFunction<false, false> | undefined;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error('Database unavailable');
  return client ??= neon(process.env.DATABASE_URL);
}
app.get('/health', async (_req, res) => {
  await sql()`SELECT 1 FROM lineup_records LIMIT 1`;
  res.json({ status: 'ok', service: 'lineup-coach-api', version: 1 });
});
const collections = new Set(['teams', 'players', 'positions', 'games', 'periods', 'lineups']);
// A 256-bit device capability is stored only on the device. Its hash scopes all
// records; no plaintext capability is persisted on the server or in source.
app.use((req, res, next) => {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
  if (!token) { res.status(401).json({ error: 'A private sync key is required.' }); return; }
  res.locals.owner = createHash('sha256').update(token).digest('hex');
  next();
});
app.use('/:collection', (req, res, next) => {
  if (!collections.has(req.params.collection)) { res.sendStatus(404); return; }
  next();
});
app.get('/:collection', async (req, res) => {
  const rows = await sql()`SELECT id, body FROM lineup_records WHERE owner = ${res.locals.owner} AND collection = ${req.params.collection} ORDER BY id`;
  res.json(rows.map(row => ({ ...row.body, id: row.id })));
});
app.get('/:collection/:id', async (req, res) => {
  const rows = await sql()`SELECT body FROM lineup_records WHERE owner = ${res.locals.owner} AND collection = ${req.params.collection} AND id = ${req.params.id}`;
  if (!rows.length) { res.sendStatus(404); return; }
  res.json({ ...rows[0].body, id: req.params.id });
});
app.post('/:collection', async (req, res) => {
  if (!validBody(req.body)) { res.status(400).json({ error: 'Expected a JSON object with an optional string id.' }); return; }
  const { id = randomUUID(), ...body } = req.body;
  await sql()`INSERT INTO lineup_records (owner, collection, id, body) VALUES (${res.locals.owner}, ${req.params.collection}, ${id}, ${JSON.stringify(body)}::jsonb) ON CONFLICT (owner, collection, id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`;
  res.status(201).json({ ...body, id });
});
app.put('/:collection/:id', async (req, res) => {
  if (!validBody(req.body) || (req.body.id && req.body.id !== req.params.id)) { res.status(400).json({ error: 'Invalid record or mismatched id.' }); return; }
  const { id: _id, ...body } = req.body;
  const rows = await sql()`UPDATE lineup_records SET body = ${JSON.stringify(body)}::jsonb, updated_at = now() WHERE owner = ${res.locals.owner} AND collection = ${req.params.collection} AND id = ${req.params.id} RETURNING id`;
  if (!rows.length) { res.sendStatus(404); return; }
  res.json({ ...body, id: req.params.id });
});
app.delete('/:collection/:id', async (req, res) => {
  const rows = await sql()`DELETE FROM lineup_records WHERE owner = ${res.locals.owner} AND collection = ${req.params.collection} AND id = ${req.params.id} RETURNING id`;
  res.sendStatus(rows.length ? 204 : 404);
});
function validBody(value: unknown): value is Record<string, unknown> & { id?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const id = (value as { id?: unknown }).id;
  return id === undefined || (typeof id === 'string' && id.length > 0 && id.length <= 200);
}
app.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status === 413 ? 413 : err.status === 400 ? 400 : 503;
  res.status(status).json({ error: status === 503 ? 'Sync unavailable. Your changes remain on your device.' : 'Invalid request body.' });
});
export default app;
