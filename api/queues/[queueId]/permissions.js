// GET    → list users with queue permissions
// POST   → grant a user queue access
// DELETE → revoke a user's queue access
import { supabase } from '../../_supabase.js';
import { handleCors, requireAuth } from '../../_auth.js';

// True for a superadmin, or a user whose permission row makes them this
// queue's admin.
async function isQueueAdmin(userId, queueId, isAdmin) {
    if (isAdmin) {
        return true;
    }
    const { data: permission } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('is_queue_admin')
        .eq('queue_id', queueId)
        .eq('user_id', userId)
        .maybeSingle();
    if (permission === null || permission === undefined) {
        return false;
    }
    return permission.is_queue_admin === true;
}

// True when the user is an editor of the event this queue belongs to.
async function isEditorOfQueueEvent(userId, queueId) {
    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('event_id')
        .eq('id', queueId)
        .maybeSingle();
    if (!queue) {
        return false;
    }
    const { data: editorRow } = await supabase
        .from('gftvqueue_event_editors')
        .select('id')
        .eq('event_id', queue.event_id)
        .eq('user_id', userId)
        .maybeSingle();
    return Boolean(editorRow);
}

export default async function handler(request, response) {
    if (handleCors(request, response)) {
        return;
    }

    const user = await requireAuth(request, response);
    if (!user) {
        return;
    }

    const { queueId } = request.query;

    if (request.method === 'GET') {
        return listPermissions(user, queueId, response);
    }
    if (request.method === 'POST') {
        return grantPermission(user, queueId, request, response);
    }
    if (request.method === 'DELETE') {
        return revokePermission(user, queueId, request, response);
    }

    return response.status(405).json({ error: 'Method not allowed' });
}

// Only a superadmin, an admin of this queue, or an editor of the queue's
// event may list its staff.
async function listPermissions(user, queueId, response) {
    const hasAdminAccess = await isQueueAdmin(user.id, queueId, user.is_admin);
    if (!hasAdminAccess) {
        const hasEditorAccess = await isEditorOfQueueEvent(user.id, queueId);
        if (!hasEditorAccess) {
            return response.status(403).json({ error: 'Queue admin or event editor access required' });
        }
    }

    // No page calls this list today. It sends what a staff list shows:
    // each person's name and username, whether they're a queue admin, and
    // the user_id a Revoke button sends (rule F2).
    const { data: permissions, error } = await supabase
        .from('gftvqueue_queue_permissions')
        .select('user_id, is_queue_admin, gftvhello_users!user_id(username, display_name)')
        .eq('queue_id', queueId);

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    let permissionList = [];
    if (permissions) {
        permissionList = permissions;
    }
    return response.status(200).json({ permissions: permissionList });
}

// Gives a user operator access to this queue (or queue admin access, with
// is_queue_admin: true), replacing any permission row they already have.
async function grantPermission(user, queueId, request, response) {
    const hasAdminAccess = await isQueueAdmin(user.id, queueId, user.is_admin);
    if (!hasAdminAccess) {
        return response.status(403).json({ error: 'Queue admin access required' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const staffUserId = body.user_id;
    let grantQueueAdmin = false;
    if (body.is_queue_admin !== undefined) {
        grantQueueAdmin = body.is_queue_admin;
    }
    if (!staffUserId) {
        return response.status(400).json({ error: 'user_id is required' });
    }

    const { error } = await supabase
        .from('gftvqueue_queue_permissions')
        .upsert({
            queue_id: queueId,
            user_id: staffUserId,
            is_queue_admin: grantQueueAdmin,
            granted_by: user.id,
            granted_at: new Date().toISOString(),
        }, {
            onConflict: 'queue_id,user_id'
        });

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    // No page reads anything back (rule F2).
    return response.status(201).json({ ok: true });
}

// Takes away a user's access to this queue (queue admins only).
async function revokePermission(user, queueId, request, response) {
    const hasAdminAccess = await isQueueAdmin(user.id, queueId, user.is_admin);
    if (!hasAdminAccess) {
        return response.status(403).json({ error: 'Queue admin access required' });
    }

    let body = {};
    if (request.body) {
        body = request.body;
    }
    const staffUserId = body.user_id;
    if (!staffUserId) {
        return response.status(400).json({ error: 'user_id is required' });
    }

    const { error } = await supabase
        .from('gftvqueue_queue_permissions')
        .delete()
        .eq('queue_id', queueId)
        .eq('user_id', staffUserId);

    if (error) {
        return response.status(500).json({ error: error.message });
    }
    return response.status(200).json({ message: 'Permission revoked' });
}
