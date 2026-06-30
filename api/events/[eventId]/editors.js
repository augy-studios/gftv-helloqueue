// GET    → list editors for an event
// POST   → assign an editor to an event (admin only)
// DELETE → remove an editor from an event (admin only)
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../../_auth.js';
import { verifySignedRequest } from '../../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        eventId
    } = req.query;

    if (req.method === 'GET') {
        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_event_editors')
            .select('id, user_id, assigned_at, gftvhello_users(id, username, display_name, email)')
            .eq('event_id', eventId);

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            editors: data || []
        });
    }

    if (req.method === 'POST') {
        if (!user.is_admin) return res.status(403).json({
            error: 'Admin access required'
        });

        const {
            user_id
        } = req.body || {};
        if (!user_id) return res.status(400).json({
            error: 'user_id is required'
        });

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_event_editors')
            .insert({
                event_id: eventId,
                user_id,
                assigned_by: user.id
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') return res.status(409).json({
                error: 'User is already an editor for this event'
            });
            return res.status(500).json({
                error: error.message
            });
        }
        return res.status(201).json({
            editor: data
        });
    }

    if (req.method === 'DELETE') {
        if (!user.is_admin) return res.status(403).json({
            error: 'Admin access required'
        });

        const {
            user_id
        } = req.body || {};
        if (!user_id) return res.status(400).json({
            error: 'user_id is required'
        });

        const {
            error
        } = await supabase
            .from('gftvqueue_event_editors')
            .delete()
            .eq('event_id', eventId)
            .eq('user_id', user_id);

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            message: 'Editor removed'
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}