// GET api/queues/[queueId].js.
// H1 (fixed in job 02): only a superadmin, an editor of the queue's event, or
// an admin or operator of that queue gets the queue; everyone else gets 403.
// L1 records a known gap on purpose (job 03 trims the fields).

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

test('queries: the queue with its event code, the permission check, then the entries by number', async () => {
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
    // H1: the access check runs before any entry is read.
    assert.deepEqual(database.queries.map((query) => query.table).filter((table) => table.startsWith('gftvqueue_')), [
        'gftvqueue_queues',
        'gftvqueue_queue_permissions',
        'gftvqueue_entries',
    ]);
});

// H1 (fixed): an operator of queue A can't read queue B: 403, and queue B's
// entries are never even looked up.
test('H1: operator of queue A cannot read queue B: 403', async () => {
    const response = await getQueue(IDS.queueB, SESSION_TOKENS.operator);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'No access to this queue' });
    assert.equal(callsOn(database, 'gftvqueue_entries').length, 0);
});

// H1 (fixed): an account with no roles can't read any queue.
test('H1: an account with no roles cannot read queue A or queue B: 403', async () => {
    for (const queueId of [IDS.queueA, IDS.queueB]) {
        const response = await getQueue(queueId, SESSION_TOKENS.outsider);
        assert.equal(response.status, 403);
        assert.deepEqual(response.body, { error: 'No access to this queue' });
        assert.equal(JSON.stringify(response.body).includes('telegram_username'), false);
    }
    assert.equal(callsOn(database, 'gftvqueue_entries').length, 0);
});

// H1 (fixed): a queue admin of queue B can't read queue A.
test('H1: queue admin of queue B cannot read queue A: 403', async () => {
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 403);
});

// H1: an editor of the queue's event reads every queue in it, without
// operate rights (they have no permission row).
test('H1: event editor reads queue A and queue B, without operate rights', async () => {
    for (const queueId of [IDS.queueA, IDS.queueB]) {
        const response = await getQueue(queueId, SESSION_TOKENS.editor);
        assert.equal(response.status, 200);
        assert.equal(response.body.queue.id, queueId);
        assert.equal(response.body.can_operate, false);
        assert.equal(response.body.is_queue_admin, false);
    }
});

// H1: an editor of another event gets 403 for this event's queues.
test('H1: editor of a different event cannot read queue A: 403', async () => {
    const otherEvent = '11111111-1111-4111-8111-222222222222';
    database.tables.gftvqueue_event_editors[0].event_id = otherEvent;
    const response = await getQueue(IDS.queueA, SESSION_TOKENS.editor);
    assert.equal(response.status, 403);
});

// H1: the access check runs on the queue's own event, from the queue row.
test('H1: the editor check looks up the editor row for the queue\'s event', async () => {
    await getQueue(IDS.queueA, SESSION_TOKENS.editor);
    assert.deepEqual(callsOn(database, 'gftvqueue_event_editors'), [[
        ['select', 'id', {}],
        ['eq', 'event_id', IDS.event],
        ['eq', 'user_id', IDS.editor],
        ['maybeSingle'],
    ]]);
});

// The queue is looked up before the access check, so an unknown id is 404
// for anyone signed in. Queue ids are random UUIDs, so this reveals nothing.
test('unknown queue as an account with no roles: 404', async () => {
    const response = await getQueue('99999999-9999-4999-8999-999999999999', SESSION_TOKENS.outsider);
    assert.equal(response.status, 404);
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
