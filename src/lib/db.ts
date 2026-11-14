import "server-only";
import postgres from "postgres";

// One connection pool per server process. DATABASE_URL is a Postgres address; on Vercel, adding a free Neon
// database from the project's Storage tab fills it in. Tables are created on first use, so a fresh database needs
// no manual setup.

const g = globalThis as unknown as { __sql?: postgres.Sql; __schema?: Promise<void> };

export const hasDatabase = () => Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);

function sql() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL tanımlı değil");
  // prepare: false keeps it working behind poolers (Neon, Supabase) that do not support prepared statements
  g.__sql ??= postgres(url, { max: 5, idle_timeout: 20, prepare: false, onnotice: () => {} });
  return g.__sql;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ig_rules (
    id SERIAL PRIMARY KEY,
    keywords TEXT NOT NULL,
    media_id VARCHAR(40) NOT NULL DEFAULT '',
    media_url TEXT NOT NULL DEFAULT '',
    dm_text TEXT NOT NULL,
    reply_text TEXT NOT NULL DEFAULT '',
    active SMALLINT NOT NULL DEFAULT 1,
    sent_count INTEGER NOT NULL DEFAULT 0,
    follow_gate SMALLINT NOT NULL DEFAULT 0,
    gate_text TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ig_events (
    id SERIAL PRIMARY KEY,
    comment_id VARCHAR(40) NOT NULL UNIQUE,
    rule_id INTEGER NULL,
    username VARCHAR(100) NOT NULL DEFAULT '',
    ig_user_id VARCHAR(40) NOT NULL DEFAULT '',
    account_id VARCHAR(40) NOT NULL DEFAULT '',
    media_id VARCHAR(40) NOT NULL DEFAULT '',
    comment_text VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(12) NOT NULL DEFAULT 'pending',
    error VARCHAR(500) NOT NULL DEFAULT '',
    attempts SMALLINT NOT NULL DEFAULT 0,
    next_try_at TIMESTAMPTZ NULL,
    claimed_at TIMESTAMPTZ NULL,
    sent_at TIMESTAMPTZ NULL,
    replied SMALLINT NOT NULL DEFAULT 0,
    gate_tries SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // every comment asks "how many DMs this hour" and "did this person already get one"; the queue asks "what is due"
  `CREATE INDEX IF NOT EXISTS ig_events_created ON ig_events (created_at)`,
  `CREATE INDEX IF NOT EXISTS ig_events_sent ON ig_events (sent_at)`,
  `CREATE INDEX IF NOT EXISTS ig_events_rule_user ON ig_events (rule_id, ig_user_id)`,
  `CREATE INDEX IF NOT EXISTS ig_events_status_next ON ig_events (status, next_try_at)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    ip VARCHAR(64) NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip, at)`,
  // columns added after the first release; databases created before them get the column here
  `ALTER TABLE ig_rules ADD COLUMN IF NOT EXISTS media_url TEXT NOT NULL DEFAULT ''`,
];

function ensureSchema() {
  g.__schema ??= (async () => {
    for (const stmt of SCHEMA) await sql().unsafe(stmt);
  })().catch((e) => {
    g.__schema = undefined;
    throw e;
  });
  return g.__schema;
}

/** `?` placeholders, numbered in order, so queries read the same as plain SQL. */
const numbered = (text: string) => {
  let n = 0;
  return text.replace(/\?/g, () => `$${++n}`);
};

type Param = string | number | boolean | null | Date;

export async function query<T = Record<string, unknown>>(text: string, params: Param[] = []): Promise<T[]> {
  await ensureSchema();
  const rows = await sql().unsafe(numbered(text), params as never[]);
  return rows as unknown as T[];
}

/** For INSERT/UPDATE/DELETE: how many rows changed, and the rows a RETURNING clause gave back. */
export async function execute<T = Record<string, unknown>>(text: string, params: Param[] = []) {
  await ensureSchema();
  const rows = await sql().unsafe(numbered(text), params as never[]);
  return { count: rows.count ?? 0, rows: rows as unknown as T[] };
}
