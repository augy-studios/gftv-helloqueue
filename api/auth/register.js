import bcrypt from 'bcryptjs';
import { supabase } from '../_supabase.js';
import { handleCors } from '../_auth.js';

// Creates an account waiting for an admin's approval. Every field is
// required, the password needs 8 characters, and the username and email
// must both be unused.
export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method not allowed' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const username = body.username;
    const displayName = body.display_name;
    const email = body.email;
    const password = body.password;

    if (!username || !displayName || !email || !password) {
        return response.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 8) {
        return response.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check uniqueness: one plain .eq() lookup per value, so typed input is
    // never parsed as part of a PostgREST filter expression.
    const { data: existingUsername } = await supabase
        .from('gftvhello_users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

    const { data: existingEmail } = await supabase
        .from('gftvhello_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

    if (existingUsername || existingEmail) {
        return response.status(409).json({ error: 'Username or email already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { error } = await supabase
        .from('gftvhello_users')
        .insert({
            username: username,
            display_name: displayName,
            email: email,
            password_hash: passwordHash,
            is_approved: false
        });

    if (error) {
        console.error('Register error:', error);
        return response.status(500).json({ error: 'Registration failed' });
    }

    // The page shows its own success message and reads nothing back
    // (rule F2).
    return response.status(201).json({
        message: 'Registration successful. Your account is pending admin approval.',
    });
}
