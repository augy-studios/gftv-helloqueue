// Telegram webhook - registered with the Bot API's setWebhook method:
//   url = https://queue.gftv.asia/api/telegram/webhook
//   secret_token = the same value as TELEGRAM_WEBHOOK_SECRET in Vercel
// Telegram then sends that value in the X-Telegram-Bot-Api-Secret-Token header.
// Without TELEGRAM_WEBHOOK_SECRET set, every request is rejected.
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';
import { sendTelegramMessage } from '../_telegram.js';

// Checks the secret header, then answers one message: /start attend_<code>
// or /attend <code> (attendee sign-in), /start or /help, /link <code>
// (account link), and any other /command with "Unknown command". Telegram
// always gets a 200 once the secret matches.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    // Fail closed: with no secret configured, anyone could post a fake update
    // in any Telegram user's name, so nothing is accepted until it is set.
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret) {
        console.error('[Telegram webhook] TELEGRAM_WEBHOOK_SECRET is not set, so every request is rejected. Set it in Vercel and pass the same value as secret_token to setWebhook.');
        return response.status(403).json({ error: 'Forbidden' });
    }
    if (!secretMatches(request.headers['x-telegram-bot-api-secret-token'], expectedSecret)) {
        console.error('[Telegram webhook] Rejected a request with a missing or wrong X-Telegram-Bot-Api-Secret-Token header.');
        return response.status(403).json({ error: 'Forbidden' });
    }

    const update = request.body;
    let message = undefined;
    if (update !== null && update !== undefined) {
        message = update.message;
    }
    // Only messages are handled here. Button presses (callback queries) are
    // ignored: the Leave and notification buttons are sent and handled by the
    // polling bot (bot/index.js), which checks that the presser owns the entry.
    // If this webhook ever handles them, it needs the same check.
    if (!message) {
        return response.status(200).end();
    }

    let chatId = undefined;
    if (message.chat !== null && message.chat !== undefined) {
        chatId = message.chat.id;
    }
    let messageText = '';
    if (message.text) {
        messageText = message.text;
    }
    const text = messageText.trim();
    let sender = {};
    if (message.from) {
        sender = message.from;
    }

    // deep link + /attend
    const code = attendCodeFrom(text);
    if (code) {
        await handleAttendLogin(chatId, sender, code);
        return response.status(200).end();
    }

    if (text === '/start' || text === '/help') {
        await sendHelp(chatId);
        return response.status(200).end();
    }

    const linkMatch = text.match(/^\/link\s+([A-Z0-9]+)$/i);
    if (linkMatch) {
        await handleTelegramLink(chatId, sender, linkMatch[1].toUpperCase());
        return response.status(200).end();
    }

    if (text.startsWith('/')) {
        await sendTelegramMessage(chatId, 'Unknown command\\. Use /help to see available commands\\.', { parse_mode: 'MarkdownV2' });
    }

    return response.status(200).end();
}

// The sign-in code from "/start attend_<code>" (the queue page's deep link)
// or "/attend <code>", in upper case, or null for any other text.
function attendCodeFrom(text) {
    const startMatch = text.match(/^\/start\s+attend_([A-Z0-9]+)$/i);
    const attendMatch = text.match(/^\/attend\s+([A-Z0-9]+)$/i);
    if (startMatch) {
        return startMatch[1].toUpperCase();
    }
    if (attendMatch) {
        return attendMatch[1].toUpperCase();
    }
    return null;
}

// The /start and /help reply.
async function sendHelp(chatId) {
    await sendTelegramMessage(chatId, [
        `👋 *Welcome to GFTV HelloQueue!*`,
        ``,
        `Here's what I can do:`,
        ``,
        `🎟 */attend \\<CODE\\>* - Connect your Telegram to a queue session\\. Get the code from the queue page\\.`,
        `🔗 */link \\<OTP\\>* - Link your Telegram to a HelloQueue dashboard account\\. Get the OTP from your dashboard settings\\.`,
        `❓ */help* - Show this message\\.`,
        ``,
        `To join a queue, visit the queue link and tap *Connect Telegram*\\.`,
    ].join('\n'), { parse_mode: 'MarkdownV2' });
}

