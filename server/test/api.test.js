import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestApp } from './helpers.js';

let t;
let admin;
let member;
const ids = {};

before(async () => {
  t = await startTestApp();
  admin = await t.login();
  member = await t.login('member@example.test');
});
after(() => t.close());

const stockOf = async (id) => (await admin.get('/api/stock')).data.find((r) => r.id === id).on_hand;

describe('auth', () => {
  test('rejects requests without a session', async () => {
    assert.equal((await t.anonymous().get('/api/stock')).status, 401);
  });

  test('rejects a wrong password', async () => {
    await assert.rejects(t.login('admin@example.test', 'wrong-password'));
  });

  test('rejects writes without the app header (cross-site protection)', async () => {
    const res = await fetch(`${t.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.test', password: 'x' }),
    });
    assert.equal(res.status, 403);
  });

  test('only admins manage users', async () => {
    const body = { email: 'partner@example.test', name: 'Partner', password: 'partner-pass-123' };
    assert.equal((await member.post('/api/users', body)).status, 403);
    const created = await admin.post('/api/users', body);
    assert.equal(created.status, 201);
    assert.equal(created.data.role, 'member');

    await admin.patch(`/api/users/${created.data.id}`, { active: false });
    await assert.rejects(t.login('partner@example.test', 'partner-pass-123'));
  });

  test('admins cannot lock themselves out', async () => {
    const me = (await admin.get('/api/auth/me')).data.user;
    assert.equal((await admin.patch(`/api/users/${me.id}`, { active: false })).status, 400);
  });
});

describe('catalog', () => {
  test('creates items and recipes', async () => {
    const mk = async (key, body) => {
      const r = await member.post('/api/items', body);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      ids[key] = r.data.id;
    };
    await mk('green', { code: 'GRN-1', name: 'Brazil green', type: 'green' });
    await mk('roasted', { code: 'RST-1', name: 'Brazil roasted', type: 'roasted' });
    await mk('bag', { code: 'BAG-12', name: '12oz bag', type: 'packaging', unit: 'each' });
    await mk('fg', { code: 'FG-12', name: 'Brazil 12oz', type: 'finished', unit: 'each', pack_size_oz: 12, units_per_case: 12 });

    const r = await member.put(`/api/items/${ids.fg}/components`, {
      components: [
        { component_item_id: ids.roasted, qty_per_unit: 0.75 },
        { component_item_id: ids.bag, qty_per_unit: 1 },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.components.length, 2);
  });

  test('rejects duplicate codes and bad types', async () => {
    assert.equal((await admin.post('/api/items', { code: 'GRN-1', name: 'Dup', type: 'green' })).status, 409);
    assert.equal((await admin.post('/api/items', { code: 'X', name: 'X', type: 'spaceship' })).status, 400);
  });
});

describe('inventory ledger', () => {
  test('receive -> roast -> pack -> ship updates stock', async () => {
    let r = await member.post('/api/movements', {
      kind: 'receive',
      lines: [
        { item_id: ids.green, qty: 1000, lot_code: 'LOT-A' },
        { item_id: ids.bag, qty: 500 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(await stockOf(ids.green), 1000);

    r = await member.post('/api/movements', {
      kind: 'roast',
      lines: [
        { item_id: ids.green, qty: -119, lot_code: 'LOT-A' },
        { item_id: ids.roasted, qty: 100 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(await stockOf(ids.green), 881);
    assert.equal(await stockOf(ids.roasted), 100);

    const preview = await member.post('/api/movements/preview', { item_id: ids.fg, qty: 120 });
    assert.deepEqual(
      preview.data.lines.map((l) => [l.code, l.qty]),
      [['FG-12', 120], ['RST-1', -90], ['BAG-12', -120]],
    );
    r = await member.post('/api/movements', { kind: 'pack', lines: preview.data.lines });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(await stockOf(ids.fg), 120);
    assert.equal(await stockOf(ids.roasted), 10);
    assert.equal(await stockOf(ids.bag), 380);

    r = await member.post('/api/movements', { kind: 'ship', reference: 'SO-1', lines: [{ item_id: ids.fg, qty: -24 }] });
    assert.equal(r.status, 201);
    assert.equal(await stockOf(ids.fg), 96);
  });

  test('warns when stock goes negative but still records it', async () => {
    const r = await member.post('/api/movements', { kind: 'ship', lines: [{ item_id: ids.fg, qty: -100 }] });
    assert.equal(r.status, 201);
    assert.match(r.data.warnings[0], /Brazil 12oz is now at -4/);
  });

  test('voiding reverses the effect and keeps the record', async () => {
    const list = await admin.get(`/api/movements?kind=ship`);
    const last = list.data[0];
    const r = await member.post(`/api/movements/${last.id}/void`, { reason: 'Typo' });
    assert.equal(r.status, 200);
    assert.ok(r.data.voided_at);
    assert.equal(await stockOf(ids.fg), 96);
    assert.equal((await member.post(`/api/movements/${last.id}/void`, { reason: 'again' })).status, 409);
    assert.equal((await admin.get('/api/movements?kind=ship')).data.length, 2);
  });

  test('rejects invalid movements', async () => {
    const r = await member.post('/api/movements', { kind: 'roast', lines: [{ item_id: ids.bag, qty: 5 }] });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /can't be produced in a roast/);
  });

  test('lots show what remains per lot code', async () => {
    const r = await admin.get(`/api/stock/lots?item_id=${ids.green}`);
    assert.deepEqual(r.data.map((l) => [l.lot_code, l.on_hand]), [['LOT-A', 881]]);
  });

  test('stock count records only the differences', async () => {
    const r = await member.post('/api/stock/count', {
      counts: [
        { item_id: ids.green, counted: 875 },
        { item_id: ids.bag, counted: 380 },
      ],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.changed, 1);
    assert.equal(await stockOf(ids.green), 875);
  });

  test('items with history cannot be deleted', async () => {
    assert.equal((await admin.del(`/api/items/${ids.green}`)).status, 409);
  });

  test('production report totals roasting and packing', async () => {
    const from = new Date(Date.now() - 86400000).toISOString();
    const to = new Date(Date.now() + 86400000).toISOString();
    const r = await admin.get(`/api/reports/production?from=${from}&to=${to}`);
    const roast = r.data.find((x) => x.kind === 'roast');
    assert.equal(roast.output_qty, 100);
    assert.equal(roast.input_lbs, 119);
    const pack = r.data.find((x) => x.kind === 'pack');
    assert.equal(pack.output_qty, 120);
    assert.equal(pack.input_lbs, 90);
  });
});

describe('import', () => {
  test('creates/updates items by code and sets counts', async () => {
    const r = await admin.post('/api/import/items', {
      rows: [
        { code: 'GRN-2', name: 'Colombia green', type: 'green', unit: 'lb', on_hand: '500' },
        { Code: 'GRN-1', Name: 'Brazil green (renamed)', on_hand: '900' },
        { code: 'BAD', name: 'Bad row', type: 'nope' },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.created, 1);
    assert.equal(r.data.updated, 1);
    assert.equal(r.data.counted, 2);
    assert.equal(r.data.errors.length, 1);
    assert.equal(r.data.errors[0].row, 4);
    assert.equal(await stockOf(ids.green), 900);
  });
});
