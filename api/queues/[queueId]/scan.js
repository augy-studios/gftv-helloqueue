// POST { token } → validate a one-time entry QR token
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
        token
    } = req.body || {};
    if (!token) return res.status(400).json({
        error: 'Token is required'
    });

    // Check permission to operate
    const allowed = user.is_admin || await (async () => {
        const {
            data
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .select('id').eq('queue_id', queueId).eq('user_id', user.id).maybeSingle();
        return !!data;
    })();
    if (!allowed) return res.status(403).json({
        error: 'No permission to scan for this queue'
    });

    // Fetch token
    const {
        data: tokenRow,
        error
    } = await supabase
        .from('gftvqueue_entry_tokens')
        .select('id, used_at, entry_id, gftvqueue_entries(id, queue_number, status, display_name, telegram_user_id, queue_id)')
        .eq('token', token)
        .maybeSingle();

    if (error || !tokenRow) {
        return res.status(404).json({
            error: 'Invalid QR code',
            valid: false
        });
    }

    const entry = tokenRow.gftvqueue_entries;

    // Make sure this token belongs to this queue
    if (entry.queue_id !== queueId) {
        return res.status(400).json({
            error: 'QR code does not belong to this queue',
            valid: false
        });
    }

    // Already used
    if (tokenRow.used_at) {
        return res.status(409).json({
            error: 'This QR code has already been used',
            valid: false
        });
    }

    // Entry must be in 'serving' state
    if (entry.status === 'missed') {
        return res.status(400).json({
            error: 'This attendee was marked as missed - they must rejoin the queue.',
            valid: false,
            name: entry.display_name,
            queue_number: entry.queue_number,
        });
    }

    if (entry.status !== 'serving') {
        return res.status(400).json({
            error: `Entry is in state: ${entry.status}. Only 'serving' entries can be scanned.`,
            valid: false,
        });
    }

    // Mark token used
    await supabase
        .from('gftvqueue_entry_tokens')
        .update({
            used_at: new Date().toISOString()
        })
        .eq('id', tokenRow.id);

    // Mark entry complete
    await supabase
        .from('gftvqueue_entries')
        .update({
            status: 'completed',
            completed_at: new Date().toISOString()
        })
        .eq('id', entry.id);

    // Telegram notification
    const tgMsg = `✅ *Entry confirmed!*\n\nNumber: *#${entry.queue_number}*\nName: ${entry.display_name}\n\nEnjoy your time at the Dealers' Den!`;
    await sendTelegramMessage(entry.telegram_user_id, tgMsg);

    return res.status(200).json({
        valid: true,
        message: 'Validated - marked served.',
        queue_number: entry.queue_number,
        name: entry.display_name,
    });
}