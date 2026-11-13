// GET    → get single event
// PUT    → update event (admin only)
// DELETE → delete event (admin only)
import { supabase } from '../_supabase.js';
import { handleCors, requireAuth } from '../_auth.js';

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    const { eventId } = request.query;

    if (request.method === 'GET') {
        return getEvent(user, eventId, response);
    }
    if (request.method === 'PUT') {
        return updateEvent(user, eventId, request, response);
    }
    if (request.method === 'DELETE') {
        return deleteEvent(user, eventId, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// ── GET ───────────────────────────────────────────────────────────────────────

// The event page: the event's details, its editors and every queue in it.
// It's only for a superadmin or an editor of this event. No page shows it
// to anyone else.
async function getEvent(user, eventId, response) {
    if (!user.is_admin) {
        const { data: editorRow } = await supabase
            .from('gftvqueue_event_editors')
            .select('id')
            .eq('event_id', eventId)
            .eq('user_id', user.id)
            .maybeSingle();
        if (!editorRow) {
            return response.status(403).json({ error: 'Event editor access required' });
        }
    }

    // Only what the event page shows (rule F2). Its buttons use the
    // event id from the URL, so the id isn't sent back.
    const { data: event, error } = await supabase
        .from('gftvqueue_events')
        .select('name, status, venue, event_date, access_code')
        .eq('id', eventId)
        .single();

    if (error || !event) {
        return response.status(404).json({ error: 'Event not found' });
    }

    // Get editors for this event: each one's name and username, and the
    // user_id the Remove button sends.
    const { data: editors } = await supabase
        .from('gftvqueue_event_editors')
        .select('user_id, gftvhello_users(username, display_name)')
        .eq('event_id', eventId);

    // Get queues: what each queue card shows, and the id its Operate
    // button sends.
    const { data: queues } = await supabase
        .from('gftvqueue_queues')
        .select('id, name, status, access_code, max_serving')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true });

    let editorList = [];
    if (editors) {
        editorList = editors;
    }
    let queueList = [];
    if (queues) {
        queueList = queues;
    }

    return response.status(200).json({
        event: event,
        editors: editorList,
        queues: queueList
    });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

// Changes only the fields sent: name, description, venue, event_date and
// status.
async function updateEvent(user, eventId, request, response) {
    if (!user.is_admin) {
        return response.status(403).json({ error: 'Admin access required' });
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
    if (body.venue !== undefined) {
        updates.venue = body.venue;
    }
    if (body.event_date !== undefined) {
        updates.event_date = body.event_date;
    }
    if (body.status !== undefined) {
        updates.status = body.status;
    }

    // .select('id').single() keeps the error for an event that doesn't
    // exist. The events page reads nothing back (rule F2).
    const { error } = await supabase
        .from('gftvqueue_events')
        .update(updates)
        .eq('id', eventId)
        .select('id')
        .single();

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ ok: true });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

async function deleteEvent(user, eventId, response) {
    if (!user.is_admin) {
        return response.status(403).json({ error: 'Admin access required' });
    }

    const { error } = await supabase.from('gftvqueue_events').delete().eq('id', eventId);
    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ message: 'Event deleted' });
}
