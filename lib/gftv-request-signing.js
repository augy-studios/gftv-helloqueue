// Client-side HMAC request-signing library (SubtleCrypto, no dependencies)
const SK_KEY = 'gftv_signing_key';

async function hmacHex(keyStr, message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(keyStr),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * storeSigningKey(signingKey, keyId, persistent)
 * persistent=true → localStorage (survives browser close, for remembered sessions)
 * persistent=false → sessionStorage (guest keys and non-remembered sessions)
 */
export function storeSigningKey(signingKey, keyId, persistent = false) {
    const val = JSON.stringify({ signingKey, keyId });
    if (persistent) {
        localStorage.setItem(SK_KEY, val);
        sessionStorage.removeItem(SK_KEY);
    } else {
        sessionStorage.setItem(SK_KEY, val);
        localStorage.removeItem(SK_KEY);
    }
}

/** Returns { signingKey, keyId } or null. Checks localStorage first (persistent sessions). */
export function getSigningKey() {
    try {
        const ls = localStorage.getItem(SK_KEY);
        if (ls) return JSON.parse(ls);
        const ss = sessionStorage.getItem(SK_KEY);
        if (ss) return JSON.parse(ss);
    } catch {}
    return null;
}

/** Removes signing key from both storages (call on logout). */
export function clearSigningKey() {
    localStorage.removeItem(SK_KEY);
    sessionStorage.removeItem(SK_KEY);
}

/**
 * initGuestKey(appId)
 * No-ops if a key already exists. Fetches a 10-min guest signing key from /api/auth/guest-key.
 * Always stores in sessionStorage (guest keys never persist across browser close).
 */
export async function initGuestKey(appId) {
    if (getSigningKey()) return;
    const res = await fetch(`/api/auth/guest-key?app=${encodeURIComponent(appId)}`);
    if (!res.ok) throw new Error('Failed to initialise guest signing key');
    const { key_id, signing_key } = await res.json();
    storeSigningKey(signing_key, key_id, false);
}

/**
 * signedFetch(url, options)
 * Drop-in for fetch(). Computes HMAC-SHA256 over ts:METHOD:path:bodyHash and attaches
 * X-Request-Token, X-Request-TS, X-Key-ID headers.
 * Throws if no signing key is present — never silently falls back to unsigned fetch.
 */
export async function signedFetch(url, options = {}) {
    const keyInfo = getSigningKey();
    if (!keyInfo) throw new Error('No signing key available — call initGuestKey() or storeSigningKey() first');

    const { signingKey, keyId } = keyInfo;
    const ts = String(Date.now());
    const method = (options.method || 'GET').toUpperCase();

    // Pathname only — Vercel rewrites req.url on dynamic [param] routes to append
    // the matched segment as a query string (e.g. /api/events/abc -> /api/events/abc?eventId=abc),
    // which the client never sent. Signing only the pathname keeps both sides in agreement.
    const urlObj = new URL(url, window.location.origin);
    const path = urlObj.pathname;

    // Normalise body to string; treat missing or empty-object body as "no body"
    const rawBody = options.body;
    const bodyStr = typeof rawBody === 'string' ? rawBody
        : rawBody != null ? JSON.stringify(rawBody)
        : null;
    const isEmptyBody = bodyStr == null || bodyStr === '{}';

    const bodyHash = isEmptyBody ? 'empty' : await hmacHex(signingKey, bodyStr);
    const message = `${ts}:${method}:${path}:${bodyHash}`;
    const token = await hmacHex(signingKey, message);

    const headers = {
        ...(options.headers || {}),
        'X-Request-Token': token,
        'X-Request-TS': ts,
        'X-Key-ID': keyId,
    };

    return fetch(url, { ...options, headers });
}
