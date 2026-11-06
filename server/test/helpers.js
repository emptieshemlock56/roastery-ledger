import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

export const PASSWORD = 'test-password-123';

// Starts a fresh app + empty database. Uses in-memory PGlite by default;
// CI also runs the suite against real Postgres via TEST_DATABASE_URL.
export async function startTestApp() {
  const config = loadConfig({ APP_ENV: 'test' });
  const db = await createDb({ databaseUrl: process.env.TEST_DATABASE_URL || null });
  if (db.engine === 'postgres') await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);

  const hash = await hashPassword(PASSWORD, config);
  await db.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES
       ('admin@example.test', 'Admin', $1, 'admin'),
       ('member@example.test', 'Member', $1, 'member')`,
    [hash],
  );

  const { app, events } = createApp({ db, config });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    db,
    base,
    async login(email = 'admin@example.test', password = PASSWORD) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ledger' },
        body: JSON.stringify({ email, password }),
      });
      if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
      return client(base, res.headers.get('set-cookie').split(';')[0]);
    },
    anonymous: () => client(base, null),
    async close() {
      events.closeAll();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      await db.close();
    },
  };
}

function client(base, cookie) {
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'X-Requested-With': 'ledger',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b ?? {}),
    patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b),
    del: (p) => call('DELETE', p),
  };
}
