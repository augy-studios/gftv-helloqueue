// GET    → list users with queue permissions
// POST   → grant a user queue access
// DELETE → revoke a user's queue access
import {
    supabase
} from '../../_supabase.js';
import {
    handleCors,
    requireAuth
} from '../../_auth.js';

async function isQueueAdmin(userId, queueId, isAdmin) {
    if (isAdmin) return true;
    const {
        data
    } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('is_queue_admin')
        .eq('queue_id', queueId)
        .eq('user_id', userId)
        .maybeSingle();
    return data?.is_queue_admin === true;
}

export default async function handler(req, res) {
    if (handleCors(req, res)) return;

    const user = await requireAuth(req, res);
    if (!user) return;

    const {
        queueId
    } = req.query;

    if (req.method === 'GET') {
        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .select('id, user_id, is_queue_admin, granted_at, gftvhello_users!user_id(id, username, display_name)')
            .eq('queue_id', queueId);

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            permissions: data || []
        });
    }

    if (req.method === 'POST') {
        const admin = await isQueueAdmin(user.id, queueId, user.is_admin);
        if (!admin) return res.status(403).json({
            error: 'Queue admin access required'
        });

        const {
            user_id,
            is_queue_admin = false
        } = req.body || {};
        if (!user_id) return res.status(400).json({
            error: 'user_id is required'
        });

        const {
            data,
            error
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .upsert({
                queue_id: queueId,
                user_id,
                is_queue_admin,
                granted_by: user.id,
                granted_at: new Date().toISOString(),
            }, {
                onConflict: 'queue_id,user_id'
            })
            .select()
            .single();

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(201).json({
            permission: data
        });
    }

    if (req.method === 'DELETE') {
        const admin = await isQueueAdmin(user.id, queueId, user.is_admin);
        if (!admin) return res.status(403).json({
            error: 'Queue admin access required'
        });

        const {
            user_id
        } = req.body || {};
        if (!user_id) return res.status(400).json({
            error: 'user_id is required'
        });

        const {
            error
        } = await supabase
            .from('gftvqueue_queue_permissions')
            .delete()
            .eq('queue_id', queueId)
            .eq('user_id', user_id);

        if (error) return res.status(500).json({
            error: error.message
        });
        return res.status(200).json({
            message: 'Permission revoked'
        });
    }

    return res.status(405).json({
        error: 'Method not allowed'
    });
}