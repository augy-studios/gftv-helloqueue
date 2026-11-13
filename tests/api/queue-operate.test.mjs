// Baseline: POST api/queues/[queueId]/operate.js, as the code behaves today.
// Tests marked with a gap ID (H2, M2) record a known security gap on
// purpose; job 02 changes them when it fixes the gap.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS, TELEGRAM_IDS } from '../support/fixtures.cjs';
import { telegramMessages } from '../support/telegram.cjs';
import { useFreshDatabase, callsOn } from './helpers.mjs';

const HANDLER = 'api/queues/[queueId]/operate.js';
const UNKNOWN_ENTRY = '99999999-9999-4999-8999-999999999999';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function operate(queueId, token, body) {
    return callHandler(HANDLER, { method: 'POST', query: { queueId }, token, body });
}

function entryRow(id) {
    return database.row('gftvqueue_entries', id);
}

function setEntry(id, values) {
    const row = database.tables.gftvqueue_entries.find((candidate) => candidate.id === id);
    Object.assign(row, values);
}

test('GET is not allowed: 405', async () => {
    const response = await callHandler(HANDLER, { method: 'GET', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator });
    assert.equal(response.status, 405);
});

test('no token: 401', async () => {
    const response = await operate(IDS.queueA, null, { action: 'call_next' });
    assert.equal(response.status, 401);
});

test('account with no roles: 403', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.outsider, { action: 'call_next' });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'No permission to operate this queue' });
});

test('queue admin of queue B cannot operate queue A: 403', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.queueAdmin, { action: 'call_next' });
    assert.equal(response.status, 403);
});

test('operator of queue A cannot operate queue B through its URL: 403', async () => {
    const response = await operate(IDS.queueB, SESSION_TOKENS.operator, { action: 'call_next' });
    assert.equal(response.status, 403);
});

test('event editor without a queue permission cannot operate: 403', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.editor, { action: 'call_next' });
    assert.equal(response.status, 403);
});

test('unknown queue (as superadmin): 404', async () => {
    const response = await operate('99999999-9999-4999-8999-999999999999', SESSION_TOKENS.superadmin, { action: 'call_next' });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Queue not found' });
});

test('unknown action: 400', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'shuffle' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Unknown action' });
});

test('call_next calls the first waiting attendee, makes a QR token and sends both Telegram notices', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'call_next' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Called 1 attendee(s)', called: [5] });

    const called = entryRow(IDS.entryA5Waiting);
    assert.equal(called.status, 'serving');
    assert.notEqual(called.called_at, null);

    const tokens = database.rows('gftvqueue_entry_tokens').filter((row) => row.entry_id === IDS.entryA5Waiting);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].used_at, null);

    const messages = telegramMessages();
    assert.equal(messages.length, 2);
    assert.equal(messages[0].chatId, TELEGRAM_IDS.attendeeA5);
    assert.match(messages[0].text, /It's your turn!/);
    assert.match(messages[0].text, /#5/);
    assert.equal(messages[1].chatId, TELEGRAM_IDS.attendeeA6);
    assert.match(messages[1].text, /You're next in line!/);
});

test('call_next queries the serving entries, then the next waiting ones by number', async () => {
    await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'call_next' });
    const entryQueries = callsOn(database, 'gftvqueue_entries');
    assert.deepEqual(entryQueries[0], [
        ['select', 'id, queue_number, telegram_user_id', {}],
        ['eq', 'queue_id', IDS.queueA],
        ['eq', 'status', 'serving'],
        ['order', 'queue_number', { ascending: true }],
    ]);
    assert.deepEqual(entryQueries[1], [
        ['select', 'id, queue_number, telegram_user_id, notify_serving', {}],
        ['eq', 'queue_id', IDS.queueA],
        ['eq', 'status', 'waiting'],
        ['order', 'queue_number', { ascending: true }],
        ['limit', 1],
    ]);
});

test('call_batch is capped by the free serving slots (queue A has 1 of 3 free)', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'call_batch', count: 5 });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.called, [5]);
    assert.equal(entryRow(IDS.entryA6Waiting).status, 'waiting');
});

test('call_batch calls several when there is room', async () => {
    database.tables.gftvqueue_queues.find((row) => row.id === IDS.queueA).max_serving = 10;
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'call_batch', count: 2 });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Called 2 attendee(s)', called: [5, 6] });
});

test('call_next at capacity: 400', async () => {
    database.tables.gftvqueue_queues.find((row) => row.id === IDS.queueA).max_serving = 2;
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'call_next' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Queue is at capacity. Complete or miss some entries first.' });
});

test('call_next with nobody waiting: 400', async () => {
    setEntry(IDS.entryA5Waiting, { status: 'completed' });
    setEntry(IDS.entryA6Waiting, { status: 'completed' });
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'call_next' });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'No one is waiting in the queue' });
});

