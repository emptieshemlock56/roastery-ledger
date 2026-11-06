import { mkdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// One small interface over two engines:
//  - real Postgres (staging, production, CI) when DATABASE_URL is set
//  - PGlite, an embedded Postgres, for local dev and tests (nothing to install)
//
// db.query(sql, params) -> { rows }
// db.exec(sql)          -> runs a multi-statement script (migrations)
// db.tx(async (t) => {})-> transaction; t has the same query/exec methods

export async function createDb({ databaseUrl, databaseSsl, pgliteDir }) {
  if (databaseUrl) return createPostgres(databaseUrl, databaseSsl);
  return createPglite(pgliteDir);
}

function createPostgres(url, ssl) {
  const pool = new pg.Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : undefined });
  const wrap = (c) => ({ query: (text, params) => c.query(text, params), exec: (text) => c.query(text) });
  return {
    engine: 'postgres',
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function createPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) mkdirSync(path.dirname(path.resolve(dir)), { recursive: true });
  const db = dir ? new PGlite(dir) : new PGlite();
  await db.waitReady;
  const wrap = (c) => ({ query: (text, params) => c.query(text, params), exec: (text) => c.exec(text) });
  return {
    engine: 'pglite',
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  };
}
