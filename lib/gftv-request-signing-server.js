// Server-side HMAC request-signing library (node:crypto, no dependencies)
import { createHmac, timingSafeEqual } from 'node:crypto';

function hmacHex(key, message) {
    return createHmac('sha256', key).update(message).digest('hex');
}

// Constant-time string comparison to prevent timing attacks
function safeEqual(a, b) {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) {
        timingSafeEqual(ab, Buffer.alloc(ab.length, 0));
        return false;
    }
    return timingSafeEqual(ab, bb);
}

/**
 * verifySignedRequest(req, supabase)
 * Returns { valid: boolean, reason: string }.
 *
 * Reads X-Request-Token, X-Request-TS, X-Key-ID headers.
 * Checks timestamp freshness (±30 s), looks up the signing key by session_token,
 * recomputes the HMAC, constant-time compares, and checks/records replay tokens.
 *
 * Body-hash rule: an absent body OR req.body === {} is treated as "no body" (hashed as 'empty').
 * This mirrors Vercel's behaviour of setting req.body = {} for GET/DELETE with no payload.
 */
export async function verifySignedRequest(req, supabase) {
    const token = req.headers['x-request-token'];
    const ts    = req.headers['x-request-ts'];
    const keyId = req.headers['x-key-id'];

    if (!token || !ts || !keyId) {
        return { valid: false, reason: 'Missing signing headers' };
    }

    const requestTime = parseInt(ts, 10);
    if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > 30_000) {
        return { valid: false, reason: 'Request timestamp out of window' };
    }

    // Look up signing key by session_token
    const { data: keyRow } = await supabase
        .from('gftvhello_signing_keys')
        .select('signing_key, expires_at')
        .eq('session_token', keyId)
        .maybeSingle();

    if (!keyRow) return { valid: false, reason: 'Unknown signing key' };
    if (new Date(keyRow.expires_at) < new Date()) return { valid: false, reason: 'Signing key expired' };

    const method = req.method.toUpperCase();
    const path   = req.url; // full path + query string as Vercel sets it

    // Treat absent body or empty-object body as "no body" — mirrors Vercel's body-parser behaviour
    const serialised = req.body != null ? JSON.stringify(req.body) : null;
    const isEmptyBody = serialised == null || serialised === '{}';
    const bodyHash = isEmptyBody ? 'empty' : hmacHex(keyRow.signing_key, serialised);

    const message  = `${ts}:${method}:${path}:${bodyHash}`;
    const expected = hmacHex(keyRow.signing_key, message);

    if (!safeEqual(token, expected)) {
        return { valid: false, reason: 'Invalid signature' };
    }

    // Replay check
    const { data: usedToken } = await supabase
        .from('gftvhello_used_request_tokens')
        .select('token')
        .eq('token', token)
        .maybeSingle();

    if (usedToken) return { valid: false, reason: 'Replay attack detected' };

    // Mark as used
    await supabase.from('gftvhello_used_request_tokens').insert({
        token,
        session_token: keyId,
        used_at: new Date().toISOString(),
    });

    return { valid: true, reason: 'ok' };
}
