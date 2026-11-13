// Stub environment for the test process. Names come from .env.example (plus
// TELEGRAM_BOT_USERNAME, which api/auth/attendee-login.js reads but
// .env.example doesn't list). These values replace anything in the shell, so
// a test can never reach the real Supabase or Telegram. No .env file is read.

const { STUB_SUPABASE_URL } = require('./fake-supabase.cjs');

const STUB_ENVIRONMENT = {
    SUPABASE_URL: STUB_SUPABASE_URL,
    SUPABASE_SERVICE_KEY: 'test-service-key-not-real',
    TELEGRAM_BOT_TOKEN: 'test-bot-token-not-real',
    TELEGRAM_BOT_USERNAME: 'TestHelloQueueBot',
    WEBAPP_URL: 'http://127.0.0.1',
};

function applyStubEnvironment() {
    Object.assign(process.env, STUB_ENVIRONMENT);
    // Unset, as the rules say this can't be checked here. The webhook skips
    // its secret check when it's missing.
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
}

module.exports = { STUB_ENVIRONMENT, applyStubEnvironment };
