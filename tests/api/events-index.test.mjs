// api/events/index.js (GET list, POST create).
// M2 (job 02): events and their access codes are listed only to a superadmin
// (every event) and an event's editors (their events). The code already did
// this; the M2 tests prove it. L2 (fixed in job 03, rule F2): the list sends
// only what the events page shows. B1 marks behaviour that Augy's decision 1
// ("own records") will change.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase, callsOn } from './helpers.mjs';

const HANDLER = 'api/events/index.js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function listEvents(token) {
    return callHandler(HANDLER, { method: 'GET', token });
}

function createEvent(token, body) {
    return callHandler(HANDLER, { method: 'POST', token, body });
}

test('no token: 401', async () => {
    const response = await listEvents(null);
    assert.equal(response.status, 401);
});

test('superadmin lists every event', async () => {
    const response = await listEvents(SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.events.map((event) => event.id), [IDS.event]);
    assert.equal(response.body.events[0].access_code, 'EVNTCODE');
    // No editor lookup for a superadmin.
    assert.equal(callsOn(database, 'gftvqueue_event_editors').length, 0);
});

test('event editor lists the events they are assigned to', async () => {
    const response = await listEvents(SESSION_TOKENS.editor);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.events.map((event) => event.id), [IDS.event]);
    assert.deepEqual(callsOn(database, 'gftvqueue_events')[0], [
        ['select', 'id, name, venue, event_date, status, access_code', {}],
        ['in', 'id', [IDS.event]],
        ['order', 'created_at', { ascending: false }],
    ]);
});

test('an account with no roles gets an empty list', async () => {
    const response = await listEvents(SESSION_TOKENS.outsider);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { events: [] });
});

// M2: a second event the editor isn't assigned to.
const OTHER_EVENT = {
    id: '11111111-1111-4111-8111-222222222222',
    name: 'Other Con',
    status: 'active',
    access_code: 'OTHRCODE',
    created_by: IDS.superadmin,
    created_at: '2026-11-02T09:00:00.000Z',
    updated_at: '2026-11-02T09:00:00.000Z',
};

test('M2: an event editor sees only their own events and access codes', async () => {
    database.tables.gftvqueue_events.push({ description: null, venue: null, event_date: null, ...OTHER_EVENT });
    const response = await listEvents(SESSION_TOKENS.editor);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.events.map((event) => event.id), [IDS.event]);
    assert.equal(JSON.stringify(response.body).includes('OTHRCODE'), false);
});

test('M2: a superadmin sees every event with its access code', async () => {
    database.tables.gftvqueue_events.push({ description: null, venue: null, event_date: null, ...OTHER_EVENT });
    const response = await listEvents(SESSION_TOKENS.superadmin);
    assert.deepEqual(response.body.events.map((event) => event.access_code), ['OTHRCODE', 'EVNTCODE']);
});

test('M2: operators, queue admins and accounts with no roles get no events and no access codes', async () => {
    for (const token of [SESSION_TOKENS.operator, SESSION_TOKENS.queueAdmin, SESSION_TOKENS.outsider]) {
        const response = await listEvents(token);
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, { events: [] });
    }
    // The events query is built but never run for them.
    assert.equal(database.queriesOn('gftvqueue_events').every((query) => query.result === null), true);
});

// B1: only event editors see events. An operator or queue admin who isn't an
// editor gets nothing, so the dashboard's Events view is empty for them. (My
// Queues no longer depends on this: job 02's M3 gave it GET /api/queues?mine=1.)
// Decision 1 says staff see the events and queues they're assigned to.
test('B1: operator of queue A (not an event editor) gets no events', async () => {
    const response = await listEvents(SESSION_TOKENS.operator);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { events: [] });
});

// B1: same, for a queue admin.
test('B1: queue admin of queue B (not an event editor) gets no events', async () => {
    const response = await listEvents(SESSION_TOKENS.queueAdmin);
    assert.deepEqual(response.body, { events: [] });
});

// L2 (fixed, F2): the list used to carry created_by (a user id), created_at
// and description, which the events page doesn't show.
test('L2: each listed event carries only what the events page shows', async () => {
    const response = await listEvents(SESSION_TOKENS.editor);
    assert.deepEqual(Object.keys(response.body.events[0]).sort(), [
        'access_code', 'event_date', 'id', 'name', 'status', 'venue',
    ]);
});

test('POST as superadmin creates a draft event with an 8-character access code', async () => {
    const response = await createEvent(SESSION_TOKENS.superadmin, {
        name: 'New Con', venue: 'Hall 2', event_date: '2027-01-02', description: 'Made in a test',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { ok: true });
    const created = database.rows('gftvqueue_events').find((event) => event.name === 'New Con');
    assert.equal(created.status, 'draft');
    assert.equal(created.created_by, IDS.superadmin);
    assert.match(created.access_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.equal(database.rows('gftvqueue_events').length, 2);
});

test('POST with an empty date stores null', async () => {
    const response = await createEvent(SESSION_TOKENS.superadmin, { name: 'No Date Con', event_date: '' });
    assert.equal(response.status, 201);
    const created = database.rows('gftvqueue_events').find((event) => event.name === 'No Date Con');
    assert.equal(created.event_date, null);
});

test('POST without a name: 400', async () => {
    const response = await createEvent(SESSION_TOKENS.superadmin, { venue: 'Somewhere' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Event name is required' });
});

test('POST as event editor: 403', async () => {
    const response = await createEvent(SESSION_TOKENS.editor, { name: 'Sneaky Con' });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Admin access required' });
    assert.equal(database.rows('gftvqueue_events').length, 1);
});

test('DELETE is not allowed here: 405', async () => {
    const response = await callHandler(HANDLER, { method: 'DELETE', token: SESSION_TOKENS.superadmin });
    assert.equal(response.status, 405);
});
