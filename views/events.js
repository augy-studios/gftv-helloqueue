import {
    api,
    toast,
    Icons,
    escapeHtml
} from '/script.js';

// What the status button on an event card moves the event to next.
const NEXT_EVENT_STATUS = {
    draft: 'active',
    active: 'closed',
    closed: 'draft'
};

// The Events page: a card per event and, for admins, the New Event button
// and its form.
export async function renderEventsView(container, {
    user,
    navigate
}) {
    let newEventButton = '';
    if (user.is_admin) {
        newEventButton = `<button class="btn btn-primary btn-sm" id="create-event-btn">${Icons.plus} New Event</button>`;
    }

    container.innerHTML = `
    <div class="page-title">
      <span>Events</span>
      ${newEventButton}
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

    attachCreateEventForm(container, user, navigate);
}

// New Event opens the form; submitting it creates the event and reloads the
// list.
function attachCreateEventForm(container, user, navigate) {
    const createEventButton = document.getElementById('create-event-btn');
    if (createEventButton) {
        createEventButton.addEventListener('click', () => {
            document.getElementById('create-event-modal').classList.add('open');
        });
    }
    const closeButton = document.getElementById('close-event-modal');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            document.getElementById('create-event-modal').classList.remove('open');
        });
    }

    const createEventForm = document.getElementById('create-event-form');
    if (!createEventForm) {
        return;
    }
    // A failed create shows the API's message in the form, under the fields.
    createEventForm.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const formError = document.getElementById('ev-err');
        formError.style.display = 'none';
        try {
            // An empty date is sent as null.
            let eventDate = null;
            const dateValue = document.getElementById('ev-date').value;
            if (dateValue) {
                eventDate = dateValue;
            }
            await api('/events', {
                method: 'POST',
                body: {
                    name: document.getElementById('ev-name').value.trim(),
                    venue: document.getElementById('ev-venue').value.trim(),
                    event_date: eventDate,
                    description: document.getElementById('ev-desc').value.trim(),
                },
            });
            document.getElementById('create-event-modal').classList.remove('open');
            document.getElementById('create-event-form').reset();
            toast('Event created!', 'success');
            await loadEvents(container, user, navigate);
        } catch (error) {
            formError.textContent = error.message;
            formError.style.display = 'block';
        }
    });
}

// Fills the events grid: one card per event, or a note when there are none.
async function loadEvents(container, user, navigate) {
    const grid = document.getElementById('events-grid');
    if (!grid) {
        return;
    }

    try {
        const {
            events
        } = await api('/events');

        if (!events.length) {
            let emptyEnding = '.';
            if (user.is_admin) {
                emptyEnding = '. Create one to get started.';
            }
            grid.innerHTML = `<div class="empty-state">${Icons.calendar}<br>No events yet${emptyEnding}</div>`;
            return;
        }

        grid.innerHTML = events.map((event) => buildEventCard(event, user)).join('');

        attachEventCardButtons(grid, container, user, navigate);

    } catch (error) {
        grid.innerHTML = `<div class="empty-state">Failed to load events: ${escapeHtml(error.message)}</div>`;
    }
}

// One event's card: status, name, venue and date, access code, and Manage.
// Admins also get the status and delete buttons.
function buildEventCard(event, user) {
    let adminButtons = '';
    if (user.is_admin) {
        adminButtons = `
            <div style="display:flex;gap:6px;">
              <button class="btn-icon btn-sm ev-status-btn" data-id="${escapeHtml(event.id)}" data-status="${escapeHtml(event.status)}" title="Toggle status">${Icons.refresh}</button>
              <button class="btn-icon btn-sm ev-delete-btn danger" data-id="${escapeHtml(event.id)}" title="Delete event">${Icons.trash}</button>
            </div>
          `;
    }

    let venue = '';
    if (event.venue) {
        venue = `${Icons.calendar} ${escapeHtml(event.venue)}`;
    }

    let eventDate = '';
    if (event.event_date) {
        eventDate = ` · ${new Date(event.event_date).toLocaleDateString()}`;
    }

    return `
      <div class="glass-card event-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="status-pill ${escapeHtml(event.status)}">${escapeHtml(event.status)}</span>
          ${adminButtons}
        </div>
        <div class="event-card-title">${escapeHtml(event.name)}</div>
        <div class="event-card-meta">
          ${venue}
          ${eventDate}
        </div>
        <div class="event-card-footer">
          <span class="text-sm text-muted">Code: <strong>${escapeHtml(event.access_code)}</strong></span>
          <button class="btn btn-ghost btn-sm ev-open-btn" data-id="${escapeHtml(event.id)}">Manage ${Icons.externalLink}</button>
        </div>
      </div>
    `;
}

// The buttons on the event cards: Manage opens the event, the bin deletes it
// (after a confirm), and the status button moves it to its next status.
function attachEventCardButtons(grid, container, user, navigate) {
    grid.querySelectorAll('.ev-open-btn').forEach((button) => {
        button.addEventListener('click', () => openEventDetail(button.dataset.id, container, user, navigate));
    });

    grid.querySelectorAll('.ev-delete-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            if (!confirm('Delete this event and all its queues?')) {
                return;
            }
            try {
                await api(`/events/${button.dataset.id}`, {
                    method: 'DELETE'
                });
                toast('Event deleted', 'info');
                await loadEvents(container, user, navigate);
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    });

    grid.querySelectorAll('.ev-status-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            // Draft → active → closed → draft; an unknown status goes to draft.
            let nextStatus = 'draft';
            if (NEXT_EVENT_STATUS[button.dataset.status]) {
                nextStatus = NEXT_EVENT_STATUS[button.dataset.status];
            }
            try {
                await api(`/events/${button.dataset.id}`, {
                    method: 'PUT',
                    body: {
                        status: nextStatus
                    }
                });
                toast(`Status → ${nextStatus}`, 'success');
                await loadEvents(container, user, navigate);
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    });
}

// The page for one event. It loads the event, its editors and its queues,
// draws the page (buildEventDetailHtml), then wires up its buttons
// (attachEventDetailEvents). If either step fails, the page says so.
async function openEventDetail(eventId, container, user, navigate) {
    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div class="loader"></div></div>`;

    try {
        const {
            event,
            editors,
            queues
        } = await api(`/events/${eventId}`);

        container.innerHTML = buildEventDetailHtml(event, editors, queues, eventId, user);
        attachEventDetailEvents(eventId, container, user, navigate);

    } catch (error) {
        container.innerHTML = `<div class="empty-state">Failed to load event: ${escapeHtml(error.message)}</div>`;
    }
}

