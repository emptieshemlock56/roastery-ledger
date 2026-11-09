import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { codeAt, currentStep, matchStep } from '../src/totp.js';
import { PASSWORD, startTestApp } from './helpers.js';

let t;

before(async () => {
  t = await startTestApp({ require2fa: true });
});
after(() => t.close());

// Raw request that also returns the session cookie the server sets.
async function req(method, path, body, cookie) {
  const res = await fetch(`${t.base}${path}`, {
    method,
    headers: {
      'X-Requested-With': 'ledger',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : null };
}

const login = (email, password = PASSWORD) => req('POST', '/api/auth/login', { email, password });

async function turnOn2fa(cookie) {
  const setup = await req('POST', '/api/auth/2fa/setup', {}, cookie);
  assert.equal(setup.status, 200);
  assert.match(setup.data.otpauth_url, /^otpauth:\/\/totp\//);
  assert.match(setup.data.qr_svg, /<svg/);
  const step = currentStep();
  const enable = await req('POST', '/api/auth/2fa/enable', { code: codeAt(setup.data.secret, step) }, cookie);
  assert.equal(enable.status, 200);
  return { secret: setup.data.secret, backupCodes: enable.data.backup_codes, step };
}

describe('authenticator codes', () => {
  test('match the RFC 6238 test vector', () => {
    // RFC 6238 SHA-1 secret "12345678901234567890", T = 59s -> 94287082 (last 6 digits: 287082)
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    assert.equal(codeAt(secret, 1), '287082');
    assert.equal(matchStep(secret, '287082', 59_000), 1);
    assert.equal(matchStep(secret, '000000', 59_000), null);
  });
});

describe('two-factor sign-in (required)', () => {
  let secret;
  let backupCodes;
  let enabledStep;

  test('without 2FA you can sign in but only to set it up', async () => {
    const res = await login('admin@example.test');
    assert.equal(res.status, 200);
    assert.equal(res.data.user.must_setup_2fa, true);
    assert.equal((await req('GET', '/api/items', null, res.cookie)).status, 403);
    assert.equal((await req('GET', '/api/auth/me', null, res.cookie)).status, 200);

    ({ secret, backupCodes, step: enabledStep } = await turnOn2fa(res.cookie));
    assert.equal(backupCodes.length, 10);
    assert.equal((await req('GET', '/api/items', null, res.cookie)).status, 200);
    const me = await req('GET', '/api/auth/me', null, res.cookie);
    assert.equal(me.data.user.two_factor, true);
    assert.equal(me.data.user.must_setup_2fa, false);
  });

  test('once on, signing in needs a code, and each code works only once', async () => {
    const step1 = await login('admin@example.test');
    assert.equal(step1.data.needs_code, true);
    assert.equal(step1.cookie, null, 'no session before the code');

    // The code used to turn 2FA on can't be replayed.
    const replay = await req('POST', '/api/auth/login/code', { ticket: step1.data.ticket, code: codeAt(secret, enabledStep) });
    assert.equal(replay.status, 401);
    assert.equal((await req('POST', '/api/auth/login/code', { ticket: step1.data.ticket, code: '123456' })).status, 401);

    const next = codeAt(secret, enabledStep + 1); // one step of clock drift is allowed
    const ok = await req('POST', '/api/auth/login/code', { ticket: step1.data.ticket, code: next });
    assert.equal(ok.status, 200);
    assert.equal((await req('GET', '/api/items', null, ok.cookie)).status, 200);

    const again = await login('admin@example.test');
    assert.equal((await req('POST', '/api/auth/login/code', { ticket: again.data.ticket, code: next })).status, 401);
  });

  test('a backup code works once, with or without the dash', async () => {
    const step1 = await login('admin@example.test');
    const code = backupCodes[0].toUpperCase().replace('-', ' ');
    const ok = await req('POST', '/api/auth/login/code', { ticket: step1.data.ticket, code });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.backup_codes_left, 9);

    const step2 = await login('admin@example.test');
    assert.equal((await req('POST', '/api/auth/login/code', { ticket: step2.data.ticket, code: backupCodes[0] })).status, 401);
  });

  test('the half-way ticket is not a session', async () => {
    const step1 = await login('admin@example.test');
    assert.equal((await req('GET', '/api/auth/me', null, `ledger_session=${step1.data.ticket}`)).status, 401);
  });

  test('2FA cannot be turned off where it is required', async () => {
    const s = await login('admin@example.test');
    const ok = await req('POST', '/api/auth/login/code', { ticket: s.data.ticket, code: backupCodes[1] });
    assert.equal((await req('POST', '/api/auth/2fa/disable', { password: PASSWORD }, ok.cookie)).status, 400);
  });

  test('"sign out everywhere else" ends other sessions but keeps this one', async () => {
    const a = await req('POST', '/api/auth/login/code', { ticket: (await login('admin@example.test')).data.ticket, code: backupCodes[2] });
    const b = await req('POST', '/api/auth/login/code', { ticket: (await login('admin@example.test')).data.ticket, code: backupCodes[3] });
    const res = await req('POST', '/api/auth/logout-others', {}, a.cookie);
    assert.equal(res.status, 200);
    assert.equal((await req('GET', '/api/auth/me', null, b.cookie)).status, 401);
    assert.equal((await req('GET', '/api/auth/me', null, res.cookie)).status, 200);
  });

  test('an admin can reset a member who lost their phone', async () => {
    const admin = await req('POST', '/api/auth/login/code', { ticket: (await login('admin@example.test')).data.ticket, code: backupCodes[4] });

    const m = await login('member@example.test');
    await turnOn2fa(m.cookie);
    const users = await req('GET', '/api/users', null, admin.cookie);
    const member = users.data.find((u) => u.email === 'member@example.test');
    assert.equal(member.two_factor, true);

    assert.equal((await req('POST', `/api/users/${member.id}/reset-2fa`, {}, m.cookie)).status, 403, 'members cannot');
    const me = users.data.find((u) => u.email === 'admin@example.test');
    assert.equal((await req('POST', `/api/users/${me.id}/reset-2fa`, {}, admin.cookie)).status, 400, 'not your own');

    assert.equal((await req('POST', `/api/users/${member.id}/reset-2fa`, {}, admin.cookie)).status, 200);
    assert.equal((await req('GET', '/api/auth/me', null, m.cookie)).status, 401, 'their old session ends');
    const back = await login('member@example.test');
    assert.equal(back.data.user.must_setup_2fa, true, 'they set it up again');
  });

  test('changing your password signs out your other sessions', async () => {
    const a = await login('member@example.test');
    const b = await login('member@example.test');
    const res = await req('POST', '/api/auth/password', { current: PASSWORD, next: 'a-new-password-456' }, a.cookie);
    assert.equal(res.status, 200);
    assert.equal((await req('GET', '/api/auth/me', null, b.cookie)).status, 401);
    assert.equal((await req('GET', '/api/auth/me', null, res.cookie)).status, 200);
  });
});
