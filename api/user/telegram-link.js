// GET  → generate OTP for linking
// DELETE → unlink Telegram account
import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../_auth.js';

function randomOtp() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const user = await requireAuth(req, res);
    if (!user) return;

    // ── GET: Generate a 6-digit OTP ──────────────────────────────────────────
    if (req.method === 'GET') {
        // Invalidate any previous unused OTPs for this user
        await supabase
            .from('gftvqueue_telegram_otps')
            .delete()
            .eq('user_id', user.id)
            .is('used_at', null);

        const otp_code = randomOtp();
        const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        const {
            error
        } = await supabase.from('gftvqueue_telegram_otps').insert({
            otp_code,
            user_id: user.id,
            expires_at,
        });

        if (error) {
            console.error('OTP insert error:', error);
            return res.status(500).json({
                error: 'Failed to generate OTP'
            });
        }

        return res.status(200).json({
            otp_code,
            expires_at,
            bot_username: 'GFTVHelloQueueBot',
            instruction: `Send /link ${otp_code} to @GFTVHelloQueueBot on Telegram to link your account.`,
        });
    }

    // ── DELETE: Unlink Telegram ───────────────────────────────────────────────
    if (req.method === 'DELETE') {
        const {
            error
        } = await supabase
            .from('gftvqueue_telegram_links')
            .delete()
            .eq('user_id', user.id);

        if (error) {
            console.error('Unlink error:', error);
            return res.status(500).json({
                error: 'Failed to unlink Telegram'
            });
        }

        return res.status(200).json({
            message: 'Telegram account unlinked successfully'
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}