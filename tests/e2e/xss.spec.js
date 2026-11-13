// H3 (job 05): every value that comes from data (the API, or the session in
// localStorage) is escaped before it goes into innerHTML. Each test puts
// markup into this test's own copy of the fixture database (or into the
// stored session, or an API error), opens the page, and checks that the
// markup shows as text and never runs: no <img src="x"> appears and
// window.__xss stays undefined.
//
// The fixture file itself is left alone, so no other test sees these names.

const { test, expect, fixtures, signInAs, signInAsAttendee } = require('./support/test.js');

const { IDS, CODES, ATTENDEE_TOKENS, SESSION_TOKENS } = fixtures;

const QUEUE_A_OPERATOR_PAGE = `/dashboard/events/${IDS.event}/queues/${IDS.queueA}`;
const QUEUE_A_PAGE = `/queue/${CODES.event}/${CODES.queueA}`;
const QUEUE_A_DISPLAY = `/display/${CODES.event}/${CODES.queueA}`;

// Markup that runs if it ever reaches innerHTML unescaped. The second one
// also tries to break out of a quoted attribute first.
const NAME_PAYLOAD = '<img src=x onerror="window.__xss=1">';
const ATTRIBUTE_PAYLOAD = '"><img src=x onerror="window.__xss=2">';

function findRow(database, table, id) {
    return database.tables[table].find((row) => row.id === id);
}

// Changes one row of this test's database in place.
function updateRow(database, table, id, values) {
    Object.assign(findRow(database, table, id), values);
}

// Gives the event and queue A marked-up names.
function markUpEventAndQueueNames(database) {
    updateRow(database, 'gftvqueue_events', IDS.event, { name: NAME_PAYLOAD, venue: ATTRIBUTE_PAYLOAD });
    updateRow(database, 'gftvqueue_queues', IDS.queueA, { name: NAME_PAYLOAD });
}

// Nothing was injected: no stray image, and its onerror never ran.
async function expectNoInjectedMarkup(page) {
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
}

test.describe('H3: the queue operator view', () => {
    test('an attendee named <img src=x onerror=...> shows as text in every column, and after the poll', async ({ page, api }) => {
        updateRow(api.database, 'gftvqueue_entries', IDS.entryA5Waiting, {
            display_name: NAME_PAYLOAD,
            telegram_username: ATTRIBUTE_PAYLOAD,
        });
        updateRow(api.database, 'gftvqueue_entries', IDS.entryA3Called, { display_name: NAME_PAYLOAD });
        updateRow(api.database, 'gftvqueue_entries', IDS.entryA2Missed, { display_name: NAME_PAYLOAD });
        // The Completed column's cards (job 03).
        updateRow(api.database, 'gftvqueue_entries', IDS.entryA1Completed, {
            display_name: NAME_PAYLOAD,
            telegram_username: ATTRIBUTE_PAYLOAD,
        });

        await signInAs(page, 'operator');
        await page.goto(QUEUE_A_OPERATOR_PAGE);

        const waitingName = page.locator(`[data-entry-id="${IDS.entryA5Waiting}"] .entry-card-name`);
        await expect(waitingName).toContainText(NAME_PAYLOAD);
        await expect(waitingName).toContainText(`@${ATTRIBUTE_PAYLOAD}`);
        await expect(waitingName).toHaveAttribute('title', NAME_PAYLOAD);
        for (const column of ['serving', 'missed', 'completed']) {
            await expect(page.locator(`#col-${column} .entry-card-name`).first()).toContainText(NAME_PAYLOAD);
        }
        await expect(page.locator('#col-completed .entry-card-name')).toContainText(`@${ATTRIBUTE_PAYLOAD}`);
        await expectNoInjectedMarkup(page);

        // The 4-second poll redraws the columns (updateColumns), which only
        // it stamps with "Updated ...".
        await expect(page.locator('#last-updated')).toContainText('Updated', { timeout: 8000 });
        await expect(waitingName).toContainText(NAME_PAYLOAD);
        await expect(page.locator('#col-completed .entry-card-name')).toContainText(NAME_PAYLOAD);
        await expectNoInjectedMarkup(page);
    });

    test('the scanner result shows a marked-up name as text', async ({ page, api }) => {
        updateRow(api.database, 'gftvqueue_entries', IDS.entryA3Called, { display_name: NAME_PAYLOAD });
        await signInAs(page, 'operator');
        await page.goto(QUEUE_A_OPERATOR_PAGE);
        await page.click('#open-scanner-btn');
        await page.fill('#manual-token', 'test-qr-token-a3');
        await page.click('#manual-validate-btn');
        await expect(page.locator('#scanner-result')).toContainText(`#3 · ${NAME_PAYLOAD}`);
        await expectNoInjectedMarkup(page);
    });

    test('a marked-up error message from the API shows as text', async ({ page, consoleErrors }) => {
        consoleErrors.allow('expected-500', (error) => error.text.includes('500'));
        // Registered after the api fixture's route, so it answers first.
        await page.route(`**/api/queues/${IDS.queueA}`, (route) => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: NAME_PAYLOAD }),
        }));
        await signInAs(page, 'operator');
        await page.goto(QUEUE_A_OPERATOR_PAGE);
        await expect(page.locator('#main-content')).toContainText(`Failed to load queue: ${NAME_PAYLOAD}`);
        await expectNoInjectedMarkup(page);
    });
});

