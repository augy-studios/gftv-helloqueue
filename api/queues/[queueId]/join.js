// POST → join a queue (attendee or full account, identified by telegram_user_id)
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';
import { sendTelegramMessage } from '../../_telegram.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const caller = await requireQueueAccess(req, res);
    if (!caller) return;

    const { queueId } = req.query;
    const { telegram_user_id, display_name } = caller;

    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('*, gftvqueue_events(name)')
        .eq('id', queueId)
        .single();

    if (!queue) return res.status(404).json({ error: 'Queue not found' });
    if (queue.status !== 'open') return res.status(400).json({ error: 'This queue is currently closed.' });

    const { data: existing } = await supabase
        .from('gftvqueue_entries')
        .select('id, status, queue_number')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegram_user_id)
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

    if (existing) {
        return res.status(409).json({ error: 'You are already in this queue.', entry: existing });
    }

    const { data: lastEntry } = await supabase
        .from('gftvqueue_entries')
        .select('queue_number')
        .eq('queue_id', queueId)
        .order('queue_number', { ascending: false })
        .limit(1)
        .maybeSingle();

    const queue_number = lastEntry ? lastEntry.queue_number + 1 : 1;

    const { count: aheadCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'waiting');

    const { count: servingCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'serving');

    const atCapacity = servingCount >= queue.max_serving;
    const { notify_serving = true, notify_next = true } = req.body || {};

    // Get Telegram username if available (from attendee session or telegram_links)
    let telegram_username = null;
    if (caller.is_attendee) {
        const { data: sess } = await supabase
            .from('gftvqueue_attendee_sessions')
            .select('telegram_username')
            .eq('telegram_user_id', telegram_user_id)
            .maybeSingle();
        telegram_username = sess?.telegram_username || null;
    } else {
        const { data: link } = await supabase
            .from('gftvqueue_telegram_links')
            .select('telegram_username')
            .eq('telegram_user_id', telegram_user_id)
            .maybeSingle();
        telegram_username = link?.telegram_username || null;
    }

    const { data: entry, error } = await supabase
        .from('gftvqueue_entries')
        .insert({
            queue_id: queueId,
            telegram_user_id,
            telegram_username,
            display_name,
            queue_number,
            status: 'waiting',
            notify_serving,
            notify_next,
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });

    const position = (aheadCount || 0) + 1;
    const capacityMsg = atCapacity ? '\n\n⚠️ The den is currently at capacity. Please wait to be called.' : '';
    const tgMsg = `✅ *You've joined the queue!*\n\nEvent: ${queue.gftvqueue_events?.name || queue.name}\nQueue: ${queue.name}\nYour number: *#${queue_number}*\nPosition in queue: *${position}*${capacityMsg}\n\nKeep an eye out for a message when it's your turn!`;

    await sendTelegramMessage(telegram_user_id, tgMsg);

    return res.status(201).json({ entry, position });
}
