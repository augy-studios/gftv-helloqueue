import { handleCors, requireAuth } from '../_auth.js';
import { supabase } from '../_supabase.js';

// The signed-in account's Telegram link, for the profile page.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'GET') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    // Fetch telegram link status
    const { data: telegramLink } = await supabase
        .from('gftvqueue_telegram_links')
        .select('telegram_username, linked_at')
        .eq('user_id', user.id)
        .maybeSingle();

    // Only what the profile page reads from here (rule F2): whether Telegram
    // is linked, the linked @username and when. The page takes the rest of
    // the account from hq_user, saved at sign-in.
    let telegramUsername = null;
    let telegramLinkedAt = null;
    if (telegramLink && telegramLink.telegram_username) {
        telegramUsername = telegramLink.telegram_username;
    }
    if (telegramLink && telegramLink.linked_at) {
        telegramLinkedAt = telegramLink.linked_at;
    }

    return response.status(200).json({
        user: {
            telegram_linked: Boolean(telegramLink),
            telegram_username: telegramUsername,
            telegram_linked_at: telegramLinkedAt,
        },
    });
}