test.describe('H3: the other dashboard views', () => {
    test('marked-up event, venue and queue names show as text on Events, the event page, My Queues and the operator title', async ({ page, api }) => {
        markUpEventAndQueueNames(api.database);
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');

        const eventCard = page.locator('#events-grid .event-card');
        await expect(eventCard.locator('.event-card-title')).toHaveText(NAME_PAYLOAD);
        await expect(eventCard.locator('.event-card-meta')).toContainText(ATTRIBUTE_PAYLOAD);
        await expectNoInjectedMarkup(page);

        await page.click('.ev-open-btn');
        await expect(page.locator('.page-title')).toContainText(NAME_PAYLOAD);
        await expect(page.locator('.glass-card', { hasText: 'Event Info' })).toContainText(ATTRIBUTE_PAYLOAD);
        await expect(page.locator('#queues-list .event-card-title').first()).toHaveText(NAME_PAYLOAD);
        await expectNoInjectedMarkup(page);

        await page.click('#nav-queues');
        const queueCard = page.locator('#queues-list .event-card', { has: page.locator(`#counts-${IDS.queueA}`) });
        await expect(queueCard.locator('.event-card-title')).toHaveText(NAME_PAYLOAD);
        await expect(queueCard).toContainText(`Event: ${NAME_PAYLOAD}`);
        await expect(page.locator(`#counts-${IDS.queueA}`)).toContainText('Waiting: 2');
        await expectNoInjectedMarkup(page);

        await queueCard.locator('.operate-btn').click();
        await expect(page.locator('.page-title')).toContainText(NAME_PAYLOAD);
        await expect(page.locator('#col-waiting .entry-card')).toHaveCount(2);
        await expectNoInjectedMarkup(page);
    });

    test('a marked-up name in the stored session (hq_user) and a marked-up Telegram username show as text', async ({ page, api }) => {
        updateRow(api.database, 'gftvqueue_telegram_links', '44444444-4444-4444-8444-444444444444', {
            telegram_username: ATTRIBUTE_PAYLOAD,
        });
        const storedUser = {
            ...fixtures.signedInUser('operator'),
            display_name: NAME_PAYLOAD,
            username: ATTRIBUTE_PAYLOAD,
        };
        await page.addInitScript(([sessionToken, sessionUser]) => {
            window.localStorage.setItem('hq_token', sessionToken);
            window.localStorage.setItem('hq_user', JSON.stringify(sessionUser));
        }, [SESSION_TOKENS.operator, storedUser]);

        await page.goto('/dashboard');
        await expect(page.locator('.topbar')).toContainText(NAME_PAYLOAD);
        await expectNoInjectedMarkup(page);

        await page.click('#nav-profile');
        await expect(page.locator('.info-row', { hasText: 'Display Name' })).toContainText(NAME_PAYLOAD);
        await expect(page.locator('.info-row', { hasText: 'Username' })).toContainText(`@${ATTRIBUTE_PAYLOAD}`);
        await expect(page.locator('#tg-content')).toContainText('Linked');
        await expect(page.locator('#tg-content')).toContainText(`@${ATTRIBUTE_PAYLOAD}`);
        await expectNoInjectedMarkup(page);
    });

    test('a marked-up name and email in User Management show as text', async ({ page, api }) => {
        updateRow(api.database, 'gftvhello_users', IDS.pending, {
            display_name: NAME_PAYLOAD,
            email: ATTRIBUTE_PAYLOAD,
        });
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('[data-view="admin-users"]');
        const row = page.locator('#users-table-wrap tbody tr');
        await expect(row).toHaveCount(1);
        await expect(row).toContainText(NAME_PAYLOAD);
        await expect(row).toContainText(ATTRIBUTE_PAYLOAD);
        await expect(row.locator('.approve-btn')).toHaveAttribute('data-id', IDS.pending);
        await expectNoInjectedMarkup(page);
    });
});

test.describe('H3: the public pages', () => {
    test('the display board shows marked-up event and queue names as text', async ({ page, api, consoleErrors }) => {
        // B3: display.html links /css/main.css, which doesn't exist.
        consoleErrors.allow('B3', (error) => error.url.endsWith('/css/main.css'));
        markUpEventAndQueueNames(api.database);
        await page.goto(QUEUE_A_DISPLAY);
        await expect(page.locator('.display-header h1')).toHaveText(NAME_PAYLOAD);
        await expect(page.locator('.display-header p')).toContainText(NAME_PAYLOAD);
        await expect(page.locator('.display-sidebar')).toContainText(NAME_PAYLOAD);
        await expect(page.locator('#waiting-numbers .waiting-badge')).toHaveText(['5', '6']);
        await expectNoInjectedMarkup(page);
    });

    test('the attendee page shows marked-up event and queue names as text, signed out and signed in', async ({ page, api }) => {
        markUpEventAndQueueNames(api.database);

        await page.goto(QUEUE_A_PAGE);
        await expect(page.locator('#open-tg-connect-btn')).toBeVisible();
        await expect(page.locator('.attendee-header')).toContainText(NAME_PAYLOAD);
        await expectNoInjectedMarkup(page);

        await signInAsAttendee(page, ATTENDEE_TOKENS.waitingA5);
        await page.reload();
        await expect(page.locator('.your-number-badge')).toHaveText('5');
        await expect(page.locator('.attendee-header')).toContainText(NAME_PAYLOAD);
        await expectNoInjectedMarkup(page);
    });
});
