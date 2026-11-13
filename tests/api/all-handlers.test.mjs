// Every route file in api/ loads with the fake Supabase and answers a CORS
// preflight. This proves the harness can call each handler; the behaviour
// tests live in the other files.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler, listApiRouteFiles, resolveApiRoute } from '../support/handlers.cjs';
import { useFreshDatabase } from './helpers.mjs';

beforeEach(() => {
    useFreshDatabase();
});

const routeFiles = listApiRouteFiles();

test('the router finds all 22 route files', () => {
    assert.equal(routeFiles.length, 22);
});

for (const file of routeFiles) {
    test(`${file}: loads and answers OPTIONS with 204`, async () => {
        const response = await callHandler(file, { method: 'OPTIONS' });
        assert.equal(response.status, 204);
        assert.equal(response.ended, true);
        assert.equal(response.headers['access-control-allow-origin'], '*');
    });
}

test('URL paths map to route files the way Vercel maps them', () => {
    assert.deepEqual(resolveApiRoute('/api/events'), { file: 'api/events/index.js', params: {} });
    assert.deepEqual(resolveApiRoute('/api/events/e1'), { file: 'api/events/[eventId].js', params: { eventId: 'e1' } });
    assert.deepEqual(resolveApiRoute('/api/events/e1/editors'), {
        file: 'api/events/[eventId]/editors.js', params: { eventId: 'e1' },
    });
    assert.deepEqual(resolveApiRoute('/api/queues/q1/operate'), {
        file: 'api/queues/[queueId]/operate.js', params: { queueId: 'q1' },
    });
    assert.deepEqual(resolveApiRoute('/api/display/EVNTCODE/QUEUEAAA'), {
        file: 'api/display/[eventCode]/[queueCode].js', params: { eventCode: 'EVNTCODE', queueCode: 'QUEUEAAA' },
    });
    assert.equal(resolveApiRoute('/api/_auth'), null);
    assert.equal(resolveApiRoute('/api/nothing/here'), null);
});
