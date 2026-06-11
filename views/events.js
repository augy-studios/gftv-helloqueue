import {
    api,
    toast,
    Icons
} from '/script.js';

export async function renderEventsView(container, {
    user,
    navigate
}) {
    container.innerHTML = `
    <div class="page-title">
      <span>Events</span>
      ${user.is_admin ? `<button class="btn btn-primary btn-sm" id="create-event-btn">${Icons.plus} New Event</button>` : ''}
    </div>
    <div id="events-grid" class="card-grid">
      <div class="loader"></div>
    </div>
    <!-- Create Event Modal -->
    <div class="modal-overlay" id="create-event-modal">
      <div class="modal">
        <div class="modal-header">
          <span class="modal-title">Create Event</span>
          <button class="modal-close" id="close-event-modal">${Icons.x}</button>
        </div>
        <form id="create-event-form">
          <div class="form-group"><label>Event Name *</label><input id="ev-name" required placeholder="FURUM 2026" /></div>
          <div class="form-group"><label>Venue</label><input id="ev-venue" placeholder="Sunway Hotel, Kuala Lumpur" /></div>
          <div class="form-group"><label>Date</label><input type="date" id="ev-date" /></div>
          <div class="form-group"><label>Description</label><textarea id="ev-desc" rows="2" placeholder="Optional description…"></textarea></div>
          <div id="ev-err" style="color:var(--status-error);font-size:0.85rem;margin-bottom:10px;display:none;"></div>
          <button type="submit" class="btn btn-primary w-full">Create Event</button>
        </form>
      </div>
    </div>
  `;

    await loadEvents(container, user, navigate);

    document.getElementById('create-event-btn')?.addEventListener('click', () => {
        document.getElementById('create-event-modal').classList.add('open');
    });
    document.getElementById('close-event-modal')?.addEventListener('click', () => {
        document.getElementById('create-event-modal').classList.remove('open');
    });

    document.getElementById('create-event-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('ev-err');
        errEl.style.display = 'none';
        try {
            await api('/events', {
                method: 'POST',
                body: {
                    name: document.getElementById('ev-name').value.trim(),
                    venue: document.getElementById('ev-venue').value.trim(),
                    event_date: document.getElementById('ev-date').value || null,
                    description: document.getElementById('ev-desc').value.trim(),
                },
            });
            document.getElementById('create-event-modal').classList.remove('open');
            document.getElementById('create-event-form').reset();
            toast('Event created!', 'success');
            await loadEvents(container, user, navigate);
        } catch (err) {
            errEl.textContent = err.message;
            errEl.style.display = 'block';
        }
    });
}

async function loadEvents(container, user, navigate) {
    const grid = document.getElementById('events-grid');
    if (!grid) return;

    try {
        const {
            events
        } = await api('/events');

        if (!events.length) {
            grid.innerHTML = `<div class="empty-state">${Icons.calendar}<br>No events yet${user.is_admin ? '. Create one to get started.' : '.'}</div>`;
            return;
        }

        grid.innerHTML = events.map(ev => `
      <div class="glass event-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="status-pill ${ev.status}">${ev.status}</span>
          ${user.is_admin ? `
            <div style="display:flex;gap:6px;">
              <button class="btn-icon btn-sm ev-status-btn" data-id="${ev.id}" data-status="${ev.status}" title="Toggle status">${Icons.refresh}</button>
              <button class="btn-icon btn-sm ev-delete-btn danger" data-id="${ev.id}" title="Delete event">${Icons.trash}</button>
            </div>
          ` : ''}
        </div>
        <div class="event-card-title">${ev.name}</div>
        <div class="event-card-meta">
          ${ev.venue ? `${Icons.calendar} ${ev.venue}` : ''}
          ${ev.event_date ? ` · ${new Date(ev.event_date).toLocaleDateString()}` : ''}
        </div>
        <div class="event-card-footer">
          <span class="text-sm text-muted">Code: <strong>${ev.access_code}</strong></span>
          <button class="btn btn-ghost btn-sm ev-open-btn" data-id="${ev.id}">Manage ${Icons.externalLink}</button>
        </div>
      </div>
    `).join('');

        grid.querySelectorAll('.ev-open-btn').forEach(btn => {
            btn.addEventListener('click', () => openEventDetail(btn.dataset.id, container, user, navigate));
        });

        grid.querySelectorAll('.ev-delete-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this event and all its queues?')) return;
                try {
                    await api(`/events/${btn.dataset.id}`, {
                        method: 'DELETE'
                    });
                    toast('Event deleted', 'info');
                    await loadEvents(container, user, navigate);
                } catch (err) {
                    toast(err.message, 'error');
                }
            });
        });

        grid.querySelectorAll('.ev-status-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const nextStatus = {
                    draft: 'active',
                    active: 'closed',
                    closed: 'draft'
                } [btn.dataset.status] || 'draft';
                try {
                    await api(`/events/${btn.dataset.id}`, {
                        method: 'PUT',
                        body: {
                            status: nextStatus
                        }
                    });
                    toast(`Status → ${nextStatus}`, 'success');
                    await loadEvents(container, user, navigate);
                } catch (err) {
                    toast(err.message, 'error');
                }
            });
        });

    } catch (err) {
        grid.innerHTML = `<div class="empty-state">Failed to load events: ${err.message}</div>`;
    }
}