// Signs an attendee in from Telegram: checks the code the queue page showed,
// replaces any earlier attendee session for this Telegram user with a new
// one, and stores its token on the code for the page to collect. Replies in
// the chat either way.
async function handleAttendLogin(chatId, sender, code) {
    const now = new Date().toISOString();

    const { data: loginCode } = await supabase
        .from('gftvqueue_attendee_login_codes')
        .select('id, expires_at, used_at')
        .eq('code', code)
        .maybeSingle();

    if (!loginCode) {
        await sendTelegramMessage(chatId, '❌ Invalid code. Please get a new one from the queue page.');
        return;
    }
    if (loginCode.expires_at < now) {
        await sendTelegramMessage(chatId, '⏰ This code has expired. Please get a new one from the queue page.');
        return;
    }
    if (loginCode.used_at) {
        await sendTelegramMessage(chatId, '✅ This code has already been used.');
        return;
    }

    const telegramUserId = chatId;
    const fullName = [sender.first_name, sender.last_name].filter(Boolean).join(' ');
    let displayName = 'Attendee';
    if (fullName) {
        displayName = fullName;
    } else if (sender.username) {
        displayName = sender.username;
    }
    let telegramUsername = null;
    if (sender.username) {
        telegramUsername = sender.username;
    }

    // enforce single session
    await supabase
        .from('gftvqueue_attendee_sessions')
        .delete()
        .eq('telegram_user_id', telegramUserId);

    const { data: newSession, error: sessionError } = await supabase
        .from('gftvqueue_attendee_sessions')
        .insert({
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
            display_name: displayName,
        })
        .select('token')
        .single();

    if (sessionError || !newSession) {
        await sendTelegramMessage(chatId, '❌ Something went wrong. Please try again.');
        return;
    }

    // mark used
    await supabase
        .from('gftvqueue_attendee_login_codes')
        .update({ used_at: now, session_token: newSession.token })
        .eq('id', loginCode.id);

    await sendTelegramMessage(chatId,
        `✅ *You're connected!*\n\nYou can now go back to the queue page - it will load automatically.\n\nYou'll receive Telegram notifications here when it's your turn.`
    );
}

// Links a dashboard account to this Telegram user with the one-time code
// from the profile page. Any earlier link for either side is removed first.
// Replies in the chat either way.
async function handleTelegramLink(chatId, sender, otpCode) {
    const now = new Date().toISOString();

    const { data: otpRow } = await supabase
        .from('gftvqueue_telegram_otps')
        .select('id, user_id, expires_at, used_at')
        .eq('otp_code', otpCode)
        .maybeSingle();

    if (!otpRow) {
        await sendTelegramMessage(chatId, '❌ Invalid OTP code. Please generate a new one from your dashboard.');
        return;
    }
    if (otpRow.expires_at < now || otpRow.used_at) {
        await sendTelegramMessage(chatId, '⏰ This OTP has expired. Please generate a new one from your dashboard.');
        return;
    }

    const telegramUserId = chatId;
    let telegramUsername = null;
    if (sender.username) {
        telegramUsername = sender.username;
    }

    // clear old links
    await supabase.from('gftvqueue_telegram_links').delete().eq('telegram_user_id', telegramUserId);
    await supabase.from('gftvqueue_telegram_links').delete().eq('user_id', otpRow.user_id);

    const { error: linkError } = await supabase
        .from('gftvqueue_telegram_links')
        .insert({
            user_id: otpRow.user_id,
            telegram_user_id: telegramUserId,
            telegram_username: telegramUsername,
        });

    if (linkError) {
        await sendTelegramMessage(chatId, '❌ Failed to link account. Please try again.');
        return;
    }

    await supabase
        .from('gftvqueue_telegram_otps')
        .update({ used_at: now })
        .eq('id', otpRow.id);

    await sendTelegramMessage(chatId, '✅ *Telegram account linked successfully!*\n\nYou will now receive queue notifications here.');
}

// True when the header holds exactly the expected secret. Both values are
// hashed to the same length first, so timingSafeEqual never throws on a
// different length and the time taken reveals neither the secret nor its length.
function secretMatches(receivedSecret, expectedSecret) {
    if (typeof receivedSecret !== 'string') {
        return false;
    }
    const receivedDigest = createHash('sha256').update(receivedSecret, 'utf8').digest();
    const expectedDigest = createHash('sha256').update(expectedSecret, 'utf8').digest();
    return timingSafeEqual(receivedDigest, expectedDigest);
}
