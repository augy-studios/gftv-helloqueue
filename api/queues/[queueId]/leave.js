// POST → leave the queue
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const caller = await requireQueueAccess(req, res);
    if (!caller) return;

    const { queueId } = req.query;
    const { telegram_user_id } = caller;

    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, status, queue_number')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegram_user_id)
        .in('status', ['waiting', 'serving', 'missed'])
        .maybeSingle();

    if (!entry) return res.status(404).json({ error: 'You are not in this queue' });

    await supabase.from('gftvqueue_entries').delete().eq('id', entry.id);

    return res.status(200).json({ message: 'You have left the queue' });
}
