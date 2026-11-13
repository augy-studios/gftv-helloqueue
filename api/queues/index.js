// GET  → list queues for an event (?event_id=...), or the caller's own queues (?mine=1)
// POST → create a queue (event editor or admin)
import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth,
    randomCode
} from '../_auth.js';

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

// GET ?mine=1: the queues the caller can operate or administer, for the
// dashboard's My Queues view. A superadmin gets every queue (they can operate
// all of them); anyone else gets the queues they have a permission row for.
// Each queue carries what the view shows: its event's name and access code
// (for the Display link and live counts) and whether the caller is its queue
// admin.
async function listMyQueues(user, res) {
    const columns = 'id, event_id, name, status, access_code, max_serving, gftvqueue_events(name, access_code)';
    let rows;
    const adminByQueue = {};

    if (user.is_admin) {
        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .select(columns)
            .order('created_at', {
                ascending: true
            });
        if (error) return res.status(500).json({
            error: error.message
        });
        rows = data || [];
    } else {
        const {
            data: permissions,
            error: permissionsError
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .select('queue_id, is_queue_admin')
            .eq('user_id', user.id);
        if (permissionsError) return res.status(500).json({
            error: permissionsError.message
        });
        if (!permissions || permissions.length === 0) return res.status(200).json({
            queues: []
        });

        for (const permission of permissions) {
            adminByQueue[permission.queue_id] = permission.is_queue_admin === true;
        }

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .select(columns)
            .in('id', permissions.map(p => p.queue_id))
            .order('created_at', {
                ascending: true
            });
        if (error) return res.status(500).json({
            error: error.message
        });
        rows = data || [];
    }

    const queues = rows.map(row => {
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
    });

    return res.status(200).json({
        queues
    });
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const user = await requireAuth(req, res);
    if (!user) return;

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const {
            event_id,
            mine
        } = req.query;

        // ?mine=1 → only the queues the caller can operate or administer
        if (mine === '1') return listMyQueues(user, res);

        if (!event_id) return res.status(400).json({
            error: 'event_id is required'
        });

        // A superadmin or an editor of the event gets every queue in it,
        // with access codes. No page calls this list today (the event page
        // gets its queues from GET /api/events/:id), so it sends only what
        // that page's queue cards show (rule F2).
        const editor = await canEditEvent(user.id, event_id, user.is_admin);
        if (editor) {
            const {
                data,
                error
            } = await supabase
                .from('gftvqueue_queues')
                .select('id, name, status, access_code, max_serving')
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

        // Staff see only the queues in this event they're assigned to,
        // without access codes. Anyone else gets 403.
        const {
            data: permissions
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .select('queue_id')
            .eq('user_id', user.id);
        const queueIds = (permissions || []).map(p => p.queue_id);
        if (queueIds.length === 0) return res.status(403).json({
            error: 'No access to this event'
        });

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .select('id, name, status, max_serving')
            .eq('event_id', event_id)
            .in('id', queueIds)
            .order('created_at', {
                ascending: true
            });

        if (error) return res.status(500).json({
            error: error.message
        });
        if (!data || data.length === 0) return res.status(403).json({
            error: 'No access to this event'
        });
        return res.status(200).json({
            queues: data
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

        // Only the new queue's id is read back, for the permission row below.
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
            .select('id')
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

        // The event page reloads and reads nothing back (rule F2).
        return res.status(201).json({
            ok: true
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}