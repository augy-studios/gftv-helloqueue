// POST → generate attendee login code
// GET  ?code=XXX → poll for completion, returns session token once bot authenticates
import { supabase } from '../_supabase.js';
import { handleCors, randomCode } from '../_auth.js';

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    if (request.method === 'POST') {
        return createLoginCode(response);
    }
    if (request.method === 'GET') {
        return pollLoginCode(request, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// Makes a 6-character code for the attendee to send to the bot, and names
// the bot to send it to.
async function createLoginCode(response) {
    const code = randomCode(6);
    const { error } = await supabase
        .from('gftvqueue_attendee_login_codes')
        .insert({ code: code });

    if (error) {
        return response.status(500).json({ error: error.message });
    }

    let botUsername = '';
    if (process.env.TELEGRAM_BOT_USERNAME) {
        botUsername = process.env.TELEGRAM_BOT_USERNAME;
    }
    return response.status(200).json({
        code: code,
        bot_username: botUsername,
    });
}

// The attendee page polls here until the bot has signed the attendee in.
// 202 while waiting, 410 once the code expires, then the session token
// exactly once (every later poll gets 410).
async function pollLoginCode(request, response) {
    const { code } = request.query;
    if (!code) {
        return response.status(400).json({ error: 'Missing code' });
    }

    const now = new Date().toISOString();

    const { data: loginCode } = await supabase
        .from('gftvqueue_attendee_login_codes')
        .select('id, used_at, expires_at, session_token')
        .eq('code', code)
        .maybeSingle();

    if (!loginCode) {
        return response.status(404).json({ error: 'Code not found' });
    }
    if (loginCode.expires_at < now && !loginCode.used_at) {
        return response.status(410).json({ error: 'Code expired' });
    }

    if (!loginCode.used_at) {
        return response.status(202).json({ pending: true });
    }

    // The token has already been handed out once: refuse every later poll.
    if (!loginCode.session_token) {
        return response.status(410).json({ error: 'Code already used' });
    }

    // Hand the token out once. Clear it, but only while it still holds the
    // value read above, so two polls at the same moment can't both get it.
    const { data: claimed } = await supabase
        .from('gftvqueue_attendee_login_codes')
        .update({ session_token: null })
        .eq('id', loginCode.id)
        .eq('session_token', loginCode.session_token)
        .select('id');

    if (!claimed || claimed.length === 0) {
        return response.status(410).json({ error: 'Code already used' });
    }

    return response.status(200).json({ token: loginCode.session_token });
}
