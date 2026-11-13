// GET  → generate OTP for linking
// DELETE → unlink Telegram account
import { randomInt } from 'crypto';
import { supabase } from '../_supabase.js';
import { handleCors, requireAuth } from '../_auth.js';

// 6 digits, 100000-999999 (randomInt's upper bound is exclusive)
function randomOtp() {
    return String(randomInt(100000, 1000000));
}

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    if (request.method === 'GET') {
        return createLinkCode(user, response);
    }
    if (request.method === 'DELETE') {
        return unlinkTelegram(user, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// ── GET: Generate a 6-digit OTP ───────────────────────────────────────────────

// Replaces the user's unused codes with a new one that lasts 10 minutes. The
// user sends it to the bot with /link.
async function createLinkCode(user, response) {
    // Invalidate any previous unused OTPs for this user
    await supabase
        .from('gftvqueue_telegram_otps')
        .delete()
        .eq('user_id', user.id)
        .is('used_at', null);

    const otpCode = randomOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error } = await supabase.from('gftvqueue_telegram_otps').insert({
        otp_code: otpCode,
        user_id: user.id,
        expires_at: expiresAt,
    });

    if (error) {
        console.error('OTP insert error:', error);
        return response.status(500).json({ error: 'Failed to generate OTP' });
    }

    // The profile page shows the code and when it expires, with its own
    // instructions (rule F2).
    return response.status(200).json({
        otp_code: otpCode,
        expires_at: expiresAt,
    });
}

// ── DELETE: Unlink Telegram ───────────────────────────────────────────────────

async function unlinkTelegram(user, response) {
    const { error } = await supabase
        .from('gftvqueue_telegram_links')
        .delete()
        .eq('user_id', user.id);

    if (error) {
        console.error('Unlink error:', error);
        return response.status(500).json({ error: 'Failed to unlink Telegram' });
    }

    return response.status(200).json({ message: 'Telegram account unlinked successfully' });
}
