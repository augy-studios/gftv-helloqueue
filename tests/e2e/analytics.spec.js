// F1 (decision 7, job 05): Google Analytics and AdSense are off the staff and
// sign-in pages (dashboard.html, login.html, register.html), and the public
// pages (index.html, attendee.html, display.html, 404.html) keep them. The
// harness answers both hosts with a stub (tests/e2e/support/test.js), so
// these tests check which requests each page makes.

const { test, expect, fixtures, signInAs } = require('./support/test.js');

const { CODES } = fixtures;

const ANALYTICS_HOSTS = ['www.googletagmanager.com', 'pagead2.googlesyndication.com'];

// `ready` is an element that shows once the page's own script has run.
const STAFF_PAGES = [
    { file: 'dashboard.html', path: '/dashboard', signedInAs: 'superadmin', ready: '#events-grid .event-card' },
    { file: 'login.html', path: '/login', ready: '#login-form' },
    { file: 'register.html', path: '/register', ready: '#register-form' },
];

const PUBLIC_PAGES = [
    { file: 'index.html', path: '/', ready: '.hero h1' },
    { file: 'attendee.html', path: `/queue/${CODES.event}/${CODES.queueA}`, ready: '.attendee-header' },
    { file: 'display.html', path: `/display/${CODES.event}/${CODES.queueA}`, ready: '.display-header h1' },
    { file: '404.html', path: '/404', ready: 'h1.title-text' },
];

function requestedHosts(thirdParty) {
    return thirdParty.requests.map((url) => new URL(url).hostname);
}

// Opens the page and waits for its load event, by which time any async
// script tag in the head has been requested.
async function openPage(page, consoleErrors, pageInfo) {
    if (pageInfo.file === 'display.html') {
        // B3: display.html links /css/main.css, which doesn't exist.
        consoleErrors.allow('B3', (error) => error.url.endsWith('/css/main.css'));
    }
    if (pageInfo.signedInAs) {
        await signInAs(page, pageInfo.signedInAs);
    }
    await page.goto(pageInfo.path, { waitUntil: 'load' });
    await expect(page.locator(pageInfo.ready).first()).toBeVisible();
}

for (const pageInfo of STAFF_PAGES) {
    test(`F1: ${pageInfo.file} makes no request to Google Analytics or AdSense`, async ({ page, thirdParty, consoleErrors }) => {
        await openPage(page, consoleErrors, pageInfo);
        const hosts = requestedHosts(thirdParty);
        for (const host of ANALYTICS_HOSTS) {
            expect(hosts, `${pageInfo.file} requested ${host}`).not.toContain(host);
        }
        await expect(page.locator('script[src*="googletagmanager.com"], script[src*="googlesyndication.com"]')).toHaveCount(0);
        // The inline gtag config went with the tag.
        expect(await page.evaluate(() => typeof window.gtag)).toBe('undefined');
        expect(await page.evaluate(() => typeof window.dataLayer)).toBe('undefined');
    });
}

for (const pageInfo of PUBLIC_PAGES) {
    test(`F1: ${pageInfo.file} still loads Google Analytics and AdSense`, async ({ page, thirdParty, consoleErrors }) => {
        await openPage(page, consoleErrors, pageInfo);
        const hosts = requestedHosts(thirdParty);
        for (const host of ANALYTICS_HOSTS) {
            expect(hosts, `${pageInfo.file} did not request ${host}`).toContain(host);
        }
        expect(await page.evaluate(() => typeof window.gtag)).toBe('function');
    });
}
