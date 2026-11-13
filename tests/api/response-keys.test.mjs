// Rule F2 (job 03): every API response carries only what its page shows,
// plus the ids its buttons send. These tests pin the exact keys of each
// response, all the way down, so a field can't creep back in. A new key
// fails here until it's added on purpose.
//
// Status flags and messages that carry no data (ok, message, error, valid,
// pending, in_queue, can_operate) are kept on purpose.
//
// api/telegram/ is left out: it answers Telegram, not a page (job 04).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { callHandler, listApiRouteFiles } from '../support/handlers.cjs';
import {
    IDS, CODES, SESSION_TOKENS, ATTENDEE_TOKENS, LOGIN_CODES, PASSWORD, BACKUP_CODE,
} from '../support/fixtures.cjs';
import { useFreshDatabase } from './helpers.mjs';

// A leaf in a shape: any value that isn't an object or an array.
const LEAF = 'leaf';

let database;

beforeEach(() => {
    database = useFreshDatabase();
});

// The keys of a JSON value, all the way down. An object becomes its keys,
// each with the shape of its value. An array becomes the shapes of its items,
// each different shape once. Anything else is a LEAF.
function shapeOf(value) {
    if (Array.isArray(value)) {
        const shapes = [];
        for (const item of value) {
            const shape = shapeOf(item);
            if (!shapes.some((known) => isDeepStrictEqual(known, shape))) {
                shapes.push(shape);
            }
        }
        return shapes;
    }
    if (value !== null && typeof value === 'object') {
        const shape = {};
        for (const key of Object.keys(value).sort()) {
            shape[key] = shapeOf(value[key]);
        }
        return shape;
    }
    return LEAF;
}

// An object shape whose keys are all leaves.
function leaves(...keys) {
    const shape = {};
    for (const key of keys) {
        shape[key] = LEAF;
    }
    return shape;
}

const OK = leaves('ok');
const MESSAGE = leaves('message');
const ERROR = leaves('error');

// The hq_user object the sign-in page saves, which the dashboard reads.
const SIGNED_IN_USER = leaves('id', 'username', 'display_name', 'is_admin', 'is_editor');

// An operator's entry card: the id its buttons send, the number, the name
// and the @username (decision 5). Called attendees add entered_at.
const ENTRY_CARD = leaves('id', 'queue_number', 'display_name', 'telegram_username');
const SERVING_CARD = leaves('id', 'queue_number', 'display_name', 'telegram_username', 'entered_at');
const FINISHED_CARD = leaves('queue_number', 'display_name', 'telegram_username');

const STAFF_MEMBER = { user_id: LEAF, gftvhello_users: leaves('username', 'display_name') };

function call(file, options) {
    return callHandler(file, options);
}

function signIn(username) {
    return call('api/auth/login.js', { method: 'POST', body: { username, password: PASSWORD } });
}