// The event page's markup: the title and New Queue, the event's details,
// its editors (admins get the add and remove controls), a card per queue,
// and the New Queue form.
function buildEventDetailHtml(event, editors, queues, eventId, user) {
    let venue = '';
    if (event.venue) {
        venue = `<div class="text-sm">${Icons.calendar} ${escapeHtml(event.venue)}</div>`;
    }

    let eventDate = '';
    if (event.event_date) {
        eventDate = `<div class="text-sm mt-1">${new Date(event.event_date).toLocaleDateString()}</div>`;
    }

    let editorRows = editors.map((editor) => buildEditorRow(editor, eventId, user)).join('');
    if (!editorRows) {
        editorRows = '<div class="text-sm text-muted">No editors assigned</div>';
    }

    let addEditorForm = '';
    if (user.is_admin) {
        addEditorForm = `
            <div style="display:flex;gap:8px;margin-top:10px;">
              <input id="add-editor-username" placeholder="Username to add…" style="flex:1;" />
              <button class="btn btn-ghost btn-sm" id="add-editor-btn">Add</button>
            </div>
          `;
    }

    let queueCards = '<div class="empty-state">No queues yet. Create one to get started.</div>';
    if (queues.length) {
        queueCards = queues.map((queue) => buildQueueCard(queue, event, eventId)).join('');
    }

    return `
      <div class="page-title">
        <div style="display:flex;align-items:center;gap:10px;">
          <button class="btn btn-ghost btn-sm" id="back-to-events">&larr; Events</button>
          <span>${escapeHtml(event.name)}</span>
          <span class="status-pill ${escapeHtml(event.status)}">${escapeHtml(event.status)}</span>
        </div>
        <button class="btn btn-primary btn-sm" id="create-queue-btn">${Icons.plus} New Queue</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div class="glass-card" style="padding:16px;">
          <div class="section-label">Event Info</div>
          ${venue}
          ${eventDate}
          <div class="text-sm mt-1 text-muted">Code: <strong>${escapeHtml(event.access_code)}</strong></div>
        </div>
        <div class="glass-card" style="padding:16px;">
          <div class="section-label">Editors</div>
          <div id="editors-list">
            ${editorRows}
          </div>
          ${addEditorForm}
        </div>
      </div>

      <div class="section-label">Queues</div>
      <div id="queues-list" class="card-grid">
        ${queueCards}
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
}

// One editor in the Editors box, with a remove button for admins.
function buildEditorRow(editor, eventId, user) {
    // gftvhello_users is the editor's account, and can be missing.
    let displayName;
    let username;
    const account = editor.gftvhello_users;
    if (account !== null && account !== undefined) {
        displayName = account.display_name;
        username = account.username;
    }

    let removeButton = '';
    if (user.is_admin) {
        removeButton = `<button class="btn-icon btn-sm danger remove-editor-btn" data-event="${escapeHtml(eventId)}" data-user="${escapeHtml(editor.user_id)}">${Icons.trash}</button>`;
    }

    return `
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span class="text-sm">${escapeHtml(displayName)} (@${escapeHtml(username)})</span>
                ${removeButton}
              </div>
            `;
}

// One queue's card on the event page, with Display and Operate.
function buildQueueCard(queue, event, eventId) {
    return `
          <div class="glass-card event-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span class="status-pill ${escapeHtml(queue.status)}">${escapeHtml(queue.status)}</span>
              <span class="text-sm text-muted">Max: ${queue.max_serving}</span>
            </div>
            <div class="event-card-title">${escapeHtml(queue.name)}</div>
            <div class="event-card-meta">Code: ${escapeHtml(queue.access_code)}</div>
            <div class="event-card-footer">
              <a href="/display/${encodeURIComponent(event.access_code)}/${encodeURIComponent(queue.access_code)}" target="_blank" class="btn btn-ghost btn-sm">${Icons.monitor} Display</a>
              <button class="btn btn-primary btn-sm operate-queue-btn" data-queue="${escapeHtml(queue.id)}" data-event="${escapeHtml(eventId)}">Operate</button>
            </div>
          </div>
        `;
}

// Wires up the event page: back to Events, the New Queue form, the Operate
// buttons and, for admins, adding and removing editors.
function attachEventDetailEvents(eventId, container, user, navigate) {
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

    attachCreateQueueForm(eventId, container, user, navigate);
    attachOperateButtons(container, user, navigate);

    if (user.is_admin) {
        attachEditorControls(eventId, container, user, navigate);
    }
}

// Submitting the New Queue form creates the queue in this event and reopens
// the event page.
function attachCreateQueueForm(eventId, container, user, navigate) {
    const createQueueForm = document.getElementById('create-queue-form');
    if (!createQueueForm) {
        return;
    }
    createQueueForm.addEventListener('submit', async (submitEvent) => {
        submitEvent.preventDefault();
        const formError = document.getElementById('q-err');
        formError.style.display = 'none';
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
        } catch (error) {
            formError.textContent = error.message;
            formError.style.display = 'block';
        }
    });
}

// Operate on a queue card opens the queue operator view.
function attachOperateButtons(container, user, navigate) {
    container.querySelectorAll('.operate-queue-btn').forEach((button) => {
        button.addEventListener('click', () => {
            import('/views/queue-operator.js').then((operatorModule) => {
                operatorModule.renderQueueOperatorView(container, {
                    user,
                    navigate,
                    queueId: button.dataset.queue,
                    eventId: button.dataset.event
                });
            });
        });
    });
}

// Admins only: Add looks the username up and makes that account an editor
// of this event; the bin on an editor's row removes them.
function attachEditorControls(eventId, container, user, navigate) {
    const addEditorButton = document.getElementById('add-editor-btn');
    if (addEditorButton) {
        addEditorButton.addEventListener('click', async () => {
            const username = document.getElementById('add-editor-username').value.trim();
            if (!username) {
                return;
            }
            try {
                // Resolve username → user_id
                const {
                    data: users
                } = await api('/admin/users?username=' + encodeURIComponent(username));
                if (!users || !users.length) {
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
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    }

    container.querySelectorAll('.remove-editor-btn').forEach((button) => {
        button.addEventListener('click', async () => {
            try {
                await api(`/events/${button.dataset.event}/editors`, {
                    method: 'DELETE',
                    body: {
                        user_id: button.dataset.user
                    }
                });
                toast('Editor removed', 'info');
                openEventDetail(eventId, container, user, navigate);
            } catch (error) {
                toast(error.message, 'error');
            }
        });
    });
}
