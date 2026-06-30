// GET → get own queue entry status + QR token if serving
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';
import QRCode from 'qrcode';
import { verifySignedRequest } from '../../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const caller = await requireQueueAccess(req, res);
    if (!caller) return;

    const { queueId } = req.query;
    const { telegram_user_id } = caller;

    // Find user's entry in this queue
    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, status, joined_at, called_at, entered_at, notify_serving, notify_next')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegram_user_id)
        .not('status', 'in', '("completed")')
        .order('joined_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('name, status, max_serving, gftvqueue_events(name)')
        .eq('id', queueId)
        .single();

    if (!queue) return res.status(404).json({ error: 'Queue not found' });

    const { count: waitingCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'waiting');

    const { count: servedCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'completed');

    if (!entry) {
        return res.status(200).json({
            in_queue: false,
            queue: { name: queue.name, status: queue.status, event_name: queue.gftvqueue_events?.name },
            waiting_count: waitingCount || 0,
            served_count: servedCount || 0,
        });
    }

    // If serving, fetch or create QR token
    let qr_data_url = null;
    let tokenRow = null;
    if (entry.status === 'serving') {
        const { data: existingToken } = await supabase
            .from('gftvqueue_entry_tokens')
            .select('token')
            .eq('entry_id', entry.id)
            .is('used_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        tokenRow = existingToken;

        if (!tokenRow) {
            const { data: newToken } = await supabase
                .from('gftvqueue_entry_tokens')
                .insert({ entry_id: entry.id })
                .select('token')
                .single();
            tokenRow = newToken;
        }

        if (tokenRow) {
            qr_data_url = await QRCode.toDataURL(tokenRow.token, {
                width: 300,
                margin: 2,
                color: { dark: '#000000', light: '#ffffff' },
            });
        }
    }

    let position = null;
    if (entry.status === 'waiting') {
        const { count: ahead } = await supabase
            .from('gftvqueue_entries')
            .select('id', { count: 'exact', head: true })
            .eq('queue_id', queueId)
            .eq('status', 'waiting')
            .lt('queue_number', entry.queue_number);
        position = (ahead || 0) + 1;
    }

    return res.status(200).json({
        in_queue: true,
        entry: {
            id: entry.id,
            queue_number: entry.queue_number,
            status: entry.status,
            position,
            entered_at: entry.entered_at,
            notify_serving: entry.notify_serving,
            notify_next: entry.notify_next,
        },
        qr_data_url,
        qr_token: qr_data_url ? tokenRow?.token ?? null : null,
        queue: { name: queue.name, status: queue.status, event_name: queue.gftvqueue_events?.name },
        waiting_count: waitingCount || 0,
        served_count: servedCount || 0,
    });
}
