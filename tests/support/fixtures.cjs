// Fixture data shared by the Node handler tests and the Playwright tests.
//
// One event with two queues (A and B), and these people:
// - superadmin: is_admin, sees everything
// - editor: event editor of the event, no queue permissions
// - operator: operator of queue A only (not a queue admin)
// - queueAdmin: queue admin of queue B only
// - outsider: approved account with no roles or assignments
// - pending: registered, not approved yet
// - twoFactor: approved, no roles, with two-factor sign-in and one backup code
//
// Queue A has attendees in every state: completed (#1), missed (#2), called
// and not yet entered (#3), called and entered (#4), and waiting (#5, #6).
// Queue B has one waiting (#1) and one called (#2).
//
// Each call to createFixtureDatabase() returns a fresh copy, so tests can
// change it freely.

const bcrypt = require('bcryptjs');
const { createDatabase } = require('./fake-supabase.cjs');

const PASSWORD = 'correct-horse-battery';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

// The twoFactor user's authenticator secret and unused backup code.
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
const BACKUP_CODE = 'ABCD-EFGH-IJKL';
const BACKUP_CODE_HASH = bcrypt.hashSync('ABCDEFGHIJKL', 4);

const CREATED = '2026-11-01T09:00:00.000Z';
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';
const LONG_AGO = '2020-01-01T00:00:00.000Z';

const IDS = {
    superadmin: '00000000-0000-4000-8000-000000000001',
    editor: '00000000-0000-4000-8000-000000000002',
    operator: '00000000-0000-4000-8000-000000000003',
    queueAdmin: '00000000-0000-4000-8000-000000000004',
    outsider: '00000000-0000-4000-8000-000000000005',
    pending: '00000000-0000-4000-8000-000000000006',
    twoFactor: '00000000-0000-4000-8000-000000000007',
    event: '11111111-1111-4111-8111-111111111111',
    queueA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    queueB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    entryA1Completed: 'eeeeeeee-0000-4000-8000-0000000000a1',
    entryA2Missed: 'eeeeeeee-0000-4000-8000-0000000000a2',
    entryA3Called: 'eeeeeeee-0000-4000-8000-0000000000a3',
    entryA4Entered: 'eeeeeeee-0000-4000-8000-0000000000a4',
    entryA5Waiting: 'eeeeeeee-0000-4000-8000-0000000000a5',
    entryA6Waiting: 'eeeeeeee-0000-4000-8000-0000000000a6',
    entryB1Waiting: 'eeeeeeee-0000-4000-8000-0000000000b1',
    entryB2Called: 'eeeeeeee-0000-4000-8000-0000000000b2',
};

const CODES = {
    event: 'EVNTCODE',
    queueA: 'QUEUEAAA',
    queueB: 'QUEUEBBB',
};

// Dashboard session tokens (Authorization: Bearer <token>).
const SESSION_TOKENS = {
    superadmin: 'test-session-superadmin',
    editor: 'test-session-editor',
    operator: 'test-session-operator',
    queueAdmin: 'test-session-queue-admin',
    outsider: 'test-session-outsider',
    pending: 'test-session-pending',
    expired: 'test-session-expired',
};

// Attendee session tokens, as stored in hq_attendee_token.
const ATTENDEE_TOKENS = {
    waitingA5: 'test-attendee-waiting-a5',
    calledA3: 'test-attendee-called-a3',
    missedA2: 'test-attendee-missed-a2',
    newcomer: 'test-attendee-newcomer',
};

// Attendee login codes (api/auth/attendee-login.js).
const LOGIN_CODES = {
    pending: 'PENDNG',
    used: 'USEDCD',
    usedLongAgo: 'OLDUSE',
    expired: 'EXPIRD',
};

const TELEGRAM_IDS = {
    operator: 7003,
    attendeeA1: 9001,
    attendeeA2: 9002,
    attendeeA3: 9003,
    attendeeA4: 9004,
    attendeeA5: 9005,
    attendeeA6: 9006,
    attendeeB1: 9101,
    attendeeB2: 9102,
    newcomer: 9200,
};

function user(key, values) {
    return {
        id: IDS[key],
        email: `${values.username}@example.test`,
        password_hash: PASSWORD_HASH,
        is_admin: false,
        is_approved: true,
        is_editor: false,
        created_at: CREATED,
        ...values,
    };
}

const USERS = [
    user('superadmin', { username: 'admin.augy', display_name: 'Augy Admin', is_admin: true }),
    user('editor', { username: 'editor.eve', display_name: 'Eve Editor', is_editor: true }),
    user('operator', { username: 'operator.olly', display_name: 'Olly Operator' }),
    user('queueAdmin', { username: 'queueadmin.quinn', display_name: 'Quinn Queue Admin' }),
    user('outsider', { username: 'outsider.otto', display_name: 'Otto Outsider' }),
    user('pending', { username: 'pending.pat', display_name: 'Pat Pending', is_approved: false }),
    user('twoFactor', { username: 'twofactor.tia', display_name: 'Tia Two Factor', totp_secret: TOTP_SECRET }),
];

