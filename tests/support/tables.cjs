// The database shape the fake Supabase checks queries against.
//
// Columns come from schema.sql. Two tables the code uses are missing from
// schema.sql (gftvqueue_attendee_login_codes and gftvqueue_attendee_sessions);
// their columns are taken from the code that reads and writes them in
// api/auth/attendee-login.js, api/_auth.js, api/telegram/webhook.js and
// bot/index.js. The gftvhello_* tables belong to the shared HelloSuite auth
// system and are not in schema.sql either; their columns come from the code.
//
// A query that names a table or column not listed here fails the same way
// PostgREST does, so a renamed database name in the code shows up in the tests.

const TABLE_COLUMNS = {
    gftvhello_users: [
        'id', 'username', 'display_name', 'email', 'password_hash', 'is_admin',
        'is_approved', 'is_editor', 'avatar_url', 'totp_secret', 'created_at',
    ],
    gftvhello_sessions: ['id', 'user_id', 'token', 'expires_at', 'created_at'],
    gftvhello_totp_challenges: ['id', 'token', 'user_id', 'expires_at'],
    gftvhello_trusted_devices: ['id', 'user_id', 'device_token', 'expires_at'],
    gftvhello_backup_codes: ['id', 'user_id', 'code_hash', 'used_at'],
    gftvqueue_events: [
        'id', 'name', 'description', 'venue', 'event_date', 'status', 'access_code',
        'created_by', 'created_at', 'updated_at',
    ],
    gftvqueue_event_editors: ['id', 'event_id', 'user_id', 'assigned_by', 'assigned_at'],
    gftvqueue_queues: [
        'id', 'event_id', 'name', 'description', 'status', 'access_code', 'max_serving',
        'created_by', 'created_at', 'updated_at',
    ],
    gftvqueue_queue_permissions: ['id', 'queue_id', 'user_id', 'is_queue_admin', 'granted_by', 'granted_at'],
    gftvqueue_entries: [
        'id', 'queue_id', 'telegram_user_id', 'telegram_username', 'display_name', 'queue_number',
        'status', 'notify_serving', 'notify_next', 'joined_at', 'called_at', 'entered_at', 'completed_at',
    ],
    gftvqueue_entry_tokens: ['id', 'token', 'entry_id', 'created_at', 'used_at'],
    gftvqueue_telegram_links: ['id', 'user_id', 'telegram_user_id', 'telegram_username', 'linked_at'],
    gftvqueue_telegram_otps: ['id', 'otp_code', 'user_id', 'expires_at', 'used_at'],
    // Not in schema.sql.
    gftvqueue_attendee_login_codes: ['id', 'code', 'used_at', 'expires_at', 'session_token', 'created_at'],
    // Not in schema.sql.
    gftvqueue_attendee_sessions: [
        'id', 'token', 'telegram_user_id', 'telegram_username', 'display_name', 'expires_at', 'created_at',
    ],
};

// Foreign keys, used to resolve embedded selects such as
// "*, gftvqueue_events(access_code)". Two keys from one table to the same
// table make an embed without a "!column" hint ambiguous, as in PostgREST.
const FOREIGN_KEYS = [
    { table: 'gftvhello_sessions', column: 'user_id', references: 'gftvhello_users' },
    { table: 'gftvqueue_events', column: 'created_by', references: 'gftvhello_users' },
    { table: 'gftvqueue_event_editors', column: 'event_id', references: 'gftvqueue_events' },
    { table: 'gftvqueue_event_editors', column: 'user_id', references: 'gftvhello_users' },
    { table: 'gftvqueue_event_editors', column: 'assigned_by', references: 'gftvhello_users' },
    { table: 'gftvqueue_queues', column: 'event_id', references: 'gftvqueue_events' },
    { table: 'gftvqueue_queues', column: 'created_by', references: 'gftvhello_users' },
    { table: 'gftvqueue_queue_permissions', column: 'queue_id', references: 'gftvqueue_queues' },
    { table: 'gftvqueue_queue_permissions', column: 'user_id', references: 'gftvhello_users' },
    { table: 'gftvqueue_queue_permissions', column: 'granted_by', references: 'gftvhello_users' },
    { table: 'gftvqueue_entries', column: 'queue_id', references: 'gftvqueue_queues' },
    { table: 'gftvqueue_entry_tokens', column: 'entry_id', references: 'gftvqueue_entries' },
    { table: 'gftvqueue_telegram_links', column: 'user_id', references: 'gftvhello_users' },
    { table: 'gftvqueue_telegram_otps', column: 'user_id', references: 'gftvhello_users' },
];

// Unique constraints from schema.sql. An insert that breaks one fails with
// Postgres error code 23505, which api/events/[eventId]/editors.js checks for.
const UNIQUE_KEYS = {
    gftvhello_users: [['username'], ['email']],
    gftvhello_sessions: [['token']],
    gftvqueue_events: [['access_code']],
    gftvqueue_event_editors: [['event_id', 'user_id']],
    gftvqueue_queues: [['access_code']],
    gftvqueue_queue_permissions: [['queue_id', 'user_id']],
    gftvqueue_entries: [['queue_id', 'queue_number']],
    gftvqueue_entry_tokens: [['token']],
    gftvqueue_telegram_links: [['user_id'], ['telegram_user_id']],
    gftvqueue_telegram_otps: [['otp_code']],
    gftvqueue_attendee_login_codes: [['code']],
    gftvqueue_attendee_sessions: [['token']],
};

module.exports = { TABLE_COLUMNS, FOREIGN_KEYS, UNIQUE_KEYS };
