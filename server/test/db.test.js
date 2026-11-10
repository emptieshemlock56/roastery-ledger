import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDb, isConnectionError, withDbRetry } from '../src/db.js';

const noSleep = async () => {};

test('retries while the database is waking up, then succeeds', async () => {
  const logs = [];
  let calls = 0;
  const result = await withDbRetry(
    async () => {
      if (++calls < 3) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return 'ok';
    },
    { sleep: noSleep, log: (m) => logs.push(m) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
  assert.equal(logs.length, 2);
  assert.match(logs[0], /attempt 1 of 5/);
});

test('gives up with a clear message when the database never answers', async () => {
  const logs = [];
  const err = Object.assign(new Error('Connection terminated due to connection timeout'), {});
  await assert.rejects(withDbRetry(() => Promise.reject(err), { attempts: 3, sleep: noSleep, log: (m) => logs.push(m) }), err);
  assert.equal(logs.length, 3);
  assert.match(logs.at(-1), /Could not reach the database after 3 attempts.*Check DATABASE_URL/);
});

test('does not retry real SQL errors', async () => {
  let calls = 0;
  const sqlError = Object.assign(new Error('syntax error at or near "SELEC"'), { code: '42601' });
  await assert.rejects(withDbRetry(() => (calls++, Promise.reject(sqlError)), { sleep: noSleep, log: () => {} }), sqlError);
  assert.equal(calls, 1);
  assert.equal(isConnectionError(sqlError), false);
});

test('an unreachable Postgres fails fast instead of hanging', async () => {
  const db = await createDb({ databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none' });
  const started = Date.now();
  await assert.rejects(
    withDbRetry(() => db.query('SELECT 1'), { attempts: 2, sleep: noSleep, log: () => {} }),
    (err) => isConnectionError(err),
  );
  assert.ok(Date.now() - started < 10_000);
  await db.close();
});
