// GET  → list events (admin sees all; editors see assigned)
// POST → create event (admin only)
import { supabase } from '../_supabase.js';
import { handleCors, requireAuth, randomCode } from '../_auth.js';

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    if (request.method === 'GET') {
        return listEvents(user, response);
    }
    if (request.method === 'POST') {
        return createEvent(user, request, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// ── GET: list events ──────────────────────────────────────────────────────────

// Only what the events page shows (rule F2): the id its buttons send, the
// name, status, venue, date and access code. Newest first.
async function listEvents(user, response) {
    let query = supabase
        .from('gftvqueue_events')
        .select('id, name, venue, event_date, status, access_code');

    if (!user.is_admin) {
        // editors only see their assigned events
        const { data: assigned } = await supabase
            .from('gftvqueue_event_editors')
            .select('event_id')
            .eq('user_id', user.id);
        let assignments = [];
        if (assigned) {
            assignments = assigned;
        }
        const eventIds = assignments.map((assignment) => assignment.event_id);
        if (eventIds.length === 0) {
            return response.status(200).json({ events: [] });
        }
        query = query.in('id', eventIds);
    }

    const { data: events, error } = await query.order('created_at', { ascending: false });
    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ events: events });
}

// ── POST: create event (admin only) ───────────────────────────────────────────

// Creates an event with a fresh access code.
async function createEvent(user, request, response) {
    if (!user.is_admin) {
        return response.status(403).json({ error: 'Admin access required' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const name = body.name;
    const description = body.description;
    const venue = body.venue;
    const eventDate = body.event_date;
    if (!name) {
        return response.status(400).json({ error: 'Event name is required' });
    }

    // Generate unique 8-char access code
    let accessCode;
    let attempts = 0;
    while (attempts < 10) {
        accessCode = randomCode(8);
        const { data: existing } = await supabase
            .from('gftvqueue_events')
            .select('id').eq('access_code', accessCode).maybeSingle();
        if (!existing) {
            break;
        }
        attempts++;
    }

    let savedEventDate = null;
    if (eventDate) {
        savedEventDate = eventDate;
    }

    const { error } = await supabase
        .from('gftvqueue_events')
        .insert({
            name: name,
            description: description,
            venue: venue,
            event_date: savedEventDate,
            access_code: accessCode,
            created_by: user.id
        });

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    // The events page reloads its list and reads nothing back (rule F2).
    return response.status(201).json({ ok: true });
}
