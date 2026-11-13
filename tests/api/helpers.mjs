// Shared set-up for the Node handler tests.

import { useDatabase } from '../support/fake-supabase.cjs';
import { createFixtureDatabase } from '../support/fixtures.cjs';
import { clearTelegramMessages } from '../support/telegram.cjs';

// A fresh copy of the fixture database, made current for the handlers, with
// the Telegram message log cleared. Call it in beforeEach.
export function useFreshDatabase() {
    const database = createFixtureDatabase();
    useDatabase(database);
    clearTelegramMessages();
    return database;
}

// The builder calls of every recorded query on a table, as
// [[method, ...args], ...] lists, for easy assertions.
export function callsOn(database, table) {
    return database.queriesOn(table).map((query) =>
        query.calls.map((call) => [call.method, ...call.args])
    );
}
