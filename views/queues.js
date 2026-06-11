import {
    api,
    toast,
    Icons
} from '/script.js';

export async function renderQueuesView(container, {
    user,
    navigate
}) {
    container.innerHTML = `
    <div class="page-title">My Queues</div>
    <div id="queues-list" class="card-grid">
      <div class="loader"></div>
    </div>
  `;

    await loadMyQueues(container, user, navigate);
}

async function loadMyQueues(container, user, navigate) {
    const listEl = document.getElementById('queues-list');
    if (!listEl) return;

    try {
        const {
            events
        } = await api('/events');
        if (!events.length) {
            listEl.innerHTML = `<div class="empty-state">${Icons.list}<br>No queues found. You need to be assigned to an event first.</div>`;
            return;
        }

        const allQueues = [];
        for (const ev of events) {
            const {
                queues
            } = await api(`/queues?event_id=${ev.id}`).catch(() => ({
                queues: []
            }));
            for (const q of queues) {
                const {
                    permissions
                } = await api(`/queues/${q.id}/permissions`).catch(() => ({
                    permissions: []
                }));
                const myPerm = permissions.find(p => p.user_id === user.id);
                if (myPerm || user.is_admin) {
                    allQueues.push({
                        ...q,
                        event_name: ev.name,
                        event_access_code: ev.access_code,
                        is_queue_admin: myPerm?.is_queue_admin || user.is_admin
                    });
                }
            }
        }

        if (!allQueues.length) {
            listEl.innerHTML = `<div class="empty-state">${Icons.list}<br>You don't have operator access to any queues yet.</div>`;
            return;
        }

        listEl.innerHTML = allQueues.map(q => `
      <div class="glass event-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="status-pill ${q.status}">${q.status}</span>
          ${q.is_queue_admin ? `<span class="text-sm text-muted">Queue Admin</span>` : `<span class="text-sm text-muted">Operator</span>`}
        </div>

        <div class="event-card-title">${q.name}</div>
        <div class="event-card-meta">
          Event: ${q.event_name}
          &nbsp;·&nbsp; Max: ${q.max_serving}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          <span class="text-sm text-muted">
            Queue code: <strong>${q.access_code}</strong>
          </span>
        </div>

        <div id="counts-${q.id}" class="glass-sm" style="padding:8px 12px;margin-top:10px;display:flex;gap:14px;font-size:0.8rem;">
          <span>${Icons.hourglass} Loading…</span>
        </div>

        <div class="event-card-footer" style="margin-top:12px;">
          <a href="/display/${q.event_access_code}/${q.access_code}" target="_blank" class="btn btn-ghost btn-sm">
            ${Icons.monitor} Display
          </a>
          <button class="btn btn-primary btn-sm operate-btn" data-queue="${q.id}" data-event="${q.event_id}">
            Operate
          </button>
        </div>
      </div>
    `).join('');

        for (const q of allQueues) {
            loadQueueCounts(q.id, q.event_access_code, q.access_code);
        }

        listEl.querySelectorAll('.operate-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                import('/views/queue-operator.js').then(m => {
                    m.renderQueueOperatorView(container, {
                        user,
                        navigate,
                        queueId: btn.dataset.queue,
                        eventId: btn.dataset.event,
                    });
                });
            });
        });

    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Failed to load queues: ${err.message}</div>`;
    }
}

async function loadQueueCounts(queueId, eventCode, queueCode) {
    const el = document.getElementById(`counts-${queueId}`);
    if (!el) return;
    try {
        const data = await fetch(`/api/display/${eventCode}/${queueCode}`).then(r => r.json());
        el.innerHTML = `
      <span style="color:var(--status-serving);"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> Serving: ${data.serving?.length || 0}</span>
      <span style="color:var(--status-waiting);">${Icons.hourglass} Waiting: ${data.total_in_queue || 0}</span>
      <span style="color:var(--status-missed);">${Icons.alertTriangle} Missed: ${data.missed?.length || 0}</span>
      <span style="color:var(--text-muted);">${Icons.check} Done: ${data.total_served || 0}</span>
    `;
    } catch {
        el.innerHTML = `<span class="text-muted">Couldn't load live counts</span>`;
    }
}