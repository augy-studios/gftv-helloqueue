// GET    → get single event
// PUT    → update event (admin only)
// DELETE → delete event (admin only)
import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        eventId
    } = req.query;

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        // The event page (details, access codes, editors, every queue) is
        // only for a superadmin or an editor of this event. No page shows it
        // to anyone else.
        if (!user.is_admin) {
            const {
                data: editorRow
            } = await supabase
                .from('gftvqueue_event_editors')
                .select('id')
                .eq('event_id', eventId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (!editorRow) return res.status(403).json({
                error: 'Event editor access required'
            });
        }

        // Only what the event page shows (rule F2). Its buttons use the
        // event id from the URL, so the id isn't sent back.
        const {
            data: event,
            error
        } = await supabase
            .from('gftvqueue_events')
            .select('name, status, venue, event_date, access_code')
            .eq('id', eventId)
            .single();

        if (error || !event) return res.status(404).json({
            error: 'Event not found'
        });

        // Get editors for this event: each one's name and username, and the
        // user_id the Remove button sends.
        const {
            data: editors
        } = await supabase
            .from('gftvqueue_event_editors')
            .select('user_id, gftvhello_users(username, display_name)')
            .eq('event_id', eventId);

        // Get queues: what each queue card shows, and the id its Operate
        // button sends.
        const {
            data: queues
        } = await supabase
            .from('gftvqueue_queues')
            .select('id, name, status, access_code, max_serving')
            .eq('event_id', eventId)
            .order('created_at', {
                ascending: true
            });

        return res.status(200).json({
            event,
            editors: editors || [],
            queues: queues || []
        });
    }

    // ── PUT ───────────────────────────────────────────────────────────────────
    if (req.method === 'PUT') {
        if (!user.is_admin) return res.status(403).json({
            error: 'Admin access required'
        });

        const {
            name,
            description,
            venue,
            event_date,
            status
        } = req.body || {};
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (venue !== undefined) updates.venue = venue;
        if (event_date !== undefined) updates.event_date = event_date;
        if (status !== undefined) updates.status = status;

        // .select('id').single() keeps the error for an event that doesn't
        // exist. The events page reads nothing back (rule F2).
        const {
            error
        } = await supabase
            .from('gftvqueue_events')
            .update(updates)
            .eq('id', eventId)
            .select('id')
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            ok: true
        });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        if (!user.is_admin) return res.status(403).json({
            error: 'Admin access required'
        });

        const {
            error
        } = await supabase.from('gftvqueue_events').delete().eq('id', eventId);
        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            message: 'Event deleted'
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}