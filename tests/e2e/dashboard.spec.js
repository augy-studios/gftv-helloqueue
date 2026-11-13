// Smoke tests: dashboard.html and each of its views (events, queues, queue
// operator, profile, admin users), signed in as the fixture people.

const { test, expect, fixtures, signInAs } = require('./support/test.js');

const { IDS, CODES } = fixtures;

function queueNumbers(page, status) {
    return page.locator(`#col-${status} .entry-card .queue-number`);
}

test.describe('events view', () => {
    test('superadmin sees the event, the New Event button and the admin menu', async ({ page }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await expect(page.locator('#officialBar')).toBeVisible();
        await expect(page.locator('.topbar')).toContainText('Augy Admin');
        await expect(page.locator('#logout-btn')).toBeVisible();
        await expect(page.locator('#nav-events')).toHaveClass(/active/);
        await expect(page.locator('.page-title')).toContainText('Events');
        await expect(page.locator('#create-event-btn')).toBeVisible();
        await expect(page.locator('#nav-admin-section')).toBeVisible();
        const cards = page.locator('#events-grid .event-card');
        await expect(cards).toHaveCount(1);
        await expect(cards.first().locator('.event-card-title')).toHaveText('GFTV Test Con 2026');
        await expect(cards.first()).toContainText(CODES.event);
        await expect(cards.first().locator('.ev-delete-btn')).toBeVisible();
    });

    test('event editor sees the event but no admin controls', async ({ page }) => {
        await signInAs(page, 'editor');
        await page.goto('/dashboard');
        await expect(page.locator('#events-grid .event-card')).toHaveCount(1);
        await expect(page.locator('#create-event-btn')).toHaveCount(0);
        await expect(page.locator('#nav-admin-section')).toBeHidden();
        await expect(page.locator('.ev-delete-btn')).toHaveCount(0);
    });

    test('superadmin opens the event and sees both queues', async ({ page }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('.ev-open-btn');
        await expect(page.locator('.page-title')).toContainText('GFTV Test Con 2026');
        const queueCards = page.locator('#queues-list .event-card');
        await expect(queueCards).toHaveCount(2);
        await expect(queueCards.nth(0).locator('.event-card-title')).toHaveText('Dealers Den (Queue A)');
        await expect(queueCards.nth(1).locator('.event-card-title')).toHaveText('Photo Booth (Queue B)');
        await expect(queueCards.nth(0).locator('a[href*="/display/"]')).toHaveAttribute(
            'href',
            `/display/${CODES.event}/${CODES.queueA}`
        );
        // B2: the editor list is always empty (ambiguous embed, see
        // tests/api/event-by-id.test.mjs). Flip this when B2 is fixed.
        await expect(page.locator('#editors-list')).toContainText('No editors assigned');
    });

    test('Operate on a queue card opens the queue operator view', async ({ page }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('.ev-open-btn');
        await page.locator(`.operate-queue-btn[data-queue="${IDS.queueA}"]`).click();
        await expect(page.locator('.page-title')).toContainText('Dealers Den (Queue A)');
        await expect(queueNumbers(page, 'serving')).toHaveText(['3', '4']);
    });
});

test.describe('queues view (My Queues)', () => {
    test('superadmin sees both queues with live counts', async ({ page }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('#nav-queues');
        await expect(page.locator('.page-title')).toHaveText('My Queues');
        const cards = page.locator('#queues-list .event-card');
        await expect(cards).toHaveCount(2);
        await expect(cards.nth(0)).toContainText('Queue Admin');
        const countsA = page.locator(`#counts-${IDS.queueA}`);
        await expect(countsA).toContainText('Serving: 2');
        await expect(countsA).toContainText('Waiting: 2');
        await expect(countsA).toContainText('Missed: 1');
        await expect(countsA).toContainText('Done: 1');
        await expect(page.locator(`#counts-${IDS.queueB}`)).toContainText('Serving: 1');
    });

    // B1: operators who aren't event editors get no events from /api/events,
    // so My Queues is empty for them. Decision 1 changes this.
    test('B1: operator of queue A sees the "assigned to an event first" empty state', async ({ page }) => {
        await signInAs(page, 'operator');
        await page.goto('/dashboard');
        await page.click('#nav-queues');
        await expect(page.locator('#queues-list')).toContainText('You need to be assigned to an event first.');
    });

    test('event editor without queue permissions sees the "no operator access" empty state', async ({ page }) => {
        await signInAs(page, 'editor');
        await page.goto('/dashboard');
        await page.click('#nav-queues');
        await expect(page.locator('#queues-list')).toContainText("You don't have operator access to any queues yet.");
    });
});

