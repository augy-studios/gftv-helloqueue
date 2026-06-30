// PUT { notify_serving, notify_next } → update notification preferences
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';
import { verifySignedRequest } from '../../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const caller = await requireQueueAccess(req, res);
    if (!caller) return;

    const { queueId } = req.query;
    const { telegram_user_id } = caller;
    const { notify_serving, notify_next } = req.body || {};

    const updates = {};
    if (notify_serving !== undefined) updates.notify_serving = notify_serving;
    if (notify_next !== undefined) updates.notify_next = notify_next;

    const { data, error } = await supabase
        .from('gftvqueue_entries')
        .update(updates)
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegram_user_id)
        .in('status', ['waiting', 'serving'])
        .select('notify_serving, notify_next')
        .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ prefs: data });
}
