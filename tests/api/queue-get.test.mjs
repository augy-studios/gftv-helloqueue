// Baseline: GET api/queues/[queueId].js, as the code behaves today.
// Tests marked with a gap ID (H1, L1) record a known security gap on
// purpose; job 02 changes them when it fixes the gap.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase, callsOn } from './helpers.mjs';

const HANDLER = 'api/queues/[queueId].js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function getQueue(queueId, token) {
    return callHandler(HANDLER, { method: 'GET', query: { queueId }, token });
}

function numbers(entries) {
    return entries.map((entry) => entry.queue_number);
}

test('OPTIONS preflight answers 204 with the CORS headers', async () => {
    const response = await callHandler(HANDLER, { method: 'OPTIONS', query: { queueId: IDS.queueA } });
    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.equal(response.headers['access-control-allow-methods'], 'GET,POST,PUT,DELETE,OPTIONS');
});

test('no token: 401', async () => {
    const response = await getQueue(IDS.queueA, null);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Missing authorization token' });
});

test('unknown token: 401', async () => {
    const response = await getQueue(IDS.queueA, 'not-a-session');
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Invalid or expired session' });
});

test('expired session: 401', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.expired);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Session expired' });
});

test('account pending approval: 403', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.pending);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Account pending approval' });
});

test('unknown queue: 404', async () => {
    const response = await getQueue('99999999-9999-4999-8999-999999999999', SESSION_TOKENS.superadmin);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Queue not found' });
});

test('superadmin gets the queue, its entries grouped by status, and full rights', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.equal(response.body.queue.id, IDS.queueA);
    assert.equal(response.body.queue.name, 'Dealers Den (Queue A)');
    assert.equal(response.body.queue.event_access_code, 'EVNTCODE');
    assert.equal(response.body.queue.gftvqueue_events, undefined);
    assert.deepEqual(numbers(response.body.entries.serving), [3, 4]);
    assert.deepEqual(numbers(response.body.entries.waiting), [5, 6]);
    assert.deepEqual(numbers(response.body.entries.missed), [2]);
    assert.deepEqual(numbers(response.body.entries.completed), [1]);
    assert.equal(response.body.can_operate, true);
    assert.equal(response.body.is_queue_admin, true);
});

test('operator of queue A gets queue A with operate rights but not queue admin', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.operator);
    assert.equal(response.status, 200);
    assert.equal(response.body.can_operate, true);
    assert.equal(response.body.is_queue_admin, false);
});

test('queue admin of queue B gets queue B as queue admin', async () => {
    const response = await getQueue(IDS.queueB, SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 200);
    assert.equal(response.body.can_operate, true);
    assert.equal(response.body.is_queue_admin, true);
    assert.deepEqual(numbers(response.body.entries.serving), [2]);
    assert.deepEqual(numbers(response.body.entries.waiting), [1]);
});

test('entries carry the attendee @telegram_username (decision 5: operators see it)', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.operator);
    const waiting = response.body.entries.waiting[0];
    assert.equal(waiting.display_name, 'Eli Otter');
    assert.equal(waiting.telegram_username, 'eli_otter');
});

test('entries never carry the attendee telegram_user_id', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.superadmin);
    for (const group of Object.values(response.body.entries)) {
        for (const entry of group) {
            assert.equal('telegram_user_id' in entry, false);
        }
    }
});

test('queries: the queue with its event code, the entries by number, then the permission check', async () => {
    await getQueue(IDS.queueA, SESSION_TOKENS.operator);
    assert.deepEqual(callsOn(database, 'gftvqueue_queues'), [[
        ['select', '*, gftvqueue_events(access_code)', {}],
        ['eq', 'id', IDS.queueA],
        ['single'],
    ]]);
    assert.deepEqual(callsOn(database, 'gftvqueue_entries'), [[
        ['select', 'id, queue_number, status, display_name, telegram_username, joined_at, called_at, entered_at', {}],
        ['eq', 'queue_id', IDS.queueA],
        ['order', 'queue_number', { ascending: true }],
    ]]);
    assert.deepEqual(callsOn(database, 'gftvqueue_queue_permissions'), [[
        ['select', 'is_queue_admin', {}],
        ['eq', 'queue_id', IDS.queueA],
        ['eq', 'user_id', IDS.operator],
        ['maybeSingle'],
    ]]);
});

// H1: no access check on GET. Any signed-in account reads any queue and
// every entry in it (names, @usernames, times), with can_operate: false.
test('H1: operator of queue A can read queue B and all its attendees', async () => {
    const response = await getQueue(IDS.queueB, SESSION_TOKENS.operator);
    assert.equal(response.status, 200);
    assert.equal(response.body.can_operate, false);
    assert.equal(response.body.is_queue_admin, false);
    assert.deepEqual(numbers(response.body.entries.waiting), [1]);
    assert.equal(response.body.entries.waiting[0].display_name, 'Gus Goat');
    assert.equal(response.body.entries.waiting[0].telegram_username, 'gus_goat');
});

// H1: no access check on GET, for an account with no roles at all.
test('H1: an account with no roles can read queue A and all its attendees', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.outsider);
    assert.equal(response.status, 200);
    assert.equal(response.body.can_operate, false);
    const total = Object.values(response.body.entries).reduce((sum, group) => sum + group.length, 0);
    assert.equal(total, 6);
    assert.equal(response.body.entries.serving[0].telegram_username, 'cara_cat');
});

// L1 (F2): the response carries fields the operator page doesn't show: the
// whole queue row and each entry's joined_at and called_at.
test('L1: GET returns the whole queue row and joined_at/called_at per entry', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.operator);
    assert.deepEqual(Object.keys(response.body.queue).sort(), [
        'access_code', 'created_at', 'created_by', 'description', 'event_access_code',
        'event_id', 'id', 'max_serving', 'name', 'status', 'updated_at',
    ]);
    assert.deepEqual(Object.keys(response.body.entries.serving[0]).sort(), [
        'called_at', 'display_name', 'entered_at', 'id', 'joined_at', 'queue_number',
        'status', 'telegram_username',
    ]);
});

test('completed entries come back in full, not as a count (decision 4 changes this later)', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.operator);
    assert.equal(Array.isArray(response.body.entries.completed), true);
    assert.equal(response.body.entries.completed[0].display_name, 'Alice Fox');
});

test('PATCH is not allowed: 405', async () => {
    const response = await callHandler(HANDLER, {
        method: 'PATCH', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.superadmin,
    });
    assert.equal(response.status, 405);
    assert.deepEqual(response.body, { error: 'Method not allowed' });
});
