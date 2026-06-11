// GET → get own queue entry status + QR token if serving
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../../_auth.js';
import QRCode from 'qrcode';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({
        error: 'Method not allowed'
    });

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;

    // Get Telegram link
    const {
        data: tgLink
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_user_id')
        .eq('user_id', user.id)
        .maybeSingle();

    if (!tgLink) {
        return res.status(400).json({
            error: 'Telegram account not linked'
        });
    }

    // Find user's entry in this queue (active ones)
    const {
        data: entry
    } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, status, joined_at, called_at, notify_serving, notify_next')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', tgLink.telegram_user_id)
        .not('status', 'in', '("completed")')
        .order('joined_at', {
            ascending: false
        })
        .limit(1)
        .maybeSingle();

    // Get queue info
    const {
        data: queue
    } = await supabase
        .from('gftvqueue_queues')
        .select('name, status, max_serving, gftvqueue_events(name)')
        .eq('id', queueId)
        .single();

    if (!queue) return res.status(404).json({
        error: 'Queue not found'
    });

    // Count people waiting
    const {
        count: waitingCount
    } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queueId)
        .eq('status', 'waiting');

    const {
        count: servedCount
    } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queueId)
        .eq('status', 'completed');

    if (!entry) {
        return res.status(200).json({
            in_queue: false,
            queue: {
                name: queue.name,
                status: queue.status,
                event_name: queue.gftvqueue_events?.name
            },
            waiting_count: waitingCount || 0,
            served_count: servedCount || 0,
        });
    }

    // If serving, fetch or create token and generate QR
    let qr_data_url = null;
    if (entry.status === 'serving') {
        let {
            data: tokenRow
        } = await supabase
            .from('gftvqueue_entry_tokens')
            .select('token')
            .eq('entry_id', entry.id)
            .is('used_at', null)
            .order('created_at', {
                ascending: false
            })
            .limit(1)
            .maybeSingle();

        if (!tokenRow) {
            const {
                data: newToken
            } = await supabase
                .from('gftvqueue_entry_tokens')
                .insert({
                    entry_id: entry.id
                })
                .select('token')
                .single();
            tokenRow = newToken;
        }

        if (tokenRow) {
            qr_data_url = await QRCode.toDataURL(tokenRow.token, {
                width: 300,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                },
            });
        }
    }

    // Position in queue
    let position = null;
    if (entry.status === 'waiting') {
        const {
            count: ahead
        } = await supabase
            .from('gftvqueue_entries')
            .select('id', {
                count: 'exact',
                head: true
            })
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
            notify_serving: entry.notify_serving,
            notify_next: entry.notify_next,
        },
        qr_data_url,
        queue: {
            name: queue.name,
            status: queue.status,
            event_name: queue.gftvqueue_events?.name,
        },
        waiting_count: waitingCount || 0,
        served_count: servedCount || 0,
    });
}