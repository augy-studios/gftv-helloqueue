// Replaces global fetch in the test process. Calls to the Telegram Bot API
// (api/_telegram.js) are recorded and answered with { ok: true }; any other
// request fails, so a handler test can never reach the network.

const STATE_KEY = Symbol.for('helloqueue.tests.telegram');

function installTelegramRecorder() {
    if (globalThis[STATE_KEY]) {
        return;
    }
    const state = { messages: [], originalFetch: globalThis.fetch };
    globalThis[STATE_KEY] = state;

    globalThis.fetch = async (input, options = {}) => {
        let url = String(input);
        if (input && input.url) {
            url = String(input.url);
        }
        if (url.startsWith('https://api.telegram.org/')) {
            const method = url.split('/').pop();
            let payload = {};
            if (options.body) {
                payload = JSON.parse(options.body);
            }
            state.messages.push({ method, chatId: payload.chat_id, text: payload.text, payload });
            return new Response(JSON.stringify({ ok: true, result: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        throw new Error(`Network access is disabled in the tests (tried ${url})`);
    };
}

// Every Telegram message sent since the last clear.
function telegramMessages() {
    return structuredClone(globalThis[STATE_KEY].messages);
}

function clearTelegramMessages() {
    globalThis[STATE_KEY].messages.length = 0;
}

module.exports = { installTelegramRecorder, telegramMessages, clearTelegramMessages };
