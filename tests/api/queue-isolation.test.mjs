// Isolation across users and queues (job 02, decision 1: staff see only the
// events and queues they're assigned to).
//
// 1. An operator of queue A can't read or change queue B through any
//    endpoint, and nothing in queue B changes or gets a Telegram message.
// 2. A matrix of every staff endpoint against every kind of caller, so a
//    later change that opens one up shows here.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, CODES, SESSION_TOKENS } from '../support/fixtures.cjs';
import { telegramMessages } from '../support/telegram.cjs';
import { useFreshDatabase } from './helpers.mjs';

let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function queueBState() {
    return {
        queue: database.row('gftvqueue_queues', IDS.queueB),
        entries: database.rows('gftvqueue_entries').filter((row) => row.queue_id === IDS.queueB),
        tokens: database.rows('gftvqueue_entry_tokens').filter((row) => row.entry_id === IDS.entryB2Called),
        permissions: database.rows('gftvqueue_queue_permissions').filter((row) => row.queue_id === IDS.queueB),
    };
}

// Every way an operator of queue A could try to reach queue B.
const QUEUE_B_ATTEMPTS = [
    { name: 'read queue B', file: 'api/queues/[queueId].js', method: 'GET', queueId: IDS.queueB, status: 403 },
    { name: 'close queue B', file: 'api/queues/[queueId].js', method: 'PUT', queueId: IDS.queueB, body: { status: 'closed' }, status: 403 },
    { name: 'delete queue B', file: 'api/queues/[queueId].js', method: 'DELETE', queueId: IDS.queueB, status: 403 },
    { name: 'call next in queue B', file: 'api/queues/[queueId]/operate.js', method: 'POST', queueId: IDS.queueB, body: { action: 'call_next' }, status: 403 },
    {
        name: 'mark a queue B attendee missed through queue B', file: 'api/queues/[queueId]/operate.js', method: 'POST',
        queueId: IDS.queueB, body: { action: 'mark_missed', entry_id: IDS.entryB2Called }, status: 403,
    },
    {
        name: 'mark a queue B attendee missed through queue A', file: 'api/queues/[queueId]/operate.js', method: 'POST',
        queueId: IDS.queueA, body: { action: 'mark_missed', entry_id: IDS.entryB2Called }, status: 404,
    },
    {
        name: 'confirm a queue B attendee\'s entrance through queue A', file: 'api/queues/[queueId]/operate.js', method: 'POST',
        queueId: IDS.queueA, body: { action: 'mark_entered', entry_id: IDS.entryB2Called }, status: 404,
    },
    {
        name: 'complete a queue B attendee through queue A', file: 'api/queues/[queueId]/operate.js', method: 'POST',
        queueId: IDS.queueA, body: { action: 'mark_complete', entry_id: IDS.entryB2Called }, status: 404,
    },
    {
        name: 'scan a queue B QR code in queue B', file: 'api/queues/[queueId]/scan.js', method: 'POST',
        queueId: IDS.queueB, body: { token: 'test-qr-token-b2', scan_type: 'exit' }, status: 403,
    },
    {
        name: 'scan a queue B QR code in queue A', file: 'api/queues/[queueId]/scan.js', method: 'POST',
        queueId: IDS.queueA, body: { token: 'test-qr-token-b2', scan_type: 'exit' }, status: 400,
    },
    { name: 'list queue B\'s staff', file: 'api/queues/[queueId]/permissions.js', method: 'GET', queueId: IDS.queueB, status: 403 },
    {
        name: 'grant themselves queue B', file: 'api/queues/[queueId]/permissions.js', method: 'POST',
        queueId: IDS.queueB, body: { user_id: IDS.operator, is_queue_admin: true }, status: 403,
    },
    {
        name: 'revoke queue B\'s admin', file: 'api/queues/[queueId]/permissions.js', method: 'DELETE',
        queueId: IDS.queueB, body: { user_id: IDS.queueAdmin }, status: 403,
    },
];