test('superadmin can operate any queue without a permission row', async () => {
    const response = await operate(IDS.queueB, SESSION_TOKENS.superadmin, { action: 'call_next' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.called, [1]);
    assert.equal(callsOn(database, 'gftvqueue_queue_permissions').length, 0);
});

for (const action of ['mark_missed', 'mark_complete', 'mark_entered', 'rejoin']) {
    test(`${action} without entry_id: 400`, async () => {
        const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action });
        assert.equal(response.status, 400);
        assert.deepEqual(response.body, { error: 'entry_id required' });
    });
}

test('mark_missed on a called attendee marks them missed and tells them on Telegram', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_missed', entry_id: IDS.entryA3Called });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Marked as missed' });
    assert.equal(entryRow(IDS.entryA3Called).status, 'missed');
    const messages = telegramMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].chatId, TELEGRAM_IDS.attendeeA3);
    assert.match(messages[0].text, /You missed your turn/);
});

test('mark_missed on a waiting attendee: 400', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_missed', entry_id: IDS.entryA5Waiting });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Entry must be in serving state to mark missed' });
});

test('mark_missed on an unknown entry: 404', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_missed', entry_id: UNKNOWN_ENTRY });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: 'Entry not found' });
});

test('mark_entered on a called attendee sets entered_at and tells them on Telegram', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_entered', entry_id: IDS.entryA3Called });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Marked as entered' });
    assert.notEqual(entryRow(IDS.entryA3Called).entered_at, null);
    assert.equal(entryRow(IDS.entryA3Called).status, 'serving');
    assert.match(telegramMessages()[0].text, /Entrance confirmed!/);
});

test('mark_entered twice: 409', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_entered', entry_id: IDS.entryA4Entered });
    assert.equal(response.status, 409);
    assert.deepEqual(response.body, { error: 'Entry already marked as entered' });
});

test('mark_entered on a waiting attendee: 400', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_entered', entry_id: IDS.entryA5Waiting });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Entry must be in serving state' });
});

test('mark_complete (manual exit) completes a called attendee', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_complete', entry_id: IDS.entryA4Entered });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Marked as complete' });
    assert.equal(entryRow(IDS.entryA4Entered).status, 'completed');
    assert.notEqual(entryRow(IDS.entryA4Entered).completed_at, null);
});

test('rejoin moves a missed attendee back to waiting', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'rejoin', entry_id: IDS.entryA2Missed });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Entry moved back to waiting' });
    assert.equal(entryRow(IDS.entryA2Missed).status, 'waiting');
});

test('rejoin on a waiting attendee: 400', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'rejoin', entry_id: IDS.entryA5Waiting });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Entry must be in missed state to rejoin' });
});

// H2: entry actions don't check that entry_id belongs to the queue in the
// URL. The permission check passes for queue A, then the action changes an
// entry in queue B.
test('H2: operator of queue A can mark a queue B attendee missed through queue A', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_missed', entry_id: IDS.entryB2Called });
    assert.equal(response.status, 200);
    assert.equal(entryRow(IDS.entryB2Called).status, 'missed');
    // The Telegram notice even names queue A, the wrong queue.
    const messages = telegramMessages();
    assert.equal(messages[0].chatId, TELEGRAM_IDS.attendeeB2);
    assert.match(messages[0].text, /Dealers Den \(Queue A\)/);
});

// H2: same gap, mark_entered.
test('H2: operator of queue A can mark a queue B attendee entered through queue A', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_entered', entry_id: IDS.entryB2Called });
    assert.equal(response.status, 200);
    assert.notEqual(entryRow(IDS.entryB2Called).entered_at, null);
});

// H2: same gap, mark_complete.
test('H2: operator of queue A can complete a queue B attendee through queue A', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_complete', entry_id: IDS.entryB2Called });
    assert.equal(response.status, 200);
    assert.equal(entryRow(IDS.entryB2Called).status, 'completed');
});

// H2: same gap, rejoin.
test('H2: operator of queue A can move a missed queue B attendee back to waiting through queue A', async () => {
    setEntry(IDS.entryB2Called, { status: 'missed' });
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'rejoin', entry_id: IDS.entryB2Called });
    assert.equal(response.status, 200);
    assert.equal(entryRow(IDS.entryB2Called).status, 'waiting');
});

// M2: mark_complete never looks the entry up: it completes an entry from any
// state, and answers 200 for an id that doesn't exist.
test('M2: mark_complete completes a waiting attendee who was never called', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_complete', entry_id: IDS.entryA5Waiting });
    assert.equal(response.status, 200);
    assert.equal(entryRow(IDS.entryA5Waiting).status, 'completed');
});

// M2: same gap, a missed entry.
test('M2: mark_complete completes a missed attendee', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_complete', entry_id: IDS.entryA2Missed });
    assert.equal(response.status, 200);
    assert.equal(entryRow(IDS.entryA2Missed).status, 'completed');
});

// M2: same gap, an id that doesn't exist.
test('M2: mark_complete answers 200 for an entry that does not exist', async () => {
    const response = await operate(IDS.queueA, SESSION_TOKENS.operator, { action: 'mark_complete', entry_id: UNKNOWN_ENTRY });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { message: 'Marked as complete' });
});
