import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../_auth.js';

async function canOperateQueue(userId, queueId, isAdmin) {
    if (isAdmin) return {
        allowed: true,
        isQueueAdmin: true
    };
    const {
        data
    } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('is_queue_admin')
        .eq('queue_id', queueId)
        .eq('user_id', userId)
        .maybeSingle();
    if (!data) return {
        allowed: false,
        isQueueAdmin: false
    };
    return {
        allowed: true,
        isQueueAdmin: data.is_queue_admin
    };
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const {
            data: queue,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .select('*, gftvqueue_events(access_code)')
            .eq('id', queueId)
            .single();

        if (queue && queue.gftvqueue_events) {
            queue.event_access_code = queue.gftvqueue_events.access_code;
            delete queue.gftvqueue_events;
        }

        if (error || !queue) return res.status(404).json({
            error: 'Queue not found'
        });

        // Entry counts by status
        const {
            data: entries
        } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, status, display_name, telegram_username, joined_at, called_at, entered_at')
            .eq('queue_id', queueId)
            .order('queue_number', {
                ascending: true
            });

        const grouped = {
            serving: (entries || []).filter(e => e.status === 'serving'),
            waiting: (entries || []).filter(e => e.status === 'waiting'),
            missed: (entries || []).filter(e => e.status === 'missed'),
            completed: (entries || []).filter(e => e.status === 'completed'),
        };

        // Permission info
        const {
            allowed,
            isQueueAdmin
        } = await canOperateQueue(user.id, queueId, user.is_admin);

        return res.status(200).json({
            queue,
            entries: grouped,
            can_operate: allowed,
            is_queue_admin: isQueueAdmin
        });
    }

    // ── PUT: update queue settings ────────────────────────────────────────────
    if (req.method === 'PUT') {
        const {
            allowed
        } = await canOperateQueue(user.id, queueId, user.is_admin);
        if (!allowed) return res.status(403).json({
            error: 'No permission to edit this queue'
        });

        const {
            name,
            description,
            max_serving,
            status
        } = req.body || {};
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (max_serving !== undefined) updates.max_serving = max_serving;
        if (status !== undefined) updates.status = status;

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .update(updates)
            .eq('id', queueId)
            .select()
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            queue: data
        });
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
        const {
            isQueueAdmin
        } = await canOperateQueue(user.id, queueId, user.is_admin);
        if (!isQueueAdmin) return res.status(403).json({
            error: 'Queue admin access required'
        });

        const {
            error
        } = await supabase.from('gftvqueue_queues').delete().eq('id', queueId);
        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            message: 'Queue deleted'
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}