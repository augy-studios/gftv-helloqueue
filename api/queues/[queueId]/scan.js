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
import { verifySignedRequest } from '../../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;
    const {
        token,
        scan_type = 'exit',
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

    if (scan_type === 'entrance') {
        await supabase
            .from('gftvqueue_entries')
            .update({ entered_at: new Date().toISOString() })
            .eq('id', entry.id);

        const tgMsg = `🚪 *Entrance confirmed!*\n\nNumber: *#${entry.queue_number}*\nName: ${entry.display_name}\n\nWelcome! Show this QR code again when you exit.`;
        await sendTelegramMessage(entry.telegram_user_id, tgMsg);

        return res.status(200).json({
            valid: true,
            message: 'Entrance confirmed.',
            queue_number: entry.queue_number,
            name: entry.display_name,
        });
    }

    // Exit scan — mark token used and complete the entry
    await supabase
        .from('gftvqueue_entry_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', tokenRow.id);

    await supabase
        .from('gftvqueue_entries')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', entry.id);

    const tgMsg = `✅ *Exit confirmed!*\n\nNumber: *#${entry.queue_number}*\nName: ${entry.display_name}\n\nThank you for visiting the Dealers' Den!`;
    await sendTelegramMessage(entry.telegram_user_id, tgMsg);

    return res.status(200).json({
        valid: true,
        message: 'Exit confirmed - marked complete.',
        queue_number: entry.queue_number,
        name: entry.display_name,
    });
}