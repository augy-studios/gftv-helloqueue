// A fake of the parts of @supabase/supabase-js that the API uses.
//
// The test hooks (tests/support/hooks.cjs) make every
// `import { createClient } from '@supabase/supabase-js'` load this file
// instead, so api/_supabase.js gets a fake client without any change to the
// app code. Nothing here touches the network.
//
// How it behaves:
// - Queries run against an in-memory database of plain rows (see
//   createDatabase), filtered, ordered, limited and projected the way
//   PostgREST does it, so handlers see realistic results.
// - Every query is recorded: the table, each builder call in order
//   (.select(), .eq(), .order() and so on) and the result. Tests read these
//   from database.queries to check what a handler asked for.
// - Unknown tables or columns, ambiguous embeds, .single() on zero or several
//   rows and broken unique keys fail with the same error codes PostgREST uses.

const { randomBytes } = require('node:crypto');
const { TABLE_COLUMNS, FOREIGN_KEYS, UNIQUE_KEYS } = require('./tables.cjs');

const STUB_SUPABASE_URL = 'https://fake-supabase.test.invalid';

// The current database lives on globalThis rather than in this module, so it
// is shared even if a test runner loads this file twice (once through
// require() and once through import).
const STATE_KEY = Symbol.for('helloqueue.tests.fakeSupabase');
if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = { database: null };
}
const state = globalThis[STATE_KEY];

function useDatabase(database) {
    state.database = database;
}

function currentDatabase() {
    return state.database;
}

// Stand-in for supabase-js createClient. The database is looked up on every
// .from() call, because api/_supabase.js creates its client once at import
// time, before any test has chosen a database.
function createClient(url) {
    if (url !== STUB_SUPABASE_URL) {
        throw new Error(
            `fake createClient got SUPABASE_URL "${url}". The tests must run with the stub URL; ` +
            'load tests/support/setup.cjs first.'
        );
    }
    return {
        from(table) {
            if (!state.database) {
                throw new Error('No fake database in use. Call useDatabase(createFixtureDatabase()) first.');
            }
            return new QueryBuilder(state.database, table);
        },
        rpc(name) {
            throw new Error(`fake Supabase does not support rpc("${name}")`);
        },
    };
}

// ── The database ────────────────────────────────────────────────────────────

// Builds an in-memory database. `seed` maps table names to arrays of rows;
// any column a row leaves out is null. A seed row with a column the table
// doesn't have throws, to catch typos in fixtures.
function createDatabase(seed = {}) {
    const tables = {};
    for (const table of Object.keys(TABLE_COLUMNS)) {
        tables[table] = [];
    }
    for (const [table, rows] of Object.entries(seed)) {
        if (!TABLE_COLUMNS[table]) {
            throw new Error(`Fixture uses unknown table "${table}"`);
        }
        for (const row of rows) {
            for (const column of Object.keys(row)) {
                if (!TABLE_COLUMNS[table].includes(column)) {
                    throw new Error(`Fixture row for ${table} has unknown column "${column}"`);
                }
            }
            tables[table].push(fillRow(table, row));
        }
    }

    const database = {
        tables,
        queries: [],
        nextId: 1,
        // Every recorded query on one table, in order.
        queriesOn(table) {
            return this.queries.filter((query) => query.table === table);
        },
        // A copy of every row in a table.
        rows(table) {
            return structuredClone(this.tables[table]);
        },
        // A copy of the row with this id, or null.
        row(table, id) {
            const found = this.tables[table].find((row) => row.id === id);
            if (!found) {
                return null;
            }
            return structuredClone(found);
        },
    };
    return database;
}

function fillRow(table, values) {
    const row = {};
    for (const column of TABLE_COLUMNS[table]) {
        row[column] = null;
    }
    return Object.assign(row, structuredClone(values));
}

