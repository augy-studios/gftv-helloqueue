import bcrypt from 'bcryptjs';
import {
    v4 as uuidv4
} from 'uuid';
import {
    supabase
} from '../_supabase.js';
import {
    handleCors
} from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const {
        username,
        password
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

    // If TOTP is enabled, issue a totp_challenge instead of a full session
    if (user.totp_secret) {
        const challengeToken = uuidv4();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await supabase.from('gftvhello_totp_challenges').insert({
            token: challengeToken,
            user_id: user.id,
            expires_at: expiresAt,
        });

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

    return res.status(200).json({
        token,
        expires_at: expiresAt,
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            is_admin: user.is_admin,
            is_editor: user.is_editor,
        },
    });
}