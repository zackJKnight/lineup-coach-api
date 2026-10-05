import { neon } from '@neondatabase/serverless';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = neon(process.env.DATABASE_URL);
await sql`CREATE TABLE IF NOT EXISTS lineup_records (owner text NOT NULL, collection text NOT NULL CHECK (collection IN ('teams','players','positions','games','periods','lineups')), id text NOT NULL, body jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (owner, collection, id))`;
console.log('Schema ready');
