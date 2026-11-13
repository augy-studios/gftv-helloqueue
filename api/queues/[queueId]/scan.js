// POST { token, scan_type } → validate a one-time entry QR token.
// scan_type 'entrance' confirms the attendee went in; anything else
// (the default is 'exit') uses up the token and completes the entry.
import { supabase } from '../../_supabase.js';
import { handleCors, requireAuth } from '../../_auth.js';
import { sendTelegramMessage } from '../../_telegram.js';

// Checks the scanner and the token, then confirms an entrance or an exit.
// Every refusal sends { error, valid: false }.
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
    const token = body.token;
    let scanType = 'exit';
    if (body.scan_type !== undefined) {
        scanType = body.scan_type;
    }
    if (!token) {
        return response.status(400).json({ error: 'Token is required' });
    }

    // Check permission to operate
    let allowed = false;
    if (user.is_admin) {
        allowed = true;
    } else {
        allowed = await hasQueuePermission(user.id, queueId);
    }
    if (!allowed) {
        return response.status(403).json({ error: 'No permission to scan for this queue' });
    }

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
        return response.status(404).json({ error: 'Invalid QR code', valid: false });
    }

    const entry = tokenRow.gftvqueue_entries;

    const problem = findScanProblem(tokenRow, entry, queueId);
    if (problem) {
        return response.status(problem.status).json({ error: problem.error, valid: false });
    }

    if (scanType === 'entrance') {
        return confirmEntrance(entry, response);
    }
    return confirmExit(tokenRow, entry, response);
}

// True when the user has a permission row for this queue.
async function hasQueuePermission(userId, queueId) {
    const { data: permission } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('id').eq('queue_id', queueId).eq('user_id', userId).maybeSingle();
    return Boolean(permission);
}

// Why this token can't be scanned here, as { status, error }, or null when it
// can. The scanner shows only the error (rule F2).
function findScanProblem(tokenRow, entry, queueId) {
    // Make sure this token belongs to this queue
    if (entry.queue_id !== queueId) {
        return { status: 400, error: 'QR code does not belong to this queue' };
    }

    // Already used
    if (tokenRow.used_at) {
        return { status: 409, error: 'This QR code has already been used' };
    }

    // Entry must be in 'serving' state
    if (entry.status === 'missed') {
        return { status: 400, error: 'This attendee was marked as missed - they must rejoin the queue.' };
    }

    if (entry.status !== 'serving') {
        return { status: 400, error: `Entry is in state: ${entry.status}. Only 'serving' entries can be scanned.` };
    }

    return null;
}

// Entrance scan: records when the attendee went in. The token stays valid
// for the exit scan.
async function confirmEntrance(entry, response) {
    await supabase
        .from('gftvqueue_entries')
        .update({ entered_at: new Date().toISOString() })
        .eq('id', entry.id);

    const telegramMessage = `🚪 *Entrance confirmed!*\n\nNumber: *#${entry.queue_number}*\nName: ${entry.display_name}\n\nWelcome! Show this QR code again when you exit.`;
    await sendTelegramMessage(entry.telegram_user_id, telegramMessage);

    return response.status(200).json({
        valid: true,
        message: 'Entrance confirmed.',
        queue_number: entry.queue_number,
        name: entry.display_name,
    });
}

// Exit scan: marks the token used and completes the entry.
async function confirmExit(tokenRow, entry, response) {
    await supabase
        .from('gftvqueue_entry_tokens')
        .update({ used_at: new Date().toISOString() })
        .eq('id', tokenRow.id);

    await supabase
        .from('gftvqueue_entries')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', entry.id);

    const telegramMessage = `✅ *Exit confirmed!*\n\nNumber: *#${entry.queue_number}*\nName: ${entry.display_name}\n\nThank you for visiting the Dealers' Den!`;
    await sendTelegramMessage(entry.telegram_user_id, telegramMessage);

    return response.status(200).json({
        valid: true,
        message: 'Exit confirmed - marked complete.',
        queue_number: entry.queue_number,
        name: entry.display_name,
    });
}
