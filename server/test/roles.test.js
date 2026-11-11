import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestApp } from './helpers.js';

const PW = 'tester-pass-123';
// A real 1x1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let t;
let admin;
let roles; // by name
const ids = {};

async function addUser(email, roleName) {
  const body = { email, name: email.split('@')[0], password: PW };
  if (roleName) body.role_id = roles[roleName].id;
  const r = await admin.post('/api/users', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return t.login(email, PW);
}

before(async () => {
  t = await startTestApp();
  admin = await t.login();
  const list = (await admin.get('/api/roles')).data.roles;
  roles = Object.fromEntries(list.map((r) => [r.name, r]));

  const mk = async (key, body) => (ids[key] = (await admin.post('/api/items', body)).data.id);
  await mk('green', { code: 'G1', name: 'Green A', type: 'green', unit: 'lb' });
  await mk('roasted', { code: 'R1', name: 'Roasted A', type: 'roasted', unit: 'lb' });
  await admin.post('/api/movements', { kind: 'receive', lines: [{ item_id: ids.green, qty: 500 }] });
});
after(() => t.close());

describe('starting roles', () => {
  test('the standard roles exist and existing members keep full access', async () => {
    for (const name of ['Staff (full access)', 'Roast manager', 'Packing manager', 'Shipping manager', 'View only']) {
      assert.ok(roles[name], name);
    }
    const member = await t.login('member@example.test');
    const me = (await member.get('/api/auth/me')).data.user;
    assert.equal(me.role_name, 'Staff (full access)');
    assert.equal(me.permissions.length, 9);
  });

  test('admins get every permission; /auth/me reports them', async () => {
    const me = (await admin.get('/api/auth/me')).data.user;
    assert.equal(me.role_name, 'Administrator');
    assert.equal(me.permissions.length, 9);
  });
});

describe('a roast manager', () => {
  let roast;
  let roastEntryId;
  before(async () => {
    roast = await addUser('roaster@example.test', 'Roast manager');
  });

  test('can look at everything', async () => {
    for (const p of ['/api/stock', '/api/items', '/api/machines', '/api/movements', '/api/reports/production?from=2020-01-01&to=2030-01-01']) {
      assert.equal((await roast.get(p)).status, 200, p);
    }
  });

  test('can record a roast', async () => {
    const r = await roast.post('/api/movements', {
      kind: 'roast',
      lines: [
        { item_id: ids.green, qty: -100 },
        { item_id: ids.roasted, qty: 84 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    roastEntryId = r.data.movement.id;
  });

  test('cannot record other kinds of entry', async () => {
    for (const kind of ['ship', 'pack', 'receive', 'adjust']) {
      const r = await roast.post('/api/movements', { kind, lines: [{ item_id: ids.green, qty: kind === 'ship' ? -1 : 1 }] });
      assert.equal(r.status, 403, kind);
      assert.match(r.data.error, /role/i);
    }
  });

  test('cannot change the catalog, import, or count stock', async () => {
    assert.equal((await roast.post('/api/items', { code: 'X', name: 'X', type: 'other' })).status, 403);
    assert.equal((await roast.patch(`/api/items/${ids.green}`, { name: 'Renamed' })).status, 403);
    assert.equal((await roast.put(`/api/items/${ids.roasted}/components`, { components: [] })).status, 403);
    assert.equal((await roast.post('/api/machines', { name: 'M', kind: 'other' })).status, 403);
    assert.equal((await roast.post('/api/import/items', { rows: [{ code: 'Z', name: 'Z', type: 'other' }] })).status, 403);
    assert.equal((await roast.post('/api/stock/count', { counts: [{ item_id: ids.green, counted: 1 }] })).status, 403);
  });

  test('can void a roast but not an entry of a kind they cannot record', async () => {
    const receipt = (await admin.post('/api/movements', { kind: 'receive', lines: [{ item_id: ids.green, qty: 5 }] })).data.movement.id;
    assert.equal((await roast.post(`/api/movements/${receipt}/void`, { reason: 'typo' })).status, 403);
    assert.equal((await roast.post(`/api/movements/${roastEntryId}/void`, { reason: 'typo' })).status, 200);
  });

  test('cannot manage users, roles, the logo or see the audit log', async () => {
    assert.equal((await roast.get('/api/users')).status, 403);
    assert.equal((await roast.get('/api/roles')).status, 403);
    assert.equal((await roast.post('/api/branding/logo', { data: PNG })).status, 403);
    assert.equal((await roast.get('/api/audit')).status, 403);
  });
});

describe('view only', () => {
  test('new users with no role chosen can look but not touch', async () => {
    const viewer = await addUser('viewer@example.test');
    assert.equal((await viewer.get('/api/auth/me')).data.user.role_name, 'View only');
    assert.equal((await viewer.get('/api/stock')).status, 200);
    assert.equal((await viewer.post('/api/movements', { kind: 'receive', lines: [{ item_id: ids.green, qty: 1 }] })).status, 403);
  });

  test('a member with no role at all has no write access either', async () => {
    await t.db.query(
      `INSERT INTO users (email, name, password_hash, role) SELECT 'norole@example.test', 'No Role', password_hash, 'member' FROM users WHERE email = 'member@example.test'`,
    );
    const c = await t.login('norole@example.test', 'test-password-123');
    assert.equal((await c.post('/api/movements', { kind: 'receive', lines: [{ item_id: ids.green, qty: 1 }] })).status, 403);
  });
});

describe('editing roles', () => {
  test('only admins can, and permission names are checked', async () => {
    const member = await t.login('member@example.test');
    assert.equal((await member.post('/api/roles', { name: 'Sneaky', permissions: ['catalog'] })).status, 403);
    assert.equal((await admin.post('/api/roles', { name: 'Odd', permissions: ['fly'] })).status, 400);
  });

  test('a change to a role applies to its people straight away', async () => {
    const packer = await addUser('packer@example.test', 'Packing manager');
    const ship = { kind: 'ship', lines: [{ item_id: ids.green, qty: -1 }] };
    assert.equal((await packer.post('/api/movements', ship)).status, 403);

    const updated = await admin.patch(`/api/roles/${roles['Packing manager'].id}`, { permissions: ['pack', 'ship', 'void'] });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.data.permissions, ['pack', 'ship', 'void']);
    assert.equal((await packer.post('/api/movements', ship)).status, 201);
    assert.deepEqual((await packer.get('/api/auth/me')).data.user.permissions, ['pack', 'ship', 'void']);
  });

  test('admins can add roles, and duplicate names are refused', async () => {
    const r = await admin.post('/api/roles', { name: 'Office', description: 'Catalog only', permissions: ['catalog', 'import'] });
    assert.equal(r.status, 201);
    assert.equal(r.data.user_count, 0);
    assert.equal((await admin.post('/api/roles', { name: 'office' })).status, 409);
  });

  test('a role with people in it cannot be deleted, an empty one can', async () => {
    const created = (await admin.post('/api/roles', { name: 'Temp', permissions: [] })).data;
    const blocked = await admin.del(`/api/roles/${roles['Roast manager'].id}`);
    assert.equal(blocked.status, 409);
    assert.match(blocked.data.error, /Move them/);
    assert.equal((await admin.del(`/api/roles/${created.id}`)).status, 200);
  });

  test('moving someone to another role, or to admin, works; admins cannot demote themselves', async () => {
    const list = (await admin.get('/api/users')).data;
    const viewer = list.find((u) => u.email === 'viewer@example.test');
    const moved = await admin.patch(`/api/users/${viewer.id}`, { role_id: roles['Shipping manager'].id });
    assert.equal(moved.data.role, 'member');
    assert.equal(moved.data.role_name, 'Shipping manager');
    const promoted = await admin.patch(`/api/users/${viewer.id}`, { role: 'admin' });
    assert.equal(promoted.data.role, 'admin');
    assert.equal(promoted.data.role_id, null);

    const me = (await admin.get('/api/auth/me')).data.user;
    assert.equal((await admin.patch(`/api/users/${me.id}`, { role_id: roles['View only'].id })).status, 400);
  });

  test('role changes are in the audit log', async () => {
    const log = (await admin.get('/api/audit')).data;
    assert.ok(log.some((a) => a.entity === 'role' && a.action === 'update'));
  });
});

describe('logo', () => {
  test('there is none to start with', async () => {
    assert.equal((await t.anonymous().get('/api/config')).data.logo, null);
    assert.equal((await t.anonymous().get('/api/branding/logo')).status, 404);
  });

  test('only admins can upload, and only real PNG/JPG/WebP images', async () => {
    const member = await t.login('member@example.test');
    assert.equal((await member.post('/api/branding/logo', { data: PNG })).status, 403);
    assert.equal((await admin.post('/api/branding/logo', {})).status, 400);
    const notImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
    assert.equal((await admin.post('/api/branding/logo', { data: notImage })).status, 400);
    const tooBig = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(1024 * 1024 + 10)]).toString('base64');
    const big = await admin.post('/api/branding/logo', { data: tooBig });
    assert.equal(big.status, 400);
    assert.match(big.data.error, /too big/);
  });

  test('an uploaded logo is shown to everyone, even before signing in, and can be removed', async () => {
    const up = await admin.post('/api/branding/logo', { data: `data:image/png;base64,${PNG}` });
    assert.equal(up.status, 200);
    assert.equal(typeof up.data.logo, 'number');
    assert.equal((await t.anonymous().get('/api/config')).data.logo, up.data.logo);

    const img = await fetch(`${t.base}/api/branding/logo`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), Buffer.from(PNG, 'base64'));

    assert.equal((await admin.del('/api/branding/logo')).status, 200);
    assert.equal((await t.anonymous().get('/api/config')).data.logo, null);
  });
});