test.describe('queue operator view', () => {
    test('operator of queue A sees every column with its attendees and @usernames', async ({ page }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await expect(page.locator('.page-title')).toContainText('Dealers Den (Queue A)');
        await expect(page.locator('.page-title .status-pill')).toHaveText('open');
        await expect(queueNumbers(page, 'serving')).toHaveText(['3', '4']);
        await expect(queueNumbers(page, 'waiting')).toHaveText(['5', '6']);
        await expect(queueNumbers(page, 'missed')).toHaveText(['2']);
        await expect(queueNumbers(page, 'completed')).toHaveText(['1']);
        // Decision 5: operators see the attendee's @telegram_username.
        await expect(page.locator('#col-waiting')).toContainText('Eli Otter');
        await expect(page.locator('#col-waiting')).toContainText('@eli_otter');
        // #3 is called but not in yet; #4 has entered.
        await expect(page.locator(`[data-entry-id="${IDS.entryA3Called}"] .mark-entered-btn`)).toBeVisible();
        await expect(page.locator(`[data-entry-id="${IDS.entryA4Entered}"] .manual-exit-btn`)).toBeVisible();
        await expect(page.locator(`[data-entry-id="${IDS.entryA2Missed}"] .rejoin-btn`)).toBeVisible();
        await expect(page.locator('#stat-serving')).toHaveText('2');
        await expect(page.locator('#ms-value')).toHaveText('3');
        await expect(page.locator('#call-next-btn')).toBeEnabled();
        // Only queue admins get the permissions modal markup.
        await expect(page.locator('#perms-modal')).toHaveCount(0);
    });

    test('Call Next calls the first waiting attendee', async ({ page, api }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await expect(queueNumbers(page, 'waiting')).toHaveText(['5', '6']);
        await page.click('#call-next-btn');
        await expect(page.locator('.toast')).toContainText('Called #5');
        await expect(queueNumbers(page, 'serving')).toHaveText(['3', '4', '5']);
        await expect(queueNumbers(page, 'waiting')).toHaveText(['6']);
        expect(api.database.row('gftvqueue_entries', IDS.entryA5Waiting).status).toBe('serving');
    });

    test('queue admin of queue B sees queue B as queue admin', async ({ page }) => {
        await signInAs(page, 'queueAdmin');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueB}`);
        await expect(page.locator('.page-title')).toContainText('Photo Booth (Queue B)');
        await expect(queueNumbers(page, 'serving')).toHaveText(['2']);
        await expect(queueNumbers(page, 'waiting')).toHaveText(['1']);
        await expect(page.locator('#perms-modal')).toHaveCount(1);
    });
});

test.describe('profile view', () => {
    test('operator sees their account and their linked Telegram', async ({ page }) => {
        await signInAs(page, 'operator');
        await page.goto('/dashboard');
        await page.click('#nav-profile');
        await expect(page.locator('.page-title')).toHaveText('Profile');
        await expect(page.locator('.info-row').first()).toContainText('Olly Operator');
        await expect(page.locator('#tg-content')).toContainText('Linked');
        await expect(page.locator('#tg-content')).toContainText('@olly_ops');
        await expect(page.locator('#unlink-tg-btn')).toBeVisible();
    });

    test('superadmin without Telegram can generate a link code', async ({ page }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('#nav-profile');
        await expect(page.locator('.info-row', { hasText: 'Role' })).toContainText('Admin');
        await page.click('#gen-otp-btn');
        await expect(page.locator('#otp-code')).toHaveText(/^\d{6}$/);
        await expect(page.locator('#otp-display')).toContainText('/link');
    });
});

test.describe('admin users view', () => {
    test('superadmin sees pending accounts, then all accounts', async ({ page }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('[data-view="admin-users"]');
        await expect(page.locator('.page-title')).toContainText('User Management');
        const rows = page.locator('#users-table-wrap tbody tr');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Pat Pending');
        await expect(rows.first().locator('.approve-btn')).toBeVisible();

        await page.click('.filter-btn[data-filter="all"]');
        await expect(rows).toHaveCount(7);
        await expect(page.locator('#users-table-wrap')).toContainText('(you)');
    });
});

// The buttons on each view, so later refactors of views/*.js are checked
// end to end against the real handlers.
test.describe('dashboard actions', () => {
    test('Log out ends the session and returns to the sign-in page', async ({ page, api }) => {
        // Not signInAs: its init script would sign the sign-in page in again
        // and bounce it back to the dashboard. Store the session once instead.
        await page.goto('/404');
        await page.evaluate((user) => {
            window.localStorage.setItem('hq_token', 'test-session-superadmin');
            window.localStorage.setItem('hq_user', JSON.stringify(user));
        }, fixtures.signedInUser('superadmin'));
        await page.goto('/dashboard');
        await expect(page.locator('#events-grid .event-card')).toHaveCount(1);
        await page.click('#logout-btn');
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.locator('#login-form')).toBeVisible();
        expect(await page.evaluate(() => window.localStorage.getItem('hq_token'))).toBeNull();
        const sessions = api.database.rows('gftvhello_sessions');
        expect(sessions.some((session) => session.token === 'test-session-superadmin')).toBe(false);
    });

    test('superadmin creates an event from the New Event form', async ({ page, api }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('#create-event-btn');
        await expect(page.locator('#create-event-modal')).toHaveClass(/open/);
        await page.fill('#ev-name', 'Second Test Con');
        await page.fill('#ev-venue', 'Hall 9');
        await page.locator('#create-event-form button[type="submit"]').click();
        await expect(page.locator('.toast')).toContainText('Event created!');
        await expect(page.locator('#events-grid .event-card')).toHaveCount(2);
        expect(api.database.rows('gftvqueue_events').map((event) => event.name)).toContain('Second Test Con');
    });

    test('superadmin moves an event to its next status', async ({ page, api }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('.ev-status-btn');
        await expect(page.locator('.toast')).toContainText('Status → closed');
        await expect(page.locator('#events-grid .status-pill')).toHaveText('closed');
        expect(api.database.row('gftvqueue_events', IDS.event).status).toBe('closed');
    });

    test('superadmin deletes an event', async ({ page, api }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        page.once('dialog', (dialog) => dialog.accept());
        await page.click('.ev-delete-btn');
        await expect(page.locator('.toast')).toContainText('Event deleted');
        await expect(page.locator('#events-grid')).toContainText('No events yet. Create one to get started.');
        expect(api.database.row('gftvqueue_events', IDS.event)).toBeNull();
    });

    test('superadmin creates a queue in the event', async ({ page, api }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('.ev-open-btn');
        await page.click('#create-queue-btn');
        await page.fill('#q-name', 'Art Show (Queue C)');
        await page.locator('#create-queue-form button[type="submit"]').click();
        await expect(page.locator('.toast')).toContainText('Queue created!');
        await expect(page.locator('#queues-list .event-card')).toHaveCount(3);
        const created = api.database.rows('gftvqueue_queues').find((queue) => queue.name === 'Art Show (Queue C)');
        const permission = api.database.rows('gftvqueue_queue_permissions').find((row) => row.queue_id === created.id);
        expect(permission.user_id).toBe(IDS.superadmin);
        expect(permission.is_queue_admin).toBe(true);
    });

    test('superadmin adds an event editor by username', async ({ page, api }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('.ev-open-btn');
        await page.fill('#add-editor-username', 'operator.olly');
        await page.click('#add-editor-btn');
        await expect(page.locator('.toast').first()).toContainText('operator.olly added as editor');
        const editors = api.database.rows('gftvqueue_event_editors').map((row) => row.user_id);
        expect(editors).toContain(IDS.operator);
        // B2: the new editor still isn't listed on the page.
        await expect(page.locator('#editors-list')).toContainText('No editors assigned');
    });

    test('operator confirms an entrance and does a manual exit', async ({ page, api }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await page.locator(`[data-entry-id="${IDS.entryA3Called}"] .mark-entered-btn`).click();
        await expect(page.locator('.toast').first()).toContainText('Entrance confirmed');
        await expect(page.locator(`[data-entry-id="${IDS.entryA3Called}"] .manual-exit-btn`)).toBeVisible();

        await page.locator(`[data-entry-id="${IDS.entryA4Entered}"] .manual-exit-btn`).click();
        await expect(page.locator('.toast', { hasText: 'Manually exited' })).toBeVisible();
        await expect(queueNumbers(page, 'completed')).toHaveText(['1', '4']);
        expect(api.database.row('gftvqueue_entries', IDS.entryA4Entered).status).toBe('completed');
    });

    test('operator marks an attendee missed, then moves another back to waiting', async ({ page }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await page.locator(`[data-entry-id="${IDS.entryA3Called}"] .mark-missed-btn`).click();
        await expect(page.locator('.toast').first()).toContainText('Marked as missed');
        await expect(queueNumbers(page, 'missed')).toHaveText(['2', '3']);

        await page.locator(`[data-entry-id="${IDS.entryA2Missed}"] .rejoin-btn`).click();
        await expect(page.locator('.toast', { hasText: 'Moved back to waiting' })).toBeVisible();
        await expect(queueNumbers(page, 'waiting')).toHaveText(['2', '5', '6']);
    });

    test('Call Batch calls as many as there are free slots', async ({ page }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await page.selectOption('#batch-count', '2');
        await page.click('#call-batch-btn');
        // Queue A allows 3 at once and 2 are already in, so only #5 is called.
        await expect(page.locator('.toast')).toContainText('Called #5');
        await expect(queueNumbers(page, 'serving')).toHaveText(['3', '4', '5']);
    });

    test('Close Queue closes it and disables Call Next', async ({ page, api }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await page.click('#toggle-queue-btn');
        await expect(page.locator('.toast')).toContainText('Queue closed');
        await expect(page.locator('.page-title .status-pill')).toHaveText('closed');
        await expect(page.locator('#call-next-btn')).toBeDisabled();
        expect(api.database.row('gftvqueue_queues', IDS.queueA).status).toBe('closed');
    });

    test('Max Serving + saves the new limit', async ({ page, api }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await page.click('#ms-plus');
        await expect(page.locator('#ms-value')).toHaveText('4');
        await expect.poll(() => api.database.row('gftvqueue_queues', IDS.queueA).max_serving).toBe(4);
    });

    test('the scanner validates a QR token typed in by hand', async ({ page, api }) => {
        await signInAs(page, 'operator');
        await page.goto(`/dashboard/events/${IDS.event}/queues/${IDS.queueA}`);
        await page.click('#open-scanner-btn');
        await expect(page.locator('#scanner-modal')).toHaveClass(/open/);
        await page.fill('#manual-token', 'test-qr-token-a3');
        await page.click('#manual-validate-btn');
        await expect(page.locator('#scanner-result')).toContainText('Entrance confirmed.');
        await expect(page.locator('#scanner-result')).toContainText('#3 · Cara Cat');
        expect(api.database.row('gftvqueue_entries', IDS.entryA3Called).entered_at).not.toBeNull();
    });

    test('superadmin approves a pending account', async ({ page, api }) => {
        await signInAs(page, 'superadmin');
        await page.goto('/dashboard');
        await page.click('[data-view="admin-users"]');
        await page.click('.approve-btn');
        await expect(page.locator('.toast')).toContainText('User approved');
        await expect(page.locator('#users-table-wrap')).toContainText('No pending accounts');
        expect(api.database.row('gftvhello_users', IDS.pending).is_approved).toBe(true);
    });

    test('operator unlinks their Telegram account', async ({ page, api }) => {
        await signInAs(page, 'operator');
        await page.goto('/dashboard');
        await page.click('#nav-profile');
        page.once('dialog', (dialog) => dialog.accept());
        await page.click('#unlink-tg-btn');
        await expect(page.locator('.toast')).toContainText('Telegram unlinked');
        await expect(page.locator('#gen-otp-btn')).toBeVisible();
        expect(api.database.rows('gftvqueue_telegram_links')).toEqual([]);
    });
});
