import {
    api,
    toast,
    Icons
} from '/script.js';

let pollTimer = null;

export async function renderQueueOperatorView(container, {
    user,
    navigate,
    queueId,
    eventId
}) {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div class="loader"></div></div>`;

    try {
        await loadOperatorView(container, user, navigate, queueId, eventId);
        pollTimer = setInterval(() => loadOperatorView(container, user, navigate, queueId, eventId, true), 4000);
    } catch (err) {
        container.innerHTML = `<div class="empty-state">Failed to load queue: ${err.message}</div>`;
    }
}

async function loadOperatorView(container, user, navigate, queueId, eventId, silent = false) {
    try {
        const {
            queue,
            entries,
            can_operate,
            is_queue_admin
        } = await api(`/queues/${queueId}`);

        const servingList = entries.serving || [];
        const waitingList = entries.waiting || [];
        const missedList = entries.missed || [];
        const completedList = entries.completed || [];

        if (!silent) {
            container.innerHTML = buildOperatorHTML(queue, servingList, waitingList, missedList, completedList, can_operate, is_queue_admin, user, eventId);
            attachOperatorEvents(container, user, navigate, queueId, eventId, queue);
        } else {
                updateCounts(servingList, waitingList, missedList, completedList);
            updateColumns(container, servingList, waitingList, missedList, completedList);
        }
    } catch (err) {
        if (!silent) throw err;
    }
}

function buildOperatorHTML(queue, serving, waiting, missed, completed, can_operate, is_queue_admin, user, eventId) {
    return `
    <div>
      <div class="page-title" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" id="back-btn">&larr; Event</button>
          <span>${queue.name}</span>
          <span class="status-pill ${queue.status}">${queue.status}</span>
          <span class="text-sm text-muted" id="last-updated" style="font-size:0.75rem;"></span>
        </div>
      </div>

      <div class="queue-operator-header">
        <div class="operator-controls">
          <button class="btn ${queue.status === 'open' ? 'btn-danger' : 'btn-success'} btn-sm" id="toggle-queue-btn">
            ${queue.status === 'open' ? `${Icons.x} Close Queue` : `${Icons.check} Open Queue`}
          </button>

          <button class="btn btn-primary btn-sm" id="call-next-btn" ${queue.status !== 'open' ? 'disabled' : ''}>
            Call Next
          </button>

          <div style="display:flex;align-items:center;gap:6px;">
            <select id="batch-count" class="btn-ghost" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-family:Jua,sans-serif;font-size:0.88rem;">
              ${[2,3,4,5,10].map(n => `<option value="${n}">${n}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-sm" id="call-batch-btn" ${queue.status !== 'open' ? 'disabled' : ''}>Call Batch</button>
          </div>

          <button class="btn btn-ghost btn-sm" id="open-scanner-btn">${Icons.scan} Scanner</button>
          <a href="/display/${queue.event_access_code || ''}/${queue.access_code}" target="_blank" class="btn btn-ghost btn-sm">${Icons.monitor} Display</a>
        </div>

        <div class="max-serving-control">
          <span class="text-sm">Max Serving:</span>
          <button class="max-serving-btn" id="ms-minus">−</button>
          <span id="ms-value" style="min-width:24px;text-align:center;">${queue.max_serving}</span>
          <button class="max-serving-btn" id="ms-plus">+</button>
        </div>
      </div>

      <div class="glass-sm" style="padding:8px 14px;margin-bottom:14px;display:flex;align-items:center;gap:16px;font-size:0.82rem;color:var(--text-muted);">
        ${Icons.bell} Queue Code: <strong>${queue.access_code}</strong>
        &nbsp;·&nbsp; Serving: <span id="stat-serving">${serving.length}</span>/${queue.max_serving}
        &nbsp;·&nbsp; Waiting: <span id="stat-waiting">${waiting.length}</span>
        &nbsp;·&nbsp; Missed: <span id="stat-missed">${missed.length}</span>
        &nbsp;·&nbsp; Done: <span id="stat-completed">${completed.length}</span>
      </div>

      <div class="queue-columns">
        ${buildCol('Serving', 'serving', serving, true)}
        ${buildCol('In Queue', 'waiting', waiting, false)}
        ${buildCol('Missed', 'missed', missed, false)}
        ${buildCol('Completed', 'completed', completed, false)}
      </div>

      <div class="modal-overlay" id="scanner-modal">
        <div class="modal" style="max-width:420px;">
          <div class="modal-header">
            <span class="modal-title">${Icons.scan} Scan QR Code</span>
            <button class="modal-close" id="close-scanner">${Icons.x}</button>
          </div>
          <div class="scanner-container">
            <video id="scanner-video" class="scanner-video" autoplay muted playsinline></video>
          </div>
          <div id="scanner-result" class="scanner-result" style="display:none;"></div>
          <hr class="divider" />
          <div class="form-group">
            <label>Enter code manually</label>
            <div style="display:flex;gap:8px;">
              <input id="manual-token" placeholder="Paste or type token code…" />
              <button class="btn btn-primary btn-sm" id="manual-validate-btn">Validate</button>
            </div>
          </div>
        </div>
      </div>

      ${is_queue_admin ? `
      <div class="modal-overlay" id="perms-modal">
        <div class="modal">
          <div class="modal-header">
            <span class="modal-title">${Icons.users} Queue Permissions</span>
            <button class="modal-close" id="close-perms">${Icons.x}</button>
          </div>
          <div id="perms-list"><div class="loader"></div></div>
          <hr class="divider" />
          <div class="form-group">
            <label>Add operator (username)</label>
            <div style="display:flex;gap:8px;">
              <input id="add-op-username" placeholder="username…" />
              <button class="btn btn-ghost btn-sm" id="add-op-btn">Add</button>
            </div>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  `;
}

function buildCol(title, status, entries, isServing) {
    const colors = {
        serving: 'col-serving',
        waiting: 'col-waiting',
        missed: 'col-missed',
        completed: 'col-completed'
    };
    return `
    <div class="queue-col ${colors[status]}">
      <div class="queue-col-header">
        <span>${title}</span>
        <span class="status-pill ${status}">${entries.length}</span>
      </div>
      <div class="queue-col-body" id="col-${status}">
        ${entries.length ? entries.map(e => buildEntryCard(e, status)).join('') : `<div class="empty-state" style="padding:16px 0;font-size:0.8rem;">Empty</div>`}
      </div>
    </div>
  `;
}

function buildEntryCard(entry, status) {
    let actions = '';
    if (status === 'serving') {
        actions = `
      <button class="entry-action-btn success mark-done-btn" data-id="${entry.id}" title="Mark complete">${Icons.check}</button>
      <button class="entry-action-btn danger mark-missed-btn" data-id="${entry.id}" title="Mark missed">${Icons.x}</button>
    `;
    } else if (status === 'missed') {
        actions = `<button class="entry-action-btn rejoin-btn" data-id="${entry.id}" title="Move back to waiting">${Icons.refresh}</button>`;
    }
    return `
    <div class="entry-card" data-entry-id="${entry.id}">
      <div class="queue-number ${status}">${entry.queue_number}</div>
      <div class="entry-card-name" title="${entry.display_name}">
        ${entry.display_name}
        ${entry.telegram_username ? `<div style="font-size:0.75rem;color:var(--text-muted);">@${entry.telegram_username}</div>` : ''}
      </div>
      <div class="entry-card-actions">${actions}</div>
    </div>
  `;
}

function updateCounts(serving, waiting, missed, completed) {
    const safe = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    safe('stat-serving', serving.length);
    safe('stat-waiting', waiting.length);
    safe('stat-missed', missed.length);
    safe('stat-completed', completed.length);
}

function updateColumns(container, serving, waiting, missed, completed) {
    const update = (id, entries, status) => {
        const col = document.getElementById(`col-${status}`);
        if (!col) return;
        col.innerHTML = entries.length ?
            entries.map(e => buildEntryCard(e, status)).join('') :
            `<div class="empty-state" style="padding:16px 0;font-size:0.8rem;">Empty</div>`;
        attachCardEvents(container, id, status);
    };
    update('col-serving', serving, 'serving');
    update('col-waiting', waiting, 'waiting');
    update('col-missed', missed, 'missed');
    update('col-completed', completed, 'completed');

    const ts = document.getElementById('last-updated');
    if (ts) ts.textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

function attachCardEvents(container, colId, queueId) {
    // events delegated to attachOperatorEvents
}

function attachOperatorEvents(container, user, navigate, queueId, eventId, queue) {
    document.getElementById('back-btn')?.addEventListener('click', () => {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        import('/views/events.js').then(m => m.renderEventsView(container, {
            user,
            navigate
        }));
    });

    document.getElementById('toggle-queue-btn')?.addEventListener('click', async () => {
        const newStatus = queue.status === 'open' ? 'closed' : 'open';
        try {
            await api(`/queues/${queueId}`, {
                method: 'PUT',
                body: {
                    status: newStatus
                }
            });
            toast(`Queue ${newStatus}`, 'success');
            queue.status = newStatus;
            await loadOperatorView(container, user, navigate, queueId, eventId);
        } catch (err) {
            toast(err.message, 'error');
        }
    });

    document.getElementById('call-next-btn')?.addEventListener('click', async () => {
        try {
            const {
                called
            } = await api(`/queues/${queueId}/operate`, {
                method: 'POST',
                body: {
                    action: 'call_next'
                }
            });
            toast(`Called #${called.join(', #')}`, 'success');
            await loadOperatorView(container, user, navigate, queueId, eventId, true);
        } catch (err) {
            toast(err.message, 'error');
        }
    });

    document.getElementById('call-batch-btn')?.addEventListener('click', async () => {
        const count = parseInt(document.getElementById('batch-count').value);
        try {
            const {
                called
            } = await api(`/queues/${queueId}/operate`, {
                method: 'POST',
                body: {
                    action: 'call_batch',
                    count
                }
            });
            toast(`Called #${called.join(', #')}`, 'success');
            await loadOperatorView(container, user, navigate, queueId, eventId, true);
        } catch (err) {
            toast(err.message, 'error');
        }
    });

    let maxServing = queue.max_serving;
    document.getElementById('ms-minus')?.addEventListener('click', async () => {
        if (maxServing <= 1) return;
        maxServing--;
        document.getElementById('ms-value').textContent = maxServing;
        await api(`/queues/${queueId}`, {
            method: 'PUT',
            body: {
                max_serving: maxServing
            }
        }).catch(() => {});
    });
    document.getElementById('ms-plus')?.addEventListener('click', async () => {
        maxServing++;
        document.getElementById('ms-value').textContent = maxServing;
        await api(`/queues/${queueId}`, {
            method: 'PUT',
            body: {
                max_serving: maxServing
            }
        }).catch(() => {});
    });

    container.addEventListener('click', async (e) => {
        const markDone = e.target.closest('.mark-done-btn');
        if (markDone) {
            try {
                await api(`/queues/${queueId}/operate`, {
                    method: 'POST',
                    body: {
                        action: 'mark_complete',
                        entry_id: markDone.dataset.id
                    }
                });
                toast('Marked complete', 'success');
                await loadOperatorView(container, user, navigate, queueId, eventId, true);
            } catch (err) {
                toast(err.message, 'error');
            }
        }

        const markMissed = e.target.closest('.mark-missed-btn');
        if (markMissed) {
            try {
                await api(`/queues/${queueId}/operate`, {
                    method: 'POST',
                    body: {
                        action: 'mark_missed',
                        entry_id: markMissed.dataset.id
                    }
                });
                toast('Marked as missed', 'info');
                await loadOperatorView(container, user, navigate, queueId, eventId, true);
            } catch (err) {
                toast(err.message, 'error');
            }
        }
    });

    let stream = null;
    document.getElementById('open-scanner-btn')?.addEventListener('click', async () => {
        document.getElementById('scanner-modal').classList.add('open');
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment'
                }
            });
            document.getElementById('scanner-video').srcObject = stream;
        } catch (err) {
            toast('Camera access denied', 'error');
        }
    });

    document.getElementById('close-scanner')?.addEventListener('click', () => {
        document.getElementById('scanner-modal').classList.remove('open');
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        const res = document.getElementById('scanner-result');
        if (res) res.style.display = 'none';
    });

    document.getElementById('manual-validate-btn')?.addEventListener('click', async () => {
        const token = document.getElementById('manual-token').value.trim();
        if (!token) return;
        await validateToken(token, queueId);
    });
}

async function validateToken(token, queueId) {
    const resultEl = document.getElementById('scanner-result');
    try {
        const data = await api(`/queues/${queueId}/scan`, {
            method: 'POST',
            body: {
                token
            }
        });
        resultEl.className = 'scanner-result valid';
        resultEl.innerHTML = `${Icons.check} Validated — marked served.<br><strong>#${data.queue_number} · ${data.name}</strong>`;
        resultEl.style.display = 'block';
        document.getElementById('manual-token').value = '';
    } catch (err) {
        resultEl.className = 'scanner-result invalid';
        resultEl.innerHTML = `${Icons.x} ${err.message}`;
        resultEl.style.display = 'block';
    }
}