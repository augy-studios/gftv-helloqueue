// POST → join a queue (attendee or full account, identified by telegram_user_id)
import { supabase } from '../../_supabase.js';
import { handleCors, requireQueueAccess } from '../../_auth.js';
import { sendTelegramMessage } from '../../_telegram.js';

// Adds the caller to an open queue with the next number, unless they're
// already waiting or called in it, then sends a Telegram message with their
// number and place in line.
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
    const displayName = caller.display_name;

    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('name, status, max_serving, gftvqueue_events(name)')
        .eq('id', queueId)
        .single();

    if (!queue) {
        return response.status(404).json({ error: 'Queue not found' });
    }
    if (queue.status !== 'open') {
        return response.status(400).json({ error: 'This queue is currently closed.' });
    }

    const { data: existing } = await supabase
        .from('gftvqueue_entries')
        .select('id')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', telegramUserId)
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

    // The page shows only the error (rule F2).
    if (existing) {
        return response.status(409).json({ error: 'You are already in this queue.' });
    }

    const { data: lastEntry } = await supabase
        .from('gftvqueue_entries')
        .select('queue_number')
        .eq('queue_id', queueId)
        .order('queue_number', { ascending: false })
        .limit(1)
        .maybeSingle();

    let queueNumber = 1;
    if (lastEntry) {
        queueNumber = lastEntry.queue_number + 1;
    }

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

    let body = {};
    if (request.body) {
        body = request.body;
    }
    let notifyServing = true;
    if (body.notify_serving !== undefined) {
        notifyServing = body.notify_serving;
    }
    let notifyNext = true;
    if (body.notify_next !== undefined) {
        notifyNext = body.notify_next;
    }

    const telegramUsername = await findTelegramUsername(caller, telegramUserId);

    const { error } = await supabase
        .from('gftvqueue_entries')
        .insert({
            queue_id: queueId,
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            display_name: displayName,
            queue_number: queueNumber,
            status: 'waiting',
            notify_serving: notifyServing,
            notify_next: notifyNext,
        });

    if (error) {
        return response.status(500).json({ error: error.message });
    }

    let waitingAhead = 0;
    if (aheadCount) {
        waitingAhead = aheadCount;
    }
    const position = waitingAhead + 1;
    const telegramMessage = joinedMessage(queue, queueNumber, position, atCapacity);

    await sendTelegramMessage(telegramUserId, telegramMessage);

    // The queue page reloads its status and reads nothing back (rule F2).
    return response.status(201).json({ ok: true });
}

// The caller's Telegram @username, or null: from their attendee session, or
// from their account's Telegram link.
async function findTelegramUsername(caller, telegramUserId) {
    if (caller.is_attendee) {
        const { data: attendeeSession } = await supabase
            .from('gftvqueue_attendee_sessions')
            .select('telegram_username')
            .eq('telegram_user_id', telegramUserId)
            .maybeSingle();
        if (attendeeSession && attendeeSession.telegram_username) {
            return attendeeSession.telegram_username;
        }
        return null;
    }

    const { data: telegramLink } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_username')
        .eq('telegram_user_id', telegramUserId)
        .maybeSingle();
    if (telegramLink && telegramLink.telegram_username) {
        return telegramLink.telegram_username;
    }
    return null;
}

// The "You've joined the queue!" Telegram message. The event line falls back
// to the queue's name when the event has none.
function joinedMessage(queue, queueNumber, position, atCapacity) {
    let capacityNote = '';
    if (atCapacity) {
        capacityNote = '\n\n⚠️ The den is currently at capacity. Please wait to be called.';
    }
    let eventName = queue.name;
    if (queue.gftvqueue_events && queue.gftvqueue_events.name) {
        eventName = queue.gftvqueue_events.name;
    }
    return `✅ *You've joined the queue!*\n\nEvent: ${eventName}\nQueue: ${queue.name}\nYour number: *#${queueNumber}*\nPosition in queue: *${position}*${capacityNote}\n\nKeep an eye out for a message when it's your turn!`;
}
