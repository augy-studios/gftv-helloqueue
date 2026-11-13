import bcrypt from 'bcryptjs';
import { v4 as generateUuid } from 'uuid';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';

// Signs in with a username and password. An account with two-factor sign-in
// (TOTP) gets a session straight away only from a trusted device; otherwise
// it gets a challenge token for /api/auth/totp-verify. Every other approved
// account gets a session.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const username = body.username;
    const password = body.password;
    const deviceToken = body.device_token;
    if (!username || !password) {
        return response.status(400).json({ error: 'Username and password are required' });
    }

    // Fetch user by username
    const {
        data: user,
        error
    } = await supabase
        .from('gftvhello_users')
        .select('id, username, display_name, password_hash, is_admin, is_approved, is_editor, totp_secret')
        .eq('username', username)
        .single();

    if (error || !user) {
        return response.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_approved) {
        return response.status(403).json({ error: 'Account pending approval' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
        return response.status(401).json({ error: 'Invalid credentials' });
    }

    await lowerPasswordHashCost(user, password);

    // If TOTP is enabled, check for a valid trusted device token first
    if (user.totp_secret) {
        if (deviceToken) {
            const trusted = await isTrustedDevice(user.id, deviceToken);
            if (trusted) {
                // Trusted device — skip TOTP, issue session directly
                return startSession(user, response);
            }
        }
        return startTotpChallenge(user, response);
    }

    // Issue full session
    return startSession(user, response);
}

// Upgrade hash cost if stored at a higher round than current target: a hash
// made with more than 10 rounds is replaced by a 10-round hash.
async function lowerPasswordHashCost(user, password) {
    const currentRounds = bcrypt.getRounds(user.password_hash);
    if (currentRounds > 10) {
        const newHash = await bcrypt.hash(password, 10);
        await supabase
            .from('gftvhello_users')
            .update({ password_hash: newHash })
            .eq('id', user.id);
    }
}

// True when this device token belongs to the user and hasn't expired.
async function isTrustedDevice(userId, deviceToken) {
    const { data: trustedDevice } = await supabase
        .from('gftvhello_trusted_devices')
        .select('id, expires_at')
        .eq('user_id', userId)
        .eq('device_token', deviceToken)
        .single();

    if (!trustedDevice) {
        return false;
    }
    return new Date(trustedDevice.expires_at) > new Date();
}

// Starts a 7-day session and sends its token. The sign-in page keeps the
// token and saves `user` as hq_user, which the dashboard reads (rule F2:
// nothing else is sent).
async function startSession(user, response) {
    const token = generateUuid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await supabase.from('gftvhello_sessions').insert({
        user_id: user.id,
        token: token,
        expires_at: expiresAt,
    });

    return response.status(200).json({
        token: token,
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin,
            is_editor: user.is_editor,
        },
    });
}

// Starts a 10-minute two-factor challenge and sends its token, which the
// sign-in page passes to /api/auth/totp-verify with the code.
async function startTotpChallenge(user, response) {
    const challengeToken = generateUuid();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabase.from('gftvhello_totp_challenges').insert({
        token: challengeToken,
        user_id: user.id,
        expires_at: expiresAt,
    });

    return response.status(200).json({
        requires_totp: true,
        totp_token: challengeToken
    });
}
