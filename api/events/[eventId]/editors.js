// GET    → list editors for an event
// POST   → assign an editor to an event (admin only)
// DELETE → remove an editor from an event (admin only)
import { supabase } from '../../_supabase.js';
import { handleCors, requireAuth } from '../../_auth.js';

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
        return listEditors(user, eventId, response);
    }
    if (request.method === 'POST') {
        return addEditor(user, eventId, request, response);
    }
    if (request.method === 'DELETE') {
        return removeEditor(user, eventId, request, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// Only people who manage this event (a superadmin or one of its editors) may
// list its editors.
async function listEditors(user, eventId, response) {
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

    // No page calls this list today. It sends what the event page's own
    // editor list shows: each editor's name and username, and the user_id
    // its Remove button sends. Never emails (rule F2).
    // The embed names user_id: the table has two keys to gftvhello_users.
    const { data: editors, error } = await supabase
        .from('gftvqueue_event_editors')
        .select('user_id, gftvhello_users!user_id(username, display_name)')
        .eq('event_id', eventId);

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    let editorList = [];
    if (editors) {
        editorList = editors;
    }
    return response.status(200).json({ editors: editorList });
}

// Makes a user an editor of this event. Already an editor is a 409.
async function addEditor(user, eventId, request, response) {
    if (!user.is_admin) {
        return response.status(403).json({ error: 'Admin access required' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const editorUserId = body.user_id;
    if (!editorUserId) {
        return response.status(400).json({ error: 'user_id is required' });
    }

    const { error } = await supabase
        .from('gftvqueue_event_editors')
        .insert({
            event_id: eventId,
            user_id: editorUserId,
            assigned_by: user.id
        });

    if (error) {
        if (error.code === '23505') {
            return response.status(409).json({ error: 'User is already an editor for this event' });
        }
        return response.status(500).json({ error: error.message });
    }
    // The event page reloads and reads nothing back (rule F2).
    return response.status(201).json({ ok: true });
}

async function removeEditor(user, eventId, request, response) {
    if (!user.is_admin) {
        return response.status(403).json({ error: 'Admin access required' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const editorUserId = body.user_id;
    if (!editorUserId) {
        return response.status(400).json({ error: 'user_id is required' });
    }

    const { error } = await supabase
        .from('gftvqueue_event_editors')
        .delete()
        .eq('event_id', eventId)
        .eq('user_id', editorUserId);

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ message: 'Editor removed' });
}
