// api/auth/attendee-login.js.
// POST makes a login code; the attendee sends it to the bot, and the page
// polls GET ?code= until the bot has made a session.
// M5 (fixed in job 02, job 01's H4): the session token is handed out once,
// then cleared; every later poll for that code gets 410.
// randomInt (fixed in job 02, job 01's M1): codes come from
// crypto.randomInt, not Math.random().

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { ATTENDEE_TOKENS, LOGIN_CODES } from '../support/fixtures.cjs';
import { useFreshDatabase } from './helpers.mjs';

const HANDLER = 'api/auth/attendee-login.js';
const CODE_PATTERN = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const realRandom = Math.random;
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

afterEach(() => {
    Math.random = realRandom;
});

function poll(code) {
    let query = {};
    if (code !== undefined) {
        query = { code };
    }
    return callHandler(HANDLER, { method: 'GET', query });
}

test('POST makes a 6-character code, stores it, and names the bot', async () => {
    const response = await callHandler(HANDLER, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.match(response.body.code, CODE_PATTERN);
    assert.equal(response.body.bot_username, 'TestHelloQueueBot');
    const stored = database.rows('gftvqueue_attendee_login_codes').find((row) => row.code === response.body.code);
    assert.notEqual(stored, undefined);
    assert.equal(stored.used_at, null);
    assert.deepEqual(database.queriesOn('gftvqueue_attendee_login_codes')[0].calls, [
        { method: 'insert', args: [{ code: response.body.code }, undefined] },
    ]);
});

test('POST needs no sign-in, and every call stores another code', async () => {
    await callHandler(HANDLER, { method: 'POST' });
    await callHandler(HANDLER, { method: 'POST' });
    assert.equal(database.rows('gftvqueue_attendee_login_codes').length, 4 + 2);
});

test('GET without a code: 400', async () => {
    const response = await poll();
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Missing code' });
});

test('GET with an unknown code: 404', async () => {
    const response = await poll('NOPE22');
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Code not found' });
});

test('GET while the bot has not confirmed yet: 202 pending', async () => {
    const response = await poll(LOGIN_CODES.pending);
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { pending: true });
});

test('GET with an expired, unused code: 410', async () => {
    const response = await poll(LOGIN_CODES.expired);
    assert.equal(response.status, 410);
    assert.deepEqual(response.body, { error: 'Code expired' });
});

test('GET after the bot confirmed: 200 with the attendee session token', async () => {
    const response = await poll(LOGIN_CODES.used);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { token: ATTENDEE_TOKENS.waitingA5 });
});

test('the full flow: pending, then the bot confirms, then the token once', async () => {
    const created = await callHandler(HANDLER, { method: 'POST' });
    const code = created.body.code;
    assert.equal((await poll(code)).status, 202);
    // What the bot does when the attendee sends /attend <code>.
    const row = database.tables.gftvqueue_attendee_login_codes.find((candidate) => candidate.code === code);
    row.used_at = new Date().toISOString();
    row.session_token = ATTENDEE_TOKENS.newcomer;
    const first = await poll(code);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { token: ATTENDEE_TOKENS.newcomer });
    const second = await poll(code);
    assert.equal(second.status, 410);
    assert.equal('token' in second.body, false);
});

// M5 (fixed): the token is handed out on the first successful poll only.
// The code row keeps used_at (so the bot still says "already used") but its
// session_token is cleared, and every later poll is refused with 410.
test('M5: a used code hands out its session token once, then refuses every later poll', async () => {
    const first = await poll(LOGIN_CODES.used);
    const second = await poll(LOGIN_CODES.used);
    const third = await poll(LOGIN_CODES.used);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { token: ATTENDEE_TOKENS.waitingA5 });
    for (const later of [second, third]) {
        assert.equal(later.status, 410);
        assert.deepEqual(later.body, { error: 'Code already used' });
    }
    const row = database.row('gftvqueue_attendee_login_codes', '66666666-6666-4666-8666-000000000002');
    assert.equal(row.session_token, null);
    assert.notEqual(row.used_at, null);
    // The attendee session itself is untouched: the first poller stays signed in.
    assert.equal(database.rows('gftvqueue_attendee_sessions').some((session) => session.token === ATTENDEE_TOKENS.waitingA5), true);
});

// M5: the token is cleared only while it still holds the value that was
// read, so two polls racing each other can't both get it.
test('M5: the token is cleared with a guarded update on the code row', async () => {
    await poll(LOGIN_CODES.used);
    const update = database.queriesOn('gftvqueue_attendee_login_codes')[1].calls.map((call) => [call.method, ...call.args]);
    assert.deepEqual(update, [
        ['update', { session_token: null }],
        ['eq', 'id', '66666666-6666-4666-8666-000000000002'],
        ['eq', 'session_token', ATTENDEE_TOKENS.waitingA5],
        ['select', 'id', {}],
    ]);
});

// M5: two polls at the same moment both read the row before either clears
// it. Only the one whose guarded update matches gets the token.
test('M5: two polls at the same moment: one gets the token, the other 410', async () => {
    const responses = await Promise.all([poll(LOGIN_CODES.used), poll(LOGIN_CODES.used)]);
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [200, 410]);
    const winners = responses.filter((response) => response.body.token === ATTENDEE_TOKENS.waitingA5);
    assert.equal(winners.length, 1);
    // Both polls read the row first, then both tried the guarded update.
    const methods = database.queriesOn('gftvqueue_attendee_login_codes').map((query) => query.calls[0].method);
    assert.deepEqual(methods, ['select', 'select', 'update', 'update']);
});

// M5: a code used and expired long ago still hands out its token once if
// nobody polled it (expiry only applies to unused codes, unchanged), then
// never again. See the job 02 report: limiting old codes needs a decision.
test('M5: a code used and expired long ago hands out its token once, then 410', async () => {
    const first = await poll(LOGIN_CODES.usedLongAgo);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { token: ATTENDEE_TOKENS.calledA3 });
    const second = await poll(LOGIN_CODES.usedLongAgo);
    assert.equal(second.status, 410);
});

// randomInt (fixed): codes no longer come from Math.random(). With
// Math.random() broken, POST still makes a valid 6-character code.
test('randomInt: the login code does not use Math.random()', async () => {
    Math.random = () => {
        throw new Error('Math.random() must not be used for codes');
    };
    const response = await callHandler(HANDLER, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.match(response.body.code, CODE_PATTERN);
});

// randomInt: length and characters are kept exactly, and the codes vary.
test('randomInt: codes keep 6 characters from the unambiguous set, and vary', async () => {
    const codes = new Set();
    for (let index = 0; index < 50; index += 1) {
        const response = await callHandler(HANDLER, { method: 'POST' });
        assert.match(response.body.code, CODE_PATTERN);
        codes.add(response.body.code);
    }
    assert.ok(codes.size > 45);
});

test('PUT is not allowed: 405', async () => {
    const response = await callHandler(HANDLER, { method: 'PUT' });
    assert.equal(response.status, 405);
});
