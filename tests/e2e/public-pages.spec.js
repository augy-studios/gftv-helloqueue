// Smoke tests: index.html, login.html, register.html and 404.html.

const { test, expect, fixtures, signInAs } = require('./support/test.js');

const { PASSWORD, BACKUP_CODE } = fixtures;

function loadedFrom(thirdParty, host) {
    return thirdParty.requests.some((url) => new URL(url).hostname === host);
}

test.describe('index.html (/)', () => {
    test('renders the landing page', async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveTitle('GFTV HelloQueue | GFTV TIDSC');
        await expect(page.locator('#officialBar')).toBeVisible();
        await expect(page.locator('.topbar-brand')).toContainText('HelloQueue');
        await expect(page.locator('.hero h1')).toHaveText('Virtual Queue Management for Furry Events');
        await expect(page.locator('.hero-cta a[href="/login"]')).toHaveText('Operator Login');
        await expect(page.locator('.feature-card')).toHaveCount(6);
        await expect(page.locator('.footer')).toContainText('TIDSC');
    });

    test('loads Google Analytics and AdSense (public page: decision F1 keeps them)', async ({ page, thirdParty }) => {
        await page.goto('/');
        await expect(page.locator('.hero h1')).toBeVisible();
        expect(loadedFrom(thirdParty, 'www.googletagmanager.com')).toBe(true);
        expect(loadedFrom(thirdParty, 'pagead2.googlesyndication.com')).toBe(true);
    });

    test('sends a signed-in visitor to the dashboard', async ({ page }) => {
        await signInAs(page, 'operator');
        await page.goto('/');
        await expect(page).toHaveURL(/\/dashboard$/);
    });
});

test.describe('login.html (/login)', () => {
    test('renders the sign-in form', async ({ page }) => {
        await page.goto('/login');
        await expect(page).toHaveTitle('Login | GFTV HelloQueue');
        await expect(page.locator('#officialBar')).toBeVisible();
        await expect(page.locator('.auth-title')).toHaveText('Welcome back');
        await expect(page.locator('#username')).toBeVisible();
        await expect(page.locator('#password')).toBeVisible();
        await expect(page.locator('#login-btn')).toHaveText('Sign in');
        await expect(page.locator('a.auth-link[href="/register"]')).toBeVisible();
        await expect(page.locator('#totp-modal')).not.toHaveClass(/open/);
    });

    // F1 (job 05) took Google Analytics and AdSense off the sign-in pages
    // (analytics.spec.js checks every page).
    test('F1: loads neither Google Analytics nor AdSense', async ({ page, thirdParty }) => {
        await page.goto('/login');
        await expect(page.locator('#login-form')).toBeVisible();
        expect(loadedFrom(thirdParty, 'www.googletagmanager.com')).toBe(false);
        expect(loadedFrom(thirdParty, 'pagead2.googlesyndication.com')).toBe(false);
    });

    test('signing in with the right password opens the dashboard', async ({ page, api }) => {
        await page.goto('/login');
        await page.fill('#username', 'admin.augy');
        await page.fill('#password', PASSWORD);
        await page.click('#login-btn');
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.locator('.page-title')).toContainText('Events');
        const token = await page.evaluate(() => window.localStorage.getItem('hq_token'));
        expect(api.database.rows('gftvhello_sessions').some((session) => session.token === token)).toBe(true);
    });

    test('a two-factor account signs in with a backup code', async ({ page, api }) => {
        await page.goto('/login');
        await page.fill('#username', 'twofactor.tia');
        await page.fill('#password', PASSWORD);
        await page.click('#login-btn');
        await expect(page.locator('#totp-modal')).toHaveClass(/open/);
        await page.click('#totp-toggle-backup');
        await expect(page.locator('#totp-code-label')).toHaveText('Backup Code');
        await page.fill('#totp-code', BACKUP_CODE);
        await page.click('#totp-submit-btn');
        await expect(page).toHaveURL(/\/dashboard$/);
        expect(api.database.rows('gftvhello_backup_codes')[0].used_at).not.toBeNull();
    });

    test('a wrong password shows the error and stays on the page', async ({ page, consoleErrors }) => {
        consoleErrors.allow('expected-401', (error) => error.text.includes('401'));
        await page.goto('/login');
        await page.fill('#username', 'admin.augy');
        await page.fill('#password', 'wrong-password');
        await page.click('#login-btn');
        await expect(page.locator('#login-error')).toHaveText('Invalid credentials');
        await expect(page).toHaveURL(/\/login$/);
    });
});

test.describe('register.html (/register)', () => {
    test('renders the registration form', async ({ page }) => {
        await page.goto('/register');
        await expect(page.locator('#officialBar')).toBeVisible();
        await expect(page.locator('.auth-title')).toHaveText('Create account');
        for (const id of ['#display_name', '#username', '#email', '#password']) {
            await expect(page.locator(id)).toBeVisible();
        }
        await expect(page.locator('#reg-btn')).toHaveText('Create account');
    });

    test('registering creates an account waiting for approval', async ({ page, api }) => {
        await page.goto('/register');
        await page.fill('#display_name', 'New Person');
        await page.fill('#username', 'new.person');
        await page.fill('#email', 'new.person@example.test');
        await page.fill('#password', 'long-enough-password');
        await page.click('#reg-btn');
        await expect(page.locator('#reg-success')).toContainText('Account created!');
        const created = api.database.rows('gftvhello_users').find((user) => user.username === 'new.person');
        expect(created.is_approved).toBe(false);
    });
});

test.describe('404.html', () => {
    test('/404 renders the not-found page', async ({ page }) => {
        await page.goto('/404');
        await expect(page.locator('#officialBar')).toBeVisible();
        await expect(page.locator('h1.title-text')).toHaveText('Page Not Found uwu');
        await expect(page.locator('.submarine')).toBeVisible();
    });

    test('an unknown path answers 404 with the not-found page', async ({ page, consoleErrors }) => {
        consoleErrors.allow('expected-404', (error) => error.text.includes('404'));
        const response = await page.goto('/no-such-page');
        expect(response.status()).toBe(404);
        await expect(page.locator('h1.title-text')).toHaveText('Page Not Found uwu');
    });
});