// Column defaults from schema.sql, plus assumed defaults for the two tables
// that aren't in it.
function defaultsFor(table, database) {
    const now = new Date().toISOString();
    const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const id = generatedId(database);
    switch (table) {
        case 'gftvhello_users':
            return { id, is_admin: false, is_approved: false, is_editor: false, created_at: now };
        case 'gftvhello_sessions':
            return { id, created_at: now };
        case 'gftvqueue_events':
            return { id, status: 'draft', created_at: now, updated_at: now };
        case 'gftvqueue_event_editors':
            return { id, assigned_at: now };
        case 'gftvqueue_queues':
            return { id, status: 'closed', max_serving: 30, created_at: now, updated_at: now };
        case 'gftvqueue_queue_permissions':
            return { id, is_queue_admin: false, granted_at: now };
        case 'gftvqueue_entries':
            return { id, status: 'waiting', notify_serving: true, notify_next: true, joined_at: now };
        case 'gftvqueue_entry_tokens':
            return { id, token: randomBytes(32).toString('hex'), created_at: now };
        case 'gftvqueue_telegram_links':
            return { id, linked_at: now };
        case 'gftvqueue_telegram_otps':
            return { id, expires_at: tenMinutesFromNow };
        case 'gftvqueue_attendee_login_codes':
            // Assumed: the table isn't in schema.sql.
            return { id, expires_at: tenMinutesFromNow, created_at: now };
        case 'gftvqueue_attendee_sessions':
            // Assumed: the table isn't in schema.sql.
            return {
                id,
                token: randomBytes(32).toString('hex'),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                created_at: now,
            };
        default:
            return { id };
    }
}

function generatedId(database) {
    const counter = String(database.nextId).padStart(12, '0');
    database.nextId += 1;
    return `00000000-0000-4000-9000-${counter}`;
}

// Tables with an updated_at trigger in schema.sql.
const UPDATED_AT_TABLES = ['gftvqueue_events', 'gftvqueue_queues'];

// ── Errors ──────────────────────────────────────────────────────────────────

function failure(status, code, message, details = null) {
    return {
        data: null,
        error: { code, message, details, hint: null },
        count: null,
        status,
        statusText: 'Error',
    };
}

class QueryError extends Error {
    constructor(result) {
        super(result.error.message);
        this.result = result;
    }
}

function unknownColumn(table, column) {
    return new QueryError(failure(400, '42703', `column ${table}.${column} does not exist`));
}

// ── Query builder ───────────────────────────────────────────────────────────

const FILTER_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in'];

class QueryBuilder {
    constructor(database, table) {
        this.database = database;
        this.table = table;
        this.action = 'select';
        this.payload = undefined;
        this.upsertOptions = {};
        this.columns = '*';
        this.selectOptions = {};
        this.returning = false;
        this.filters = [];
        this.orders = [];
        this.limitCount = null;
        this.rangeFrom = null;
        this.singleMode = null;
        this.record = { table, calls: [], result: null };
        database.queries.push(this.record);
    }

    recordCall(method, args) {
        this.record.calls.push({ method, args: structuredClone(args) });
        return this;
    }

    select(columns = '*', options = {}) {
        this.recordCall('select', [columns, options]);
        this.columns = columns;
        if (this.action === 'select') {
            this.selectOptions = options || {};
        } else {
            this.returning = true;
        }
        return this;
    }

    insert(values, options) {
        this.recordCall('insert', [values, options]);
        this.action = 'insert';
        this.payload = values;
        return this;
    }

    update(values) {
        this.recordCall('update', [values]);
        this.action = 'update';
        this.payload = values;
        return this;
    }

    delete() {
        this.recordCall('delete', []);
        this.action = 'delete';
        return this;
    }

    upsert(values, options = {}) {
        this.recordCall('upsert', [values, options]);
        this.action = 'upsert';
        this.payload = values;
        this.upsertOptions = options || {};
        return this;
    }

    eq(column, value) { return this.addFilter('eq', column, value); }
    neq(column, value) { return this.addFilter('neq', column, value); }
    gt(column, value) { return this.addFilter('gt', column, value); }
    gte(column, value) { return this.addFilter('gte', column, value); }
    lt(column, value) { return this.addFilter('lt', column, value); }
    lte(column, value) { return this.addFilter('lte', column, value); }
    like(column, value) { return this.addFilter('like', column, value); }
    ilike(column, value) { return this.addFilter('ilike', column, value); }
    is(column, value) { return this.addFilter('is', column, value); }
    in(column, values) { return this.addFilter('in', column, values); }

