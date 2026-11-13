// GET  → list queues for an event (?event_id=...), or the caller's own queues (?mine=1)
// POST → create a queue (event editor or admin)
import { supabase } from '../_supabase.js';
import { handleCors, requireAuth, randomCode } from '../_auth.js';

async function canEditEvent(userId, eventId, isAdmin) {
    if (isAdmin) {
        return true;
    }
    const { data: editorRow } = await supabase
        .from('gftvqueue_event_editors')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .maybeSingle();
    return Boolean(editorRow);
}

// Picks the list or create function by method. GET needs ?mine=1 or
// ?event_id=...
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    if (request.method === 'GET') {
        const eventId = request.query.event_id;
        const mine = request.query.mine;

        // ?mine=1 → only the queues the caller can operate or administer
        if (mine === '1') {
            return listMyQueues(user, response);
        }

        if (!eventId) {
            return response.status(400).json({ error: 'event_id is required' });
        }
        return listEventQueues(user, eventId, response);
    }

    if (request.method === 'POST') {
        return createQueue(user, request, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// GET ?mine=1: the queues the caller can operate or administer, for the
// dashboard's My Queues view. A superadmin gets every queue (they can operate
// all of them); anyone else gets the queues they have a permission row for.
// Each queue carries what the view shows: its event's name and access code
// (for the Display link and live counts) and whether the caller is its queue
// admin.
async function listMyQueues(user, response) {
    const columns = 'id, event_id, name, status, access_code, max_serving, gftvqueue_events(name, access_code)';
    let rows = [];
    const adminByQueue = {};

    if (user.is_admin) {
        const { data: allQueues, error } = await supabase
            .from('gftvqueue_queues')
            .select(columns)
            .order('created_at', { ascending: true });
        if (error) {
            return response.status(500).json({ error: error.message });
        }
        if (allQueues) {
            rows = allQueues;
        }
    } else {
        const {
            data: permissions,
            error: permissionsError
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .select('queue_id, is_queue_admin')
            .eq('user_id', user.id);
        if (permissionsError) {
            return response.status(500).json({ error: permissionsError.message });
        }
        if (!permissions || permissions.length === 0) {
            return response.status(200).json({ queues: [] });
        }

        for (const permission of permissions) {
            adminByQueue[permission.queue_id] = permission.is_queue_admin === true;
        }

        const { data: permittedQueues, error } = await supabase
            .from('gftvqueue_queues')
            .select(columns)
            .in('id', permissions.map((permission) => permission.queue_id))
            .order('created_at', { ascending: true });
        if (error) {
            return response.status(500).json({ error: error.message });
        }
        if (permittedQueues) {
            rows = permittedQueues;
        }
    }

    const queues = rows.map((row) => myQueueCard(row, user, adminByQueue));

    return response.status(200).json({ queues: queues });
}

// One queue as the My Queues view shows it. A superadmin is queue admin of
// every queue; anyone else only where their permission row says so.
function myQueueCard(row, user, adminByQueue) {
    let eventName = null;
    let eventAccessCode = null;
    if (row.gftvqueue_events) {
        eventName = row.gftvqueue_events.name;
        eventAccessCode = row.gftvqueue_events.access_code;
    }
    let isQueueAdmin = true;
    if (!user.is_admin) {
        isQueueAdmin = adminByQueue[row.id] === true;
    }
    return {
        id: row.id,
        event_id: row.event_id,
        name: row.name,
        status: row.status,
        access_code: row.access_code,
        max_serving: row.max_serving,
        event_name: eventName,
        event_access_code: eventAccessCode,
        is_queue_admin: isQueueAdmin,
    };
}

// GET ?event_id=...: a superadmin or an editor of the event gets every queue
// in it, with access codes. Staff see only the queues in this event they're
// assigned to, without access codes. Anyone else gets 403.
async function listEventQueues(user, eventId, response) {
    // No page calls this list today (the event page gets its queues from
    // GET /api/events/:id), so it sends only what that page's queue cards
    // show (rule F2).
    const isEditor = await canEditEvent(user.id, eventId, user.is_admin);
    if (isEditor) {
        const { data: eventQueues, error } = await supabase
            .from('gftvqueue_queues')
            .select('id, name, status, access_code, max_serving')
            .eq('event_id', eventId)
            .order('created_at', { ascending: true });

        if (error) {
            return response.status(500).json({ error: error.message });
        }
        let queues = [];
        if (eventQueues) {
            queues = eventQueues;
        }
        return response.status(200).json({ queues: queues });
    }

    const { data: permissions } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('queue_id')
        .eq('user_id', user.id);
    let permissionRows = [];
    if (permissions) {
        permissionRows = permissions;
    }
    const queueIds = permissionRows.map((permission) => permission.queue_id);
    if (queueIds.length === 0) {
        return response.status(403).json({ error: 'No access to this event' });
    }

    const { data: assignedQueues, error } = await supabase
        .from('gftvqueue_queues')
        .select('id, name, status, max_serving')
        .eq('event_id', eventId)
        .in('id', queueIds)
        .order('created_at', { ascending: true });

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    if (!assignedQueues || assignedQueues.length === 0) {
        return response.status(403).json({ error: 'No access to this event' });
    }
    return response.status(200).json({ queues: assignedQueues });
}

// ── POST: create queue ────────────────────────────────────────────────────────

// Creates a queue in an event the caller edits (or any event, for a
// superadmin), with a fresh access code, and makes the caller its queue admin.
async function createQueue(user, request, response) {
    let body = {};
    if (request.body) {
        body = request.body;
    }
    const eventId = body.event_id;
    const name = body.name;
    const description = body.description;
    const maxServing = body.max_serving;
    if (!eventId || !name) {
        return response.status(400).json({ error: 'event_id and name are required' });
    }

    // Check permission
    const allowed = await canEditEvent(user.id, eventId, user.is_admin);
    if (!allowed) {
        return response.status(403).json({ error: 'You are not an editor for this event' });
    }

    // Generate unique 8-char access code for this queue
    let accessCode;
    let attempts = 0;
    while (attempts < 10) {
        accessCode = randomCode(8);
        const { data: existing } = await supabase
            .from('gftvqueue_queues')
            .select('id').eq('access_code', accessCode).maybeSingle();
        if (!existing) {
            break;
        }
        attempts++;
    }

    let queueDescription = null;
    if (description) {
        queueDescription = description;
    }
    let queueMaxServing = 30;
    if (maxServing) {
        queueMaxServing = maxServing;
    }

    // Only the new queue's id is read back, for the permission row below.
    const { data: queue, error } = await supabase
        .from('gftvqueue_queues')
        .insert({
            event_id: eventId,
            name: name,
            description: queueDescription,
            max_serving: queueMaxServing,
            access_code: accessCode,
            created_by: user.id,
        })
        .select('id')
        .single();

    if (error) {
        return response.status(500).json({ error: error.message });
    }

    // Creator auto-gets queue admin permission
    await supabase.from('gftvqueue_queue_permissions').insert({
        queue_id: queue.id,
        user_id: user.id,
        is_queue_admin: true,
        granted_by: user.id,
    });

    // The event page reloads and reads nothing back (rule F2).
    return response.status(201).json({ ok: true });
}
