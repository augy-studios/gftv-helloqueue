import { supabase } from '../_supabase.js';
import { handleCors, readBearerToken } from '../_auth.js';

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    const token = readBearerToken(request);
    if (token) {
        await supabase.from('gftvhello_sessions').delete().eq('token', token);
    }
    return response.status(200).json({ message: 'Logged out' });
}
