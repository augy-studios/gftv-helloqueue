// api/auth/register.js (POST create account, pending approval).
// Registration filter (fixed in job 02): the uniqueness check used to build
// .or(`username.eq.${username},email.eq.${email}`) from typed input, so a
// comma or dot in the input became part of the filter. It's now two plain
// .eq() lookups.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { useFreshDatabase, callsOn } from './helpers.mjs';

const HANDLER = 'api/auth/register.js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function register(body) {
    return callHandler(HANDLER, { method: 'POST', body });
}

const NEW_PERSON = {
    username: 'new.person',
    display_name: 'New Person',
    email: 'new.person@example.test',
    password: 'long-enough-password',
};

test('creates an account waiting for approval', async () => {
    const response = await register(NEW_PERSON);
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { message: 'Registration successful. Your account is pending admin approval.' });
    const created = database.rows('gftvhello_users').find((row) => row.username === 'new.person');
    assert.equal(created.is_approved, false);
});

test('missing fields: 400', async () => {
    const response = await register({ username: 'x' });
    assert.equal(response.status, 400);
});

test('registration filter: the uniqueness check is two plain .eq() lookups, no .or()', async () => {
    await register(NEW_PERSON);
    const lookups = callsOn(database, 'gftvhello_users').filter((calls) => calls[0][0] === 'select');
    assert.deepEqual(lookups, [
        [['select', 'id', {}], ['eq', 'username', 'new.person'], ['maybeSingle']],
        [['select', 'id', {}], ['eq', 'email', 'new.person@example.test'], ['maybeSingle']],
    ]);
    const usesOr = callsOn(database, 'gftvhello_users').some((calls) => calls.some((call) => call[0] === 'or'));
    assert.equal(usesOr, false);
});

test('registration filter: a username already in use: 409', async () => {
    const response = await register({ ...NEW_PERSON, username: 'operator.olly' });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'Username or email already in use' });
});

test('registration filter: an email already in use: 409', async () => {
    const response = await register({ ...NEW_PERSON, email: 'operator.olly@example.test' });
    assert.equal(response.status, 409);
});

test('registration filter: a username and an email each used by a different account: 409', async () => {
    const response = await register({ ...NEW_PERSON, username: 'operator.olly', email: 'editor.eve@example.test' });
    assert.equal(response.status, 409);
});

// Before the fix, this username added "username.eq.admin.augy" to the
// filter, so the answer (409 or not) told the caller whether some other
// account matched a condition of their choosing.
test('registration filter: commas and dots in typed input are not read as filter syntax', async () => {
    const response = await register({ ...NEW_PERSON, username: 'brand.new,username.eq.admin.augy' });
    assert.equal(response.status, 201);
    const lookups = callsOn(database, 'gftvhello_users').filter((calls) => calls[0][0] === 'select');
    assert.deepEqual(lookups[0][1], ['eq', 'username', 'brand.new,username.eq.admin.augy']);
});
