// PUT { notify_serving, notify_next } → update notification preferences
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';

// Turns the caller's "your turn" and "you're next" Telegram messages on or
// off for their live entry in this queue. Only the settings sent change.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'PUT') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const caller = await requireQueueAccess(request, response);
    if (!caller) {
        return;
    }

    const { queueId } = request.query;
    const telegramUserId = caller.telegram_user_id;
    let body = {};
    if (request.body) {
        body = request.body;
    }

    const updates = {};
    if (body.notify_serving !== undefined) {
        updates.notify_serving = body.notify_serving;
    }
    if (body.notify_next !== undefined) {
        updates.notify_next = body.notify_next;
    }

    // .select('id').single() keeps the error when the caller has no live
    // entry here. The page reads nothing back (rule F2).
    const { error } = await supabase
        .from('gftvqueue_entries')
        .update(updates)
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegramUserId)
        .in('status', ['waiting', 'serving'])
        .select('id')
        .single();

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ ok: true });
}
