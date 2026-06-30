import {
    supabase
} from './_supabase.js';

/**
 * Accepts either a full account session token or an attendee session token.
 * Returns { telegram_user_id, display_name, is_attendee } or sends 401/403.
 */
export async function requireQueueAccess(req, res) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();

    if (!token) {
        res.status(401).json({ error: 'Missing authorization token' });
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
        if (session.expires_at < now) {
            res.status(401).json({ error: 'Session expired' });
            return null;
        }
        const { data: user } = await supabase
            .from('gftvhello_users')
            .select('id, display_name, is_approved')
            .eq('id', session.user_id)
            .single();
        if (!user) { res.status(401).json({ error: 'User not found' }); return null; }
        if (!user.is_approved) { res.status(403).json({ error: 'Account pending approval' }); return null; }

        const { data: tgLink } = await supabase
            .from('gftvqueue_telegram_links')
            .select('telegram_user_id, telegram_username')
            .eq('user_id', user.id)
            .maybeSingle();

        if (!tgLink) {
            res.status(400).json({ error: 'Telegram account not linked' });
            return null;
        }
        return { telegram_user_id: tgLink.telegram_user_id, display_name: user.display_name, is_attendee: false };
    }

    // Try attendee session
    const { data: attendeeSession } = await supabase
        .from('gftvqueue_attendee_sessions')
        .select('telegram_user_id, display_name, expires_at')
        .eq('token', token)
        .maybeSingle();

    if (!attendeeSession) {
        res.status(401).json({ error: 'Invalid or expired session' });
        return null;
    }
    if (attendeeSession.expires_at < now) {
        res.status(401).json({ error: 'Session expired' });
        return null;
    }
    return {
        telegram_user_id: attendeeSession.telegram_user_id,
        display_name: attendeeSession.display_name,
        is_attendee: true,
    };
}

/**
 * Validates the Bearer token from the Authorization header.
 * Returns { user } on success or sends a 401 and returns null.
 */
export async function requireAuth(req, res) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();

    if (!token) {
        res.status(401).json({
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
        res.status(401).json({
            error: 'Invalid or expired session'
        });
        return null;
    }

    if (session.expires_at < now) {
        res.status(401).json({
            error: 'Session expired'
        });
        return null;
    }

    const {
        data: user,
        error: userErr
    } = await supabase
        .from('gftvhello_users')
        .select('id, username, display_name, email, is_admin, is_approved, is_editor, avatar_url')
        .eq('id', session.user_id)
        .single();

    if (userErr || !user) {
        res.status(401).json({
            error: 'User not found'
        });
        return null;
    }

    if (!user.is_approved) {
        res.status(403).json({
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
export function handleCors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Token, X-Request-TS, X-Key-ID');
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return true;
    }
    return false;
}

/** Generate a random alphanumeric string of given length */
export function randomCode(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous
    let out = '';
    for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}