for (const attempt of QUEUE_B_ATTEMPTS) {
    test(`operator of queue A cannot ${attempt.name}: ${attempt.status}`, async () => {
        const before = queueBState();
        const response = await callHandler(attempt.file, {
            method: attempt.method,
            query: { queueId: attempt.queueId },
            token: SESSION_TOKENS.operator,
            body: attempt.body,
        });
        assert.equal(response.status, attempt.status);
        assert.deepEqual(queueBState(), before);
        assert.deepEqual(telegramMessages(), []);
        const text = JSON.stringify(response.body);
        for (const leaked of ['Gus Goat', 'gus_goat', 'Hana Hare', 'hana_hare', CODES.queueB]) {
            assert.equal(text.includes(leaked), false, `response leaks ${leaked}`);
        }
    });
}

test('operator of queue A: every queue listing shows queue A only', async () => {
    const eventList = await callHandler('api/queues/index.js', {
        method: 'GET', query: { event_id: IDS.event }, token: SESSION_TOKENS.operator,
    });
    assert.deepEqual(eventList.body.queues.map((queue) => queue.id), [IDS.queueA]);
    const mine = await callHandler('api/queues/index.js', {
        method: 'GET', query: { mine: '1' }, token: SESSION_TOKENS.operator,
    });
    assert.deepEqual(mine.body.queues.map((queue) => queue.id), [IDS.queueA]);
    const event = await callHandler('api/events/[eventId].js', {
        method: 'GET', query: { eventId: IDS.event }, token: SESSION_TOKENS.operator,
    });
    assert.equal(event.status, 403);
});

// ── The matrix ──────────────────────────────────────────────────────────────

const CALLERS = ['superadmin', 'editor', 'operator', 'queueAdmin', 'outsider'];

// Expected status per caller, in CALLERS order.
const MATRIX = [
    { name: 'GET queue A', file: 'api/queues/[queueId].js', query: { queueId: IDS.queueA }, expect: [200, 200, 200, 403, 403] },
    { name: 'GET queue B', file: 'api/queues/[queueId].js', query: { queueId: IDS.queueB }, expect: [200, 200, 403, 200, 403] },
    { name: 'GET queue A staff', file: 'api/queues/[queueId]/permissions.js', query: { queueId: IDS.queueA }, expect: [200, 200, 403, 403, 403] },
    { name: 'GET queue B staff', file: 'api/queues/[queueId]/permissions.js', query: { queueId: IDS.queueB }, expect: [200, 200, 403, 200, 403] },
    { name: 'GET the event', file: 'api/events/[eventId].js', query: { eventId: IDS.event }, expect: [200, 200, 403, 403, 403] },
    { name: 'GET the event\'s editors', file: 'api/events/[eventId]/editors.js', query: { eventId: IDS.event }, expect: [200, 200, 403, 403, 403] },
    { name: 'GET the event\'s queues', file: 'api/queues/index.js', query: { event_id: IDS.event }, expect: [200, 200, 200, 200, 403] },
];

for (const row of MATRIX) {
    for (const [index, caller] of CALLERS.entries()) {
        test(`matrix: ${row.name} as ${caller}: ${row.expect[index]}`, async () => {
            const response = await callHandler(row.file, { method: 'GET', query: row.query, token: SESSION_TOKENS[caller] });
            assert.equal(response.status, row.expect[index]);
        });
    }
}

// Access codes in the event's queue list go only to its editors and
// superadmins.
test('matrix: access codes in the event\'s queue list only for superadmin and editor', async () => {
    const withCodes = [];
    for (const caller of ['superadmin', 'editor', 'operator', 'queueAdmin']) {
        const response = await callHandler('api/queues/index.js', {
            method: 'GET', query: { event_id: IDS.event }, token: SESSION_TOKENS[caller],
        });
        if (response.body.queues.some((queue) => 'access_code' in queue)) {
            withCodes.push(caller);
        }
    }
    assert.deepEqual(withCodes, ['superadmin', 'editor']);
});