// What api/auth/login.js returns as `user`, which the pages keep in hq_user.
function signedInUser(key) {
    const found = USERS.find((candidate) => candidate.id === IDS[key]);
    return {
        id: found.id,
        username: found.username,
        display_name: found.display_name,
        is_admin: found.is_admin,
        is_editor: found.is_editor,
    };
}

function entry(id, values) {
    return {
        id,
        notify_serving: true,
        notify_next: true,
        joined_at: CREATED,
        ...values,
    };
}

function createFixtureDatabase() {
    return createDatabase({
        gftvhello_users: USERS,
        gftvhello_sessions: [
            { user_id: IDS.superadmin, token: SESSION_TOKENS.superadmin, expires_at: FAR_FUTURE },
            { user_id: IDS.editor, token: SESSION_TOKENS.editor, expires_at: FAR_FUTURE },
            { user_id: IDS.operator, token: SESSION_TOKENS.operator, expires_at: FAR_FUTURE },
            { user_id: IDS.queueAdmin, token: SESSION_TOKENS.queueAdmin, expires_at: FAR_FUTURE },
            { user_id: IDS.outsider, token: SESSION_TOKENS.outsider, expires_at: FAR_FUTURE },
            { user_id: IDS.pending, token: SESSION_TOKENS.pending, expires_at: FAR_FUTURE },
            { user_id: IDS.superadmin, token: SESSION_TOKENS.expired, expires_at: LONG_AGO },
        ].map((session, index) => ({ id: `00000000-0000-4000-a000-00000000000${index}`, created_at: CREATED, ...session })),
        gftvhello_backup_codes: [{
            id: '77777777-7777-4777-8777-777777777777',
            user_id: IDS.twoFactor,
            code_hash: BACKUP_CODE_HASH,
        }],
        gftvqueue_events: [{
            id: IDS.event,
            name: 'GFTV Test Con 2026',
            description: 'Fixture event',
            venue: 'Test Hall',
            event_date: '2026-12-05',
            status: 'active',
            access_code: CODES.event,
            created_by: IDS.superadmin,
            created_at: CREATED,
            updated_at: CREATED,
        }],
        gftvqueue_event_editors: [{
            id: '22222222-2222-4222-8222-222222222222',
            event_id: IDS.event,
            user_id: IDS.editor,
            assigned_by: IDS.superadmin,
            assigned_at: CREATED,
        }],
        gftvqueue_queues: [
            {
                id: IDS.queueA,
                event_id: IDS.event,
                name: 'Dealers Den (Queue A)',
                description: 'Fixture queue A',
                status: 'open',
                access_code: CODES.queueA,
                max_serving: 3,
                created_by: IDS.editor,
                created_at: CREATED,
                updated_at: CREATED,
            },
            {
                id: IDS.queueB,
                event_id: IDS.event,
                name: 'Photo Booth (Queue B)',
                description: 'Fixture queue B',
                status: 'open',
                access_code: CODES.queueB,
                max_serving: 2,
                created_by: IDS.queueAdmin,
                created_at: '2026-11-01T09:30:00.000Z',
                updated_at: '2026-11-01T09:30:00.000Z',
            },
        ],
        gftvqueue_queue_permissions: [
            {
                id: '33333333-3333-4333-8333-33333333333a',
                queue_id: IDS.queueA,
                user_id: IDS.operator,
                is_queue_admin: false,
                granted_by: IDS.editor,
                granted_at: CREATED,
            },
            {
                id: '33333333-3333-4333-8333-33333333333b',
                queue_id: IDS.queueB,
                user_id: IDS.queueAdmin,
                is_queue_admin: true,
                granted_by: IDS.queueAdmin,
                granted_at: CREATED,
            },
        ],
        gftvqueue_entries: [
            entry(IDS.entryA1Completed, {
                queue_id: IDS.queueA, telegram_user_id: TELEGRAM_IDS.attendeeA1, telegram_username: 'alice_fox',
                display_name: 'Alice Fox', queue_number: 1, status: 'completed',
                called_at: '2026-11-13T09:05:00.000Z', entered_at: '2026-11-13T09:06:00.000Z',
                completed_at: '2026-11-13T09:20:00.000Z',
            }),
            entry(IDS.entryA2Missed, {
                queue_id: IDS.queueA, telegram_user_id: TELEGRAM_IDS.attendeeA2, telegram_username: 'bram_wolf',
                display_name: 'Bram Wolf', queue_number: 2, status: 'missed', called_at: '2026-11-13T09:10:00.000Z',
            }),
            entry(IDS.entryA3Called, {
                queue_id: IDS.queueA, telegram_user_id: TELEGRAM_IDS.attendeeA3, telegram_username: 'cara_cat',
                display_name: 'Cara Cat', queue_number: 3, status: 'serving', called_at: '2026-11-13T09:30:00.000Z',
            }),
            entry(IDS.entryA4Entered, {
                queue_id: IDS.queueA, telegram_user_id: TELEGRAM_IDS.attendeeA4, telegram_username: 'dax_dragon',
                display_name: 'Dax Dragon', queue_number: 4, status: 'serving', called_at: '2026-11-13T09:31:00.000Z',
                entered_at: '2026-11-13T09:35:00.000Z',
            }),
            entry(IDS.entryA5Waiting, {
                queue_id: IDS.queueA, telegram_user_id: TELEGRAM_IDS.attendeeA5, telegram_username: 'eli_otter',
                display_name: 'Eli Otter', queue_number: 5, status: 'waiting',
            }),
            entry(IDS.entryA6Waiting, {
                queue_id: IDS.queueA, telegram_user_id: TELEGRAM_IDS.attendeeA6, telegram_username: 'fen_fennec',
                display_name: 'Fen Fennec', queue_number: 6, status: 'waiting', notify_next: true,
            }),
            entry(IDS.entryB1Waiting, {
                queue_id: IDS.queueB, telegram_user_id: TELEGRAM_IDS.attendeeB1, telegram_username: 'gus_goat',
                display_name: 'Gus Goat', queue_number: 1, status: 'waiting',
            }),
            entry(IDS.entryB2Called, {
                queue_id: IDS.queueB, telegram_user_id: TELEGRAM_IDS.attendeeB2, telegram_username: 'hana_hare',
                display_name: 'Hana Hare', queue_number: 2, status: 'serving', called_at: '2026-11-13T09:40:00.000Z',
            }),
        ],
        gftvqueue_entry_tokens: [
            { id: 'cccccccc-0000-4000-8000-0000000000a1', token: 'test-qr-token-a1', entry_id: IDS.entryA1Completed, created_at: '2026-11-13T09:05:00.000Z', used_at: '2026-11-13T09:20:00.000Z' },
            { id: 'cccccccc-0000-4000-8000-0000000000a3', token: 'test-qr-token-a3', entry_id: IDS.entryA3Called, created_at: '2026-11-13T09:30:00.000Z' },
            { id: 'cccccccc-0000-4000-8000-0000000000a4', token: 'test-qr-token-a4', entry_id: IDS.entryA4Entered, created_at: '2026-11-13T09:31:00.000Z' },
            { id: 'cccccccc-0000-4000-8000-0000000000b2', token: 'test-qr-token-b2', entry_id: IDS.entryB2Called, created_at: '2026-11-13T09:40:00.000Z' },
        ],
        gftvqueue_telegram_links: [{
            id: '44444444-4444-4444-8444-444444444444',
            user_id: IDS.operator,
            telegram_user_id: TELEGRAM_IDS.operator,
            telegram_username: 'olly_ops',
            linked_at: CREATED,
        }],
        gftvqueue_attendee_sessions: [
            { token: ATTENDEE_TOKENS.waitingA5, telegram_user_id: TELEGRAM_IDS.attendeeA5, telegram_username: 'eli_otter', display_name: 'Eli Otter' },
            { token: ATTENDEE_TOKENS.calledA3, telegram_user_id: TELEGRAM_IDS.attendeeA3, telegram_username: 'cara_cat', display_name: 'Cara Cat' },
            { token: ATTENDEE_TOKENS.missedA2, telegram_user_id: TELEGRAM_IDS.attendeeA2, telegram_username: 'bram_wolf', display_name: 'Bram Wolf' },
            { token: ATTENDEE_TOKENS.newcomer, telegram_user_id: TELEGRAM_IDS.newcomer, telegram_username: 'ivy_ibis', display_name: 'Ivy Ibis' },
        ].map((session, index) => ({
            id: `55555555-5555-4555-8555-00000000000${index}`,
            expires_at: FAR_FUTURE,
            created_at: CREATED,
            ...session,
        })),
        gftvqueue_attendee_login_codes: [
            { id: '66666666-6666-4666-8666-000000000001', code: LOGIN_CODES.pending, expires_at: FAR_FUTURE, created_at: CREATED },
            {
                id: '66666666-6666-4666-8666-000000000002', code: LOGIN_CODES.used, expires_at: FAR_FUTURE,
                used_at: '2026-11-13T09:00:00.000Z', session_token: ATTENDEE_TOKENS.waitingA5, created_at: CREATED,
            },
            {
                id: '66666666-6666-4666-8666-000000000003', code: LOGIN_CODES.usedLongAgo, expires_at: LONG_AGO,
                used_at: LONG_AGO, session_token: ATTENDEE_TOKENS.calledA3, created_at: LONG_AGO,
            },
            { id: '66666666-6666-4666-8666-000000000004', code: LOGIN_CODES.expired, expires_at: LONG_AGO, created_at: LONG_AGO },
        ],
    });
}

module.exports = {
    PASSWORD,
    TOTP_SECRET,
    BACKUP_CODE,
    IDS,
    CODES,
    SESSION_TOKENS,
    ATTENDEE_TOKENS,
    LOGIN_CODES,
    TELEGRAM_IDS,
    signedInUser,
    createFixtureDatabase,
};
