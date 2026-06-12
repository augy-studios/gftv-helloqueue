// POST with { action: 'call_next' | 'call_batch' | 'mark_missed' | 'mark_complete' | 'rejoin' }
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../../_auth.js';
import {
    sendTelegramMessage
} from '../../_telegram.js';

async function canOperate(userId, queueId, isAdmin) {
    if (isAdmin) return true;
    const {
        data
    } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('id')
        .eq('queue_id', queueId)
        .eq('user_id', userId)
        .maybeSingle();
    return !!data;
}

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
        action,
        entry_id,
        count
    } = req.body || {};

    const allowed = await canOperate(user.id, queueId, user.is_admin);
    if (!allowed) return res.status(403).json({
        error: 'No permission to operate this queue'
    });

    // Fetch queue
    const {
        data: queue
    } = await supabase
        .from('gftvqueue_queues')
        .select('*')
        .eq('id', queueId)
        .single();

    if (!queue) return res.status(404).json({
        error: 'Queue not found'
    });

    // ── CALL NEXT ─────────────────────────────────────────────────────────────
    if (action === 'call_next' || action === 'call_batch') {
        const batchCount = action === 'call_batch' ? (count || 1) : 1;

        // How many currently serving?
        const {
            data: currentServing
        } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, telegram_user_id')
            .eq('queue_id', queueId)
            .eq('status', 'serving')
            .order('queue_number', {
                ascending: true
            });

        const servingCount = (currentServing || []).length;
        const availableSlots = queue.max_serving - servingCount;

        if (availableSlots <= 0) {
            return res.status(400).json({
                error: 'Queue is at capacity. Complete or miss some entries first.'
            });
        }

        const toCall = Math.min(batchCount, availableSlots);

        // If calling would exceed max_serving, push oldest serving to missed
        if (servingCount + toCall > queue.max_serving) {
            const overflow = (servingCount + toCall) - queue.max_serving;
            const toMiss = (currentServing || []).slice(0, overflow);
            for (const entry of toMiss) {
                await supabase
                    .from('gftvqueue_entries')
                    .update({
                        status: 'missed'
                    })
                    .eq('id', entry.id);
                // Notify via Telegram
                await notifyMissed(entry.telegram_user_id, entry.queue_number, queue.name);
            }
        }

        // Get next N waiting entries
        const {
            data: nextEntries
        } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, telegram_user_id, notify_serving')
            .eq('queue_id', queueId)
            .eq('status', 'waiting')
            .order('queue_number', {
                ascending: true
            })
            .limit(toCall);

        if (!nextEntries || nextEntries.length === 0) {
            return res.status(400).json({
                error: 'No one is waiting in the queue'
            });
        }

        // Get total in queue for context
        const {
            count: totalWaiting
        } = await supabase
            .from('gftvqueue_entries')
            .select('id', {
                count: 'exact',
                head: true
            })
            .eq('queue_id', queueId)
            .eq('status', 'waiting');

        for (const entry of nextEntries) {
            await supabase
                .from('gftvqueue_entries')
                .update({
                    status: 'serving',
                    called_at: new Date().toISOString()
                })
                .eq('id', entry.id);

            // Generate entry token for QR
            await supabase.from('gftvqueue_entry_tokens').insert({
                entry_id: entry.id
            });

            // Notify
            if (entry.notify_serving) {
                await notifyServing(entry.telegram_user_id, entry.queue_number, queue.name);
            }
        }

        // Notify "you're next" to the person after the last called
        const calledNumbers = nextEntries.map(e => e.queue_number);
        const lastCalled = Math.max(...calledNumbers);
        const {
            data: nextUp
        } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, telegram_user_id, notify_next')
            .eq('queue_id', queueId)
            .eq('status', 'waiting')
            .gt('queue_number', lastCalled)
            .order('queue_number', {
                ascending: true
            })
            .limit(1)
            .maybeSingle();

        if (nextUp && nextUp.notify_next) {
            await notifyNext(nextUp.telegram_user_id, nextUp.queue_number, queue.name);
        }

        return res.status(200).json({
            message: `Called ${nextEntries.length} attendee(s)`,
            called: nextEntries.map(e => e.queue_number)
        });
    }

    // ── MARK MISSED ───────────────────────────────────────────────────────────
    if (action === 'mark_missed') {
        if (!entry_id) return res.status(400).json({
            error: 'entry_id required'
        });

        const {
            data: entry
        } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, telegram_user_id, status')
            .eq('id', entry_id)
            .single();

        if (!entry) return res.status(404).json({
            error: 'Entry not found'
        });
        if (entry.status !== 'serving') return res.status(400).json({
            error: 'Entry must be in serving state to mark missed'
        });

        await supabase.from('gftvqueue_entries').update({
            status: 'missed'
        }).eq('id', entry_id);
        await notifyMissed(entry.telegram_user_id, entry.queue_number, queue.name);

        return res.status(200).json({
            message: 'Marked as missed'
        });
    }

    // ── MARK COMPLETE (manual) ────────────────────────────────────────────────
    if (action === 'mark_complete') {
        if (!entry_id) return res.status(400).json({
            error: 'entry_id required'
        });

        await supabase
            .from('gftvqueue_entries')
            .update({
                status: 'completed',
                completed_at: new Date().toISOString()
            })
            .eq('id', entry_id);

        return res.status(200).json({
            message: 'Marked as complete'
        });
    }

    // ── REJOIN (move missed → waiting) ───────────────────────────────────────
    if (action === 'rejoin') {
        if (!entry_id) return res.status(400).json({ error: 'entry_id required' });

        const { data: entry } = await supabase
            .from('gftvqueue_entries')
            .select('id, queue_number, telegram_user_id, status')
            .eq('id', entry_id)
            .single();

        if (!entry) return res.status(404).json({ error: 'Entry not found' });
        if (entry.status !== 'missed') return res.status(400).json({ error: 'Entry must be in missed state to rejoin' });

        await supabase.from('gftvqueue_entries').update({ status: 'waiting' }).eq('id', entry_id);

        return res.status(200).json({ message: 'Entry moved back to waiting' });
    }

    return res.status(400).json({
        error: 'Unknown action'
    });
}

async function notifyServing(telegramUserId, queueNumber, queueName) {
    if (!telegramUserId) return;
    const msg = `🎉 *It's your turn!*\n\nQueue: ${queueName}\nNumber: *#${queueNumber}*\n\nPlease proceed to the entrance and show your QR code. Open the HelloQueue site to display it.`;
    await sendTelegramMessage(telegramUserId, msg);
}

async function notifyNext(telegramUserId, queueNumber, queueName) {
    if (!telegramUserId) return;
    const msg = `⏰ *You're next in line!*\n\nQueue: ${queueName}\nNumber: *#${queueNumber}*\n\nGet ready - you'll be called soon.`;
    await sendTelegramMessage(telegramUserId, msg);
}

async function notifyMissed(telegramUserId, queueNumber, queueName) {
    if (!telegramUserId) return;
    const msg = `😔 *You missed your turn.*\n\nQueue: ${queueName}\nNumber: *#${queueNumber}*\n\nYour number was called but you weren't present. You can rejoin the queue using /joinqueue.`;
    await sendTelegramMessage(telegramUserId, msg);
}