// Baseline: api/auth/attendee-login.js, as the code behaves today.
// POST makes a login code; the attendee sends it to the bot, and the page
// polls GET ?code= until the bot has made a session.
// Tests marked with a gap ID (H4, M1) record a known security gap on
// purpose; job 02 changes them when it fixes the gap.

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

// H4: the session token is handed to anyone who asks with the code, as many
// times as they ask. Nothing ties the code to the browser that made it, and
// the token is never cleared after the first delivery.
test('H4: a used code hands out the same session token again on every request', async () => {
    const first = await poll(LOGIN_CODES.used);
    const second = await poll(LOGIN_CODES.used);
    const third = await poll(LOGIN_CODES.used);
    assert.equal(first.body.token, ATTENDEE_TOKENS.waitingA5);
    assert.equal(second.body.token, ATTENDEE_TOKENS.waitingA5);
    assert.equal(third.body.token, ATTENDEE_TOKENS.waitingA5);
    assert.equal(database.row('gftvqueue_attendee_login_codes', '66666666-6666-4666-8666-000000000002').session_token, ATTENDEE_TOKENS.waitingA5);
});

// H4: same gap. Expiry is ignored once a code is used, so an old code keeps
// working forever.
test('H4: a code used and expired long ago still hands out its session token', async () => {
    const response = await poll(LOGIN_CODES.usedLongAgo);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { token: ATTENDEE_TOKENS.calledA3 });
});

// M1: codes come from Math.random() (randomCode in api/_auth.js), which is
// not a secure random source, and are only 6 characters long.
test('M1: the login code is built from Math.random()', async () => {
    Math.random = () => 0;
    const response = await callHandler(HANDLER, { method: 'POST' });
    assert.equal(response.body.code, 'AAAAAA');
});

test('PUT is not allowed: 405', async () => {
    const response = await callHandler(HANDLER, { method: 'PUT' });
    assert.equal(response.status, 405);
});
