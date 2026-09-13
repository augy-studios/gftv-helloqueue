// POST → generate attendee login code
// GET  ?code=XXX → poll for completion, returns session token once bot authenticates
import { supabase } from '../_supabase.js';
import { handleCors, randomCode } from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    if (req.method === 'POST') {
        const code = randomCode(6);
        const { error } = await supabase
            .from('gftvqueue_attendee_login_codes')
            .insert({ code });

        if (error) return res.status(500).json({ error: error.message });

        return res.status(200).json({
            code,
            bot_username: process.env.TELEGRAM_BOT_USERNAME || '',
        });
    }

    if (req.method === 'GET') {
        const { code } = req.query;
        if (!code) return res.status(400).json({ error: 'Missing code' });

        const now = new Date().toISOString();

        const { data: loginCode } = await supabase
            .from('gftvqueue_attendee_login_codes')
            .select('used_at, expires_at, session_token')
            .eq('code', code)
            .maybeSingle();

        if (!loginCode) return res.status(404).json({ error: 'Code not found' });
        if (loginCode.expires_at < now && !loginCode.used_at) {
            return res.status(410).json({ error: 'Code expired' });
        }

        if (!loginCode.used_at) return res.status(202).json({ pending: true });

        return res.status(200).json({ token: loginCode.session_token });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
