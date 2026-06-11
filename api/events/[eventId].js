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
        const {
            data: event,
            error
        } = await supabase
            .from('gftvqueue_events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (error || !event) return res.status(404).json({
            error: 'Event not found'
        });

        // Get editors for this event
        const {
            data: editors
        } = await supabase
            .from('gftvqueue_event_editors')
            .select('user_id, assigned_at, gftvhello_users(id, username, display_name)')
            .eq('event_id', eventId);

        // Get queues
        const {
            data: queues
        } = await supabase
            .from('gftvqueue_queues')
            .select('id, name, status, access_code, max_serving, created_at')
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

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_events')
            .update(updates)
            .eq('id', eventId)
            .select()
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            event: data
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