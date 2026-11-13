// GET → get own queue entry status + QR token if serving
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';
import QRCode from 'qrcode';

// What the attendee page shows about the caller's place in this queue: their
// entry (with its position while waiting), the QR code once they're called,
// and the queue's counts. Someone not in the queue gets what the Join card
// shows instead.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const caller = await requireQueueAccess(request, response);
    if (!caller) {
        return;
    }

    const { queueId } = request.query;
    const telegramUserId = caller.telegram_user_id;

    // Find user's entry in this queue
    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, status, joined_at, called_at, entered_at, notify_serving, notify_next')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegramUserId)
        .not('status', 'in', '("completed")')
        .order('joined_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('name, status, max_serving, gftvqueue_events(name)')
        .eq('id', queueId)
        .single();

    if (!queue) {
        return response.status(404).json({ error: 'Queue not found' });
    }

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

    let servedTotal = 0;
    if (servedCount) {
        servedTotal = servedCount;
    }

    // Not in the queue: the page shows the Join card, which takes the
    // waiting count from the display endpoint (rule F2).
    if (!entry) {
        return response.status(200).json({
            in_queue: false,
            queue: queueSummary(queue),
            served_count: servedTotal,
        });
    }

    // If serving, fetch or create QR token
    let qrDataUrl = null;
    let tokenRow = null;
    if (entry.status === 'serving') {
        const qrCode = await loadQrCode(entry.id);
        tokenRow = qrCode.tokenRow;
        qrDataUrl = qrCode.qrDataUrl;
    }

    let position = null;
    if (entry.status === 'waiting') {
        position = await waitingPosition(queueId, entry.queue_number);
    }

    // The token text goes out only alongside its QR picture.
    let qrToken = null;
    if (qrDataUrl && tokenRow !== null && tokenRow !== undefined) {
        if (tokenRow.token !== null && tokenRow.token !== undefined) {
            qrToken = tokenRow.token;
        }
    }

    let waitingTotal = 0;
    if (waitingCount) {
        waitingTotal = waitingCount;
    }

    return response.status(200).json({
        in_queue: true,
        entry: {
            queue_number: entry.queue_number,
            status: entry.status,
            position: position,
            entered_at: entry.entered_at,
            notify_serving: entry.notify_serving,
            notify_next: entry.notify_next,
        },
        qr_data_url: qrDataUrl,
        qr_token: qrToken,
        queue: queueSummary(queue),
        waiting_count: waitingTotal,
        served_count: servedTotal,
    });
}

// The queue as the attendee page shows it. event_name is left undefined
// (and so not sent) when the queue's event isn't found.
function queueSummary(queue) {
    let eventName = undefined;
    if (queue.gftvqueue_events !== null && queue.gftvqueue_events !== undefined) {
        eventName = queue.gftvqueue_events.name;
    }
    return { name: queue.name, status: queue.status, event_name: eventName };
}

// The called entry's newest unused QR token, made now if there is none, and
// its QR code as a PNG data URL. Returns { tokenRow, qrDataUrl }; both are
// empty if no token could be made.
async function loadQrCode(entryId) {
    const { data: existingToken } = await supabase
        .from('gftvqueue_entry_tokens')
        .select('token')
        .eq('entry_id', entryId)
        .is('used_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    let tokenRow = existingToken;

    if (!tokenRow) {
        const { data: newToken } = await supabase
            .from('gftvqueue_entry_tokens')
            .insert({ entry_id: entryId })
            .select('token')
            .single();
        tokenRow = newToken;
    }

    let qrDataUrl = null;
    if (tokenRow) {
        qrDataUrl = await QRCode.toDataURL(tokenRow.token, {
            width: 300,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
        });
    }
    return { tokenRow, qrDataUrl };
}

// A waiting entry's place in line: 1 plus how many waiting entries have a
// lower number.
async function waitingPosition(queueId, queueNumber) {
    const { count: aheadCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'waiting')
        .lt('queue_number', queueNumber);
    let waitingAhead = 0;
    if (aheadCount) {
        waitingAhead = aheadCount;
    }
    return waitingAhead + 1;
}
