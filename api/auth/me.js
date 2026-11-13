import {
    handleCors,
    requireAuth
} from '../_auth.js';
import {
    supabase
} from '../_supabase.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'GET') return res.status(405).json({
        error: 'Method not allowed'
    });

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

    // Only what the profile page reads from here (rule F2): whether Telegram
    // is linked, the linked @username and when. The page takes the rest of
    // the account from hq_user, saved at sign-in.
    let telegramUsername = null;
    let telegramLinkedAt = null;
    if (tgLink && tgLink.telegram_username) {
        telegramUsername = tgLink.telegram_username;
    }
    if (tgLink && tgLink.linked_at) {
        telegramLinkedAt = tgLink.linked_at;
    }

    return res.status(200).json({
        user: {
            telegram_linked: !!tgLink,
            telegram_username: telegramUsername,
            telegram_linked_at: telegramLinkedAt,
        },
    });
}