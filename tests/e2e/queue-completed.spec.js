// The operator's Completed column (decision 4, job 03): the header and the
// stats bar show how many have finished in all, and the column lists only
// the last 5 (RECENT_COMPLETED_LIMIT in api/queues/[queueId].js), newest
// first, each with its name and @username (decision 5).

const { test, expect, fixtures, signInAs } = require('./support/test.js');

const { IDS } = fixtures;
const QUEUE_A_OPERATOR_PAGE = `/dashboard/events/${IDS.event}/queues/${IDS.queueA}`;

function completedNumbers(page) {
    return page.locator('#col-completed .entry-card .queue-number');
}

// Six more finished attendees in queue A, #7 to #12. All finish times are in
// the past, so anything finished during the test is newest. Newest first they
// read 7, 8, 9, 10, 11, 12, then the fixture's #1.
function addFinishedEntries(database) {
    const fixtureFinished = database.tables.gftvqueue_entries.find((row) => row.id === IDS.entryA1Completed);
    fixtureFinished.completed_at = '2026-11-01T09:00:00.000Z';
    for (let number = 7; number <= 12; number += 1) {
        const minutesPastTen = String(20 - number).padStart(2, '0');
        database.tables.gftvqueue_entries.push({
            id: `eeeeeeee-1111-4000-8000-${String(number).padStart(12, '0')}`,
            queue_id: IDS.queueA,
            telegram_user_id: 9500 + number,
            telegram_username: `finished_${number}`,
            display_name: `Finished ${number}`,
            queue_number: number,
            status: 'completed',
            notify_serving: true,
            notify_next: true,
            joined_at: '2026-11-01T08:00:00.000Z',
            called_at: '2026-11-01T08:30:00.000Z',
            entered_at: '2026-11-01T08:35:00.000Z',
            completed_at: `2026-11-01T10:${minutesPastTen}:00.000Z`,
        });
    }
}

test('one finished attendee: the count is 1 and there is no "Last" note', async ({ page }) => {
    await signInAs(page, 'operator');
    await page.goto(QUEUE_A_OPERATOR_PAGE);
    await expect(completedNumbers(page)).toHaveText(['1']);
    await expect(page.locator('#completed-count')).toHaveText('1');
    await expect(page.locator('#stat-completed')).toHaveText('1');
    await expect(page.locator('#col-completed .completed-recent-note')).toHaveCount(0);
    // Finished cards have no buttons.
    await expect(page.locator('#col-completed button')).toHaveCount(0);
});

test('the 4-second poll updates the count, the list and the note', async ({ page, api }) => {
    await signInAs(page, 'operator');
    await page.goto(QUEUE_A_OPERATOR_PAGE);
    await expect(completedNumbers(page)).toHaveText(['1']);
    // Others finish elsewhere (another operator's scanner, say).
    addFinishedEntries(api.database);
    await expect(page.locator('#completed-count')).toHaveText('7', { timeout: 8000 });
    await expect(page.locator('#stat-completed')).toHaveText('7');
    await expect(completedNumbers(page)).toHaveText(['7', '8', '9', '10', '11']);
    await expect(page.locator('#col-completed .completed-recent-note')).toHaveText('Last 5 of 7');
});

test('more finished than the limit: the count, the newest 5 first, and a "Last 5 of 7" note', async ({ page, api }) => {
    addFinishedEntries(api.database);
    await signInAs(page, 'operator');
    await page.goto(QUEUE_A_OPERATOR_PAGE);
    await expect(completedNumbers(page)).toHaveText(['7', '8', '9', '10', '11']);
    await expect(page.locator('#completed-count')).toHaveText('7');
    await expect(page.locator('#stat-completed')).toHaveText('7');
    await expect(page.locator('#col-completed .completed-recent-note')).toHaveText('Last 5 of 7');
    // Decision 5: the @username shows on finished cards too.
    await expect(page.locator('#col-completed')).toContainText('Finished 7');
    await expect(page.locator('#col-completed')).toContainText('@finished_7');
    await expect(page.locator('#col-completed')).not.toContainText('Finished 12');
});

test('a manual exit goes to the top of the list and adds to the count', async ({ page, api }) => {
    addFinishedEntries(api.database);
    await signInAs(page, 'operator');
    await page.goto(QUEUE_A_OPERATOR_PAGE);
    await expect(page.locator('#completed-count')).toHaveText('7');
    await page.locator(`[data-entry-id="${IDS.entryA4Entered}"] .manual-exit-btn`).click();
    await expect(page.locator('.toast', { hasText: 'Manually exited' })).toBeVisible();
    await expect(completedNumbers(page)).toHaveText(['4', '7', '8', '9', '10']);
    await expect(page.locator('#completed-count')).toHaveText('8');
    await expect(page.locator('#stat-completed')).toHaveText('8');
    await expect(page.locator('#col-completed .completed-recent-note')).toHaveText('Last 5 of 8');
});

test('the queue response carries the count and at most 5 finished entries, without ids', async ({ page, api }) => {
    addFinishedEntries(api.database);
    await signInAs(page, 'operator');
    const responsePromise = page.waitForResponse((response) => response.url().endsWith(`/api/queues/${IDS.queueA}`));
    await page.goto(QUEUE_A_OPERATOR_PAGE);
    const body = await (await responsePromise).json();
    expect(body.completedCount).toBe(7);
    expect(body.entries.completed).toHaveLength(5);
    for (const entry of body.entries.completed) {
        expect(Object.keys(entry).sort()).toEqual(['display_name', 'queue_number', 'telegram_username']);
    }
});
