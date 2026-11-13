import { randomInt } from 'crypto';
import { supabase } from './_supabase.js';

/**
 * The token from an "Authorization: Bearer <token>" header, or '' when the
 * header is missing or empty.
 */
export function readBearerToken(request) {
    let authorizationHeader = '';
    if (request.headers['authorization']) {
        authorizationHeader = request.headers['authorization'];
    }
    return authorizationHeader.replace(/^Bearer\s+/, '').trim();
}

/**
 * Accepts either a full account session token or an attendee session token.
 * Returns { telegram_user_id, display_name, is_attendee } or sends 401/403.
 */
export async function requireQueueAccess(request, response) {
    const token = readBearerToken(request);

    if (!token) {
        response.status(401).json({ error: 'Missing authorization token' });
        return null;
    }

    const now = new Date().toISOString();

    // Try full account session first
    const { data: session } = await supabase
        .from('gftvhello_sessions')
        .select('user_id, expires_at')
        .eq('token', token)
        .maybeSingle();

    if (session) {
        return queueCallerFromAccount(session, now, response);
    }

    // Try attendee session
    const { data: attendeeSession } = await supabase
        .from('gftvqueue_attendee_sessions')
        .select('telegram_user_id, display_name, expires_at')
        .eq('token', token)
        .maybeSingle();

    if (!attendeeSession) {
        response.status(401).json({ error: 'Invalid or expired session' });
        return null;
    }
    if (attendeeSession.expires_at < now) {
        response.status(401).json({ error: 'Session expired' });
        return null;
    }
    return {
        telegram_user_id: attendeeSession.telegram_user_id,
        display_name: attendeeSession.display_name,
        is_attendee: true,
    };
}

/**
 * The queue caller for a full account session. The account must be
 * unexpired, approved and linked to Telegram, because queue entries belong
 * to a Telegram user. Sends 400/401/403 and returns null otherwise.
 */
async function queueCallerFromAccount(session, now, response) {
    if (session.expires_at < now) {
        response.status(401).json({ error: 'Session expired' });
        return null;
    }
    const { data: user } = await supabase
        .from('gftvhello_users')
        .select('id, display_name, is_approved')
        .eq('id', session.user_id)
        .single();
    if (!user) {
        response.status(401).json({ error: 'User not found' });
        return null;
    }
    if (!user.is_approved) {
        response.status(403).json({ error: 'Account pending approval' });
        return null;
    }

    const { data: telegramLink } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_user_id, telegram_username')
        .eq('user_id', user.id)
        .maybeSingle();

    if (!telegramLink) {
        response.status(400).json({ error: 'Telegram account not linked' });
        return null;
    }
    return { telegram_user_id: telegramLink.telegram_user_id, display_name: user.display_name, is_attendee: false };
}

/**
 * Validates the Bearer token from the Authorization header: the session must
 * exist and be unexpired, and its account must exist and be approved.
 * Returns the user on success, or sends a 401 or 403 and returns null.
 */
export async function requireAuth(request, response) {
    const token = readBearerToken(request);

    if (!token) {
        response.status(401).json({
            error: 'Missing authorization token'
        });
        return null;
    }

    const now = new Date().toISOString();

    const {
        data: session,
        error
    } = await supabase
        .from('gftvhello_sessions')
        .select('user_id, expires_at')
        .eq('token', token)
        .single();

    if (error || !session) {
        response.status(401).json({
            error: 'Invalid or expired session'
        });
        return null;
    }

    if (session.expires_at < now) {
        response.status(401).json({
            error: 'Session expired'
        });
        return null;
    }

    const {
        data: user,
        error: userError
    } = await supabase
        .from('gftvhello_users')
        .select('id, username, display_name, email, is_admin, is_approved, is_editor, avatar_url')
        .eq('id', session.user_id)
        .single();

    if (userError || !user) {
        response.status(401).json({
            error: 'User not found'
        });
        return null;
    }

    if (!user.is_approved) {
        response.status(403).json({
            error: 'Account pending approval'
        });
        return null;
    }

    return user;
}

/**
 * Quick CORS preflight handler – call at the top of every API route.
 * Returns true if the request was a preflight (caller should return immediately).
 */
export function handleCors(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (request.method === 'OPTIONS') {
        response.status(204).end();
        return true;
    }
    return false;
}

/** Generate a random alphanumeric string of given length (crypto-secure) */
export function randomCode(length = 8) {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous
    let code = '';
    for (let index = 0; index < length; index++) {
        code += characters[randomInt(characters.length)];
    }
    return code;
}
