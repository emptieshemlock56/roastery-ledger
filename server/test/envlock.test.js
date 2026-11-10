import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { claimEnvironment, WrongDatabaseError } from '../src/envlock.js';
import { startTestApp } from './helpers.js';

let t;
before(async () => {
  t = await startTestApp();
});
after(() => t.close());

test('a deployed server claims an unmarked database, and other environments are refused', async () => {
  assert.equal(await claimEnvironment(t.db, 'staging'), 'staging');
  assert.equal(await claimEnvironment(t.db, 'staging'), 'staging', 'restarting is fine');
  await assert.rejects(claimEnvironment(t.db, 'production'), (err) => {
    assert.ok(err instanceof WrongDatabaseError);
    assert.match(err.message, /belongs to "staging"/);
    return true;
  });
  const { rows } = await t.db.query('SELECT env FROM app_environment');
  assert.deepEqual(rows, [{ env: 'staging' }], 'the marker is unchanged');
});
