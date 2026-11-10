import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createMailer } from '../src/mailer.js';
import { startTestApp } from './helpers.js';

const sent = [];
const fakeMailer = { enabled: true, async send(msg) { sent.push(msg); } };

let t;
let admin;
let anon;
const wait = () => new Promise((r) => setTimeout(r, 20)); // emails go out in the background

before(async () => {
  t = await startTestApp({ helpRequestEmail: 'admins@example.test', publicUrl: 'https://ledger.example.test' }, { mailer: fakeMailer });
  admin = await t.login();
  anon = t.anonymous();
});
after(() => t.close());

describe('sign-in help requests', () => {
  test('anyone can ask; the answer is the same whether or not the account exists', async () => {
    const known = await anon.post('/api/auth/help', { email: 'Member@Example.test', kind: 'two_factor', note: 'call 555-0100' });
    const unknown = await anon.post('/api/auth/help', { email: 'nobody@example.test', kind: 'password' });
    assert.equal(known.status, 200);
    assert.deepEqual(known.data, unknown.data);
    await wait();

    assert.equal(sent.length, 2);
    assert.equal(sent[0].to, 'admins@example.test');
    assert.match(sent[0].subject, /Two-factor reset for member@example\.test/);
    assert.match(sent[0].text, /Account: Member/);
    assert.match(sent[0].text, /call 555-0100/);
    assert.match(sent[0].text, /confirm it is really them/);
    assert.match(sent[0].text, /https:\/\/ledger\.example\.test\/#\/users/);
    assert.match(sent[1].text, /NO ACCOUNT has this email/);
  });

  test('rejects bad input', async () => {
    assert.equal((await anon.post('/api/auth/help', { email: 'not-an-email', kind: 'password' })).status, 400);
    assert.equal((await anon.post('/api/auth/help', { email: 'a@example.test', kind: 'delete-everything' })).status, 400);
  });

  test('only admins see and close requests', async () => {
    const member = await t.login('member@example.test');
    assert.equal((await member.get('/api/users/help-requests')).status, 403);

    const list = await admin.get('/api/users/help-requests');
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 2);
    const unknown = list.data.find((r) => r.email === 'nobody@example.test');
    assert.equal(unknown.user_id, null);

    assert.equal((await admin.post(`/api/users/help-requests/${unknown.id}/resolve`)).status, 200);
    assert.equal((await admin.post(`/api/users/help-requests/${unknown.id}/resolve`)).status, 404, 'already handled');
  });

  test("doing the reset closes that person's request", async () => {
    const memberReq = (await admin.get('/api/users/help-requests')).data.find((r) => r.email === 'member@example.test');
    assert.equal(memberReq.resolved_at, null);
    // Their request was for two-factor; a password reset doesn't close it.
    await admin.patch(`/api/users/${memberReq.user_id}`, { password: 'temporary-pass-789' });
    assert.equal((await admin.get('/api/users/help-requests')).data.find((r) => r.id === memberReq.id).resolved_at, null);
    await admin.post(`/api/users/${memberReq.user_id}/reset-2fa`);
    assert.notEqual((await admin.get('/api/users/help-requests')).data.find((r) => r.id === memberReq.id).resolved_at, null);
  });

  test('limits how often the form can be used', async () => {
    // 2 valid requests so far from this address (invalid ones don't count); the limit is 5 an hour.
    const results = [];
    for (let i = 0; i < 4; i++) results.push((await anon.post('/api/auth/help', { email: `x${i}@example.test`, kind: 'password' })).status);
    assert.deepEqual(results, [200, 200, 200, 429]);
  });
});

describe('mailer', () => {
  test('does nothing without an API key', async () => {
    const m = createMailer({ resendApiKey: null });
    assert.equal(m.enabled, false);
    await m.send({ to: 'x@example.test', subject: 's', text: 't' });
  });

  test('sends through Resend with the key', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => (calls.push({ url, opts }), { ok: true });
    const m = createMailer({ resendApiKey: 're_test_123', mailFrom: 'Ledger <a@example.test>' }, { fetchImpl });
    await m.send({ to: 'b@example.test', subject: 'Hi', text: 'Body' });
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer re_test_123');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { from: 'Ledger <a@example.test>', to: ['b@example.test'], subject: 'Hi', text: 'Body' });
  });
});