    addFilter(operator, column, value) {
        this.recordCall(operator, [column, value]);
        this.filters.push({ column, operator, value, negate: false });
        return this;
    }

    not(column, operator, value) {
        this.recordCall('not', [column, operator, value]);
        this.filters.push({ column, operator, value, negate: true });
        return this;
    }

    filter(column, operator, value) {
        this.recordCall('filter', [column, operator, value]);
        let negate = false;
        let plainOperator = operator;
        if (operator.startsWith('not.')) {
            negate = true;
            plainOperator = operator.slice(4);
        }
        this.filters.push({ column, operator: plainOperator, value, negate });
        return this;
    }

    match(values) {
        this.recordCall('match', [values]);
        for (const [column, value] of Object.entries(values)) {
            this.filters.push({ column, operator: 'eq', value, negate: false });
        }
        return this;
    }

    // Supports the flat form the API uses: "a.eq.1,b.eq.2".
    or(expression) {
        this.recordCall('or', [expression]);
        const alternatives = String(expression).split(',').map((part) => {
            const [column, operator, ...rest] = part.split('.');
            return { column, operator, value: rest.join('.'), negate: false };
        });
        this.filters.push({ or: alternatives });
        return this;
    }

    order(column, options = {}) {
        this.recordCall('order', [column, options]);
        let ascending = true;
        if (options && options.ascending === false) {
            ascending = false;
        }
        this.orders.push({ column, ascending });
        return this;
    }

    limit(count) {
        this.recordCall('limit', [count]);
        this.limitCount = count;
        return this;
    }

    range(from, to) {
        this.recordCall('range', [from, to]);
        this.rangeFrom = from;
        this.limitCount = to - from + 1;
        return this;
    }

    single() {
        this.recordCall('single', []);
        this.singleMode = 'single';
        return this;
    }

    maybeSingle() {
        this.recordCall('maybeSingle', []);
        this.singleMode = 'maybeSingle';
        return this;
    }

    // Builders are awaited directly, like supabase-js builders.
    then(onFulfilled, onRejected) {
        return Promise.resolve()
            .then(() => this.execute())
            .then(onFulfilled, onRejected);
    }

    catch(onRejected) {
        return this.then(undefined, onRejected);
    }

    execute() {
        let result;
        try {
            result = this.run();
        } catch (error) {
            if (error instanceof QueryError) {
                result = error.result;
            } else {
                throw error;
            }
        }
        this.record.result = structuredClone(result);
        return result;
    }

    run() {
        if (!TABLE_COLUMNS[this.table]) {
            throw new QueryError(failure(404, '42P01', `relation "public.${this.table}" does not exist`));
        }
        this.checkFilterColumns();
        const plan = planSelect(this.table, this.columns);

        if (this.action === 'select') {
            return this.runSelect(plan);
        }
        if (this.action === 'insert') {
            return this.runInsert(plan);
        }
        if (this.action === 'update') {
            return this.runUpdate(plan);
        }
        if (this.action === 'delete') {
            return this.runDelete(plan);
        }
        return this.runUpsert(plan);
    }

    checkFilterColumns() {
        const columns = TABLE_COLUMNS[this.table];
        for (const filter of this.filters) {
            let parts = [filter];
            if (filter.or) {
                parts = filter.or;
            }
            for (const part of parts) {
                if (!columns.includes(part.column)) {
                    throw unknownColumn(this.table, part.column);
                }
                if (!FILTER_OPERATORS.includes(part.operator)) {
                    throw new QueryError(failure(400, 'PGRST100', `unsupported operator "${part.operator}" in the fake`));
                }
            }
        }
        for (const order of this.orders) {
            if (!columns.includes(order.column)) {
                throw unknownColumn(this.table, order.column);
            }
        }
    }