async function openEventDetail(eventId, container, user, navigate) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div class="loader"></div></div>`;

    try {
        const {
            event,
            editors,
            queues
        } = await api(`/events/${eventId}`);

        container.innerHTML = `
      <div class="page-title">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="btn btn-ghost btn-sm" id="back-to-events">&larr; Events</button>
          <span>${event.name}</span>
          <span class="status-pill ${event.status}">${event.status}</span>
        </div>
        <button class="btn btn-primary btn-sm" id="create-queue-btn">${Icons.plus} New Queue</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="glass" style="padding:16px;">
          <div class="section-label">Event Info</div>
          ${event.venue ? `<div class="text-sm">${Icons.calendar} ${event.venue}</div>` : ''}
          ${event.event_date ? `<div class="text-sm mt-1">${new Date(event.event_date).toLocaleDateString()}</div>` : ''}
          <div class="text-sm mt-1 text-muted">Code: <strong>${event.access_code}</strong></div>
        </div>
        <div class="glass" style="padding:16px;">
          <div class="section-label">Editors</div>
          <div id="editors-list">
            ${editors.map(e => `
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span class="text-sm">${e.gftvhello_users?.display_name} (@${e.gftvhello_users?.username})</span>
                ${user.is_admin ? `<button class="btn-icon btn-sm danger remove-editor-btn" data-event="${eventId}" data-user="${e.user_id}">${Icons.trash}</button>` : ''}
              </div>
            `).join('') || '<div class="text-sm text-muted">No editors assigned</div>'}
          </div>
          ${user.is_admin ? `
            <div style="display:flex;gap:8px;margin-top:10px;">
              <input id="add-editor-username" placeholder="Username to add…" style="flex:1;" />
              <button class="btn btn-ghost btn-sm" id="add-editor-btn">Add</button>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="section-label">Queues</div>
      <div id="queues-list" class="card-grid">
        ${queues.length ? queues.map(q => `
          <div class="glass event-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span class="status-pill ${q.status}">${q.status}</span>
              <span class="text-sm text-muted">Max: ${q.max_serving}</span>
            </div>
            <div class="event-card-title">${q.name}</div>
            <div class="event-card-meta">Code: ${q.access_code}</div>
            <div class="event-card-footer">
              <a href="/display/${event.access_code}/${q.access_code}" target="_blank" class="btn btn-ghost btn-sm">${Icons.monitor} Display</a>
              <button class="btn btn-primary btn-sm operate-queue-btn" data-queue="${q.id}" data-event="${eventId}">Operate</button>
            </div>
          </div>
        `).join('') : '<div class="empty-state">No queues yet. Create one to get started.</div>'}
      </div>

      <!-- Create Queue Modal -->
      <div class="modal-overlay" id="create-queue-modal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">Create Queue</span>
            <button class="modal-close" id="close-queue-modal">${Icons.x}</button>
          </div>
          <form id="create-queue-form">
            <div class="form-group"><label>Queue Name *</label><input id="q-name" required placeholder="Dealers' Den" /></div>
            <div class="form-group"><label>Description</label><input id="q-desc" placeholder="Optional" /></div>
            <div class="form-group"><label>Max Serving</label><input type="number" id="q-max" value="30" min="1" max="500" /></div>
            <div id="q-err" style="color:var(--status-error);font-size:0.85rem;margin-bottom:10px;display:none;"></div>
            <button type="submit" class="btn btn-primary w-full">Create Queue</button>
          </form>
        </div>
      </div>
    `;

        document.getElementById('back-to-events').addEventListener('click', () => renderEventsView(container, {
            user,
            navigate
        }));
        document.getElementById('create-queue-btn').addEventListener('click', () => {
            document.getElementById('create-queue-modal').classList.add('open');
        });
        document.getElementById('close-queue-modal').addEventListener('click', () => {
            document.getElementById('create-queue-modal').classList.remove('open');
        });

        document.getElementById('create-queue-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('q-err');
            errEl.style.display = 'none';
            try {
                await api('/queues', {
                    method: 'POST',
                    body: {
                        event_id: eventId,
                        name: document.getElementById('q-name').value.trim(),
                        description: document.getElementById('q-desc').value.trim(),
                        max_serving: parseInt(document.getElementById('q-max').value),
                    },
                });
                toast('Queue created!', 'success');
                document.getElementById('create-queue-modal').classList.remove('open');
                openEventDetail(eventId, container, user, navigate);
            } catch (err) {
                errEl.textContent = err.message;
                errEl.style.display = 'block';
            }
        });

        container.querySelectorAll('.operate-queue-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                import('/js/views/queue-operator.js').then(m => {
                    m.renderQueueOperatorView(container, {
                        user,
                        navigate,
                        queueId: btn.dataset.queue,
                        eventId: btn.dataset.event
                    });
                });
            });
        });

        if (user.is_admin) {
            document.getElementById('add-editor-btn')?.addEventListener('click', async () => {
                const username = document.getElementById('add-editor-username').value.trim();
                if (!username) return;
                try {
                    // Resolve username → user_id
                    const {
                        data: users
                    } = await api('/admin/users?username=' + encodeURIComponent(username));
                    if (!users?.length) {
                        toast('User not found', 'error');
                        return;
                    }
                    await api(`/events/${eventId}/editors`, {
                        method: 'POST',
                        body: {
                            user_id: users[0].id
                        }
                    });
                    toast(`${username} added as editor`, 'success');
                    openEventDetail(eventId, container, user, navigate);
                } catch (err) {
                    toast(err.message, 'error');
                }
            });

            container.querySelectorAll('.remove-editor-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await api(`/events/${btn.dataset.event}/editors`, {
                            method: 'DELETE',
                            body: {
                                user_id: btn.dataset.user
                            }
                        });
                        toast('Editor removed', 'info');
                        openEventDetail(eventId, container, user, navigate);
                    } catch (err) {
                        toast(err.message, 'error');
                    }
                });
            });
        }

    } catch (err) {
        container.innerHTML = `<div class="empty-state">Failed to load event: ${err.message}</div>`;
    }
}