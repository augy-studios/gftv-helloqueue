import {
    api,
    toast,
    Icons
} from '/js/app.js';

export async function renderAdminUsersView(container, {
    user,
    navigate
}) {
    container.innerHTML = `
    <div class="page-title">
      <span>User Management</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="user-search" placeholder="Search username…" style="padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-family:Jua,sans-serif;font-size:0.88rem;color:var(--text);width:180px;" />
        <button class="btn btn-ghost btn-sm" id="search-btn">${Icons.refresh} Search</button>
      </div>
    </div>

    <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm filter-btn active" data-filter="pending">Pending Approval</button>
      <button class="btn btn-ghost btn-sm filter-btn" data-filter="all">All Users</button>
    </div>

    <div id="users-table-wrap">
      <div class="loader"></div>
    </div>
  `;

    let currentFilter = 'pending';
    await loadUsers(user, currentFilter);

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            await loadUsers(user, currentFilter);
        });
    });

    document.getElementById('search-btn')?.addEventListener('click', async () => {
        const q = document.getElementById('user-search').value.trim();
        await loadUsers(user, currentFilter, q);
    });

    document.getElementById('user-search')?.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
            const q = e.target.value.trim();
            await loadUsers(user, currentFilter, q);
        }
    });
}

async function loadUsers(currentUser, filter, search = '') {
    const wrap = document.getElementById('users-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = `<div class="loader"></div>`;

    try {
        const params = search ? `?username=${encodeURIComponent(search)}` : '';
        const {
            data: users
        } = await api(`/admin/users${params}`);

        let filtered = users;
        if (filter === 'pending') filtered = users.filter(u => !u.is_approved);

        if (!filtered.length) {
            wrap.innerHTML = `<div class="empty-state">${filter === 'pending' ? 'No pending accounts 🎉' : 'No users found.'}</div>`;
            return;
        }

        wrap.innerHTML = `
      <div class="glass" style="overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);font-size:0.8rem;color:var(--text-muted);">
              <th style="padding:10px 14px;text-align:left;font-weight:400;">User</th>
              <th style="padding:10px 14px;text-align:left;font-weight:400;">Email</th>
              <th style="padding:10px 14px;text-align:left;font-weight:400;">Status</th>
              <th style="padding:10px 14px;text-align:left;font-weight:400;">Roles</th>
              <th style="padding:10px 14px;text-align:left;font-weight:400;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(u => buildUserRow(u, currentUser)).join('')}
          </tbody>
        </table>
      </div>
    `;

        // Attach action buttons
        wrap.querySelectorAll('.approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                await updateUser(btn.dataset.id, {
                    is_approved: true
                });
                await loadUsers(currentUser, filter, search);
                toast('User approved', 'success');
            });
        });

        wrap.querySelectorAll('.reject-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Reject and remove this account?')) return;
                await updateUser(btn.dataset.id, {
                    is_approved: false
                });
                await loadUsers(currentUser, filter, search);
                toast('User rejected', 'info');
            });
        });

        wrap.querySelectorAll('.toggle-admin-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const newVal = btn.dataset.current !== 'true';
                await updateUser(btn.dataset.id, {
                    is_admin: newVal
                });
                await loadUsers(currentUser, filter, search);
                toast(`Admin ${newVal ? 'granted' : 'revoked'}`, 'info');
            });
        });

        wrap.querySelectorAll('.toggle-editor-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const newVal = btn.dataset.current !== 'true';
                await updateUser(btn.dataset.id, {
                    is_editor: newVal
                });
                await loadUsers(currentUser, filter, search);
                toast(`Editor role ${newVal ? 'granted' : 'revoked'}`, 'info');
            });
        });

    } catch (err) {
        wrap.innerHTML = `<div class="empty-state">Failed to load users: ${err.message}</div>`;
    }
}

function buildUserRow(u, currentUser) {
    const isSelf = u.id === currentUser.id;
    return `
    <tr style="border-bottom:1px solid var(--border);font-size:0.88rem;" ${!u.is_approved ? 'style="opacity:0.8;"' : ''}>
      <td style="padding:10px 14px;">
        <div style="font-size:0.95rem;">${u.display_name}</div>
        <div style="color:var(--text-muted);font-size:0.78rem;">@${u.username}</div>
      </td>
      <td style="padding:10px 14px;color:var(--text-muted);font-size:0.82rem;">${u.email || '—'}</td>
      <td style="padding:10px 14px;">
        <span class="status-pill ${u.is_approved ? 'open' : 'draft'}">${u.is_approved ? 'Approved' : 'Pending'}</span>
      </td>
      <td style="padding:10px 14px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${u.is_admin ? `<span class="status-pill active">Admin</span>` : ''}
          ${u.is_editor ? `<span class="status-pill open">Editor</span>` : ''}
          ${!u.is_admin && !u.is_editor ? `<span class="text-muted text-sm">—</span>` : ''}
        </div>
      </td>
      <td style="padding:10px 14px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${!u.is_approved ? `
            <button class="btn btn-success btn-sm approve-btn" data-id="${u.id}">${Icons.check} Approve</button>
          ` : `
            <button class="btn btn-danger btn-sm reject-btn" data-id="${u.id}">${Icons.x} Revoke</button>
          `}
          ${!isSelf ? `
            <button class="btn btn-ghost btn-sm toggle-editor-btn" data-id="${u.id}" data-current="${u.is_editor}">
              ${u.is_editor ? 'Remove Editor' : 'Make Editor'}
            </button>
            <button class="btn btn-ghost btn-sm toggle-admin-btn" data-id="${u.id}" data-current="${u.is_admin}">
              ${u.is_admin ? 'Remove Admin' : 'Make Admin'}
            </button>
          ` : `<span class="text-sm text-muted">(you)</span>`}
        </div>
      </td>
    </tr>
  `;
}

async function updateUser(userId, updates) {
    try {
        await api('/admin/users', {
            method: 'PUT',
            body: {
                user_id: userId,
                ...updates
            }
        });
    } catch (err) {
        toast(err.message, 'error');
    }
}