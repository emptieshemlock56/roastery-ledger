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
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    // Give up on a connection attempt after 30s instead of waiting forever, so a stalled
    // database shows up as an error in the logs (free Neon databases can take a moment to wake).
    connectionTimeoutMillis: 30_000,
  });
  // An idle connection dropped by the database (e.g. Neon pausing) must not crash the server;
  // the pool simply opens a new one on the next query.
  pool.on('error', (err) => console.error(`Database connection lost (will reconnect): ${err.message}`));
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

/**
 * Runs fn until it succeeds, retrying failures that look like the database being
 * unreachable. Used at start-up so a slow-to-wake database doesn't fail the deploy,
 * while a database that never answers fails with a clear message instead of hanging.
 */
export async function withDbRetry(fn, { attempts = 5, delayMs = 5_000, log = console.error, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (!isConnectionError(err) || i >= attempts) {
        if (isConnectionError(err)) {
          log(`Could not reach the database after ${attempts} attempts: ${err.message}. Check DATABASE_URL and that the Neon project is running.`);
        }
        throw err;
      }
      log(`Database not reachable yet (attempt ${i} of ${attempts}): ${err.message}. Retrying in ${Math.round((delayMs * i) / 1000)}s...`);
      await wait(delayMs * i);
    }
  }
}

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', '57P03']);
export function isConnectionError(err) {
  return CONNECTION_CODES.has(err?.code) || /timeout|terminated unexpectedly|Connection terminated/i.test(err?.message ?? '');
}
