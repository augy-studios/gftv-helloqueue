// bot/index.js, the Telegram polling bot: its button (callback query) handler.
// The real bot file runs with a fake TelegramBot and the fake Supabase (see
// tests/support/bot.cjs).
//
// M4 (fixed in job 04): a Leave or notification button acts on its entry only
// when the Telegram user who pressed it (callback_query.from.id) is the one
// who joined with it (gftvqueue_entries.telegram_user_id). Anyone else gets
// "That isn't your entry" as the button's answer, and nothing changes.

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadBot } from '../support/bot.cjs';
import { IDS, TELEGRAM_IDS } from '../support/fixtures.cjs';
import { callsOn, useFreshDatabase } from './helpers.mjs';

const NOT_YOURS = "That isn't your entry";
let bot;
let database;
let queryCount = 0;

before(async () => {
    bot = await loadBot();
});

beforeEach(() => {
    database = useFreshDatabase();
    bot.clearRecords();
});

// A button press in a private chat, as Telegram sends it. `chatId` is the
// chat the button's message is in; it's the presser's own id unless given.
function buttonPress(data, presserId, chatId = presserId) {
    queryCount += 1;
    return {
        id: `test-callback-${queryCount}`,
        from: { id: presserId, is_bot: false, first_name: 'Tester' },
        message: { message_id: 1, chat: { id: chatId, type: 'private' } },
        chat_instance: 'test-chat-instance',
        data,
    };
}

function assertAnsweredOnce(query, expectedOptions) {
    assert.deepEqual(bot.callbackAnswers, [{ callbackQueryId: query.id, options: expectedOptions }]);
}

test('the bot registers one callback_query handler', () => {
    assert.equal(bot.listeners('callback_query').length, 1);
});

test('M4: Leave on someone else\'s entry: "That isn\'t your entry", the entry stays', async () => {
    const query = buttonPress(`leave_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA6);
    await bot.pressButton(query);

    assertAnsweredOnce(query, { text: NOT_YOURS });
    assert.deepEqual(bot.sentMessages, []);
    assert.notEqual(database.row('gftvqueue_entries', IDS.entryA5Waiting), null);
});

test('M4: Leave on your own entry still leaves the queue', async () => {
    const query = buttonPress(`leave_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA5);
    await bot.pressButton(query);

    assertAnsweredOnce(query, {});
    assert.equal(database.row('gftvqueue_entries', IDS.entryA5Waiting), null);
    assert.deepEqual(bot.sentMessages.map((message) => [message.chatId, message.text]), [
        [TELEGRAM_IDS.attendeeA5, '✅ You have left the queue.'],
    ]);
});

test('M4: "It\'s my turn" toggle on someone else\'s entry: refused, setting unchanged', async () => {
    const query = buttonPress(`notif_serving_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeB1);
    await bot.pressButton(query);

    assertAnsweredOnce(query, { text: NOT_YOURS });
    assert.deepEqual(bot.sentMessages, []);
    assert.equal(database.row('gftvqueue_entries', IDS.entryA5Waiting).notify_serving, true);
    const updates = callsOn(database, 'gftvqueue_entries').filter((calls) => calls.some((call) => call[0] === 'update'));
    assert.deepEqual(updates, []);
});

test('M4: "It\'s my turn" toggle on your own entry still toggles it', async () => {
    const query = buttonPress(`notif_serving_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA5);
    await bot.pressButton(query);

    assertAnsweredOnce(query, {});
    assert.equal(database.row('gftvqueue_entries', IDS.entryA5Waiting).notify_serving, false);
    assert.deepEqual(bot.sentMessages.map((message) => message.text), [
        '🔕 "It\'s my turn" notifications disabled.',
    ]);
});

test('M4: "I\'m next" toggle on someone else\'s entry: refused, setting unchanged', async () => {
    const query = buttonPress(`notif_next_${IDS.entryB1Waiting}`, TELEGRAM_IDS.attendeeA5);
    await bot.pressButton(query);

    assertAnsweredOnce(query, { text: NOT_YOURS });
    assert.deepEqual(bot.sentMessages, []);
    assert.equal(database.row('gftvqueue_entries', IDS.entryB1Waiting).notify_next, true);
});

test('M4: "I\'m next" toggle on your own entry still toggles it', async () => {
    const query = buttonPress(`notif_next_${IDS.entryB1Waiting}`, TELEGRAM_IDS.attendeeB1);
    await bot.pressButton(query);

    assertAnsweredOnce(query, {});
    assert.equal(database.row('gftvqueue_entries', IDS.entryB1Waiting).notify_next, false);
    assert.deepEqual(bot.sentMessages.map((message) => message.text), [
        '🔕 "I\'m next in line" notifications disabled.',
    ]);
});

test('M4: the check uses who pressed the button, not the chat the button is in', async () => {
    // Someone else presses a Leave button shown in the owner's chat id.
    const intruder = buttonPress(`leave_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA6, TELEGRAM_IDS.attendeeA5);
    await bot.pressButton(intruder);
    assertAnsweredOnce(intruder, { text: NOT_YOURS });
    assert.notEqual(database.row('gftvqueue_entries', IDS.entryA5Waiting), null);

    // The owner presses it in another chat (a group): allowed.
    bot.clearRecords();
    const owner = buttonPress(`leave_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA5, -1001234567890);
    await bot.pressButton(owner);
    assertAnsweredOnce(owner, {});
    assert.equal(database.row('gftvqueue_entries', IDS.entryA5Waiting), null);
});

test('M4: a button for an entry that doesn\'t exist is refused the same way', async () => {
    const missingEntryId = 'eeeeeeee-0000-4000-8000-0000000000ff';
    for (const prefix of ['leave_', 'notif_serving_', 'notif_next_']) {
        bot.clearRecords();
        const query = buttonPress(`${prefix}${missingEntryId}`, TELEGRAM_IDS.attendeeA5);
        await bot.pressButton(query);
        assertAnsweredOnce(query, { text: NOT_YOURS });
        assert.deepEqual(bot.sentMessages, []);
    }
    assert.equal(database.rows('gftvqueue_entries').length, 8);
});

test('M4: a button press with no presser is refused', async () => {
    const query = buttonPress(`leave_${IDS.entryA5Waiting}`, TELEGRAM_IDS.attendeeA5);
    delete query.from;
    await bot.pressButton(query);

    assertAnsweredOnce(query, { text: NOT_YOURS });
    assert.notEqual(database.row('gftvqueue_entries', IDS.entryA5Waiting), null);
});

test('other buttons are answered and handled as before', async () => {
    const cancel = buttonPress('cancel', TELEGRAM_IDS.attendeeA5);
    await bot.pressButton(cancel);
    assertAnsweredOnce(cancel, {});
    assert.deepEqual(bot.sentMessages.map((message) => message.text), ['❌ Action cancelled.']);

    bot.clearRecords();
    const attend = buttonPress('cmd_attend', TELEGRAM_IDS.newcomer);
    await bot.pressButton(attend);
    assertAnsweredOnce(attend, {});
    assert.equal(bot.sentMessages.length, 1);
    assert.match(bot.sentMessages[0].text, /Connect Telegram/);
});
