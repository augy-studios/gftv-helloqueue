// api/queues/[queueId]/permissions.js (GET list, POST grant, DELETE revoke).
// Permissions GET (fixed in job 02, found by job 01): only a superadmin, an
// editor of the queue's event, or an admin of that queue may list its staff.
// Everyone else, operators included, gets 403.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase, callsOn } from './helpers.mjs';

const HANDLER = 'api/queues/[queueId]/permissions.js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function listStaff(queueId, token) {
    return callHandler(HANDLER, { method: 'GET', query: { queueId }, token });
}

test('no token: 401', async () => {
    const response = await listStaff(IDS.queueA, null);
    assert.equal(response.status, 401);
});

test('permissions GET: superadmin lists queue A\'s staff', async () => {
    const response = await listStaff(IDS.queueA, SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.permissions.map((row) => [row.user_id, row.is_queue_admin]), [[IDS.operator, false]]);
    assert.equal(response.body.permissions[0].gftvhello_users.username, 'operator.olly');
});

test('permissions GET: editor of the queue\'s event lists queue A and queue B\'s staff', async () => {
    for (const queueId of [IDS.queueA, IDS.queueB]) {
        const response = await listStaff(queueId, SESSION_TOKENS.editor);
        assert.equal(response.status, 200);
        assert.equal(response.body.permissions.length, 1);
    }
});

test('permissions GET: queue admin of queue B lists queue B\'s staff', async () => {
    const response = await listStaff(IDS.queueB, SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.permissions.map((row) => row.user_id), [IDS.queueAdmin]);
});

test('permissions GET: queue admin of queue B cannot list queue A\'s staff: 403', async () => {
    const response = await listStaff(IDS.queueA, SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Queue admin or event editor access required' });
});

test('permissions GET: operator of queue A (not its queue admin) cannot list its staff: 403', async () => {
    const response = await listStaff(IDS.queueA, SESSION_TOKENS.operator);
    assert.equal(response.status, 403);
});

test('permissions GET: operator of queue A cannot list queue B\'s staff: 403', async () => {
    const response = await listStaff(IDS.queueB, SESSION_TOKENS.operator);
    assert.equal(response.status, 403);
});

test('permissions GET: an account with no roles gets 403 for every queue, and no staff list is read', async () => {
    for (const queueId of [IDS.queueA, IDS.queueB]) {
        const response = await listStaff(queueId, SESSION_TOKENS.outsider);
        assert.equal(response.status, 403);
    }
    const staffLists = callsOn(database, 'gftvqueue_queue_permissions').filter((calls) =>
        calls[0][1].includes('gftvhello_users')
    );
    assert.equal(staffLists.length, 0);
});

test('permissions GET: an editor of a different event gets 403', async () => {
    database.tables.gftvqueue_event_editors[0].event_id = '11111111-1111-4111-8111-222222222222';
    const response = await listStaff(IDS.queueA, SESSION_TOKENS.editor);
    assert.equal(response.status, 403);
});

test('permissions GET: unknown queue as a non-admin: 403', async () => {
    const response = await listStaff('99999999-9999-4999-8999-999999999999', SESSION_TOKENS.editor);
    assert.equal(response.status, 403);
});

test('POST as queue admin of queue B grants an operator', async () => {
    const response = await callHandler(HANDLER, {
        method: 'POST', query: { queueId: IDS.queueB }, token: SESSION_TOKENS.queueAdmin, body: { user_id: IDS.outsider },
    });
    assert.equal(response.status, 201);
    const granted = database.rows('gftvqueue_queue_permissions').find((row) => row.queue_id === IDS.queueB && row.user_id === IDS.outsider);
    assert.equal(granted.is_queue_admin, false);
});

test('POST as operator of queue A, for queue A or queue B: 403', async () => {
    for (const queueId of [IDS.queueA, IDS.queueB]) {
        const response = await callHandler(HANDLER, {
            method: 'POST', query: { queueId }, token: SESSION_TOKENS.operator, body: { user_id: IDS.outsider },
        });
        assert.equal(response.status, 403);
    }
    assert.equal(database.rows('gftvqueue_queue_permissions').length, 2);
});

test('DELETE as queue admin of queue B cannot revoke queue A\'s operator: 403', async () => {
    const response = await callHandler(HANDLER, {
        method: 'DELETE', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.queueAdmin, body: { user_id: IDS.operator },
    });
    assert.equal(response.status, 403);
    assert.equal(database.rows('gftvqueue_queue_permissions').length, 2);
});
