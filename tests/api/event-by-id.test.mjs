// api/events/[eventId].js (GET, PUT, DELETE).
// M2 (fixed in job 02, job 01's H3): the event, its access code, its editors
// and its queues go only to a superadmin or an editor of the event; no page
// shows them to anyone else, so everyone else gets 403.
// L3 records a known gap on purpose (job 03 trims the fields). B2 marks a bug.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase } from './helpers.mjs';

const HANDLER = 'api/events/[eventId].js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function getEvent(eventId, token) {
    return callHandler(HANDLER, { method: 'GET', query: { eventId }, token });
}

test('no token: 401', async () => {
    const response = await getEvent(IDS.event, null);
    assert.equal(response.status, 401);
});

test('unknown event: 404', async () => {
    const response = await getEvent('99999999-9999-4999-8999-999999999999', SESSION_TOKENS.superadmin);
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Event not found' });
});

test('superadmin gets the event and both queues, oldest first', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.equal(response.body.event.id, IDS.event);
    assert.equal(response.body.event.name, 'GFTV Test Con 2026');
    assert.deepEqual(response.body.queues.map((queue) => queue.id), [IDS.queueA, IDS.queueB]);
    assert.deepEqual(Object.keys(response.body.queues[0]).sort(), [
        'access_code', 'created_at', 'id', 'max_serving', 'name', 'status',
    ]);
});

// B2: the editors query embeds gftvhello_users(...) without a hint. In
// schema.sql gftvqueue_event_editors has two keys to gftvhello_users (user_id
// and assigned_by), so PostgREST refuses the embed (PGRST201). The handler
// ignores the error, and the event page always shows "No editors assigned".
test('B2: the editor list comes back empty because the editor embed is ambiguous', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.superadmin);
    assert.deepEqual(response.body.editors, []);
    const editorQuery = database.queriesOn('gftvqueue_event_editors')[0];
    assert.equal(editorQuery.calls[0].args[0], 'user_id, assigned_at, gftvhello_users(id, username, display_name)');
    assert.equal(editorQuery.result.error.code, 'PGRST201');
});

// M2 (fixed): an account with no roles gets 403 and no access codes.
test('M2: an account with no roles cannot read the event: 403', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.outsider);
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Event editor access required' });
    assert.equal(database.queriesOn('gftvqueue_events').length, 0);
    assert.equal(database.queriesOn('gftvqueue_queues').length, 0);
});

// M2 (fixed): staff of one queue don't get the event page, its access code
// or the other queues (their page gets their queue from the queue endpoints).
test('M2: operator of queue A and queue admin of queue B cannot read the event: 403', async () => {
    for (const token of [SESSION_TOKENS.operator, SESSION_TOKENS.queueAdmin]) {
        const response = await getEvent(IDS.event, token);
        assert.equal(response.status, 403);
        assert.equal(JSON.stringify(response.body).includes('EVNTCODE'), false);
        assert.equal(JSON.stringify(response.body).includes('QUEUEBBB'), false);
    }
});

// M2: the event's editor gets the full event, with every access code.
test('M2: event editor gets the event, its access code and every queue code', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.editor);
    assert.equal(response.status, 200);
    assert.equal(response.body.event.access_code, 'EVNTCODE');
    assert.deepEqual(response.body.queues.map((queue) => queue.access_code), ['QUEUEAAA', 'QUEUEBBB']);
});

// M2: an editor of another event gets 403 for this one.
test('M2: editor of a different event cannot read this event: 403', async () => {
    database.tables.gftvqueue_event_editors[0].event_id = '11111111-1111-4111-8111-222222222222';
    const response = await getEvent(IDS.event, SESSION_TOKENS.editor);
    assert.equal(response.status, 403);
});

// L3 (F2): select('*') returns the whole event row, including created_by,
// created_at, updated_at and description, which the event page doesn't show.
test('L3: GET returns the whole event row', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.editor);
    assert.deepEqual(Object.keys(response.body.event).sort(), [
        'access_code', 'created_at', 'created_by', 'description', 'event_date', 'id', 'name',
        'status', 'updated_at', 'venue',
    ]);
    assert.equal(database.queriesOn('gftvqueue_events')[0].calls[0].args[0], '*');
});

test('PUT as superadmin updates the given fields only', async () => {
    const response = await callHandler(HANDLER, {
        method: 'PUT', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin, body: { status: 'closed' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.event.status, 'closed');
    assert.equal(response.body.event.name, 'GFTV Test Con 2026');
    assert.equal(database.row('gftvqueue_events', IDS.event).status, 'closed');
});

test('PUT as event editor: 403', async () => {
    const response = await callHandler(HANDLER, {
        method: 'PUT', query: { eventId: IDS.event }, token: SESSION_TOKENS.editor, body: { name: 'Renamed' },
    });
    assert.equal(response.status, 403);
    assert.equal(database.row('gftvqueue_events', IDS.event).name, 'GFTV Test Con 2026');
});

test('DELETE as event editor: 403', async () => {
    const response = await callHandler(HANDLER, {
        method: 'DELETE', query: { eventId: IDS.event }, token: SESSION_TOKENS.editor,
    });
    assert.equal(response.status, 403);
    assert.notEqual(database.row('gftvqueue_events', IDS.event), null);
});

test('DELETE as superadmin removes the event', async () => {
    const response = await callHandler(HANDLER, {
        method: 'DELETE', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Event deleted' });
    assert.equal(database.row('gftvqueue_events', IDS.event), null);
});

test('POST is not allowed: 405', async () => {
    const response = await callHandler(HANDLER, {
        method: 'POST', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin,
    });
    assert.equal(response.status, 405);
});
