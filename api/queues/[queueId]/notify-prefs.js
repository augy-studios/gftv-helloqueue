// PUT { notify_serving, notify_next } → update notification preferences
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'PUT') return res.status(405).json({
        error: 'Method not allowed'
    });

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;
    const {
        notify_serving,
        notify_next
    } = req.body || {};

    const {
        data: tgLink
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_user_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (!tgLink) return res.status(400).json({
        error: 'Telegram not linked'
    });

    const updates = {};
    if (notify_serving !== undefined) updates.notify_serving = notify_serving;
    if (notify_next !== undefined) updates.notify_next = notify_next;

    const {
        data,
        error
    } = await supabase
        .from('gftvqueue_entries')
        .update(updates)
        .eq('queue_id', queueId)
        .eq('telegram_user_id', tgLink.telegram_user_id)
        .in('status', ['waiting', 'serving'])
        .select('notify_serving, notify_next')
        .single();

    if (error) return res.status(500).json({
        error: error.message
    });
    return res.status(200).json({
        prefs: data
    });
}