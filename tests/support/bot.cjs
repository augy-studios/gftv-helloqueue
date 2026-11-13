// Loading the real Telegram polling bot (bot/index.js) in a test, unchanged.
//
// Imports made from files in bot/ are redirected:
// - node-telegram-bot-api resolves to tests/support/fake-telegram-bot.cjs, so
//   the bot never polls Telegram and every reply is recorded.
// - dotenv/config resolves to an empty module, so no .env file is ever read.
// - @supabase/supabase-js already resolves to the fake Supabase
//   (tests/support/hooks.cjs, loaded by setup.cjs).
//
// bot/index.js starts the bot when it's imported, so it's loaded once per test
// file; reset the fake database and the records between tests instead.

const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { REPO_ROOT } = require('./hooks.cjs');

const BOT_DIRECTORY_URL = pathToFileURL(path.join(REPO_ROOT, 'bot')).href + '/';
const BOT_ENTRY_URL = pathToFileURL(path.join(REPO_ROOT, 'bot', 'index.js')).href;
const FAKE_TELEGRAM_BOT_URL = pathToFileURL(path.join(__dirname, 'fake-telegram-bot.cjs')).href;
const EMPTY_MODULE_URL = 'data:text/javascript,export%20%7B%7D%3B';

const HOOKS_KEY = Symbol.for('helloqueue.tests.botHooksInstalled');

function installBotHooks() {
    if (globalThis[HOOKS_KEY]) {
        return;
    }
    globalThis[HOOKS_KEY] = true;

    registerHooks({
        resolve(specifier, context, nextResolve) {
            let importedFromBot = false;
            if (context.parentURL && context.parentURL.startsWith(BOT_DIRECTORY_URL)) {
                importedFromBot = true;
            }
            if (importedFromBot && specifier === 'node-telegram-bot-api') {
                return { url: FAKE_TELEGRAM_BOT_URL, format: 'commonjs', shortCircuit: true };
            }
            if (importedFromBot && specifier === 'dotenv/config') {
                return { url: EMPTY_MODULE_URL, format: 'module', shortCircuit: true };
            }
            return nextResolve(specifier, context);
        },
    });
}

// Imports bot/index.js (once) and returns the fake bot it created. The bot's
// "started" log line is kept out of the test output.
async function loadBot() {
    installBotHooks();
    const realLog = console.log;
    console.log = () => {};
    try {
        await import(BOT_ENTRY_URL);
    } finally {
        console.log = realLog;
    }
    const { latestFakeTelegramBot } = require('./fake-telegram-bot.cjs');
    const bot = latestFakeTelegramBot();
    if (!bot) {
        throw new Error('bot/index.js did not create a TelegramBot');
    }
    return bot;
}

module.exports = { loadBot };