    matchingRows() {
        return this.database.tables[this.table].filter((row) => rowMatches(row, this.filters));
    }

    runSelect(plan) {
        const matching = this.matchingRows();
        const ordered = sortRows(matching, this.orders);
        let start = 0;
        if (this.rangeFrom !== null) {
            start = this.rangeFrom;
        }
        let limited = ordered.slice(start);
        if (this.limitCount !== null) {
            limited = limited.slice(0, this.limitCount);
        }
        let count = null;
        if (this.selectOptions.count) {
            count = matching.length;
        }
        if (this.selectOptions.head) {
            return { data: null, error: null, count, status: 200, statusText: 'OK' };
        }
        const rows = limited.map((row) => projectRow(this.database, this.table, row, plan));
        return this.finish(rows, count, 200);
    }

    runInsert(plan) {
        let values = [this.payload];
        if (Array.isArray(this.payload)) {
            values = this.payload;
        }
        const newRows = values.map((value) => this.buildNewRow(value));
        for (const [index, row] of newRows.entries()) {
            const others = this.database.tables[this.table].concat(newRows.slice(0, index));
            checkUnique(this.table, row, others);
        }
        this.database.tables[this.table].push(...newRows);
        return this.mutationResult(plan, newRows, 201);
    }

    buildNewRow(value) {
        this.checkPayloadColumns(value);
        return fillRow(this.table, { ...defaultsFor(this.table, this.database), ...value });
    }

    checkPayloadColumns(value) {
        for (const column of Object.keys(value)) {
            if (!TABLE_COLUMNS[this.table].includes(column)) {
                throw new QueryError(failure(
                    400,
                    'PGRST204',
                    `Could not find the '${column}' column of '${this.table}' in the schema cache`
                ));
            }
        }
    }

    runUpdate(plan) {
        this.checkPayloadColumns(this.payload);
        const targets = this.matchingRows();
        for (const row of targets) {
            Object.assign(row, structuredClone(this.payload));
            if (UPDATED_AT_TABLES.includes(this.table)) {
                row.updated_at = new Date().toISOString();
            }
        }
        return this.mutationResult(plan, targets, 200);
    }

    runDelete(plan) {
        const targets = this.matchingRows();
        this.database.tables[this.table] = this.database.tables[this.table].filter(
            (row) => !targets.includes(row)
        );
        return this.mutationResult(plan, targets, 200);
    }

    runUpsert(plan) {
        let values = [this.payload];
        if (Array.isArray(this.payload)) {
            values = this.payload;
        }
        let conflictColumns = ['id'];
        if (this.upsertOptions.onConflict) {
            conflictColumns = this.upsertOptions.onConflict.split(',').map((column) => column.trim());
        }
        const touched = [];
        for (const value of values) {
            this.checkPayloadColumns(value);
            const existing = this.database.tables[this.table].find((row) =>
                conflictColumns.every((column) => sameValue(row[column], value[column]))
            );
            if (existing) {
                Object.assign(existing, structuredClone(value));
                touched.push(existing);
            } else {
                const row = this.buildNewRow(value);
                checkUnique(this.table, row, this.database.tables[this.table]);
                this.database.tables[this.table].push(row);
                touched.push(row);
            }
        }
        return this.mutationResult(plan, touched, 201);
    }

    // Without .select() supabase-js v2 returns data: null for writes.
    mutationResult(plan, rows, status) {
        if (!this.returning) {
            return { data: null, error: null, count: null, status, statusText: 'OK' };
        }
        const projected = rows.map((row) => projectRow(this.database, this.table, row, plan));
        return this.finish(projected, null, status);
    }

    finish(rows, count, status) {
        if (this.singleMode === null) {
            return { data: rows, error: null, count, status, statusText: 'OK' };
        }
        if (rows.length === 1) {
            return { data: rows[0], error: null, count, status, statusText: 'OK' };
        }
        if (rows.length === 0 && this.singleMode === 'maybeSingle') {
            return { data: null, error: null, count, status, statusText: 'OK' };
        }
        return failure(
            406,
            'PGRST116',
            'JSON object requested, multiple (or no) rows returned',
            `The result contains ${rows.length} rows`
        );
    }
}

