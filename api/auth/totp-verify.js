import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import { v4 as generateUuid } from 'uuid';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';

// The second sign-in step: takes the challenge token from /api/auth/login and
// a 6-digit TOTP code or an unused backup code. On success it ends the
// challenge, starts a 7-day session and, if asked, trusts this device for
// 30 days.
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
    const totpToken = body.totp_token;
    const code = body.code;
    const trustDevice = body.trust_device;
    if (!totpToken || !code) {
        return response.status(400).json({ error: 'Missing token or code' });
    }

    const { data: challenge, error } = await supabase
        .from('gftvhello_totp_challenges')
        .select('user_id, expires_at')
        .eq('token', totpToken)
        .single();

    if (error || !challenge) {
        return response.status(401).json({ error: 'Invalid or expired token' });
    }
    if (new Date(challenge.expires_at) < new Date()) {
        return response.status(401).json({ error: 'Token expired, please sign in again' });
    }

    const { data: user, error: userError } = await supabase
        .from('gftvhello_users')
        .select('id, username, display_name, is_admin, is_editor, totp_secret')
        .eq('id', challenge.user_id)
        .single();

    if (userError || !user) {
        return response.status(401).json({ error: 'User not found' });
    }

    const authenticated = await verifyCode(user, code);
    if (!authenticated) {
        return response.status(401).json({ error: 'Invalid code' });
    }

    await supabase.from('gftvhello_totp_challenges').delete().eq('token', totpToken);

    const token = generateUuid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('gftvhello_sessions').insert({
        user_id: user.id,
        token: token,
        expires_at: expiresAt,
    });

    let deviceToken = null;
    if (trustDevice) {
        deviceToken = await trustThisDevice(user.id);
    }

    // The sign-in page keeps the token and device_token, and saves `user` as
    // hq_user (rule F2: nothing else is sent).
    return response.status(200).json({
        token: token,
        device_token: deviceToken,
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin,
            is_editor: user.is_editor,
        },
    });
}

// True when the code is the user's current TOTP code or one of their unused
// backup codes. Spaces and dashes are ignored. A matching backup code is
// used up.
async function verifyCode(user, code) {
    const normalisedCode = code.replace(/[\s-]/g, '');
    let authenticated = false;

    // Try TOTP
    if (/^\d{6}$/.test(normalisedCode)) {
        authenticated = authenticator.verify({ token: normalisedCode, secret: user.totp_secret });
    }

    // Try backup codes if TOTP didn't match
    if (!authenticated) {
        authenticated = await useBackupCode(user.id, normalisedCode);
    }

    return authenticated;
}

// Checks the code against the user's unused backup codes. The first match is
// marked used and true is returned; with no match, false.
async function useBackupCode(userId, normalisedCode) {
    const { data: backupCodes } = await supabase
        .from('gftvhello_backup_codes')
        .select('id, code_hash')
        .eq('user_id', userId)
        .is('used_at', null);

    if (!backupCodes) {
        return false;
    }
    for (const backupCode of backupCodes) {
        if (await bcrypt.compare(normalisedCode.toUpperCase(), backupCode.code_hash)) {
            await supabase
                .from('gftvhello_backup_codes')
                .update({ used_at: new Date().toISOString() })
                .eq('id', backupCode.id);
            return true;
        }
    }
    return false;
}

// Saves a new 30-day trusted device token for the user and returns it.
async function trustThisDevice(userId) {
    const deviceToken = generateUuid();
    const deviceExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('gftvhello_trusted_devices').insert({
        user_id: userId,
        device_token: deviceToken,
        expires_at: deviceExpiry,
    });
    return deviceToken;
}
