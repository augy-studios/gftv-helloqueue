// Playwright smoke tests for the pages (npm run test:e2e).
//
// The pages are served by tests/serve.js with the same URL rewrites as
// vercel.json. Every /api/... request is answered in the test process by the
// real handler in api/, running against the fake Supabase and fixture data
// (see tests/e2e/support/test.js). Every third-party request (Google
// Analytics, AdSense, the QR image service, the jsQR CDN) is answered with a
// stub, so the tests never touch the network.
//
// Chromium only, headless. @playwright/test is pinned to 1.65.0 to match the
// Chromium build already installed on the Mac mini; don't run
// `npx playwright install` there.

const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.HELLOQUEUE_TEST_PORT || 4391);

module.exports = defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.spec.js',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    reporter: [['list']],
    timeout: 30000,
    expect: { timeout: 5000 },
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        headless: true,
        // A service worker would answer requests before page.route sees them.
        serviceWorkers: 'block',
        locale: 'en-SG',
        timezoneId: 'Asia/Singapore',
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `node tests/serve.js --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/`,
        // Fail loudly if something else already holds the port, rather than
        // testing against it.
        reuseExistingServer: false,
        timeout: 15000,
    },
});
