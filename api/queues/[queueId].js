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

// How many finished entries the operator's Completed column lists, newest
// first (decision 4). The column shows the total from completedCount.
export const RECENT_COMPLETED_LIMIT = 5;

// What an operator's entry card shows (rule F2): the id its buttons send, the
// queue number, the name and the @username (decision 5).
function entryCardFields(entry) {
    return {
        id: entry.id,
        queue_number: entry.queue_number,
        display_name: entry.display_name,
        telegram_username: entry.telegram_username,
    };
}

// A called attendee's card also needs entered_at, to choose between the
// Confirm entrance and Exit buttons.
function servingCardFields(entry) {
    const fields = entryCardFields(entry);
    fields.entered_at = entry.entered_at;
    return fields;
}

async function isEventEditor(userId, eventId) {
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

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;

    // ── GET ───────────────────────────────────────────────────────────────────
    // Sends only what the operator page shows (rule F2). event_id is read for
    // the editor check and is not sent.
    if (req.method === 'GET') {
        const {
            data: queueRow,
            error
        } = await supabase
            .from('gftvqueue_queues')
            .select('event_id, name, status, access_code, max_serving, gftvqueue_events(access_code)')
            .eq('id', queueId)
            .single();

        if (error || !queueRow) return res.status(404).json({
            error: 'Queue not found'
        });

        // Permission info. Only a superadmin, an admin or operator of this
        // queue, or an editor of the queue's event may read it.
        const {
            allowed,
            isQueueAdmin
        } = await canOperateQueue(user.id, queueId, user.is_admin);

        if (!allowed) {
            const editor = await isEventEditor(user.id, queueRow.event_id);
            if (!editor) return res.status(403).json({
                error: 'No access to this queue'
            });
        }

        let eventAccessCode = null;
        if (queueRow.gftvqueue_events) {
            eventAccessCode = queueRow.gftvqueue_events.access_code;
        }
        const queue = {
            name: queueRow.name,
            status: queueRow.status,
            access_code: queueRow.access_code,
            max_serving: queueRow.max_serving,
            event_access_code: eventAccessCode,
        };

        // Entries still in the queue: called, waiting and missed.
        const {
            data: activeEntries
        } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, status, display_name, telegram_username, entered_at')
            .eq('queue_id', queueId)
            .in('status', ['serving', 'waiting', 'missed'])
            .order('queue_number', {
                ascending: true
            });

        // The Completed column (decision 4): how many have finished, and only
        // the last RECENT_COMPLETED_LIMIT of them, newest first.
        const {
            count: completedCount
        } = await supabase
            .from('gftvqueue_entries')
            .select('id', {
                count: 'exact',
                head: true
            })
            .eq('queue_id', queueId)
            .eq('status', 'completed');

        const {
            data: recentCompleted
        } = await supabase
            .from('gftvqueue_entries')
            .select('queue_number, display_name, telegram_username')
            .eq('queue_id', queueId)
            .eq('status', 'completed')
            .order('completed_at', {
                ascending: false,
                nullsFirst: false
            })
            .order('queue_number', {
                ascending: false
            })
            .limit(RECENT_COMPLETED_LIMIT);

        let rows = [];
        if (activeEntries) {
            rows = activeEntries;
        }
        let completedList = [];
        if (recentCompleted) {
            completedList = recentCompleted;
        }
        let finishedCount = 0;
        if (completedCount) {
            finishedCount = completedCount;
        }

        const grouped = {
            serving: rows.filter(entry => entry.status === 'serving').map(servingCardFields),
            waiting: rows.filter(entry => entry.status === 'waiting').map(entryCardFields),
            missed: rows.filter(entry => entry.status === 'missed').map(entryCardFields),
            completed: completedList,
        };

        return res.status(200).json({
            queue,
            entries: grouped,
            completedCount: finishedCount,
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

        // .select('id').single() keeps the error for a queue that doesn't
        // exist. The page reads nothing back (rule F2).
        const {
            error
        } = await supabase
            .from('gftvqueue_queues')
            .update(updates)
            .eq('id', queueId)
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