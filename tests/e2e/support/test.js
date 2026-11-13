// The Playwright `test` every spec uses, with three automatic fixtures:
//
// - api: answers every /api/... request (page.route) by running the real
//   handler from api/ against a fresh copy of the fixture database in the
//   fake Supabase. So the pages talk to today's API code, and only the
//   database is fake. Fails the test if a page calls a path no handler file
//   serves, or a handler throws or never answers.
// - thirdParty: answers every request to another host with a stub (see
//   STUBS below), so nothing reaches the network. Fails the test on a
//   request to a host that has no stub.
// - consoleErrors: collects console errors and uncaught page errors, and
//   fails the test if there are any, apart from ones a test allows by name
//   with consoleErrors.allow(). An allowance that matches nothing also fails
//   the test, so it gets removed once its issue is fixed.
//
// Helpers: signInAs(page, 'operator') and signInAsAttendee(page, token) put
// the session in localStorage before the page's own scripts run.
//
// Set HELLOQUEUE_API_LOG to a file path to have every API call the pages
// make appended to it, one JSON line per call (handy for checking which
// routes the tests reach).

const fs = require('node:fs');
const { test: base, expect } = require('@playwright/test');

// Order matters: the stub environment and module hooks must be in place
// before any handler is imported.
const { applyStubEnvironment } = require('../../support/environment.cjs');
const { installHooks } = require('../../support/hooks.cjs');
const { installTelegramRecorder, clearTelegramMessages, telegramMessages } = require('../../support/telegram.cjs');

applyStubEnvironment();
installHooks();
installTelegramRecorder();

const { useDatabase } = require('../../support/fake-supabase.cjs');
const fixtures = require('../../support/fixtures.cjs');
const { resolveApiRoute, createRequest, createResponse, loadHandler } = require('../../support/handlers.cjs');

// A 1x1 transparent PNG, for image stubs.
const EMPTY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
);

// Third-party hosts the pages load from, and what each gets instead.
const STUBS = {
    // Google Analytics (gtag.js), on every page.
    'www.googletagmanager.com': { contentType: 'text/javascript', body: '' },
    // Google AdSense, on every page.
    'pagead2.googlesyndication.com': { contentType: 'text/javascript', body: '' },
    // Join QR image on display.html.
    'api.qrserver.com': { contentType: 'image/png', body: EMPTY_PNG },
    // jsQR, loaded by the operator's scanner. Stubbed to find no code.
    'cdn.jsdelivr.net': { contentType: 'text/javascript', body: 'window.jsQR = function () { return null; };' },
    // Not loaded today; stubbed in case a page adds Google Fonts.
    'fonts.googleapis.com': { contentType: 'text/css', body: '' },
};

