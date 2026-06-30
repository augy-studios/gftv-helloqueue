import {
    supabase
} from '../_supabase.js';
import {
    handleCors
} from '../_auth.js';
import { verifySignedRequest } from '../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '').trim();
    if (token) {
        await supabase.from('gftvhello_sessions').delete().eq('token', token);
        // Delete signing key whose session_token matches the bearer token
        await supabase.from('gftvhello_signing_keys').delete().eq('session_token', token);
    }
    return res.status(200).json({
        message: 'Logged out'
    });
}