// ── Filtering and ordering ──────────────────────────────────────────────────

function isMissing(value) {
    return value === null || value === undefined;
}

// PostgREST compares through text in the URL, so 7001 and "7001" are equal.
function sameValue(left, right) {
    if (isMissing(left) || isMissing(right)) {
        return isMissing(left) && isMissing(right);
    }
    return String(left) === String(right);
}

function isNumeric(value) {
    if (typeof value === 'number') {
        return true;
    }
    return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value));
}

function compareValues(left, right) {
    if (isNumeric(left) && isNumeric(right)) {
        return Number(left) - Number(right);
    }
    const leftText = String(left);
    const rightText = String(right);
    if (leftText < rightText) {
        return -1;
    }
    if (leftText > rightText) {
        return 1;
    }
    return 0;
}

// Turns '("completed")' or '(a,b)' into ['completed'] or ['a', 'b'].
function parseList(value) {
    if (Array.isArray(value)) {
        return value;
    }
    return String(value)
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((item) => item.trim().replace(/^"(.*)"$/, '$1'));
}

function likeToRegExp(pattern, flags) {
    const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const translated = escaped.replace(/%/g, '.*').replace(/_/g, '.');
    return new RegExp(`^${translated}$`, flags);
}

function operatorMatches(operator, cell, value) {
    switch (operator) {
        case 'eq':
            return sameValue(cell, value);
        case 'neq':
            return !isMissing(cell) && !sameValue(cell, value);
        case 'gt':
            return !isMissing(cell) && compareValues(cell, value) > 0;
        case 'gte':
            return !isMissing(cell) && compareValues(cell, value) >= 0;
        case 'lt':
            return !isMissing(cell) && compareValues(cell, value) < 0;
        case 'lte':
            return !isMissing(cell) && compareValues(cell, value) <= 0;
        case 'like':
            return !isMissing(cell) && likeToRegExp(value, '').test(String(cell));
        case 'ilike':
            return !isMissing(cell) && likeToRegExp(value, 'i').test(String(cell));
        case 'is':
            if (value === null || value === 'null') {
                return isMissing(cell);
            }
            return String(cell) === String(value);
        case 'in':
            return parseList(value).some((item) => sameValue(cell, item));
        default:
            throw new Error(`fake Supabase: unsupported operator ${operator}`);
    }
}

function filterMatches(row, filter) {
    if (filter.or) {
        return filter.or.some((part) => filterMatches(row, part));
    }
    const cell = row[filter.column];
    const result = operatorMatches(filter.operator, cell, filter.value);
    if (filter.negate) {
        // SQL: NOT (NULL = x) is NULL, which filters the row out.
        if (isMissing(cell) && filter.operator !== 'is') {
            return false;
        }
        return !result;
    }
    return result;
}

function rowMatches(row, filters) {
    return filters.every((filter) => filterMatches(row, filter));
}

// Postgres puts nulls last when ascending and first when descending.
function sortRows(rows, orders) {
    const sorted = [...rows];
    sorted.sort((left, right) => {
        for (const order of orders) {
            const leftValue = left[order.column];
            const rightValue = right[order.column];
            let difference = 0;
            if (isMissing(leftValue) && isMissing(rightValue)) {
                difference = 0;
            } else if (isMissing(leftValue)) {
                difference = 1;
            } else if (isMissing(rightValue)) {
                difference = -1;
            } else {
                difference = compareValues(leftValue, rightValue);
            }
            if (!order.ascending) {
                difference = -difference;
            }
            if (difference !== 0) {
                return difference;
            }
        }
        return 0;
    });
    return sorted;
}

