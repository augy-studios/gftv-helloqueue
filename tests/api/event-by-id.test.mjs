// Baseline: api/events/[eventId].js (GET, PUT, DELETE), as the code behaves
// today. Tests marked with a gap ID (H3, L3) record a known security gap on
// purpose; job 02 changes them when it fixes the gap. B2 marks a bug.

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

// H3: no access check on GET. Any signed-in account reads any event, with
// every queue and its access code.
test('H3: an account with no roles can read the event, its queues and their access codes', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.outsider);
    assert.equal(response.status, 200);
    assert.equal(response.body.event.access_code, 'EVNTCODE');
    assert.deepEqual(response.body.queues.map((queue) => queue.access_code), ['QUEUEAAA', 'QUEUEBBB']);
});

// H3: same gap, for an operator: they see queue B as well as queue A.
test('H3: operator of queue A also sees queue B in the event', async () => {
    const response = await getEvent(IDS.event, SESSION_TOKENS.operator);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.queues.map((queue) => queue.id), [IDS.queueA, IDS.queueB]);
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
