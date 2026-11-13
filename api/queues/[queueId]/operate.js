// POST with { action: 'call_next' | 'call_batch' | 'mark_missed' | 'mark_complete' | 'mark_entered' | 'rejoin' }
// call_batch also takes { count }; the mark_ actions and rejoin take { entry_id }.
import { supabase } from '../../_supabase.js';
import { handleCors, requireAuth } from '../../_auth.js';
import { sendTelegramMessage } from '../../_telegram.js';

// True when the user may operate this queue: a superadmin, or anyone with a
// permission row for it.
async function canOperate(userId, queueId, isAdmin) {
    if (isAdmin) {
        return true;
    }
    const { data: permission } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('id')
        .eq('queue_id', queueId)
        .eq('user_id', userId)
        .maybeSingle();
    return Boolean(permission);
}

// Checks the caller, loads the queue, then hands the action to the function
// that runs it (runOperatorAction).
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    const { queueId } = request.query;
    let body = {};
    if (request.body) {
        body = request.body;
    }
    const action = body.action;
    const entryId = body.entry_id;
    const count = body.count;

    const allowed = await canOperate(user.id, queueId, user.is_admin);
    if (!allowed) {
        return response.status(403).json({ error: 'No permission to operate this queue' });
    }

    // Fetch queue: its name for the Telegram messages, and the serving limit
    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('name, max_serving')
        .eq('id', queueId)
        .single();

    if (!queue) {
        return response.status(404).json({ error: 'Queue not found' });
    }

    return runOperatorAction(action, { queueId, queue, entryId, count }, response);
}

// The dispatcher: picks the function for the requested action. An unknown
// action is a 400.
async function runOperatorAction(action, operation, response) {
    switch (action) {
        case 'call_next':
            return callNext(operation, response);
        case 'call_batch':
            return callBatch(operation, response);
        case 'mark_missed':
            return markMissed(operation, response);
        case 'mark_complete':
            return markComplete(operation, response);
        case 'mark_entered':
            return markEntered(operation, response);
        case 'rejoin':
            return rejoinQueue(operation, response);
        default:
            return response.status(400).json({ error: 'Unknown action' });
    }
}

// ── CALL NEXT and CALL BATCH ──────────────────────────────────────────────────

// call_next: calls the first waiting attendee.
async function callNext(operation, response) {
    return callWaitingEntries(operation, 1, response);
}

// call_batch: calls up to `count` waiting attendees (1 when count is missing
// or zero), capped by the free serving slots.
async function callBatch(operation, response) {
    let batchSize = 1;
    if (operation.count) {
        batchSize = operation.count;
    }
    return callWaitingEntries(operation, batchSize, response);
}

// Calls the next waiting attendees, at most `batchSize` and never more than
// the queue's free serving slots. Each one moves to serving, gets a one-time
// QR token and (if they asked) a Telegram message. Then the attendee after
// the last one called hears they're next. Sends a 400 when the queue is full
// or nobody is waiting.
async function callWaitingEntries(operation, batchSize, response) {
    const { queueId, queue } = operation;

    // How many currently serving?
    const { data: currentServing } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, telegram_user_id')
        .eq('queue_id', queueId)
        .eq('status', 'serving')
        .order('queue_number', { ascending: true });

    let servingEntries = [];
    if (currentServing) {
        servingEntries = currentServing;
    }
    const servingCount = servingEntries.length;
    const availableSlots = queue.max_serving - servingCount;

    if (availableSlots <= 0) {
        return response.status(400).json({
            error: 'Queue is at capacity. Complete or miss some entries first.'
        });
    }

    const callCount = Math.min(batchSize, availableSlots);

    // If calling would exceed max_serving, push oldest serving to missed
    if (servingCount + callCount > queue.max_serving) {
        const overflow = (servingCount + callCount) - queue.max_serving;
        await missOldestServing(operation, servingEntries.slice(0, overflow));
    }

    // Get next N waiting entries
    const { data: nextEntries } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, telegram_user_id, notify_serving')
        .eq('queue_id', queueId)
        .eq('status', 'waiting')
        .order('queue_number', { ascending: true })
        .limit(callCount);

    if (!nextEntries || nextEntries.length === 0) {
        return response.status(400).json({ error: 'No one is waiting in the queue' });
    }

    // Get total in queue for context (read, but not used in the reply)
    await supabase
        .from('gftvqueue_entries')
        .select('id', { count: 'exact', head: true })
        .eq('queue_id', queueId)
        .eq('status', 'waiting');

    for (const entry of nextEntries) {
        await startServing(operation, entry);
    }

    // Notify "you're next" to the person after the last called
    const calledNumbers = nextEntries.map((entry) => entry.queue_number);
    const lastCalledNumber = Math.max(...calledNumbers);
    await notifyNextInLine(operation, lastCalledNumber);

    return response.status(200).json({
        message: `Called ${nextEntries.length} attendee(s)`,
        called: nextEntries.map((entry) => entry.queue_number)
    });
}

