// GET  → list queues for an event (?event_id=...)
// POST → create a queue (event editor or admin)
import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth,
    randomCode
} from '../_auth.js';
import { verifySignedRequest } from '../../lib/gftv-request-signing-server.js';

async function canEditEvent(userId, eventId, isAdmin) {
    if (isAdmin) return true;
    const {
        data
    } = await supabase
        .from('gftvqueue_event_editors')
        .select('id')
        .eq('event_id', eventId)
        .eq('user_id', userId)
        .maybeSingle();
    return !!data;
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const user = await requireAuth(req, res);
    if (!user) return;

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const {
            event_id
        } = req.query;
        if (!event_id) return res.status(400).json({
            error: 'event_id is required'
        });

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .select('id, event_id, name, description, status, access_code, max_serving, created_by, created_at')
            .eq('event_id', event_id)
            .order('created_at', {
                ascending: true
            });

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            queues: data || []
        });
    }

    // ── POST: create queue ────────────────────────────────────────────────────
    if (req.method === 'POST') {
        const {
            event_id,
            name,
            description,
            max_serving
        } = req.body || {};
        if (!event_id || !name) return res.status(400).json({
            error: 'event_id and name are required'
        });

        // Check permission
        const allowed = await canEditEvent(user.id, event_id, user.is_admin);
        if (!allowed) return res.status(403).json({
            error: 'You are not an editor for this event'
        });

        // Generate unique 8-char access code for this queue
        let access_code;
        let attempts = 0;
        while (attempts < 10) {
            access_code = randomCode(8);
            const {
                data: existing
            } = await supabase
                .from('gftvqueue_queues')
                .select('id').eq('access_code', access_code).maybeSingle();
            if (!existing) break;
            attempts++;
        }

        const {
            data: queue,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .insert({
                event_id,
                name,
                description: description || null,
                max_serving: max_serving || 30,
                access_code,
                created_by: user.id,
            })
            .select()
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });

        // Creator auto-gets queue admin permission
        await supabase.from('gftvqueue_queue_permissions').insert({
            queue_id: queue.id,
            user_id: user.id,
            is_queue_admin: true,
            granted_by: user.id,
        });

        return res.status(201).json({
            queue
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}