import bcrypt from 'bcryptjs';
import {
    supabase
} from '../_supabase.js';
import {
    handleCors
} from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;
    if (req.method !== 'POST') return res.status(405).json({
        error: 'Method not allowed'
    });

    const {
        username,
        display_name,
        email,
        password
    } = req.body || {};

    if (!username || !display_name || !email || !password) {
        return res.status(400).json({
            error: 'All fields are required'
        });
    }

    if (password.length < 8) {
        return res.status(400).json({
            error: 'Password must be at least 8 characters'
        });
    }

    // Check uniqueness
    const {
        data: existing
    } = await supabase
        .from('gftvhello_users')
        .select('id')
        .or(`username.eq.${username},email.eq.${email}`)
        .maybeSingle();

    if (existing) {
        return res.status(409).json({
            error: 'Username or email already in use'
        });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const {
        data: user,
        error
    } = await supabase
        .from('gftvhello_users')
        .insert({
            username,
            display_name,
            email,
            password_hash,
            is_approved: false
        })
        .select('id, username, display_name')
        .single();

    if (error) {
        console.error('Register error:', error);
        return res.status(500).json({
            error: 'Registration failed'
        });
    }

    return res.status(201).json({
        message: 'Registration successful. Your account is pending admin approval.',
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name
        },
    });
}