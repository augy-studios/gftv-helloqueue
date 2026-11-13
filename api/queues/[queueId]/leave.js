// POST → leave the queue
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';

// Removes the caller's waiting, called or missed entry from this queue.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const caller = await requireQueueAccess(request, response);
    if (!caller) {
        return;
    }

    const { queueId } = request.query;
    const telegramUserId = caller.telegram_user_id;

    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, status, queue_number')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegramUserId)
        .in('status', ['waiting', 'serving', 'missed'])
        .maybeSingle();

    if (!entry) {
        return response.status(404).json({ error: 'You are not in this queue' });
    }

    await supabase.from('gftvqueue_entries').delete().eq('id', entry.id);

    return response.status(200).json({ message: 'You have left the queue' });
}
