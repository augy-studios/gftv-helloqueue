// The operator's Completed column (decision 4, job 03): GET
// api/queues/[queueId].js sends completedCount, how many entries in the
// queue have finished, and entries.completed, only the last
// RECENT_COMPLETED_LIMIT of them, newest first. Each carries what its card
// shows: the number, the name and the @username (decision 5). Finished cards
// have no buttons, so no id.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { RECENT_COMPLETED_LIMIT } from '../../api/queues/[queueId].js';
import { useFreshDatabase } from './helpers.mjs';

const HANDLER = 'api/queues/[queueId].js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function getQueue(queueId, token = SESSION_TOKENS.operator) {
    return callHandler(HANDLER, { method: 'GET', query: { queueId }, token });
}

function numbers(entries) {
    return entries.map((entry) => entry.queue_number);
}

// Adds finished entries to a queue. `finishes` maps each queue number to
// when it finished; every other column gets a plain value.
function addFinishedEntries(queueId, finishes) {
    for (const [queueNumber, completedAt] of Object.entries(finishes)) {
        const number = Number(queueNumber);
        database.tables.gftvqueue_entries.push({
            id: `eeeeeeee-1111-4000-8000-${String(number).padStart(12, '0')}`,
            queue_id: queueId,
            telegram_user_id: 9500 + number,
            telegram_username: `finished_${number}`,
            display_name: `Finished ${number}`,
            queue_number: number,
            status: 'completed',
            notify_serving: true,
            notify_next: true,
            joined_at: '2026-11-13T08:00:00.000Z',
            called_at: '2026-11-13T08:30:00.000Z',
            entered_at: '2026-11-13T08:35:00.000Z',
            completed_at: completedAt,
        });
    }
}

test('RECENT_COMPLETED_LIMIT is 5', () => {
    assert.equal(RECENT_COMPLETED_LIMIT, 5);
});

test('one finished entry: completedCount 1 and that entry, without an id', async () => {
    const response = await getQueue(IDS.queueA);
    assert.equal(response.status, 200);
    assert.equal(response.body.completedCount, 1);
    assert.deepEqual(response.body.entries.completed, [
        { queue_number: 1, display_name: 'Alice Fox', telegram_username: 'alice_fox' },
    ]);
});

test('more finished than the limit: the total, and only the newest 5, newest first', async () => {
    // #1 (fixture) finished at 09:20. #7 finished last, #12 first.
    addFinishedEntries(IDS.queueA, {
        7: '2026-11-13T10:06:00.000Z',
        8: '2026-11-13T10:05:00.000Z',
        9: '2026-11-13T10:04:00.000Z',
        10: '2026-11-13T10:03:00.000Z',
        11: '2026-11-13T10:02:00.000Z',
        12: '2026-11-13T10:01:00.000Z',
    });
    const response = await getQueue(IDS.queueA);
    assert.equal(response.body.completedCount, 7);
    assert.equal(response.body.entries.completed.length, RECENT_COMPLETED_LIMIT);
    assert.deepEqual(numbers(response.body.entries.completed), [7, 8, 9, 10, 11]);
});

test('the order is by finish time, not by queue number', async () => {
    addFinishedEntries(IDS.queueA, {
        7: '2026-11-13T09:00:00.000Z',
        8: '2026-11-13T11:00:00.000Z',
        9: '2026-11-13T10:00:00.000Z',
    });
    const response = await getQueue(IDS.queueA);
    assert.deepEqual(numbers(response.body.entries.completed), [8, 9, 1, 7]);
});

test('entries that finished at the same moment come highest number first', async () => {
    addFinishedEntries(IDS.queueA, {
        7: '2026-11-13T10:00:00.000Z',
        8: '2026-11-13T10:00:00.000Z',
    });
    const response = await getQueue(IDS.queueA);
    assert.deepEqual(numbers(response.body.entries.completed), [8, 7, 1]);
});

test('no finished entries: completedCount 0 and an empty list', async () => {
    const response = await getQueue(IDS.queueB, SESSION_TOKENS.queueAdmin);
    assert.equal(response.status, 200);
    assert.equal(response.body.completedCount, 0);
    assert.deepEqual(response.body.entries.completed, []);
});

test('another queue\'s finished entries are not counted or listed', async () => {
    addFinishedEntries(IDS.queueB, {
        3: '2026-11-13T10:00:00.000Z',
        4: '2026-11-13T10:01:00.000Z',
    });
    const response = await getQueue(IDS.queueA);
    assert.equal(response.body.completedCount, 1);
    assert.deepEqual(numbers(response.body.entries.completed), [1]);
});

test('finished entries carry only the number, name and @username', async () => {
    addFinishedEntries(IDS.queueA, { 7: '2026-11-13T10:00:00.000Z' });
    const response = await getQueue(IDS.queueA);
    for (const entry of response.body.entries.completed) {
        assert.deepEqual(Object.keys(entry).sort(), ['display_name', 'queue_number', 'telegram_username']);
    }
});

test('the other columns never include finished entries', async () => {
    addFinishedEntries(IDS.queueA, { 7: '2026-11-13T10:00:00.000Z' });
    const response = await getQueue(IDS.queueA);
    const live = [
        ...response.body.entries.serving,
        ...response.body.entries.waiting,
        ...response.body.entries.missed,
    ];
    assert.deepEqual(numbers(live).sort((left, right) => left - right), [2, 3, 4, 5, 6]);
});

test('the live entries query never reads finished rows', async () => {
    await getQueue(IDS.queueA);
    const liveQuery = database.queriesOn('gftvqueue_entries')[0];
    assert.deepEqual(liveQuery.result.data.map((row) => row.status).sort(), [
        'missed', 'serving', 'serving', 'waiting', 'waiting',
    ]);
});
