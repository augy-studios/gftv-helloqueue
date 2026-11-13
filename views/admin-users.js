import {
    api,
    toast,
    Icons,
    escapeHtml
} from '/script.js';

// The User Management page (admins only): a search box, the Pending
// Approval / All Users filter, and the table of accounts.
export async function renderAdminUsersView(container, {
    user,
    navigate
}) {
    container.innerHTML = `
    <div class="page-title">
      <span>User Management</span>
      <div style="display:flex;gap:8px;align-items:center;">
        <input id="user-search" placeholder="Search username…" style="padding:7px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-size:0.88rem;color:var(--text);width:180px;" />
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

    document.querySelectorAll('.filter-btn').forEach((filterButton) => {
        filterButton.addEventListener('click', async () => {
            document.querySelectorAll('.filter-btn').forEach((anyFilterButton) => anyFilterButton.classList.remove('active'));
            filterButton.classList.add('active');
            currentFilter = filterButton.dataset.filter;
            await loadUsers(user, currentFilter);
        });
    });

    const searchButton = document.getElementById('search-btn');
    if (searchButton) {
        searchButton.addEventListener('click', async () => {
            const searchText = document.getElementById('user-search').value.trim();
            await loadUsers(user, currentFilter, searchText);
        });
    }

    const searchInput = document.getElementById('user-search');
    if (searchInput) {
        searchInput.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                const searchText = event.target.value.trim();
                await loadUsers(user, currentFilter, searchText);
            }
        });
    }
}

// Fills the users table. "pending" shows only accounts waiting for
// approval; a search asks the API for usernames that match.
async function loadUsers(currentUser, filter, search = '') {
    const tableWrapper = document.getElementById('users-table-wrap');
    if (!tableWrapper) return;
    tableWrapper.innerHTML = `<div class="loader"></div>`;

    try {
        let query = '';
        if (search) {
            query = `?username=${encodeURIComponent(search)}`;
        }
        const {
            data: users
        } = await api(`/admin/users${query}`);

        let filtered = users;
        if (filter === 'pending') {
            filtered = users.filter((user) => !user.is_approved);
        }

        if (!filtered.length) {
            let emptyMessage = 'No users found.';
            if (filter === 'pending') {
                emptyMessage = 'No pending accounts';
            }
            tableWrapper.innerHTML = `<div class="empty-state">${emptyMessage}</div>`;
            return;
        }

        tableWrapper.innerHTML = `
      <div class="glass-card" style="overflow-x:auto;max-width:100%;">
        <table style="width:100%;min-width:640px;border-collapse:collapse;">
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
            ${filtered.map((user) => buildUserRow(user, currentUser)).join('')}
          </tbody>
        </table>
      </div>
    `;

        attachUserActions(tableWrapper, currentUser, filter, search);

    } catch (error) {
        tableWrapper.innerHTML = `<div class="empty-state">Failed to load users: ${escapeHtml(error.message)}</div>`;
    }
}

// The buttons in the users table: Approve, Revoke (after a confirm), and the
// editor and admin role switches. Each saves the change, then reloads the
// table with the same filter and search.
function attachUserActions(tableWrapper, currentUser, filter, search) {
    tableWrapper.querySelectorAll('.approve-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            await updateUser(button.dataset.id, {
                is_approved: true
            });
            await loadUsers(currentUser, filter, search);
            toast('User approved', 'success');
        });
    });

    tableWrapper.querySelectorAll('.reject-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            if (!confirm('Reject and remove this account?')) return;
            await updateUser(button.dataset.id, {
                is_approved: false
            });
            await loadUsers(currentUser, filter, search);
            toast('User rejected', 'info');
        });
    });

    tableWrapper.querySelectorAll('.toggle-admin-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const newValue = button.dataset.current !== 'true';
            await updateUser(button.dataset.id, {
                is_admin: newValue
            });
            await loadUsers(currentUser, filter, search);
            toast(`Admin ${grantedOrRevoked(newValue)}`, 'info');
        });
    });

    tableWrapper.querySelectorAll('.toggle-editor-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            const newValue = button.dataset.current !== 'true';
            await updateUser(button.dataset.id, {
                is_editor: newValue
            });
            await loadUsers(currentUser, filter, search);
            toast(`Editor role ${grantedOrRevoked(newValue)}`, 'info');
        });
    });
}

// "granted" when a role was switched on, "revoked" when it was switched off.
function grantedOrRevoked(isGranted) {
    if (isGranted) {
        return 'granted';
    }
    return 'revoked';
}

// One account's row: name and username, email, approval status, roles, and
// the action buttons. Your own row has no role buttons.
function buildUserRow(user, currentUser) {
    const isSelf = user.id === currentUser.id;

    let pendingRowStyle = '';
    if (!user.is_approved) {
        pendingRowStyle = 'style="opacity:0.8;"';
    }

    let email = '-';
    if (user.email) {
        email = user.email;
    }

    let approvalPillClass = 'draft';
    let approvalLabel = 'Pending';
    if (user.is_approved) {
        approvalPillClass = 'open';
        approvalLabel = 'Approved';
    }

    let adminPill = '';
    if (user.is_admin) {
        adminPill = `<span class="status-pill active">Admin</span>`;
    }
    let editorPill = '';
    if (user.is_editor) {
        editorPill = `<span class="status-pill open">Editor</span>`;
    }
    let noRolesDash = '';
    if (!user.is_admin && !user.is_editor) {
        noRolesDash = `<span class="text-muted text-sm">-</span>`;
    }

    let approvalButton;
    if (!user.is_approved) {
        approvalButton = `
            <button class="btn btn-success btn-sm approve-btn" data-id="${escapeHtml(user.id)}">${Icons.check} Approve</button>
          `;
    } else {
        approvalButton = `
            <button class="btn btn-danger btn-sm reject-btn" data-id="${escapeHtml(user.id)}">${Icons.x} Revoke</button>
          `;
    }

    let roleButtons;
    if (!isSelf) {
        let editorButtonLabel = 'Make Editor';
        if (user.is_editor) {
            editorButtonLabel = 'Remove Editor';
        }
        let adminButtonLabel = 'Make Admin';
        if (user.is_admin) {
            adminButtonLabel = 'Remove Admin';
        }
        roleButtons = `
            <button class="btn btn-ghost btn-sm toggle-editor-btn" data-id="${escapeHtml(user.id)}" data-current="${user.is_editor}">
              ${editorButtonLabel}
            </button>
            <button class="btn btn-ghost btn-sm toggle-admin-btn" data-id="${escapeHtml(user.id)}" data-current="${user.is_admin}">
              ${adminButtonLabel}
            </button>
          `;
    } else {
        roleButtons = `<span class="text-sm text-muted">(you)</span>`;
    }

    return `
    <tr style="border-bottom:1px solid var(--border);font-size:0.88rem;" ${pendingRowStyle}>
      <td style="padding:10px 14px;">
        <div style="font-size:0.95rem;">${escapeHtml(user.display_name)}</div>
        <div style="color:var(--text-muted);font-size:0.78rem;">@${escapeHtml(user.username)}</div>
      </td>
      <td style="padding:10px 14px;color:var(--text-muted);font-size:0.82rem;">${escapeHtml(email)}</td>
      <td style="padding:10px 14px;">
        <span class="status-pill ${approvalPillClass}">${approvalLabel}</span>
      </td>
      <td style="padding:10px 14px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${adminPill}
          ${editorPill}
          ${noRolesDash}
        </div>
      </td>
      <td style="padding:10px 14px;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${approvalButton}
          ${roleButtons}
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
    } catch (error) {
        toast(error.message, 'error');
    }
}
