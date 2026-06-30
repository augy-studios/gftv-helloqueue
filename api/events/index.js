// GET  → list events (admin sees all; editors see assigned)
// POST → create event (admin only)
import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth,
    randomCode
} from '../_auth.js';
import { verifySignedRequest } from '../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const user = await requireAuth(req, res);
    if (!user) return;

    // ── GET: list events ──────────────────────────────────────────────────────
    if (req.method === 'GET') {
        let query = supabase
            .from('gftvqueue_events')
            .select('id, name, description, venue, event_date, status, access_code, created_by, created_at');

        if (!user.is_admin) {
            // editors only see their assigned events
            const {
                data: assigned
            } = await supabase
                .from('gftvqueue_event_editors')
                .select('event_id')
                .eq('user_id', user.id);
            const ids = (assigned || []).map(r => r.event_id);
            if (ids.length === 0) return res.status(200).json({
                events: []
            });
            query = query.in('id', ids);
        }

        const {
            data,
            error
        } = await query.order('created_at', {
            ascending: false
        });
        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            events: data
        });
    }

    // ── POST: create event (admin only) ──────────────────────────────────────
    if (req.method === 'POST') {
        if (!user.is_admin) return res.status(403).json({
            error: 'Admin access required'
        });

        const {
            name,
            description,
            venue,
            event_date
        } = req.body || {};
        if (!name) return res.status(400).json({
            error: 'Event name is required'
        });

        // Generate unique 8-char access code
        let access_code;
        let attempts = 0;
        while (attempts < 10) {
            access_code = randomCode(8);
            const {
                data: existing
            } = await supabase
                .from('gftvqueue_events')
                .select('id').eq('access_code', access_code).maybeSingle();
            if (!existing) break;
            attempts++;
        }

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_events')
            .insert({
                name,
                description,
                venue,
                event_date: event_date || null,
                access_code,
                created_by: user.id
            })
            .select()
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(201).json({
            event: data
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}