// Smoke tests: attendee.html, the attendee's queue page at
// /queue/:eventCode/:queueCode, signed out and as attendees in each state.

const { test, expect, fixtures, signInAsAttendee } = require('./support/test.js');

const { IDS, CODES, ATTENDEE_TOKENS } = fixtures;
const QUEUE_A_PAGE = `/queue/${CODES.event}/${CODES.queueA}`;

test('signed out: shows the queue and the Connect Telegram card', async ({ page }) => {
    await page.goto(QUEUE_A_PAGE);
    await expect(page).toHaveTitle('Queue | GFTV HelloQueue');
    await expect(page.locator('#officialBar')).toBeVisible();
    const header = page.locator('.attendee-header');
    await expect(header).toContainText('GFTV Test Con 2026');
    await expect(header).toContainText('Dealers Den (Queue A)');
    await expect(page.locator('.info-row', { hasText: 'Now serving' })).toContainText('3');
    await expect(page.locator('.info-row', { hasText: 'Waiting' })).toContainText('2 people');
    await expect(page.locator('#open-tg-connect-btn')).toBeVisible();
});

test('signed out: Connect Telegram makes a login code and a bot link', async ({ page, api }) => {
    await page.goto(QUEUE_A_PAGE);
    await page.click('#open-tg-connect-btn');
    await expect(page.locator('#tg-connect-modal')).toHaveClass(/open/);
    await page.click('#tg-generate-btn');
    await expect(page.locator('#tg-command-display')).toHaveText(/^\/attend [A-Z0-9]{6}$/);
    await expect(page.locator('#tg-deeplink-btn')).toHaveAttribute('href', /^https:\/\/t\.me\/TestHelloQueueBot\?start=attend_[A-Z0-9]{6}$/);
    const code = (await page.locator('#tg-command-display').innerText()).split(' ')[1];
    expect(api.database.rows('gftvqueue_attendee_login_codes').some((row) => row.code === code)).toBe(true);
});

test('waiting attendee: sees their number, position and notification toggles', async ({ page }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.waitingA5);
    await page.goto(QUEUE_A_PAGE);
    await expect(page.locator('.your-number-badge')).toHaveText('5');
    await expect(page.locator('.info-row', { hasText: 'Status' })).toContainText('waiting');
    await expect(page.locator('.info-row', { hasText: 'Position' })).toContainText('#1 in queue');
    await expect(page.locator('#toggle-serving')).toBeChecked();
    await expect(page.locator('#toggle-next')).toBeChecked();
    await expect(page.locator('#leave-btn')).toBeVisible();
});

test('called attendee: sees "your turn" and the entry QR code', async ({ page }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.calledA3);
    await page.goto(QUEUE_A_PAGE);
    await expect(page.locator('.your-number-badge')).toHaveText('3');
    await expect(page.locator('#attendee-content')).toContainText("It's your turn!");
    await expect(page.locator('img[alt="Entry QR Code"]')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(page.locator('#qr-token-text')).toHaveText('test-qr-token-a3');
    await expect(page.locator('#leave-btn')).toHaveCount(0);
});

test('missed attendee: sees "you missed your turn" and Rejoin', async ({ page }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.missedA2);
    await page.goto(QUEUE_A_PAGE);
    await expect(page.locator('.your-number-badge')).toHaveText('2');
    await expect(page.locator('#attendee-content')).toContainText('You missed your turn');
    await expect(page.locator('#rejoin-btn')).toBeVisible();
});

test('attendee not in the queue yet: Join Queue gives them the next number', async ({ page }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.newcomer);
    await page.goto(QUEUE_A_PAGE);
    await expect(page.locator('#attendee-content')).toContainText('Join the queue');
    await page.click('#join-btn');
    await expect(page.locator('.toast')).toContainText('Joined queue!');
    await expect(page.locator('.your-number-badge')).toHaveText('7');
});

test('unknown queue: says the queue was not found', async ({ page, consoleErrors }) => {
    consoleErrors.allow('expected-404', (error) => error.url.includes('/api/display/'));
    await page.goto(`/queue/${CODES.event}/NOSUCHQQ`);
    await expect(page.locator('#attendee-content')).toContainText('Queue not found.');
});

test('signed out: the page signs in by itself once the bot confirms the code', async ({ page, api }) => {
    await page.goto(QUEUE_A_PAGE);
    await page.click('#open-tg-connect-btn');
    await page.click('#tg-generate-btn');
    await expect(page.locator('#tg-command-display')).toHaveText(/^\/attend [A-Z0-9]{6}$/);
    const code = (await page.locator('#tg-command-display').innerText()).split(' ')[1];
    // What the bot does when the attendee sends /attend <code>.
    const loginCode = api.database.tables.gftvqueue_attendee_login_codes.find((row) => row.code === code);
    loginCode.used_at = new Date().toISOString();
    loginCode.session_token = ATTENDEE_TOKENS.newcomer;
    // The page polls every 2 seconds.
    await expect(page.locator('.toast')).toContainText('Connected!', { timeout: 6000 });
    await expect(page.locator('#join-btn')).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('hq_attendee_token'))).toBe(ATTENDEE_TOKENS.newcomer);
});

test('waiting attendee: turning off "next in line" alerts saves it', async ({ page, api }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.waitingA5);
    await page.goto(QUEUE_A_PAGE);
    await page.locator('#toggle-next').evaluate((checkbox) => checkbox.click());
    await expect.poll(() => api.database.row('gftvqueue_entries', IDS.entryA5Waiting).notify_next).toBe(false);
});

test('waiting attendee: Leave Queue takes them out of the queue', async ({ page, api }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.waitingA5);
    await page.goto(QUEUE_A_PAGE);
    page.once('dialog', (dialog) => dialog.accept());
    await page.click('#leave-btn');
    await expect(page.locator('.toast')).toContainText('Left queue');
    await expect(page.locator('#join-btn')).toBeVisible();
    expect(api.database.row('gftvqueue_entries', IDS.entryA5Waiting)).toBeNull();
});

test('missed attendee: Rejoin puts them at the back with a new number', async ({ page }) => {
    await signInAsAttendee(page, ATTENDEE_TOKENS.missedA2);
    await page.goto(QUEUE_A_PAGE);
    await page.click('#rejoin-btn');
    await expect(page.locator('.toast')).toContainText('Rejoined queue!');
    await expect(page.locator('.your-number-badge')).toHaveText('7');
});
