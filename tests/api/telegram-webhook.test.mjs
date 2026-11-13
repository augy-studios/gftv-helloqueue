// api/telegram/webhook.js, the Telegram webhook.
//
// H4 (fixed in job 04): the webhook fails closed. With TELEGRAM_WEBHOOK_SECRET
// unset (or empty) it rejects every request and logs why; with it set, only a
// request whose X-Telegram-Bot-Api-Secret-Token header matches it exactly
// (compared in constant time) is handled. Before the fix, an unset secret
// meant no check at all, so anyone could post an update in any Telegram
// user's name, such as "/start attend_<code>" to sign in as them.
//
// M4 (job 04): the webhook handles messages only. Leave and notification
// button presses (callback queries) change nothing here, whoever presses them;
// the polling bot handles those buttons (tests in telegram-bot-buttons.test.mjs).

import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { callHandler } from '../support/handlers.cjs';
import { IDS, LOGIN_CODES, TELEGRAM_IDS } from '../support/fixtures.cjs';
import { telegramMessages } from '../support/telegram.cjs';
import { useFreshDatabase } from './helpers.mjs';

const HANDLER = 'api/telegram/webhook.js';
const SECRET = 'test-webhook-secret_0123456789-abcdefghij';
const HEADER = 'x-telegram-bot-api-secret-token';
let database;
let errorLog;

beforeEach(() => {
    database = useFreshDatabase();
    process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
    errorLog = mock.method(console, 'error', () => {});
});

afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    mock.restoreAll();
});

// An update with a text message from a Telegram user in their private chat.
function messageUpdate(text, telegramUserId = TELEGRAM_IDS.newcomer) {
    return {
        update_id: 1000,
        message: {
            message_id: 1,
            date: 1763000000,
            chat: { id: telegramUserId, type: 'private' },
            from: { id: telegramUserId, is_bot: false, first_name: 'Ivy', username: 'ivy_ibis' },
            text,
        },
    };
}

// An update for a button press, as Telegram sends it.
function buttonUpdate(data, presserId) {
    return {
        update_id: 2000,
        callback_query: {
            id: 'test-callback-1',
            from: { id: presserId, is_bot: false, first_name: 'Tester' },
            message: { message_id: 1, chat: { id: presserId, type: 'private' } },
            chat_instance: 'test-chat-instance',
            data,
        },
    };
}

function postUpdate(update, secretHeader) {
    const headers = {};
    if (secretHeader !== undefined) {
        headers[HEADER] = secretHeader;
    }
    return callHandler(HANDLER, { method: 'POST', body: update, headers });
}

// "/start attend_<code>" signs the sender in to the queue page. These check
// whether the webhook acted on it.
const ATTEND_UPDATE = messageUpdate(`/start attend_${LOGIN_CODES.pending}`);

function assertAttendNotHandled() {
    const loginCode = database.rows('gftvqueue_attendee_login_codes').find((row) => row.code === LOGIN_CODES.pending);
    assert.equal(loginCode.used_at, null);
    assert.equal(loginCode.session_token, null);
    const sessions = database.rows('gftvqueue_attendee_sessions').filter((row) => row.telegram_user_id === TELEGRAM_IDS.newcomer);
    assert.equal(sessions.length, 1, 'the newcomer keeps only the fixture session');
    assert.deepEqual(telegramMessages(), []);
}

function loggedErrors() {
    return errorLog.mock.calls.map((call) => call.arguments.join(' '));
}

test('H4: secret not set: every request is rejected with 403, and the log says why', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const response = await postUpdate(ATTEND_UPDATE, SECRET);

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Forbidden' });
    assertAttendNotHandled();
    assert.equal(loggedErrors().length, 1);
    assert.match(loggedErrors()[0], /TELEGRAM_WEBHOOK_SECRET is not set/);
});

test('H4: secret set to an empty string counts as not set', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = '';
    const response = await postUpdate(ATTEND_UPDATE, '');

    assert.equal(response.status, 403);
    assertAttendNotHandled();
    assert.match(loggedErrors()[0], /TELEGRAM_WEBHOOK_SECRET is not set/);
});

test('H4: secret not set: a request with no header is rejected too', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const response = await postUpdate(ATTEND_UPDATE);

    assert.equal(response.status, 403);
    assertAttendNotHandled();
});

test('H4: no secret header: 403', async () => {
    const response = await postUpdate(ATTEND_UPDATE);

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Forbidden' });
    assertAttendNotHandled();
    assert.match(loggedErrors()[0], /missing or wrong/);
});

