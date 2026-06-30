// POST /api/auth/login — EXEMPT from verifySignedRequest (this issues the signing key)
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import {
    v4 as uuidv4
} from 'uuid';
import {
    supabase
} from '../_supabase.js';
import {
    handleCors
} from '../_auth.js';

async function createSigningKey(sessionToken, expiresAt) {
    const signing_key = crypto.randomBytes(32).toString('hex');
    await supabase.from('gftvhello_signing_keys').insert({
        session_token: sessionToken,
        signing_key,
        is_guest: false,
        app_id: 'helloqueue',
        expires_at: expiresAt,
    });
    // key_id == session_token so the client can look it up with X-Key-ID
    return { signing_key, key_id: sessionToken };
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const {
        username,
        password,
        device_token,
    } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({
            error: 'Username and password are required'
        });
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
        return res.status(401).json({
            error: 'Invalid credentials'
        });
    }

    if (!user.is_approved) {
        return res.status(403).json({
            error: 'Account pending approval'
        });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({
            error: 'Invalid credentials'
        });
    }

    // Upgrade hash cost if stored at a higher round than current target
    const currentRounds = bcrypt.getRounds(user.password_hash);
    if (currentRounds > 10) {
        const newHash = await bcrypt.hash(password, 10);
        await supabase
            .from('gftvhello_users')
            .update({ password_hash: newHash })
            .eq('id', user.id);
    }

    // If TOTP is enabled, check for a valid trusted device token first
    if (user.totp_secret) {
        if (device_token) {
            const { data: trusted } = await supabase
                .from('gftvhello_trusted_devices')
                .select('id, expires_at')
                .eq('user_id', user.id)
                .eq('device_token', device_token)
                .single();

            if (trusted && new Date(trusted.expires_at) > new Date()) {
                // Trusted device — skip TOTP, issue session directly
                const token = uuidv4();
                const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
                await supabase.from('gftvhello_sessions').insert({ user_id: user.id, token, expires_at: expiresAt });
                const { signing_key, key_id } = await createSigningKey(token, expiresAt);
                return res.status(200).json({
                    token,
                    expires_at: expiresAt,
                    signing_key,
                    key_id,
                    user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin, is_editor: user.is_editor },
                });
            }
        }
    }

    if (user.totp_secret) {
        const challengeToken = uuidv4();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await supabase.from('gftvhello_totp_challenges').insert({
            token: challengeToken,
            user_id: user.id,
            expires_at: expiresAt,
        });

        // No signing key yet — it will be issued by /auth/totp-verify after TOTP succeeds
        return res.status(200).json({
            requires_totp: true,
            totp_token: challengeToken
        });
    }

    // Issue full session
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

    await supabase.from('gftvhello_sessions').insert({
        user_id: user.id,
        token,
        expires_at: expiresAt,
    });

    const { signing_key, key_id } = await createSigningKey(token, expiresAt);

    return res.status(200).json({
        token,
        expires_at: expiresAt,
        signing_key,
        key_id,
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin,
            is_editor: user.is_editor,
        },
    });
}
