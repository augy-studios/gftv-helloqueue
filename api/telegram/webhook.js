// Telegram webhook - registered with the Bot API's setWebhook method:
//   url = https://queue.gftv.asia/api/telegram/webhook
//   secret_token = the same value as TELEGRAM_WEBHOOK_SECRET in Vercel
// Telegram then sends that value in the X-Telegram-Bot-Api-Secret-Token header.
// Without TELEGRAM_WEBHOOK_SECRET set, every request is rejected.
import { createHash, timingSafeEqual } from 'node:crypto';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';
import { sendTelegramMessage } from '../_telegram.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Fail closed: with no secret configured, anyone could post a fake update
    // in any Telegram user's name, so nothing is accepted until it is set.
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!expectedSecret) {
        console.error('[Telegram webhook] TELEGRAM_WEBHOOK_SECRET is not set, so every request is rejected. Set it in Vercel and pass the same value as secret_token to setWebhook.');
        return res.status(403).json({ error: 'Forbidden' });
    }
    if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'], expectedSecret)) {
        console.error('[Telegram webhook] Rejected a request with a missing or wrong X-Telegram-Bot-Api-Secret-Token header.');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const update = req.body;
    const message = update?.message;
    // Only messages are handled here. Button presses (callback queries) are
    // ignored: the Leave and notification buttons are sent and handled by the
    // polling bot (bot/index.js), which checks that the presser owns the entry.
    // If this webhook ever handles them, it needs the same check.
    if (!message) return res.status(200).end();

    const chatId = message.chat?.id;
    const text = (message.text || '').trim();
    const from = message.from || {};

    // deep link + /attend
    let code = null;
    const startMatch = text.match(/^\/start\s+attend_([A-Z0-9]+)$/i);
    const attendMatch = text.match(/^\/attend\s+([A-Z0-9]+)$/i);
    if (startMatch) code = startMatch[1].toUpperCase();
    else if (attendMatch) code = attendMatch[1].toUpperCase();

    if (code) {
        await handleAttendLogin(chatId, from, code);
        return res.status(200).end();
    }

    if (text === '/start' || text === '/help') {
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
        return res.status(200).end();
    }

    const linkMatch = text.match(/^\/link\s+([A-Z0-9]+)$/i);
    if (linkMatch) {
        await handleTelegramLink(chatId, from, linkMatch[1].toUpperCase());
        return res.status(200).end();
    }

    if (text.startsWith('/')) {
        await sendTelegramMessage(chatId, 'Unknown command\\. Use /help to see available commands\\.', { parse_mode: 'MarkdownV2' });
    }

    return res.status(200).end();
}

async function handleAttendLogin(chatId, from, code) {
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
    const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Attendee';
    const telegramUsername = from.username || null;

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

async function handleTelegramLink(chatId, from, otp) {
    const now = new Date().toISOString();

    const { data: otpRow } = await supabase
        .from('gftvqueue_telegram_otps')
        .select('id, user_id, expires_at, used_at')
        .eq('otp_code', otp)
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
    const telegramUsername = from.username || null;

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
