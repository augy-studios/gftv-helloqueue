import { authenticator } from 'otplib';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { totp_token, code } = req.body || {};
    if (!totp_token || !code) return res.status(400).json({ error: 'Missing token or code' });

    const { data: challenge, error } = await supabase
        .from('gftvhello_totp_challenges')
        .select('user_id, expires_at')
        .eq('token', totp_token)
        .single();

    if (error || !challenge) return res.status(401).json({ error: 'Invalid or expired token' });
    if (new Date(challenge.expires_at) < new Date()) return res.status(401).json({ error: 'Token expired, please sign in again' });

    const { data: user, error: userError } = await supabase
        .from('gftvhello_users')
        .select('id, username, display_name, is_admin, is_editor, totp_secret')
        .eq('id', challenge.user_id)
        .single();

    if (userError || !user) return res.status(401).json({ error: 'User not found' });

    const normalised = code.replace(/[\s-]/g, '');
    let authenticated = false;

    // Try TOTP
    if (/^\d{6}$/.test(normalised)) {
        authenticated = authenticator.verify({ token: normalised, secret: user.totp_secret });
    }

    // Try backup codes if TOTP didn't match
    if (!authenticated) {
        const { data: backupCodes } = await supabase
            .from('gftvhello_backup_codes')
            .select('id, code_hash')
            .eq('user_id', user.id)
            .is('used_at', null);

        if (backupCodes) {
            for (const row of backupCodes) {
                if (await bcrypt.compare(normalised.toUpperCase(), row.code_hash)) {
                    await supabase
                        .from('gftvhello_backup_codes')
                        .update({ used_at: new Date().toISOString() })
                        .eq('id', row.id);
                    authenticated = true;
                    break;
                }
            }
        }
    }

    if (!authenticated) return res.status(401).json({ error: 'Invalid code' });

    await supabase.from('gftvhello_totp_challenges').delete().eq('token', totp_token);

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

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
