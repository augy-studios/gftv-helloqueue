// GET /api/auth/guest-key — issues a short-lived guest signing key (10 min TTL)
// Exempt from verifySignedRequest (this IS the key-issuance endpoint)
import crypto from 'node:crypto';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // Allow requests with no Origin (same-origin, normal browser behaviour).
    // Only reject when Origin IS present and is not in the allowed list.
    const origin = req.headers['origin'];
    if (origin) {
        const allowed = (process.env.ALLOWED_ORIGINS || '')
            .split(',').map(s => s.trim()).filter(Boolean);
        if (allowed.length > 0 && !allowed.includes(origin)) {
            return res.status(403).json({ error: 'Origin not allowed' });
        }
    }

    const session_token = crypto.randomUUID();
    const signing_key   = crypto.randomBytes(32).toString('hex');
    const expires_at    = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase
        .from('gftvhello_signing_keys')
        .insert({
            session_token,
            signing_key,
            is_guest: true,
            app_id: req.query.app || 'unknown',
            expires_at,
        });

    if (error) {
        console.error('guest-key insert error:', error);
        return res.status(500).json({ error: 'Failed to create guest signing key' });
    }

    return res.status(200).json({ key_id: session_token, signing_key });
}