test('H4: wrong secret of the same length: 403', async () => {
    const wrongSecret = SECRET.slice(0, -1) + 'X';
    assert.equal(wrongSecret.length, SECRET.length);
    const response = await postUpdate(ATTEND_UPDATE, wrongSecret);

    assert.equal(response.status, 403);
    assertAttendNotHandled();
});

test('H4: wrong-length secrets (shorter, longer, empty) are rejected without an error', async () => {
    for (const wrongSecret of [SECRET.slice(0, 10), `${SECRET}-and-more`, '', 'x']) {
        const response = await postUpdate(ATTEND_UPDATE, wrongSecret);
        assert.equal(response.status, 403, `secret "${wrongSecret}"`);
    }
    assertAttendNotHandled();
});

test('H4: the secret is compared exactly (no trimming, case or prefix matches)', async () => {
    for (const nearMiss of [` ${SECRET}`, `${SECRET} `, SECRET.toUpperCase(), `${SECRET}${SECRET}`]) {
        const response = await postUpdate(ATTEND_UPDATE, nearMiss);
        assert.equal(response.status, 403, `secret "${nearMiss}"`);
    }
    assertAttendNotHandled();
});

test('H4: the right secret: the update is handled as before', async () => {
    const response = await postUpdate(ATTEND_UPDATE, SECRET);

    assert.equal(response.status, 200);
    const loginCode = database.rows('gftvqueue_attendee_login_codes').find((row) => row.code === LOGIN_CODES.pending);
    assert.notEqual(loginCode.used_at, null);
    assert.notEqual(loginCode.session_token, null);
    const session = database.rows('gftvqueue_attendee_sessions').find((row) => row.token === loginCode.session_token);
    assert.equal(session.telegram_user_id, TELEGRAM_IDS.newcomer);
    const messages = telegramMessages();
    assert.equal(messages.length, 1);
    assert.equal(messages[0].chatId, TELEGRAM_IDS.newcomer);
    assert.match(messages[0].text, /You're connected/);
    assert.deepEqual(loggedErrors(), []);
});

test('H4: the header is compared with crypto.timingSafeEqual, on equal-length digests', async () => {
    const compare = mock.method(crypto, 'timingSafeEqual');
    syncBuiltinESMExports();
    try {
        await postUpdate(ATTEND_UPDATE, 'short');
        await postUpdate(ATTEND_UPDATE, SECRET);
    } finally {
        compare.mock.restore();
        syncBuiltinESMExports();
    }
    assert.equal(compare.mock.callCount(), 2);
    for (const call of compare.mock.calls) {
        const [received, expected] = call.arguments;
        assert.equal(received.length, expected.length);
    }
    assert.deepEqual(compare.mock.calls.map((call) => call.result), [false, true]);
});

test('H4: the right secret: /help still answers', async () => {
    const response = await postUpdate(messageUpdate('/help'), SECRET);

    assert.equal(response.status, 200);
    assert.equal(telegramMessages().length, 1);
    assert.match(telegramMessages()[0].text, /Welcome to GFTV HelloQueue/);
});

test('H4: GET and OPTIONS are unchanged (405 and the CORS preflight)', async () => {
    const getResponse = await callHandler(HANDLER, { method: 'GET' });
    assert.equal(getResponse.status, 405);
    const optionsResponse = await callHandler(HANDLER, { method: 'OPTIONS' });
    assert.equal(optionsResponse.status, 204);
});

test('M4: someone else\'s Leave or notification button press changes nothing in the webhook', async () => {
    for (const prefix of ['leave_', 'notif_serving_', 'notif_next_']) {
        const response = await postUpdate(buttonUpdate(`${prefix}${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA6), SECRET);
        assert.equal(response.status, 200);
    }
    const entry = database.row('gftvqueue_entries', IDS.entryA5Waiting);
    assert.notEqual(entry, null);
    assert.equal(entry.notify_serving, true);
    assert.equal(entry.notify_next, true);
    assert.deepEqual(telegramMessages(), []);
});

test('M4: the owner\'s own button press doesn\'t act in the webhook either (buttons belong to the polling bot)', async () => {
    const response = await postUpdate(buttonUpdate(`leave_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA5), SECRET);

    assert.equal(response.status, 200);
    assert.notEqual(database.row('gftvqueue_entries', IDS.entryA5Waiting), null);
    assert.deepEqual(telegramMessages(), []);
});