// Moves the given serving entries to missed, telling each one by Telegram.
async function missOldestServing(operation, entriesToMiss) {
    const { queueId, queue } = operation;
    for (const entry of entriesToMiss) {
        await supabase
            .from('gftvqueue_entries')
            .update({ status: 'missed' })
            .eq('id', entry.id)
            .eq('queue_id', queueId);
        // Notify via Telegram
        await notifyMissed(entry.telegram_user_id, entry.queue_number, queue.name);
    }
}

// Calls one waiting entry: marks it serving, makes its one-time QR token and
// sends the "your turn" message if the attendee asked for it.
async function startServing(operation, entry) {
    const { queueId, queue } = operation;

    await supabase
        .from('gftvqueue_entries')
        .update({ status: 'serving', called_at: new Date().toISOString() })
        .eq('id', entry.id)
        .eq('queue_id', queueId);

    // Generate entry token for QR
    await supabase.from('gftvqueue_entry_tokens').insert({ entry_id: entry.id });

    // Notify
    if (entry.notify_serving) {
        await notifyServing(entry.telegram_user_id, entry.queue_number, queue.name);
    }
}

// Tells the first waiting attendee after `lastCalledNumber` that they're
// next, if they asked for that message.
async function notifyNextInLine(operation, lastCalledNumber) {
    const { queueId, queue } = operation;

    const { data: nextUp } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, telegram_user_id, notify_next')
        .eq('queue_id', queueId)
        .eq('status', 'waiting')
        .gt('queue_number', lastCalledNumber)
        .order('queue_number', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (nextUp && nextUp.notify_next) {
        await notifyNext(nextUp.telegram_user_id, nextUp.queue_number, queue.name);
    }
}

// ── MARK MISSED ───────────────────────────────────────────────────────────────

// mark_missed: a called attendee didn't turn up. Only a serving entry can be
// marked missed; the attendee is told by Telegram.
async function markMissed(operation, response) {
    const { queueId, queue, entryId } = operation;
    if (!entryId) {
        return response.status(400).json({ error: 'entry_id required' });
    }

    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, telegram_user_id, status')
        .eq('id', entryId)
        .eq('queue_id', queueId)
        .single();

    if (!entry) {
        return response.status(404).json({ error: 'Entry not found' });
    }
    if (entry.status !== 'serving') {
        return response.status(400).json({ error: 'Entry must be in serving state to mark missed' });
    }

    await supabase.from('gftvqueue_entries').update({ status: 'missed' }).eq('id', entryId).eq('queue_id', queueId);
    await notifyMissed(entry.telegram_user_id, entry.queue_number, queue.name);

    return response.status(200).json({ message: 'Marked as missed' });
}

// ── MARK COMPLETE (manual) ────────────────────────────────────────────────────

// mark_complete: finishes an entry by hand, whatever its state.
async function markComplete(operation, response) {
    const { queueId, entryId } = operation;
    if (!entryId) {
        return response.status(400).json({ error: 'entry_id required' });
    }

    // The entry must be in this queue
    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id')
        .eq('id', entryId)
        .eq('queue_id', queueId)
        .single();

    if (!entry) {
        return response.status(404).json({ error: 'Entry not found' });
    }

    await supabase
        .from('gftvqueue_entries')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', entryId)
        .eq('queue_id', queueId);

    return response.status(200).json({ message: 'Marked as complete' });
}

// ── MARK ENTERED (manual entrance confirmation) ───────────────────────────────

// mark_entered: confirms by hand that a called attendee went in. Only once per
// serving entry; the attendee is told by Telegram.
async function markEntered(operation, response) {
    const { queueId, entryId } = operation;
    if (!entryId) {
        return response.status(400).json({ error: 'entry_id required' });
    }

    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, telegram_user_id, status, entered_at')
        .eq('id', entryId)
        .eq('queue_id', queueId)
        .single();

    if (!entry) {
        return response.status(404).json({ error: 'Entry not found' });
    }
    if (entry.status !== 'serving') {
        return response.status(400).json({ error: 'Entry must be in serving state' });
    }
    if (entry.entered_at) {
        return response.status(409).json({ error: 'Entry already marked as entered' });
    }

    await supabase.from('gftvqueue_entries').update({ entered_at: new Date().toISOString() }).eq('id', entryId).eq('queue_id', queueId);

    const telegramMessage = `🚪 *Entrance confirmed!*\n\nNumber: *#${entry.queue_number}*\n\nWelcome! Show your QR code again when you exit.`;
    await sendTelegramMessage(entry.telegram_user_id, telegramMessage);

    return response.status(200).json({ message: 'Marked as entered' });
}

// ── REJOIN (move missed → waiting) ────────────────────────────────────────────

// rejoin: puts a missed entry back in the waiting list, keeping its number.
async function rejoinQueue(operation, response) {
    const { queueId, entryId } = operation;
    if (!entryId) {
        return response.status(400).json({ error: 'entry_id required' });
    }

    const { data: entry } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, telegram_user_id, status')
        .eq('id', entryId)
        .eq('queue_id', queueId)
        .single();

    if (!entry) {
        return response.status(404).json({ error: 'Entry not found' });
    }
    if (entry.status !== 'missed') {
        return response.status(400).json({ error: 'Entry must be in missed state to rejoin' });
    }

    await supabase.from('gftvqueue_entries').update({ status: 'waiting' }).eq('id', entryId).eq('queue_id', queueId);

    return response.status(200).json({ message: 'Entry moved back to waiting' });
}

// ── Telegram messages ─────────────────────────────────────────────────────────

async function notifyServing(telegramUserId, queueNumber, queueName) {
    if (!telegramUserId) {
        return;
    }
    const message = `🎉 *It's your turn!*\n\nQueue: ${queueName}\nNumber: *#${queueNumber}*\n\nPlease proceed to the entrance and show your QR code. Open the HelloQueue site to display it.`;
    await sendTelegramMessage(telegramUserId, message);
}

async function notifyNext(telegramUserId, queueNumber, queueName) {
    if (!telegramUserId) {
        return;
    }
    const message = `⏰ *You're next in line!*\n\nQueue: ${queueName}\nNumber: *#${queueNumber}*\n\nGet ready - you'll be called soon.`;
    await sendTelegramMessage(telegramUserId, message);
}

async function notifyMissed(telegramUserId, queueNumber, queueName) {
    if (!telegramUserId) {
        return;
    }
    const message = `😔 *You missed your turn.*\n\nQueue: ${queueName}\nNumber: *#${queueNumber}*\n\nYour number was called but you weren't present. You can rejoin the queue using /joinqueue.`;
    await sendTelegramMessage(telegramUserId, message);
}
