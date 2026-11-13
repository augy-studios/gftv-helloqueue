// Checks on the fake Supabase itself, so later jobs can trust what the
// handler tests tell them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, createDatabase, useDatabase, STUB_SUPABASE_URL } from '../support/fake-supabase.cjs';

function setUp() {
    const database = createDatabase({
        gftvqueue_entries: [
            { id: 'e1', queue_id: 'q1', telegram_user_id: 1, display_name: 'One', queue_number: 1, status: 'waiting' },
            { id: 'e2', queue_id: 'q1', telegram_user_id: 2, display_name: 'Two', queue_number: 2, status: 'serving' },
            { id: 'e3', queue_id: 'q1', telegram_user_id: 3, display_name: 'Three', queue_number: 3, status: 'completed' },
            { id: 'e4', queue_id: 'q2', telegram_user_id: 4, display_name: 'Four', queue_number: 1, status: 'waiting' },
        ],
        gftvqueue_queues: [{ id: 'q1', event_id: 'ev1', name: 'Queue One', access_code: 'AAAAAAAA', max_serving: 2 }],
        gftvqueue_events: [{ id: 'ev1', name: 'Event One', access_code: 'EEEEEEEE' }],
    });
    useDatabase(database);
    return { database, client: createClient(STUB_SUPABASE_URL, 'key') };
}

test('refuses any URL but the stub, so a real project can never be used', () => {
    assert.throws(() => createClient('https://real-project.supabase.co', 'key'), /stub URL/);
});

test('filters, orders, limits and projects', async () => {
    const { client } = setUp();
    const { data, error } = await client
        .from('gftvqueue_entries')
        .select('id, queue_number')
        .eq('queue_id', 'q1')
        .not('status', 'eq', 'completed')
        .order('queue_number', { ascending: false })
        .limit(5);
    assert.equal(error, null);
    assert.deepEqual(data, [{ id: 'e2', queue_number: 2 }, { id: 'e1', queue_number: 1 }]);
});

test('in, not in, gt and count with head', async () => {
    const { client } = setUp();
    const inResult = await client.from('gftvqueue_entries').select('id').in('status', ['waiting', 'serving']);
    assert.deepEqual(inResult.data.map((row) => row.id), ['e1', 'e2', 'e4']);
    const notIn = await client.from('gftvqueue_entries').select('id').not('status', 'in', '("completed")');
    assert.deepEqual(notIn.data.map((row) => row.id), ['e1', 'e2', 'e4']);
    const counted = await client.from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', 'q1')
        .gt('queue_number', 1);
    assert.equal(counted.data, null);
    assert.equal(counted.count, 2);
});

test('single() and maybeSingle() follow PostgREST', async () => {
    const { client } = setUp();
    const none = await client.from('gftvqueue_entries').select('id').eq('id', 'missing').single();
    assert.equal(none.data, null);
    assert.equal(none.error.code, 'PGRST116');
    const maybeNone = await client.from('gftvqueue_entries').select('id').eq('id', 'missing').maybeSingle();
    assert.deepEqual([maybeNone.data, maybeNone.error], [null, null]);
    const many = await client.from('gftvqueue_entries').select('id').eq('queue_id', 'q1').maybeSingle();
    assert.equal(many.error.code, 'PGRST116');
});

test('embeds a parent row through its foreign key', async () => {
    const { client } = setUp();
    const { data } = await client.from('gftvqueue_queues').select('name, gftvqueue_events(access_code)').eq('id', 'q1').single();
    assert.deepEqual(data, { name: 'Queue One', gftvqueue_events: { access_code: 'EEEEEEEE' } });
});

test('an unknown column fails like PostgREST (42703)', async () => {
    const { client } = setUp();
    const { data, error } = await client.from('gftvqueue_entries').select('id, queueNumber');
    assert.equal(data, null);
    assert.equal(error.code, '42703');
});

test('an unknown table fails like PostgREST (42P01)', async () => {
    const { client } = setUp();
    const { error } = await client.from('gftvqueue_entry').select('*');
    assert.equal(error.code, '42P01');
});

test('writes return no data without .select(), and rows with it', async () => {
    const { client, database } = setUp();
    const plain = await client.from('gftvqueue_entries').update({ status: 'missed' }).eq('id', 'e2');
    assert.equal(plain.data, null);
    assert.equal(database.row('gftvqueue_entries', 'e2').status, 'missed');
    const returned = await client.from('gftvqueue_entries')
        .insert({ queue_id: 'q1', telegram_user_id: 9, display_name: 'Nine', queue_number: 9 })
        .select('queue_number, status')
        .single();
    assert.deepEqual(returned.data, { queue_number: 9, status: 'waiting' });
});

test('a broken unique key fails with 23505', async () => {
    const { client } = setUp();
    const { error } = await client.from('gftvqueue_entries')
        .insert({ queue_id: 'q1', telegram_user_id: 9, display_name: 'Dup', queue_number: 1 });
    assert.equal(error.code, '23505');
});

test('records every builder call', async () => {
    const { client, database } = setUp();
    await client.from('gftvqueue_entries').select('id').eq('queue_id', 'q1').limit(1);
    assert.deepEqual(database.queriesOn('gftvqueue_entries')[0].calls, [
        { method: 'select', args: ['id', {}] },
        { method: 'eq', args: ['queue_id', 'q1'] },
        { method: 'limit', args: [1] },
    ]);
});
