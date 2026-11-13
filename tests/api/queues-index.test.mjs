// api/queues/index.js (GET list, GET ?mine=1, POST create).
// Queues index (fixed in job 02, found by job 01): an event's queues go only
// to callers who can see the event. A superadmin and the event's editors get
// every queue with its access code; staff get only the queues they're
// assigned to, without access codes (decision 1); anyone else gets 403.
// M3 (job 02): GET ?mine=1 lists only the queues the caller can operate or
// administer, for the dashboard's My Queues view.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, CODES, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase, callsOn } from './helpers.mjs';

const HANDLER = 'api/queues/index.js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function listQueues(token, query) {
    return callHandler(HANDLER, { method: 'GET', token, query });
}

function listEventQueues(token) {
    return listQueues(token, { event_id: IDS.event });
}

function listMyQueues(token) {
    return listQueues(token, { mine: '1' });
}

test('no token: 401', async () => {
    const response = await listEventQueues(null);
    assert.equal(response.status, 401);
});

test('GET without event_id or mine: 400', async () => {
    const response = await listQueues(SESSION_TOKENS.superadmin, {});
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'event_id is required' });
});

// ── GET ?event_id= ─────────────────────────────────────────────────────────

test('queues index: superadmin gets every queue in the event, with access codes', async () => {
    const response = await listEventQueues(SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => queue.id), [IDS.queueA, IDS.queueB]);
    assert.deepEqual(response.body.queues.map((queue) => queue.access_code), [CODES.queueA, CODES.queueB]);
});

test('queues index: event editor gets every queue in the event, with access codes', async () => {
    const response = await listEventQueues(SESSION_TOKENS.editor);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => queue.access_code), [CODES.queueA, CODES.queueB]);
});

test('queues index: operator of queue A gets only queue A, without its access code', async () => {
    const response = await listEventQueues(SESSION_TOKENS.operator);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => queue.id), [IDS.queueA]);
    assert.equal('access_code' in response.body.queues[0], false);
    assert.equal(JSON.stringify(response.body).includes(CODES.queueB), false);
});

test('queues index: queue admin of queue B gets only queue B, without its access code', async () => {
    const response = await listEventQueues(SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => queue.id), [IDS.queueB]);
    assert.equal('access_code' in response.body.queues[0], false);
});

test('queues index: an account with no roles gets 403', async () => {
    const response = await listEventQueues(SESSION_TOKENS.outsider);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'No access to this event' });
});

test('queues index: staff of a queue in another event get 403 for this event', async () => {
    const otherEvent = '11111111-1111-4111-8111-222222222222';
    const response = await listQueues(SESSION_TOKENS.operator, { event_id: otherEvent });
    assert.equal(response.status, 403);
});

test('queues index: an editor of a different event gets 403', async () => {
    database.tables.gftvqueue_event_editors[0].event_id = '11111111-1111-4111-8111-222222222222';
    const response = await listEventQueues(SESSION_TOKENS.editor);
    assert.equal(response.status, 403);
});

// ── GET ?mine=1 (M3) ────────────────────────────────────────────────────────

test('M3: a pure operator sees their own queue, with what My Queues shows', async () => {
    const response = await listMyQueues(SESSION_TOKENS.operator);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
        queues: [{
            id: IDS.queueA,
            event_id: IDS.event,
            name: 'Dealers Den (Queue A)',
            status: 'open',
            access_code: CODES.queueA,
            max_serving: 3,
            event_name: 'GFTV Test Con 2026',
            event_access_code: CODES.event,
            is_queue_admin: false,
        }],
    });
});

test('M3: a queue admin sees only their queue, as queue admin', async () => {
    const response = await listMyQueues(SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => [queue.id, queue.is_queue_admin]), [[IDS.queueB, true]]);
    assert.equal(JSON.stringify(response.body).includes(CODES.queueA), false);
});

test('M3: a superadmin sees every queue, as queue admin', async () => {
    const response = await listMyQueues(SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => [queue.id, queue.is_queue_admin]), [
        [IDS.queueA, true],
        [IDS.queueB, true],
    ]);
    assert.equal(callsOn(database, 'gftvqueue_queue_permissions').length, 0);
});

test('M3: an event editor with no queue permission sees no queues', async () => {
    const response = await listMyQueues(SESSION_TOKENS.editor);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { queues: [] });
});

test('M3: an account with no roles sees no queues', async () => {
    const response = await listMyQueues(SESSION_TOKENS.outsider);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { queues: [] });
    assert.equal(callsOn(database, 'gftvqueue_queues').length, 0);
});

test('M3: queues from every event the operator works on are listed', async () => {
    const otherEvent = '11111111-1111-4111-8111-222222222222';
    const otherQueue = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    database.tables.gftvqueue_events.push({
        id: otherEvent, name: 'Other Con', description: null, venue: null, event_date: null, status: 'active',
        access_code: 'OTHRCODE', created_by: IDS.superadmin, created_at: '2026-11-02T09:00:00.000Z',
        updated_at: '2026-11-02T09:00:00.000Z',
    });
    database.tables.gftvqueue_queues.push({
        id: otherQueue, event_id: otherEvent, name: 'Other Queue', description: null, status: 'closed',
        access_code: 'OTHERQQQ', max_serving: 5, created_by: IDS.superadmin,
        created_at: '2026-11-02T10:00:00.000Z', updated_at: '2026-11-02T10:00:00.000Z',
    });
    database.tables.gftvqueue_queue_permissions.push({
        id: '33333333-3333-4333-8333-33333333333c', queue_id: otherQueue, user_id: IDS.operator,
        is_queue_admin: true, granted_by: IDS.superadmin, granted_at: '2026-11-02T10:00:00.000Z',
    });
    const response = await listMyQueues(SESSION_TOKENS.operator);
    assert.deepEqual(response.body.queues.map((queue) => [queue.id, queue.event_access_code, queue.is_queue_admin]), [
        [IDS.queueA, CODES.event, false],
        [otherQueue, 'OTHRCODE', true],
    ]);
});

test('M3: the lookup is by the caller\'s own permission rows only', async () => {
    await listMyQueues(SESSION_TOKENS.operator);
    assert.deepEqual(callsOn(database, 'gftvqueue_queue_permissions'), [[
        ['select', 'queue_id, is_queue_admin', {}],
        ['eq', 'user_id', IDS.operator],
    ]]);
    assert.deepEqual(callsOn(database, 'gftvqueue_queues')[0].find((call) => call[0] === 'in'), ['in', 'id', [IDS.queueA]]);
});

// ── POST ────────────────────────────────────────────────────────────────────

test('POST as event editor creates a queue and makes them its queue admin', async () => {
    const response = await callHandler(HANDLER, {
        method: 'POST', token: SESSION_TOKENS.editor, body: { event_id: IDS.event, name: 'Art Show' },
    });
    assert.equal(response.status, 201);
    assert.match(response.body.queue.access_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    const permission = database.rows('gftvqueue_queue_permissions').find((row) => row.queue_id === response.body.queue.id);
    assert.equal(permission.user_id, IDS.editor);
    assert.equal(permission.is_queue_admin, true);
});

test('POST as operator (not an event editor): 403', async () => {
    const response = await callHandler(HANDLER, {
        method: 'POST', token: SESSION_TOKENS.operator, body: { event_id: IDS.event, name: 'Sneaky Queue' },
    });
    assert.equal(response.status, 403);
    assert.equal(database.rows('gftvqueue_queues').length, 2);
});
