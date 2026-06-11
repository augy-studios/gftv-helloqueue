import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/, '').trim();
    if (token) {
        await supabase.from('gftvhello_sessions').delete().eq('token', token);
    }
    return res.status(200).json({
        message: 'Logged out'
    });
}