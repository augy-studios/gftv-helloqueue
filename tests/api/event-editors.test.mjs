// api/events/[eventId]/editors.js (GET list, POST assign, DELETE remove).
// M1 (fixed in job 02, with job 01's editors GET finding): only people who
// manage the event (a superadmin or one of its editors) may list its editors,
// and editors' emails are never sent: no page shows them (rule F2). The
// editor embed names its key (gftvhello_users!user_id), so the list loads;
// the event page's own editor list (api/events/[eventId].js) still has job
// 01's B2.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase } from './helpers.mjs';

const HANDLER = 'api/events/[eventId]/editors.js';
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

function listEditors(token, eventId = IDS.event) {
    return callHandler(HANDLER, { method: 'GET', query: { eventId }, token });
}

test('no token: 401', async () => {
    const response = await listEditors(null);
    assert.equal(response.status, 401);
});

test('M1: superadmin lists the event\'s editors, without emails', async () => {
    const response = await listEditors(SESSION_TOKENS.superadmin);
    assert.equal(response.status, 200);
    assert.equal(response.body.editors.length, 1);
    const editor = response.body.editors[0];
    assert.equal(editor.user_id, IDS.editor);
    assert.deepEqual(editor.gftvhello_users, { username: 'editor.eve', display_name: 'Eve Editor' });
    assert.equal(JSON.stringify(response.body).includes('@example.test'), false);
});

test('M1: the event\'s editor lists its editors, without emails', async () => {
    const response = await listEditors(SESSION_TOKENS.editor);
    assert.equal(response.status, 200);
    assert.equal(response.body.editors.length, 1);
    assert.equal('email' in response.body.editors[0].gftvhello_users, false);
});

test('M1: operators, queue admins and accounts with no roles get 403', async () => {
    for (const token of [SESSION_TOKENS.operator, SESSION_TOKENS.queueAdmin, SESSION_TOKENS.outsider]) {
        const response = await listEditors(token);
        assert.equal(response.status, 403);
        assert.deepEqual(response.body, { error: 'Event editor access required' });
    }
});

test('M1: an editor of a different event gets 403', async () => {
    database.tables.gftvqueue_event_editors[0].event_id = '11111111-1111-4111-8111-222222222222';
    const response = await listEditors(SESSION_TOKENS.editor);
    assert.equal(response.status, 403);
});

test('M1: the editor list never selects email', async () => {
    await listEditors(SESSION_TOKENS.superadmin);
    const listQuery = database.queriesOn('gftvqueue_event_editors').at(-1);
    assert.equal(listQuery.calls[0].args[0], 'user_id, gftvhello_users!user_id(username, display_name)');
    assert.equal(listQuery.result.error, null);
});

test('POST as superadmin assigns an editor', async () => {
    const response = await callHandler(HANDLER, {
        method: 'POST', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin, body: { user_id: IDS.operator },
    });
    assert.equal(response.status, 201);
    assert.equal(database.rows('gftvqueue_event_editors').length, 2);
});

test('POST as the event\'s editor: 403', async () => {
    const response = await callHandler(HANDLER, {
        method: 'POST', query: { eventId: IDS.event }, token: SESSION_TOKENS.editor, body: { user_id: IDS.operator },
    });
    assert.equal(response.status, 403);
});

test('DELETE as the event\'s editor: 403', async () => {
    const response = await callHandler(HANDLER, {
        method: 'DELETE', query: { eventId: IDS.event }, token: SESSION_TOKENS.editor, body: { user_id: IDS.editor },
    });
    assert.equal(response.status, 403);
    assert.equal(database.rows('gftvqueue_event_editors').length, 1);
});
