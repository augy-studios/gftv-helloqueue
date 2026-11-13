// api/user/telegram-link.js (GET make a link code, DELETE unlink).
// randomInt (fixed in job 02, found by job 01): the 6-digit Telegram link
// code comes from crypto.randomInt, not Math.random(). Its length and digits
// are unchanged, as the bot's /link command expects exactly 6 digits.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callHandler } from '../support/handlers.cjs';
import { IDS, SESSION_TOKENS } from '../support/fixtures.cjs';
import { useFreshDatabase } from './helpers.mjs';

const HANDLER = 'api/user/telegram-link.js';
const OTP_PATTERN = /^[1-9]\d{5}$/;
const realRandom = Math.random;
let database;

beforeEach(() => {
    database = useFreshDatabase();
});

afterEach(() => {
    Math.random = realRandom;
});

function makeCode(token = SESSION_TOKENS.superadmin) {
    return callHandler(HANDLER, { method: 'GET', token });
}

test('no token: 401', async () => {
    const response = await makeCode(null);
    assert.equal(response.status, 401);
});

test('GET makes a 6-digit code and stores it for the caller', async () => {
    const response = await makeCode();
    assert.equal(response.status, 200);
    assert.match(response.body.otp_code, OTP_PATTERN);
    const stored = database.rows('gftvqueue_telegram_otps');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].otp_code, response.body.otp_code);
    assert.equal(stored[0].user_id, IDS.superadmin);
});

test('randomInt: the link code does not use Math.random()', async () => {
    Math.random = () => {
        throw new Error('Math.random() must not be used for codes');
    };
    const response = await makeCode();
    assert.equal(response.status, 200);
    assert.match(response.body.otp_code, OTP_PATTERN);
});

test('randomInt: link codes stay 6 digits (100000-999999) and vary', async () => {
    const codes = new Set();
    for (let index = 0; index < 50; index += 1) {
        const response = await makeCode();
        assert.match(response.body.otp_code, OTP_PATTERN);
        const value = Number(response.body.otp_code);
        assert.ok(value >= 100000 && value <= 999999);
        codes.add(response.body.otp_code);
    }
    assert.ok(codes.size > 45);
});
