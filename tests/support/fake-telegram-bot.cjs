// A fake of the parts of node-telegram-bot-api that bot/index.js uses.
//
// tests/support/bot.cjs makes bot/index.js import this file in place of
// node-telegram-bot-api, so the real bot code runs in the tests without
// polling Telegram or touching the network. Every sendMessage and
// answerCallbackQuery call is recorded instead of sent.
//
// The latest bot is kept on globalThis, so the tests reach the same instance
// even if this file is loaded twice (once through require() and once through
// import).

const { EventEmitter } = require('node:events');

const STATE_KEY = Symbol.for('helloqueue.tests.fakeTelegramBot');
if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { latestBot: null };
}
const state = globalThis[STATE_KEY];

class FakeTelegramBot extends EventEmitter {
    constructor(token, options = {}) {
        super();
        this.token = token;
        this.options = options;
        this.textHandlers = [];
        this.sentMessages = [];
        this.callbackAnswers = [];
        state.latestBot = this;
    }

    onText(pattern, callback) {
        this.textHandlers.push({ pattern, callback });
    }

    async sendMessage(chatId, text, options = {}) {
        this.sentMessages.push({ chatId, text, options: structuredClone(options) });
        return { message_id: this.sentMessages.length, chat: { id: chatId }, text };
    }

    async answerCallbackQuery(callbackQueryId, options = {}) {
        this.callbackAnswers.push({ callbackQueryId, options: structuredClone(options) });
        return true;
    }

    stopPolling() {
        return Promise.resolve();
    }

    // Test helper: runs every callback_query listener with this button press
    // and waits for each one to finish (EventEmitter.emit doesn't wait).
    async pressButton(query) {
        for (const listener of this.listeners('callback_query')) {
            await listener(query);
        }
    }

    // Test helper: forgets everything recorded so far.
    clearRecords() {
        this.sentMessages.length = 0;
        this.callbackAnswers.length = 0;
    }
}

function latestFakeTelegramBot() {
    return state.latestBot;
}

module.exports = FakeTelegramBot;
module.exports.latestFakeTelegramBot = latestFakeTelegramBot;
