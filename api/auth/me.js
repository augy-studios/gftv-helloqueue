import {
    handleCors,
    requireAuth
} from '../_auth.js';
import {
    supabase
} from '../_supabase.js';
import { verifySignedRequest } from '../../lib/gftv-request-signing-server.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({
        error: 'Method not allowed'
    });

    const { valid, reason } = await verifySignedRequest(req, supabase);
    if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason}` });

    const user = await requireAuth(req, res);
    if (!user) return;

    // Fetch telegram link status
    const {
        data: tgLink
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_username, linked_at')
        .eq('user_id', user.id)
        .maybeSingle();

    return res.status(200).json({
        user: {
            ...user,
            telegram_linked: !!tgLink,
            telegram_username: tgLink?.telegram_username || null,
            telegram_linked_at: tgLink?.linked_at || null,
        },
    });
}