// POST → leave the queue (attendee removes themselves)
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;

    const {
        data: tgLink
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_user_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (!tgLink) return res.status(400).json({
        error: 'Telegram account not linked'
    });

    const {
        data: entry
    } = await supabase
        .from('gftvqueue_entries')
        .select('id, status, queue_number')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', tgLink.telegram_user_id)
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

    if (!entry) return res.status(404).json({
        error: 'You are not in this queue'
    });

    await supabase.from('gftvqueue_entries').delete().eq('id', entry.id);

    return res.status(200).json({
        message: 'You have left the queue'
    });
}