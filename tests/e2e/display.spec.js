// Smoke tests: display.html, the public TV board at /display/:eventCode/:queueCode.

const { test, expect, fixtures } = require('./support/test.js');

const { CODES } = fixtures;

// B3: display.html links /css/main.css, which doesn't exist, so every load
// logs a 404 for it. Remove this allowance when the link is fixed.
function allowMissingMainCss(consoleErrors) {
    consoleErrors.allow('B3', (error) => error.url.endsWith('/css/main.css'));
}

test('display board for queue A shows serving, waiting and missed numbers', async ({ page, consoleErrors, thirdParty }) => {
    allowMissingMainCss(consoleErrors);
    await page.goto(`/display/${CODES.event}/${CODES.queueA}`);

    await expect(page.locator('#officialBar')).toBeVisible();
    await expect(page.locator('.display-header h1')).toHaveText('GFTV Test Con 2026');
    await expect(page.locator('.display-header')).toContainText('Dealers Den (Queue A)');

    const serving = page.locator('#serving-numbers .serving-number-big');
    await expect(serving).toHaveCount(2);
    await expect(serving.nth(0)).toContainText('3');
    await expect(serving.nth(0)).toContainText('OUT');
    await expect(serving.nth(1)).toContainText('4');
    await expect(serving.nth(1)).toContainText('IN');

    await expect(page.locator('#waiting-numbers .waiting-badge')).toHaveText(['5', '6']);
    await expect(page.locator('#missed-numbers .missed-badge')).toHaveText(['2']);
    await expect(page.locator('.display-stat-num')).toHaveText(['2', '2', '1', '1']);
    await expect(page.locator('.display-wait-time')).toHaveText('4 min');
    await expect(page.locator('#join-qr')).toHaveAttribute('src', /api\.qrserver\.com/);

    expect(thirdParty.requests.some((url) => url.startsWith('https://api.qrserver.com/'))).toBe(true);
});

test('display board shows numbers only, never attendee names (decision 1)', async ({ page, consoleErrors }) => {
    allowMissingMainCss(consoleErrors);
    await page.goto(`/display/${CODES.event}/${CODES.queueA}`);
    await expect(page.locator('#serving-numbers .serving-number-big')).toHaveCount(2);
    const text = await page.locator('body').innerText();
    for (const name of ['Cara Cat', 'Dax Dragon', 'Eli Otter', 'cara_cat']) {
        expect(text).not.toContain(name);
    }
});

test('display board for an unknown queue says so and keeps retrying', async ({ page, consoleErrors }) => {
    allowMissingMainCss(consoleErrors);
    // The 404 from the API is logged by the browser as a failed load.
    consoleErrors.allow('expected-404', (error) => error.url.includes('/api/display/'));
    await page.goto(`/display/${CODES.event}/NOSUCHQQ`);
    await expect(page.locator('#display-root')).toContainText('Queue not found');
    await expect(page.locator('#display-root')).toContainText('Retrying');
});
