import {
    api,
    toast,
    Icons,
    escapeHtml
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

// Fills My Queues: a card per queue this account operates, each with live
// counts and an Operate button.
async function loadMyQueues(container, user, navigate) {
    const listElement = document.getElementById('queues-list');
    if (!listElement) return;

    try {
        // The API returns only the queues this account can operate or
        // administer, with event_name, event_access_code and is_queue_admin.
        const {
            queues: allQueues
        } = await api('/queues?mine=1');

        if (!allQueues.length) {
            listElement.innerHTML = `<div class="empty-state">${Icons.list}<br>You don't have operator access to any queues yet.</div>`;
            return;
        }

        listElement.innerHTML = allQueues.map((queue) => buildQueueCard(queue)).join('');

        for (const queue of allQueues) {
            loadQueueCounts(queue.id, queue.event_access_code, queue.access_code);
        }

        listElement.querySelectorAll('.operate-btn').forEach((button) => {
            button.addEventListener('click', () => {
                import('/views/queue-operator.js').then((operatorModule) => {
                    operatorModule.renderQueueOperatorView(container, {
                        user,
                        navigate,
                        queueId: button.dataset.queue,
                        eventId: button.dataset.event,
                    });
                });
            });
        });

    } catch (error) {
        listElement.innerHTML = `<div class="empty-state">Failed to load queues: ${escapeHtml(error.message)}</div>`;
    }
}

// One queue's card: status, your role on it, its event, its code, a box for
// the live counts (filled in by loadQueueCounts), Display and Operate.
function buildQueueCard(queue) {
    let roleLabel = `<span class="text-sm text-muted">Operator</span>`;
    if (queue.is_queue_admin) {
        roleLabel = `<span class="text-sm text-muted">Queue Admin</span>`;
    }

    return `
      <div class="glass-card event-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="status-pill ${escapeHtml(queue.status)}">${escapeHtml(queue.status)}</span>
          ${roleLabel}
        </div>

        <div class="event-card-title">${escapeHtml(queue.name)}</div>
        <div class="event-card-meta">
          Event: ${escapeHtml(queue.event_name)}
          &nbsp;·&nbsp; Max: ${queue.max_serving}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
          <span class="text-sm text-muted">
            Queue code: <strong>${escapeHtml(queue.access_code)}</strong>
          </span>
        </div>

        <div id="counts-${escapeHtml(queue.id)}" class="glass-sm" style="padding:8px 12px;margin-top:10px;display:flex;gap:14px;font-size:0.8rem;">
          <span>${Icons.hourglass} Loading…</span>
        </div>

        <div class="event-card-footer" style="margin-top:12px;">
          <a href="/display/${encodeURIComponent(queue.event_access_code)}/${encodeURIComponent(queue.access_code)}" target="_blank" class="btn btn-ghost btn-sm">
            ${Icons.monitor} Display
          </a>
          <button class="btn btn-primary btn-sm operate-btn" data-queue="${escapeHtml(queue.id)}" data-event="${escapeHtml(queue.event_id)}">
            Operate
          </button>
        </div>
      </div>
    `;
}

// Fills one card's live counts from the public display API.
async function loadQueueCounts(queueId, eventCode, queueCode) {
    const countsElement = document.getElementById(`counts-${queueId}`);
    if (!countsElement) return;
    try {
        const data = await fetch(`/api/display/${eventCode}/${queueCode}`).then((response) => response.json());
        const servingCount = lengthOrZero(data.serving);
        const waitingCount = valueOrZero(data.total_in_queue);
        const missedCount = lengthOrZero(data.missed);
        const doneCount = valueOrZero(data.total_served);
        countsElement.innerHTML = `
      <span style="color:var(--status-serving);"><svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg> Serving: ${servingCount}</span>
      <span style="color:var(--status-waiting);">${Icons.hourglass} Waiting: ${waitingCount}</span>
      <span style="color:var(--status-missed);">${Icons.alertTriangle} Missed: ${missedCount}</span>
      <span style="color:var(--text-muted);">${Icons.check} Done: ${doneCount}</span>
    `;
    } catch {
        countsElement.innerHTML = `<span class="text-muted">Couldn't load live counts</span>`;
    }
}

// How long a list from the display API is: 0 when the list is missing
// (null or undefined) or empty.
function lengthOrZero(list) {
    if (list === null || list === undefined) {
        return 0;
    }
    if (list.length) {
        return list.length;
    }
    return 0;
}

// A count from the display API, or 0 when it's missing.
function valueOrZero(value) {
    if (value) {
        return value;
    }
    return 0;
}