// Every pinned response: the route file, what's sent, and the status and
// shape that must come back.
const CASES = [
    // ── api/auth ────────────────────────────────────────────────────────────
    {
        file: 'api/auth/login.js',
        name: 'password sign-in: the token and the hq_user fields',
        run: () => signIn('admin.augy'),
        status: 200,
        shape: { token: LEAF, user: SIGNED_IN_USER },
    },
    {
        file: 'api/auth/login.js',
        name: 'two-factor account: the challenge only',
        run: () => signIn('twofactor.tia'),
        status: 200,
        shape: leaves('requires_totp', 'totp_token'),
    },
    {
        file: 'api/auth/login.js',
        name: 'two-factor account on a trusted device: the token and the hq_user fields',
        run: () => {
            database.tables.gftvhello_trusted_devices.push({
                id: '88888888-8888-4888-8888-888888888888',
                user_id: IDS.twoFactor,
                device_token: 'test-trusted-device',
                expires_at: '2099-01-01T00:00:00.000Z',
            });
            return call('api/auth/login.js', {
                method: 'POST',
                body: { username: 'twofactor.tia', password: PASSWORD, device_token: 'test-trusted-device' },
            });
        },
        status: 200,
        shape: { token: LEAF, user: SIGNED_IN_USER },
    },
    {
        file: 'api/auth/totp-verify.js',
        name: 'backup code: the token, the device token and the hq_user fields',
        run: async () => {
            const challenge = await signIn('twofactor.tia');
            return call('api/auth/totp-verify.js', {
                method: 'POST',
                body: { totp_token: challenge.body.totp_token, code: BACKUP_CODE, trust_device: true },
            });
        },
        status: 200,
        shape: { token: LEAF, device_token: LEAF, user: SIGNED_IN_USER },
    },
    {
        file: 'api/auth/register.js',
        name: 'new account: a message only',
        run: () => call('api/auth/register.js', {
            method: 'POST',
            body: { username: 'new.person', display_name: 'New Person', email: 'new.person@example.test', password: 'long-enough-password' },
        }),
        status: 201,
        shape: MESSAGE,
    },
    {
        file: 'api/auth/logout.js',
        name: 'sign out: a message only',
        run: () => call('api/auth/logout.js', { method: 'POST', token: SESSION_TOKENS.operator }),
        status: 200,
        shape: MESSAGE,
    },
    {
        file: 'api/auth/me.js',
        name: 'linked account: only the Telegram link fields the profile page shows',
        run: () => call('api/auth/me.js', { method: 'GET', token: SESSION_TOKENS.operator }),
        status: 200,
        shape: { user: leaves('telegram_linked', 'telegram_username', 'telegram_linked_at') },
    },
    {
        file: 'api/auth/me.js',
        name: 'account with no link: the same three fields',
        run: () => call('api/auth/me.js', { method: 'GET', token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: { user: leaves('telegram_linked', 'telegram_username', 'telegram_linked_at') },
    },
    {
        file: 'api/auth/attendee-login.js',
        name: 'new attendee code: the code and the bot for the deep link',
        run: () => call('api/auth/attendee-login.js', { method: 'POST' }),
        status: 200,
        shape: leaves('code', 'bot_username'),
    },
    {
        file: 'api/auth/attendee-login.js',
        name: 'poll before the bot confirms: pending only',
        run: () => call('api/auth/attendee-login.js', { method: 'GET', query: { code: LOGIN_CODES.pending } }),
        status: 202,
        shape: leaves('pending'),
    },
    {
        file: 'api/auth/attendee-login.js',
        name: 'poll after the bot confirms: the token only',
        run: () => call('api/auth/attendee-login.js', { method: 'GET', query: { code: LOGIN_CODES.used } }),
        status: 200,
        shape: leaves('token'),
    },

    // ── api/admin and api/user ──────────────────────────────────────────────
    {
        file: 'api/admin/users.js',
        name: 'user list: what the users table shows and the id its buttons send',
        run: () => call('api/admin/users.js', { method: 'GET', token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: { data: [leaves('id', 'username', 'display_name', 'email', 'is_admin', 'is_approved', 'is_editor')] },
    },
    {
        file: 'api/admin/users.js',
        name: 'approve a user: ok only',
        run: () => call('api/admin/users.js', {
            method: 'PUT', token: SESSION_TOKENS.superadmin, body: { user_id: IDS.pending, is_approved: true },
        }),
        status: 200,
        shape: OK,
    },
    {
        file: 'api/user/telegram-link.js',
        name: 'link code: the code and when it expires',
        run: () => call('api/user/telegram-link.js', { method: 'GET', token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: leaves('otp_code', 'expires_at'),
    },
    {
        file: 'api/user/telegram-link.js',
        name: 'unlink: a message only',
        run: () => call('api/user/telegram-link.js', { method: 'DELETE', token: SESSION_TOKENS.operator }),
        status: 200,
        shape: MESSAGE,
    },

    // ── api/events ──────────────────────────────────────────────────────────
    {
        file: 'api/events/index.js',
        name: 'event list: what each event card shows and the id its buttons send',
        run: () => call('api/events/index.js', { method: 'GET', token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: { events: [leaves('id', 'name', 'status', 'venue', 'event_date', 'access_code')] },
    },
    {
        file: 'api/events/index.js',
        name: 'create an event: ok only',
        run: () => call('api/events/index.js', { method: 'POST', token: SESSION_TOKENS.superadmin, body: { name: 'New Con' } }),
        status: 201,
        shape: OK,
    },
    {
        // The editor list is always empty for now (B2, see
        // event-by-id.test.mjs); event-editors' own GET pins an editor's keys.
        file: 'api/events/[eventId].js',
        name: 'event page: the event, its queue cards and the editor list',
        run: () => call('api/events/[eventId].js', { method: 'GET', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: {
            event: leaves('name', 'status', 'venue', 'event_date', 'access_code'),
            editors: [],
            queues: [leaves('id', 'name', 'status', 'access_code', 'max_serving')],
        },
    },
    {
        file: 'api/events/[eventId].js',
        name: 'change an event: ok only',
        run: () => call('api/events/[eventId].js', {
            method: 'PUT', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin, body: { status: 'closed' },
        }),
        status: 200,
        shape: OK,
    },
    {
        file: 'api/events/[eventId].js',
        name: 'delete an event: a message only',
        run: () => call('api/events/[eventId].js', { method: 'DELETE', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: MESSAGE,
    },
    {
        file: 'api/events/[eventId]/editors.js',
        name: 'editor list: each editor\'s name and username, and their user_id',
        run: () => call('api/events/[eventId]/editors.js', { method: 'GET', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: { editors: [STAFF_MEMBER] },
    },
    {
        file: 'api/events/[eventId]/editors.js',
        name: 'add an editor: ok only',
        run: () => call('api/events/[eventId]/editors.js', {
            method: 'POST', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin, body: { user_id: IDS.operator },
        }),
        status: 201,
        shape: OK,
    },
    {
        file: 'api/events/[eventId]/editors.js',
        name: 'remove an editor: a message only',
        run: () => call('api/events/[eventId]/editors.js', {
            method: 'DELETE', query: { eventId: IDS.event }, token: SESSION_TOKENS.superadmin, body: { user_id: IDS.editor },
        }),
        status: 200,
        shape: MESSAGE,
    },

    // ── api/queues ──────────────────────────────────────────────────────────
    {
        file: 'api/queues/index.js',
        name: 'My Queues: what each queue card shows and the ids its buttons send',
        run: () => call('api/queues/index.js', { method: 'GET', query: { mine: '1' }, token: SESSION_TOKENS.operator }),
        status: 200,
        shape: {
            queues: [leaves(
                'id', 'event_id', 'name', 'status', 'access_code', 'max_serving',
                'event_name', 'event_access_code', 'is_queue_admin',
            )],
        },
    },
    {
        file: 'api/queues/index.js',
        name: 'an event\'s queues, as its editor: with access codes',
        run: () => call('api/queues/index.js', { method: 'GET', query: { event_id: IDS.event }, token: SESSION_TOKENS.editor }),
        status: 200,
        shape: { queues: [leaves('id', 'name', 'status', 'access_code', 'max_serving')] },
    },
    {
        file: 'api/queues/index.js',
        name: 'an event\'s queues, as staff: without access codes',
        run: () => call('api/queues/index.js', { method: 'GET', query: { event_id: IDS.event }, token: SESSION_TOKENS.operator }),
        status: 200,
        shape: { queues: [leaves('id', 'name', 'status', 'max_serving')] },
    },
    {
        file: 'api/queues/index.js',
        name: 'create a queue: ok only',
        run: () => call('api/queues/index.js', {
            method: 'POST', token: SESSION_TOKENS.editor, body: { event_id: IDS.event, name: 'Art Show' },
        }),
        status: 201,
        shape: OK,
    },
    {
        file: 'api/queues/[queueId].js',
        name: 'operator page: the queue, each column\'s cards, and the completed count',
        run: () => call('api/queues/[queueId].js', { method: 'GET', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator }),
        status: 200,
        shape: {
            queue: leaves('name', 'status', 'access_code', 'max_serving', 'event_access_code'),
            entries: {
                serving: [SERVING_CARD],
                waiting: [ENTRY_CARD],
                missed: [ENTRY_CARD],
                completed: [FINISHED_CARD],
            },
            completedCount: LEAF,
            can_operate: LEAF,
            is_queue_admin: LEAF,
        },
    },
    {
        file: 'api/queues/[queueId].js',
        name: 'change a queue: ok only',
        run: () => call('api/queues/[queueId].js', {
            method: 'PUT', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator, body: { max_serving: 4 },
        }),
        status: 200,
        shape: OK,
    },
    {
        file: 'api/queues/[queueId].js',
        name: 'delete a queue: a message only',
        run: () => call('api/queues/[queueId].js', { method: 'DELETE', query: { queueId: IDS.queueB }, token: SESSION_TOKENS.queueAdmin }),
        status: 200,
        shape: MESSAGE,
    },
    {
        file: 'api/queues/[queueId]/join.js',
        name: 'join: ok only, never the new entry',
        run: () => call('api/queues/[queueId]/join.js', { method: 'POST', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.newcomer }),
        status: 201,
        shape: OK,
    },
    {
        file: 'api/queues/[queueId]/join.js',
        name: 'join when already in the queue: the error only, never the entry',
        run: () => call('api/queues/[queueId]/join.js', { method: 'POST', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.waitingA5 }),
        status: 409,
        shape: ERROR,
    },
    {
        file: 'api/queues/[queueId]/leave.js',
        name: 'leave: a message only',
        run: () => call('api/queues/[queueId]/leave.js', { method: 'POST', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.waitingA5 }),
        status: 200,
        shape: MESSAGE,
    },
    {
        file: 'api/queues/[queueId]/notify-prefs.js',
        name: 'notification toggles: ok only',
        run: () => call('api/queues/[queueId]/notify-prefs.js', {
            method: 'PUT', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.waitingA5, body: { notify_next: false },
        }),
        status: 200,
        shape: OK,
    },
    {
        file: 'api/queues/[queueId]/operate.js',
        name: 'Call Next: the numbers called, for the toast',
        run: () => call('api/queues/[queueId]/operate.js', {
            method: 'POST', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator, body: { action: 'call_next' },
        }),
        status: 200,
        shape: { message: LEAF, called: [LEAF] },
    },
    {
        file: 'api/queues/[queueId]/operate.js',
        name: 'mark missed: a message only',
        run: () => call('api/queues/[queueId]/operate.js', {
            method: 'POST', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator,
            body: { action: 'mark_missed', entry_id: IDS.entryA3Called },
        }),
        status: 200,
        shape: MESSAGE,
    },
    {
        file: 'api/queues/[queueId]/permissions.js',
        name: 'staff list: each person\'s name and username, their user_id and whether they\'re queue admin',
        run: () => call('api/queues/[queueId]/permissions.js', { method: 'GET', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.superadmin }),
        status: 200,
        shape: { permissions: [{ ...STAFF_MEMBER, is_queue_admin: LEAF }] },
    },
    {
        file: 'api/queues/[queueId]/permissions.js',
        name: 'grant: ok only',
        run: () => call('api/queues/[queueId]/permissions.js', {
            method: 'POST', query: { queueId: IDS.queueB }, token: SESSION_TOKENS.queueAdmin, body: { user_id: IDS.outsider },
        }),
        status: 201,
        shape: OK,
    },
    {
        file: 'api/queues/[queueId]/permissions.js',
        name: 'revoke: a message only',
        run: () => call('api/queues/[queueId]/permissions.js', {
            method: 'DELETE', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.superadmin, body: { user_id: IDS.operator },
        }),
        status: 200,
        shape: MESSAGE,
    },
    {
        file: 'api/queues/[queueId]/scan.js',
        name: 'entrance scan: the message, number and name the scanner shows',
        run: () => call('api/queues/[queueId]/scan.js', {
            method: 'POST', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator,
            body: { token: 'test-qr-token-a3', scan_type: 'entrance' },
        }),
        status: 200,
        shape: leaves('valid', 'message', 'queue_number', 'name'),
    },
    {
        file: 'api/queues/[queueId]/scan.js',
        name: 'exit scan: the message, number and name the scanner shows',
        run: () => call('api/queues/[queueId]/scan.js', {
            method: 'POST', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator,
            body: { token: 'test-qr-token-a4', scan_type: 'exit' },
        }),
        status: 200,
        shape: leaves('valid', 'message', 'queue_number', 'name'),
    },
    {
        file: 'api/queues/[queueId]/scan.js',
        name: 'a missed attendee\'s code: the error only, never their name or number',
        run: () => {
            database.tables.gftvqueue_entries.find((row) => row.id === IDS.entryA3Called).status = 'missed';
            return call('api/queues/[queueId]/scan.js', {
                method: 'POST', query: { queueId: IDS.queueA }, token: SESSION_TOKENS.operator,
                body: { token: 'test-qr-token-a3', scan_type: 'entrance' },
            });
        },
        status: 400,
        shape: leaves('error', 'valid'),
    },
    {
        file: 'api/queues/[queueId]/status.js',
        name: 'waiting attendee: what the queue page shows, no entry id',
        run: () => call('api/queues/[queueId]/status.js', { method: 'GET', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.waitingA5 }),
        status: 200,
        shape: {
            in_queue: LEAF,
            entry: leaves('queue_number', 'status', 'position', 'entered_at', 'notify_serving', 'notify_next'),
            qr_data_url: LEAF,
            qr_token: LEAF,
            queue: leaves('name', 'status', 'event_name'),
            waiting_count: LEAF,
            served_count: LEAF,
        },
    },
    {
        file: 'api/queues/[queueId]/status.js',
        name: 'called attendee: the same keys, with the QR code filled in',
        run: () => call('api/queues/[queueId]/status.js', { method: 'GET', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.calledA3 }),
        status: 200,
        shape: {
            in_queue: LEAF,
            entry: leaves('queue_number', 'status', 'position', 'entered_at', 'notify_serving', 'notify_next'),
            qr_data_url: LEAF,
            qr_token: LEAF,
            queue: leaves('name', 'status', 'event_name'),
            waiting_count: LEAF,
            served_count: LEAF,
        },
    },
    {
        file: 'api/queues/[queueId]/status.js',
        name: 'attendee not in the queue: what the Join card shows',
        run: () => call('api/queues/[queueId]/status.js', { method: 'GET', query: { queueId: IDS.queueA }, token: ATTENDEE_TOKENS.newcomer }),
        status: 200,
        shape: {
            in_queue: LEAF,
            queue: leaves('name', 'status', 'event_name'),
            served_count: LEAF,
        },
    },

    // ── api/display (public) ────────────────────────────────────────────────
    {
        // Unchanged by job 03: the board shows queue numbers only.
        file: 'api/display/[eventCode]/[queueCode].js',
        name: 'display board: queue numbers only, no names',
        run: () => call('api/display/[eventCode]/[queueCode].js', {
            method: 'GET', query: { eventCode: CODES.event, queueCode: CODES.queueA },
        }),
        status: 200,
        shape: {
            event: leaves('name'),
            queue: leaves('id', 'name', 'status'),
            serving: [LEAF],
            serving_entries: [leaves('queue_number', 'entered_at')],
            waiting: [LEAF],
            missed: [LEAF],
            total_in_queue: LEAF,
            total_served: LEAF,
            est_wait_minutes: LEAF,
            updated_at: LEAF,
            join_url: LEAF,
        },
    },
];

for (const pinned of CASES) {
    test(`${pinned.file}: ${pinned.name}`, async () => {
        const response = await pinned.run();
        assert.equal(response.status, pinned.status, JSON.stringify(response.body));
        assert.deepStrictEqual(shapeOf(response.body), pinned.shape);
    });
}

test('display board: the serving, waiting and missed lists are plain queue numbers', async () => {
    const response = await call('api/display/[eventCode]/[queueCode].js', {
        method: 'GET', query: { eventCode: CODES.event, queueCode: CODES.queueA },
    });
    for (const list of [response.body.serving, response.body.waiting, response.body.missed]) {
        assert.ok(list.length > 0);
        for (const item of list) {
            assert.equal(typeof item, 'number');
        }
    }
});

// Every route file the pages can reach has at least one pinned response, so
// a new endpoint can't skip this file.
test('every route file except api/telegram/ has a pinned response', () => {
    const pinnedFiles = new Set(CASES.map((pinned) => pinned.file));
    const routeFiles = listApiRouteFiles().filter((file) => !file.startsWith('api/telegram/'));
    const unpinned = routeFiles.filter((file) => !pinnedFiles.has(file));
    assert.deepEqual(unpinned, []);
    assert.equal(routeFiles.length, 21);
});
