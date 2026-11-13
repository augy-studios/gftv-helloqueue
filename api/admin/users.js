// GET    → list all users (admin only); ?username=x to lookup by username
// PUT    → approve/reject user (admin only)
import { supabase } from '../_supabase.js';
import { handleCors, requireAuth } from '../_auth.js';

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    if (!user.is_admin) {
        return response.status(403).json({ error: 'Admin access required' });
    }

    if (request.method === 'GET') {
        return listUsers(request, response);
    }
    if (request.method === 'PUT') {
        return updateUser(user, request, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// ── GET ───────────────────────────────────────────────────────────────────────

// What the users table shows, and the id its buttons send (rule F2).
// Still newest first, without sending created_at.
async function listUsers(request, response) {
    const { username } = request.query;

    let query = supabase
        .from('gftvhello_users')
        .select('id, username, display_name, email, is_admin, is_approved, is_editor')
        .order('created_at', { ascending: false });

    if (username) {
        query = query.ilike('username', username);
    }

    const { data: users, error } = await query;
    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ data: users });
}

// ── PUT: approve / reject / toggle role ───────────────────────────────────────

// Changes only the flags sent: is_approved, is_admin and is_editor. An admin
// can't take away their own admin role.
async function updateUser(user, request, response) {
    let body = {};
    if (request.body) {
        body = request.body;
    }
    const targetUserId = body.user_id;
    const isApproved = body.is_approved;
    const isAdmin = body.is_admin;
    const isEditor = body.is_editor;
    if (!targetUserId) {
        return response.status(400).json({ error: 'user_id is required' });
    }

    // Prevent self-demotion
    if (targetUserId === user.id && isAdmin === false) {
        return response.status(400).json({ error: 'You cannot remove your own admin role' });
    }

    const updates = {};
    if (isApproved !== undefined) {
        updates.is_approved = isApproved;
    }
    if (isAdmin !== undefined) {
        updates.is_admin = isAdmin;
    }
    if (isEditor !== undefined) {
        updates.is_editor = isEditor;
    }

    // .select('id').single() keeps the error for a user that doesn't
    // exist. The page reloads the table and reads nothing back (rule F2).
    const { error } = await supabase
        .from('gftvhello_users')
        .update(updates)
        .eq('id', targetUserId)
        .select('id')
        .single();

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ ok: true });
}
