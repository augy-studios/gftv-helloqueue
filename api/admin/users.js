// GET    → list all users (admin only); ?username=x to lookup by username
// PUT    → approve/reject user (admin only)
import {
    supabase
} from '../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../_auth.js';

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const user = await requireAuth(req, res);
    if (!user) return;

    if (!user.is_admin) return res.status(403).json({
        error: 'Admin access required'
    });

    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
        const {
            username
        } = req.query;

        let query = supabase
            .from('gftvhello_users')
            .select('id, username, display_name, email, is_admin, is_approved, is_editor, created_at')
            .order('created_at', {
                ascending: false
            });

        if (username) {
            query = query.ilike('username', username);
        }

        const {
            data,
            error
        } = await query;
        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            data
        });
    }

    // ── PUT: approve / reject / toggle role ──────────────────────────────────
    if (req.method === 'PUT') {
        const {
            user_id,
            is_approved,
            is_admin,
            is_editor
        } = req.body || {};
        if (!user_id) return res.status(400).json({
            error: 'user_id is required'
        });

        // Prevent self-demotion
        if (user_id === user.id && is_admin === false) {
            return res.status(400).json({
                error: 'You cannot remove your own admin role'
            });
        }

        const updates = {};
        if (is_approved !== undefined) updates.is_approved = is_approved;
        if (is_admin !== undefined) updates.is_admin = is_admin;
        if (is_editor !== undefined) updates.is_editor = is_editor;

        const {
            data,
            error
        } = await supabase
            .from('gftvhello_users')
            .update(updates)
            .eq('id', user_id)
            .select('id, username, display_name, is_approved, is_admin, is_editor')
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            user: data
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}