function checkUnique(table, row, existingRows) {
    const keys = UNIQUE_KEYS[table] || [];
    for (const key of keys) {
        const clash = existingRows.find((other) =>
            other !== row && key.every((column) => !isMissing(row[column]) && sameValue(other[column], row[column]))
        );
        if (clash) {
            throw new QueryError(failure(
                409,
                '23505',
                `duplicate key value violates unique constraint on ${table} (${key.join(', ')})`
            ));
        }
    }
}

// ── Select strings and embeds ───────────────────────────────────────────────

// Splits "a, b(c, d), e" at the commas that aren't inside brackets.
function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const character of text) {
        if (character === '(') {
            depth += 1;
        }
        if (character === ')') {
            depth -= 1;
        }
        if (character === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    parts.push(current);
    return parts.map((part) => part.trim()).filter((part) => part !== '');
}

// Turns a select string into a checked plan, or throws the PostgREST error
// the real query would give: unknown column (42703), no relationship
// (PGRST200) or more than one relationship (PGRST201).
function planSelect(table, columns) {
    let text = '*';
    if (typeof columns === 'string' && columns.trim() !== '') {
        text = columns;
    }
    return splitTopLevel(text).map((item) => planItem(table, item));
}

function planItem(table, item) {
    if (item === '*') {
        return { kind: 'star' };
    }
    const bracket = item.indexOf('(');
    if (bracket === -1) {
        let alias = null;
        let name = item;
        if (item.includes(':')) {
            [alias, name] = item.split(':').map((part) => part.trim());
        }
        if (!TABLE_COLUMNS[table].includes(name)) {
            throw unknownColumn(table, name);
        }
        let key = name;
        if (alias) {
            key = alias;
        }
        return { kind: 'column', name, key };
    }

    let head = item.slice(0, bracket).trim();
    const inner = item.slice(bracket + 1, item.lastIndexOf(')'));
    let alias = null;
    if (head.includes(':')) {
        [alias, head] = head.split(':').map((part) => part.trim());
    }
    let hint = null;
    let related = head;
    if (head.includes('!')) {
        [related, hint] = head.split('!').map((part) => part.trim());
    }
    if (!TABLE_COLUMNS[related]) {
        throw new QueryError(failure(
            400,
            'PGRST200',
            `Could not find a relationship between '${table}' and '${related}' in the schema cache`
        ));
    }
    let candidates = FOREIGN_KEYS.filter((key) =>
        (key.table === table && key.references === related) ||
        (key.table === related && key.references === table)
    );
    if (hint) {
        candidates = candidates.filter((key) => key.column === hint);
    }
    if (candidates.length === 0) {
        throw new QueryError(failure(
            400,
            'PGRST200',
            `Could not find a relationship between '${table}' and '${related}' in the schema cache`
        ));
    }
    if (candidates.length > 1) {
        throw new QueryError(failure(
            300,
            'PGRST201',
            `Could not embed because more than one relationship was found for '${table}' and '${related}'`
        ));
    }
    const foreignKey = candidates[0];
    let key = related;
    if (alias) {
        key = alias;
    }
    return {
        kind: 'embed',
        key,
        related,
        foreignKey,
        manyToOne: foreignKey.table === table,
        plan: planSelect(related, inner),
    };
}

function projectRow(database, table, row, plan) {
    const output = {};
    for (const item of plan) {
        if (item.kind === 'star') {
            for (const column of TABLE_COLUMNS[table]) {
                output[column] = structuredClone(row[column]);
            }
        } else if (item.kind === 'column') {
            output[item.key] = structuredClone(row[item.name]);
        } else if (item.manyToOne) {
            const parent = database.tables[item.related].find((candidate) =>
                sameValue(candidate.id, row[item.foreignKey.column])
            );
            if (parent) {
                output[item.key] = projectRow(database, item.related, parent, item.plan);
            } else {
                output[item.key] = null;
            }
        } else {
            output[item.key] = database.tables[item.related]
                .filter((candidate) => sameValue(candidate[item.foreignKey.column], row.id))
                .map((child) => projectRow(database, item.related, child, item.plan));
        }
    }
    return output;
}

module.exports = { STUB_SUPABASE_URL, useDatabase, currentDatabase, createClient, createDatabase };
