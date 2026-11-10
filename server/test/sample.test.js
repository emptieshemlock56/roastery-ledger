import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestApp } from './helpers.js';

let t;
let admin;
let member;

before(async () => {
  t = await startTestApp();
  admin = await t.login();
  member = await t.login('member@example.test');
});
after(() => t.close());

describe('sample data (practice copies only)', () => {
  test('only admins can load it', async () => {
    assert.equal((await member.post('/api/sample-data')).status, 403);
    assert.deepEqual((await admin.get('/api/sample-data')).data, { allowed: true, loaded: false });
  });

  test('loads a realistic history without negative stock', async () => {
    const res = await admin.post('/api/sample-data');
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.ok(res.data.items >= 30, `items: ${res.data.items}`);
    assert.ok(res.data.movements >= 150, `movements: ${res.data.movements}`);
    assert.equal(res.data.voided, 1);

    const stock = (await admin.get('/api/stock')).data.filter((s) => s.code.startsWith('DEMO-'));
    assert.ok(stock.length >= 30);
    for (const s of stock) assert.ok(Number(s.on_hand) >= 0, `${s.code} is ${s.on_hand}`);
    const kinds = new Set((await admin.get('/api/movements?limit=1000')).data.map((m) => m.kind));
    for (const k of ['receive', 'roast', 'blend', 'pack', 'ship', 'adjust']) assert.ok(kinds.has(k), `has ${k}`);

    assert.equal((await admin.post('/api/sample-data')).status, 409, 'not twice');
    assert.equal((await admin.get('/api/sample-data')).data.loaded, true);
  });

  test('can be removed again', async () => {
    const res = await admin.del('/api/sample-data');
    assert.equal(res.status, 200);
    assert.ok(res.data.movements >= 150);
    const left = (await admin.get('/api/items')).data.filter((i) => i.code.startsWith('DEMO-'));
    assert.equal(left.length, 0);
    assert.equal((await admin.get('/api/sample-data')).data.loaded, false);
  });
});

describe('sample data in production', () => {
  test('is refused', async () => {
    const prod = await startTestApp({ appEnv: 'production' });
    try {
      const a = await prod.login();
      assert.deepEqual((await a.get('/api/sample-data')).data, { allowed: false, loaded: false });
      assert.equal((await a.post('/api/sample-data')).status, 403);
      assert.equal((await a.del('/api/sample-data')).status, 403);
    } finally {
      await prod.close();
    }
  });
});
