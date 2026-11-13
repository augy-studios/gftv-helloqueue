// GET    → the operator page's queue: details, entries and the caller's role
// PUT    → update queue settings (operators and queue admins)
// DELETE → delete the queue (queue admins)
import { supabase } from '../_supabase.js';
import { handleCors, requireAuth } from '../_auth.js';

// Whether the user may operate this queue, and whether they're its queue
// admin. A superadmin is both.
async function canOperateQueue(userId, queueId, isAdmin) {
    if (isAdmin) {
        return {
            allowed: true,
            isQueueAdmin: true
        };
    }
    const { data: permission } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('is_queue_admin')
        .eq('queue_id', queueId)
        .eq('user_id', userId)
        .maybeSingle();
    if (!permission) {
        return {
            allowed: false,
            isQueueAdmin: false
        };
    }
    return {
        allowed: true,
        isQueueAdmin: permission.is_queue_admin
    };
}

// How many finished entries the operator's Completed column lists, newest
// first (decision 4). The column shows the total from completedCount.
export const RECENT_COMPLETED_LIMIT = 5;

// What an operator's entry card shows (rule F2): the id its buttons send, the
// queue number, the name and the @username (decision 5).
function entryCardFields(entry) {
    return {
        id: entry.id,
        queue_number: entry.queue_number,
        display_name: entry.display_name,
        telegram_username: entry.telegram_username,
    };
}

// A called attendee's card also needs entered_at, to choose between the
// Confirm entrance and Exit buttons.
function servingCardFields(entry) {
    const fields = entryCardFields(entry);
    fields.entered_at = entry.entered_at;
    return fields;
}

async function isEventEditor(userId, eventId) {
    const { data: editorRow } = await supabase
        .from('gftvqueue_event_editors')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .maybeSingle();
    return Boolean(editorRow);
}

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    const { queueId } = request.query;

    if (request.method === 'GET') {
        return getQueue(user, queueId, response);
    }
    if (request.method === 'PUT') {
        return updateQueue(user, queueId, request, response);
    }
    if (request.method === 'DELETE') {
        return deleteQueue(user, queueId, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// ── GET ───────────────────────────────────────────────────────────────────────

// Sends only what the operator page shows (rule F2). event_id is read for
// the editor check and is not sent. Only a superadmin, an admin or operator
// of this queue, or an editor of the queue's event may read it.
async function getQueue(user, queueId, response) {
    const {
        data: queueRow,
        error
    } = await supabase
        .from('gftvqueue_queues')
        .select('event_id, name, status, access_code, max_serving, gftvqueue_events(access_code)')
        .eq('id', queueId)
        .single();

    if (error || !queueRow) {
        return response.status(404).json({ error: 'Queue not found' });
    }

    const { allowed, isQueueAdmin } = await canOperateQueue(user.id, queueId, user.is_admin);

    if (!allowed) {
        const isEditor = await isEventEditor(user.id, queueRow.event_id);
        if (!isEditor) {
            return response.status(403).json({ error: 'No access to this queue' });
        }
    }

    let eventAccessCode = null;
    if (queueRow.gftvqueue_events) {
        eventAccessCode = queueRow.gftvqueue_events.access_code;
    }
    const queue = {
        name: queueRow.name,
        status: queueRow.status,
        access_code: queueRow.access_code,
        max_serving: queueRow.max_serving,
        event_access_code: eventAccessCode,
    };

    const { entries, completedCount } = await loadOperatorEntries(queueId);

    return response.status(200).json({
        queue: queue,
        entries: entries,
        completedCount: completedCount,
        can_operate: allowed,
        is_queue_admin: isQueueAdmin
    });
}

// The operator page's four columns. Called, waiting and missed list every
// entry still in the queue, by number. Completed (decision 4) lists only the
// last RECENT_COMPLETED_LIMIT finished entries, newest first; completedCount
// is how many have finished in all.
async function loadOperatorEntries(queueId) {
    // Entries still in the queue: called, waiting and missed.
    const { data: activeEntries } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, status, display_name, telegram_username, entered_at')
        .eq('queue_id', queueId)
        .in('status', ['serving', 'waiting', 'missed'])
        .order('queue_number', { ascending: true });

    const { count: completedCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'completed');

    const { data: recentCompleted } = await supabase
        .from('gftvqueue_entries')
        .select('queue_number, display_name, telegram_username')
        .eq('queue_id', queueId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false, nullsFirst: false })
        .order('queue_number', { ascending: false })
        .limit(RECENT_COMPLETED_LIMIT);

    let rows = [];
    if (activeEntries) {
        rows = activeEntries;
    }
    let completedList = [];
    if (recentCompleted) {
        completedList = recentCompleted;
    }
    let finishedCount = 0;
    if (completedCount) {
        finishedCount = completedCount;
    }

    const grouped = {
        serving: rows.filter((entry) => entry.status === 'serving').map(servingCardFields),
        waiting: rows.filter((entry) => entry.status === 'waiting').map(entryCardFields),
        missed: rows.filter((entry) => entry.status === 'missed').map(entryCardFields),
        completed: completedList,
    };

    return { entries: grouped, completedCount: finishedCount };
}

// ── PUT: update queue settings ────────────────────────────────────────────────

// Changes only the settings sent: name, description, max_serving and status.
async function updateQueue(user, queueId, request, response) {
    const { allowed } = await canOperateQueue(user.id, queueId, user.is_admin);
    if (!allowed) {
        return response.status(403).json({ error: 'No permission to edit this queue' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const updates = {};
    if (body.name !== undefined) {
        updates.name = body.name;
    }
    if (body.description !== undefined) {
        updates.description = body.description;
    }
    if (body.max_serving !== undefined) {
        updates.max_serving = body.max_serving;
    }
    if (body.status !== undefined) {
        updates.status = body.status;
    }

    // .select('id').single() keeps the error for a queue that doesn't
    // exist. The page reads nothing back (rule F2).
    const { error } = await supabase
        .from('gftvqueue_queues')
        .update(updates)
        .eq('id', queueId)
        .select('id')
        .single();

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ ok: true });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

async function deleteQueue(user, queueId, response) {
    const { isQueueAdmin } = await canOperateQueue(user.id, queueId, user.is_admin);
    if (!isQueueAdmin) {
        return response.status(403).json({ error: 'Queue admin access required' });
    }

    const { error } = await supabase.from('gftvqueue_queues').delete().eq('id', queueId);
    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ message: 'Queue deleted' });
}