function isLocal(url) {
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

// Runs the handler for one /api/... request and returns its reply to the page.
async function answerWithHandler(route, api) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const match = resolveApiRoute(url.pathname);
    api.calls.push({ method, path: url.pathname, file: match ? match.file : null });

    if (!match) {
        api.unmatched.push(`${method} ${url.pathname}`);
        await fulfil(route, { status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No such API route' }) });
        return;
    }

    const query = { ...Object.fromEntries(url.searchParams), ...match.params };
    let body = null;
    const raw = request.postData();
    if (raw) {
        try {
            body = JSON.parse(raw);
        } catch {
            body = raw;
        }
    }

    const handler = await loadHandler(match.file);
    const handlerRequest = createRequest({ method, query, body, headers: request.headers() });
    const handlerResponse = createResponse();
    try {
        await handler(handlerRequest, handlerResponse);
    } catch (error) {
        api.failures.push(`${method} ${url.pathname} threw: ${error.message}`);
        await fulfil(route, { status: 500, contentType: 'application/json', body: JSON.stringify({ error: error.message }) });
        return;
    }
    if (!handlerResponse.ended) {
        api.failures.push(`${method} ${url.pathname} never sent a response`);
        await fulfil(route, { status: 500, contentType: 'application/json', body: '{}' });
        return;
    }

    let responseBody = '';
    if (typeof handlerResponse.body === 'string') {
        responseBody = handlerResponse.body;
    } else if (handlerResponse.body !== undefined) {
        responseBody = JSON.stringify(handlerResponse.body);
    }
    await fulfil(route, {
        status: handlerResponse.statusCode,
        headers: { 'content-type': 'application/json; charset=utf-8', ...handlerResponse.headers },
        body: responseBody,
    });
}

// route.fulfill, ignoring the error when the page closed mid-request (the
// pages poll, so a request can still be in flight when a test ends).
async function fulfil(route, response) {
    try {
        await route.fulfill(response);
    } catch (error) {
        if (!/closed|destroyed/i.test(error.message)) {
            throw error;
        }
    }
}

const test = base.extend({
    api: [async ({ page }, use) => {
        const database = fixtures.createFixtureDatabase();
        useDatabase(database);
        clearTelegramMessages();
        const api = {
            database,
            calls: [],
            unmatched: [],
            failures: [],
            telegramMessages,
        };
        await page.route((url) => isLocal(url) && url.pathname.startsWith('/api/'), (route) => answerWithHandler(route, api));
        await use(api);
        if (process.env.HELLOQUEUE_API_LOG) {
            const lines = api.calls.map((call) => JSON.stringify(call) + '\n').join('');
            fs.appendFileSync(process.env.HELLOQUEUE_API_LOG, lines);
        }
        expect(api.unmatched, 'pages called API paths that no handler file serves').toEqual([]);
        expect(api.failures, 'handlers that threw or never answered').toEqual([]);
    }, { auto: true }],

    thirdParty: [async ({ page }, use) => {
        const thirdParty = { requests: [], unstubbed: [] };
        await page.route((url) => !isLocal(url), async (route) => {
            const url = new URL(route.request().url());
            thirdParty.requests.push(url.href);
            const stub = STUBS[url.hostname];
            if (stub) {
                await fulfil(route, { status: 200, contentType: stub.contentType, body: stub.body });
                return;
            }
            thirdParty.unstubbed.push(url.href);
            await fulfil(route, { status: 200, contentType: 'text/plain', body: '' });
        });
        await use(thirdParty);
        expect(thirdParty.unstubbed, 'third-party requests with no stub (add one to STUBS)').toEqual([]);
    }, { auto: true }],

    consoleErrors: [async ({ page }, use) => {
        const tracker = {
            errors: [],
            allowed: [],
            // Lets a test accept one known console error. `id` names the
            // known issue (for example "B3"), so it's easy to find and remove
            // when the issue is fixed.
            allow(id, matches) {
                this.allowed.push({ id, matches });
            },
        };
        page.on('console', (message) => {
            if (message.type() === 'error') {
                tracker.errors.push({ text: message.text(), url: message.location().url });
            }
        });
        page.on('pageerror', (error) => {
            tracker.errors.push({ text: `Uncaught: ${error.message}`, url: '' });
        });
        await use(tracker);
        const unexpected = tracker.errors.filter((error) => !tracker.allowed.some((allowance) => allowance.matches(error)));
        expect(unexpected, 'console errors on the page').toEqual([]);
        // An allowance nothing matched is stale: the issue is fixed, so the
        // allowance should go.
        const unused = tracker.allowed
            .filter((allowance) => !tracker.errors.some((error) => allowance.matches(error)))
            .map((allowance) => allowance.id);
        expect(unused, 'console error allowances that matched nothing (remove them)').toEqual([]);
    }, { auto: true }],
});

// Signs the page in as one of the fixture people (superadmin, editor,
// operator, queueAdmin, outsider) before any page script runs.
async function signInAs(page, key) {
    const token = fixtures.SESSION_TOKENS[key];
    const user = fixtures.signedInUser(key);
    await page.addInitScript(([sessionToken, sessionUser]) => {
        window.localStorage.setItem('hq_token', sessionToken);
        window.localStorage.setItem('hq_user', JSON.stringify(sessionUser));
    }, [token, user]);
}

// Gives the queue page an attendee session (hq_attendee_token).
async function signInAsAttendee(page, attendeeToken) {
    await page.addInitScript((token) => {
        window.localStorage.setItem('hq_attendee_token', token);
    }, attendeeToken);
}

module.exports = { test, expect, fixtures, signInAs, signInAsAttendee };
