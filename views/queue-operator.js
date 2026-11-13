import {
    api,
    toast,
    Icons,
    escapeHtml
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
    } catch (error) {
        container.innerHTML = `<div class="empty-state">Failed to load queue: ${escapeHtml(error.message)}</div>`;
    }
}

// Loads the queue and its entries. The first load draws the whole page and
// wires up its buttons; a silent load (the 4-second poll, and after each
// action) only refreshes the counts and the columns, and keeps quiet if the
// call fails.
async function loadOperatorView(container, user, navigate, queueId, eventId, silent = false) {
    try {
        const {
            queue,
            entries,
            completedCount,
            can_operate: canOperate,
            is_queue_admin: isQueueAdmin
        } = await api(`/queues/${queueId}`);

        const servingList = listOrEmpty(entries.serving);
        const waitingList = listOrEmpty(entries.waiting);
        const missedList = listOrEmpty(entries.missed);
        // Only the last few finished entries (decision 4); completedCount is
        // how many have finished in all.
        const completedList = listOrEmpty(entries.completed);

        if (!silent) {
            container.innerHTML = buildOperatorHTML(queue, servingList, waitingList, missedList, completedList, completedCount, canOperate, isQueueAdmin, user, eventId);
            attachOperatorEvents(container, user, navigate, queueId, eventId, queue);
        } else {
            updateCounts(servingList, waitingList, missedList, completedCount);
            updateColumns(container, servingList, waitingList, missedList, completedList, completedCount);
        }
    } catch (error) {
        if (!silent) {
            throw error;
        }
    }
}

// The API leaves out a status that has no entries: use an empty list then.
function listOrEmpty(list) {
    if (list) {
        return list;
    }
    return [];
}

// The whole operator page: the title, the queue controls, the counts, the
// four columns, the scanner modal, and (for queue admins only) the
// permissions modal.
function buildOperatorHTML(queue, serving, waiting, missed, completed, completedCount, canOperate, isQueueAdmin, user, eventId) {
    // The open/close button shows what pressing it will do.
    let toggleButtonClass = 'btn-success';
    let toggleButtonLabel = `${Icons.check} Open Queue`;
    if (queue.status === 'open') {
        toggleButtonClass = 'btn-danger';
        toggleButtonLabel = `${Icons.x} Close Queue`;
    }

    // Nobody can be called while the queue isn't open.
    let callButtonsDisabled = '';
    if (queue.status !== 'open') {
        callButtonsDisabled = 'disabled';
    }

    let eventAccessCode = '';
    if (queue.event_access_code) {
        eventAccessCode = queue.event_access_code;
    }

    let permissionsModal = '';
    if (isQueueAdmin) {
        permissionsModal = `
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
      `;
    }

    return `
    <div>
      <div class="page-title" style="margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" id="back-btn">&larr; Event</button>
          <span>${escapeHtml(queue.name)}</span>
          <span class="status-pill ${escapeHtml(queue.status)}">${escapeHtml(queue.status)}</span>
          <span class="text-sm text-muted" id="last-updated" style="font-size:0.75rem;"></span>
        </div>
      </div>

      <div class="queue-operator-header">
        <div class="operator-controls">
          <button class="btn ${toggleButtonClass} btn-sm" id="toggle-queue-btn">
            ${toggleButtonLabel}
          </button>

          <button class="btn btn-primary btn-sm" id="call-next-btn" ${callButtonsDisabled}>
            Call Next
          </button>

          <div style="display:flex;align-items:center;gap:6px;">
            <select id="batch-count" class="btn-ghost" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-size:0.88rem;">
              ${[2,3,4,5,10].map((batchSize) => `<option value="${batchSize}">${batchSize}</option>`).join('')}
            </select>
            <button class="btn btn-ghost btn-sm" id="call-batch-btn" ${callButtonsDisabled}>Call Batch</button>
          </div>

          <button class="btn btn-ghost btn-sm" id="open-scanner-btn">${Icons.scan} Scanner</button>
          <a href="/display/${encodeURIComponent(eventAccessCode)}/${encodeURIComponent(queue.access_code)}" target="_blank" class="btn btn-ghost btn-sm">${Icons.monitor} Display</a>
        </div>

        <div class="max-serving-control">
          <span class="text-sm">Max Serving:</span>
          <button class="max-serving-btn" id="ms-minus">−</button>
          <span id="ms-value" style="min-width:24px;text-align:center;">${queue.max_serving}</span>
          <button class="max-serving-btn" id="ms-plus">+</button>
        </div>
      </div>

      <div class="glass-sm" style="padding:8px 14px;margin-bottom:14px;display:flex;align-items:center;gap:16px;font-size:0.82rem;color:var(--text-muted);">
        ${Icons.bell} Queue Code: <strong>${escapeHtml(queue.access_code)}</strong>
        &nbsp;·&nbsp; Serving: <span id="stat-serving">${serving.length}</span>/${queue.max_serving}
        &nbsp;·&nbsp; Waiting: <span id="stat-waiting">${waiting.length}</span>
        &nbsp;·&nbsp; Missed: <span id="stat-missed">${missed.length}</span>
        &nbsp;·&nbsp; Done: <span id="stat-completed">${completedCount}</span>
      </div>

      <div class="queue-columns">
        ${buildColumn('Serving', 'serving', serving, true)}
        ${buildColumn('In Queue', 'waiting', waiting, false)}
        ${buildColumn('Missed', 'missed', missed, false)}
        ${buildCompletedColumn(completed, completedCount)}
      </div>

      <div class="modal-overlay" id="scanner-modal">
        <div class="modal" style="max-width:420px;">
          <div class="modal-header">
            <span class="modal-title">${Icons.scan} Scan QR Code</span>
            <button class="modal-close" id="close-scanner">${Icons.x}</button>
          </div>
          <div class="scanner-container">
            <video id="scanner-video" class="scanner-video" autoplay muted playsinline></video>
            <canvas id="scanner-canvas" style="display:none;"></canvas>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px;">
            <button class="btn btn-primary btn-sm" id="scan-type-entrance" style="flex:1;">🚪 Entrance</button>
            <button class="btn btn-ghost btn-sm" id="scan-type-exit" style="flex:1;">🏁 Exit</button>
          </div>
          <div style="margin-top:8px;">
            <button class="btn btn-primary w-full" id="scan-btn">Scan QR</button>
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

      ${permissionsModal}
    </div>
  `;
}

// One column (Serving, In Queue or Missed): a header with its count, and a
// card per entry.
function buildColumn(title, status, entries, isServing) {
    const columnClasses = {
        serving: 'col-serving',
        waiting: 'col-waiting',
        missed: 'col-missed',
        completed: 'col-completed'
    };
    return `
    <div class="queue-col ${columnClasses[status]}">
      <div class="queue-col-header">
        <span>${title}</span>
        <span class="status-pill ${status}">${entries.length}</span>
      </div>
      <div class="queue-col-body" id="col-${status}">
        ${buildColumnBody(entries, status)}
      </div>
    </div>
  `;
}

// The cards in one column, or "Empty" when it has none.
function buildColumnBody(entries, status) {
    if (entries.length) {
        return entries.map((entry) => buildEntryCard(entry, status)).join('');
    }
    return `<div class="empty-state" style="padding:16px 0;font-size:0.8rem;">Empty</div>`;
}

// The Completed column (decision 4): the header shows how many have
// finished in all, and the body lists only the last few, newest first.
function buildCompletedColumn(recentCompleted, completedCount) {
    return `
    <div class="queue-col col-completed">
      <div class="queue-col-header">
        <span>Completed</span>
        <span class="status-pill completed" id="completed-count">${completedCount}</span>
      </div>
      <div class="queue-col-body" id="col-completed">
        ${buildCompletedBody(recentCompleted, completedCount)}
      </div>
    </div>
  `;
}

// The cards for the last few finished entries, with a note when there are
// more finished than are listed.
function buildCompletedBody(recentCompleted, completedCount) {
    if (!recentCompleted.length) {
        return `<div class="empty-state" style="padding:16px 0;font-size:0.8rem;">Empty</div>`;
    }
    let note = '';
    if (completedCount > recentCompleted.length) {
        note = `<div class="text-sm text-muted completed-recent-note" style="font-size:0.75rem;margin-bottom:6px;">Last ${recentCompleted.length} of ${completedCount}</div>`;
    }
    return note + recentCompleted.map((entry) => buildEntryCard(entry, 'completed')).join('');
}

// One attendee's card: their number, name and @telegram_username, and the
// buttons that fit their column.
function buildEntryCard(entry, status) {
    let actions = '';
    if (status === 'serving') {
        const hasEntered = Boolean(entry.entered_at);
        if (hasEntered) {
            actions = `
      <button class="entry-action-btn success manual-exit-btn" data-id="${escapeHtml(entry.id)}" title="Manual exit (QR unavailable)">${Icons.x}</button>
    `;
        } else {
            actions = `
      <button class="entry-action-btn success mark-entered-btn" data-id="${escapeHtml(entry.id)}" title="Confirm entrance">${Icons.check}</button>
      <button class="entry-action-btn danger mark-missed-btn" data-id="${escapeHtml(entry.id)}" title="Mark missed">${Icons.x}</button>
    `;
        }
    } else if (status === 'missed') {
        actions = `<button class="entry-action-btn rejoin-btn" data-id="${escapeHtml(entry.id)}" title="Move back to waiting">${Icons.refresh}</button>`;
    }
    // Finished entries come without an id: their cards have no buttons.
    let entryIdAttribute = '';
    if (entry.id) {
        entryIdAttribute = ` data-entry-id="${escapeHtml(entry.id)}"`;
    }
    // Decision 5: operators see the attendee's @telegram_username.
    let telegramUsernameLine = '';
    if (entry.telegram_username) {
        telegramUsernameLine = `<div style="font-size:0.75rem;color:var(--text-muted);">@${escapeHtml(entry.telegram_username)}</div>`;
    }
    return `
    <div class="entry-card"${entryIdAttribute}>
      <div class="queue-number ${status}">${entry.queue_number}</div>
      <div class="entry-card-name" title="${escapeHtml(entry.display_name)}">
        ${escapeHtml(entry.display_name)}
        ${telegramUsernameLine}
      </div>
      <div class="entry-card-actions">${actions}</div>
    </div>
  `;
}

function updateCounts(serving, waiting, missed, completedCount) {
    const setText = (elementId, value) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    };
    setText('stat-serving', serving.length);
    setText('stat-waiting', waiting.length);
    setText('stat-missed', missed.length);
    setText('stat-completed', completedCount);
    setText('completed-count', completedCount);
}

function updateColumns(container, serving, waiting, missed, completed, completedCount) {
    const updateColumn = (columnId, entries, status) => {
        const column = document.getElementById(`col-${status}`);
        if (!column) {
            return;
        }
        column.innerHTML = buildColumnBody(entries, status);
        attachCardEvents(container, columnId, status);
    };
    updateColumn('col-serving', serving, 'serving');
    updateColumn('col-waiting', waiting, 'waiting');
    updateColumn('col-missed', missed, 'missed');

    const completedColumn = document.getElementById('col-completed');
    if (completedColumn) {
        completedColumn.innerHTML = buildCompletedBody(completed, completedCount);
    }

    const lastUpdated = document.getElementById('last-updated');
    if (lastUpdated) {
        lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    }
}

function attachCardEvents(container, columnId, status) {
    // events delegated to attachEntryActions
}

// Wires up every control on the operator page, one group at a time. The
// groups share `page`: the container, the queue, and a reload that redraws
// the page after an action (a silent reload only refreshes the counts and
// the columns).
function attachOperatorEvents(container, user, navigate, queueId, eventId, queue) {
    const page = {
        container,
        queueId,
        queue,
        reload(silent) {
            return loadOperatorView(container, user, navigate, queueId, eventId, silent);
        },
    };

    attachBackButton(container, user, navigate);
    attachQueueStatusButton(page);
    attachCallButtons(page);
    attachMaxServingButtons(page);
    attachEntryActions(page);
    attachScannerEvents(queueId);
}

// "← Event": stops the poll and goes back to the events list.
function attachBackButton(container, user, navigate) {
    const backButton = document.getElementById('back-btn');
    if (!backButton) {
        return;
    }
    backButton.addEventListener('click', () => {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
        import('/views/events.js').then((eventsModule) => eventsModule.renderEventsView(container, {
            user,
            navigate
        }));
    });
}

// Open Queue / Close Queue: switches the queue's status, then redraws the
// whole page.
function attachQueueStatusButton(page) {
    const toggleButton = document.getElementById('toggle-queue-btn');
    if (!toggleButton) {
        return;
    }
    toggleButton.addEventListener('click', async () => {
        let newStatus;
        if (page.queue.status === 'open') {
            newStatus = 'closed';
        } else {
            newStatus = 'open';
        }
        try {
            await api(`/queues/${page.queueId}`, {
                method: 'PUT',
                body: {
                    status: newStatus
                }
            });
            toast(`Queue ${newStatus}`, 'success');
            page.queue.status = newStatus;
            await page.reload(false);
        } catch (error) {
            toast(error.message, 'error');
        }
    });
}

// Call Next calls the first waiting attendee; Call Batch calls as many as
// the batch-size dropdown says.
function attachCallButtons(page) {
    const callNextButton = document.getElementById('call-next-btn');
    if (callNextButton) {
        callNextButton.addEventListener('click', async () => {
            await callAttendees(page, {
                action: 'call_next'
            });
        });
    }

    const callBatchButton = document.getElementById('call-batch-btn');
    if (callBatchButton) {
        callBatchButton.addEventListener('click', async () => {
            const count = parseInt(document.getElementById('batch-count').value);
            await callAttendees(page, {
                action: 'call_batch',
                count
            });
        });
    }
}

// Posts a call action, says which numbers were called, and refreshes.
async function callAttendees(page, body) {
    try {
        const {
            called
        } = await api(`/queues/${page.queueId}/operate`, {
            method: 'POST',
            body
        });
        toast(`Called #${called.join(', #')}`, 'success');
        await page.reload(true);
    } catch (error) {
        toast(error.message, 'error');
    }
}

// The − and + buttons beside Max Serving. The new number shows at once and
// is saved in the background; a failed save is ignored.
function attachMaxServingButtons(page) {
    let maxServing = page.queue.max_serving;

    const minusButton = document.getElementById('ms-minus');
    if (minusButton) {
        minusButton.addEventListener('click', async () => {
            if (maxServing <= 1) {
                return;
            }
            maxServing--;
            await showAndSaveMaxServing(page.queueId, maxServing);
        });
    }

    const plusButton = document.getElementById('ms-plus');
    if (plusButton) {
        plusButton.addEventListener('click', async () => {
            maxServing++;
            await showAndSaveMaxServing(page.queueId, maxServing);
        });
    }
}

async function showAndSaveMaxServing(queueId, maxServing) {
    document.getElementById('ms-value').textContent = maxServing;
    await api(`/queues/${queueId}`, {
        method: 'PUT',
        body: {
            max_serving: maxServing
        }
    }).catch(() => {});
}

// The buttons on the entry cards. Each posts one action for its entry, then
// shows a message.
const ENTRY_ACTIONS = [
    { buttonSelector: '.mark-missed-btn', action: 'mark_missed', doneMessage: 'Marked as missed', toastType: 'info' },
    { buttonSelector: '.mark-entered-btn', action: 'mark_entered', doneMessage: 'Entrance confirmed', toastType: 'success' },
    { buttonSelector: '.manual-exit-btn', action: 'mark_complete', doneMessage: 'Manually exited', toastType: 'success' },
    { buttonSelector: '.rejoin-btn', action: 'rejoin', doneMessage: 'Moved back to waiting', toastType: 'success' },
];

// One listener on the page handles every card's buttons, including the
// cards the poll redraws.
function attachEntryActions(page) {
    page.container.addEventListener('click', async (event) => {
        for (const entryAction of ENTRY_ACTIONS) {
            const actionButton = event.target.closest(entryAction.buttonSelector);
            if (actionButton) {
                await runEntryAction(page, entryAction, actionButton.dataset.id);
            }
        }
    });
}

async function runEntryAction(page, entryAction, entryId) {
    try {
        await api(`/queues/${page.queueId}/operate`, {
            method: 'POST',
            body: {
                action: entryAction.action,
                entry_id: entryId
            }
        });
        toast(entryAction.doneMessage, entryAction.toastType);
        await page.reload(true);
    } catch (error) {
        toast(error.message, 'error');
    }
}

// The scanner modal. Its buttons share `scanner`: which kind of scan the
// next code counts as (entrance or exit), and the camera stream while the
// modal is open.
function attachScannerEvents(queueId) {
    const scanner = {
        queueId,
        scanType: 'entrance',
        cameraStream: null,
    };

    attachScanTypeButtons(scanner);
    attachScannerOpenAndClose(scanner);
    attachScanButton(scanner);
    attachManualValidateButton(scanner);
}

// Entrance / Exit: highlights the chosen one.
function attachScanTypeButtons(scanner) {
    const entranceButton = document.getElementById('scan-type-entrance');
    if (entranceButton) {
        entranceButton.addEventListener('click', () => chooseScanType(scanner, 'entrance'));
    }
    const exitButton = document.getElementById('scan-type-exit');
    if (exitButton) {
        exitButton.addEventListener('click', () => chooseScanType(scanner, 'exit'));
    }
}

function chooseScanType(scanner, scanType) {
    scanner.scanType = scanType;
    let chosenButton = document.getElementById('scan-type-entrance');
    let otherButton = document.getElementById('scan-type-exit');
    if (scanType === 'exit') {
        chosenButton = document.getElementById('scan-type-exit');
        otherButton = document.getElementById('scan-type-entrance');
    }
    chosenButton.className = 'btn btn-primary btn-sm';
    otherButton.className = 'btn btn-ghost btn-sm';
    chosenButton.style.flex = '1';
    otherButton.style.flex = '1';
}

// Scanner opens the modal and starts the back camera; the close button
// stops the camera and hides the last result.
function attachScannerOpenAndClose(scanner) {
    const openButton = document.getElementById('open-scanner-btn');
    if (openButton) {
        openButton.addEventListener('click', async () => {
            document.getElementById('scanner-modal').classList.add('open');
            try {
                scanner.cameraStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'environment'
                    }
                });
                document.getElementById('scanner-video').srcObject = scanner.cameraStream;
            } catch {
                toast('Camera access denied', 'error');
            }
        });
    }

    const closeButton = document.getElementById('close-scanner');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            document.getElementById('scanner-modal').classList.remove('open');
            if (scanner.cameraStream) {
                scanner.cameraStream.getTracks().forEach((track) => track.stop());
                scanner.cameraStream = null;
            }
            const scannerResult = document.getElementById('scanner-result');
            if (scannerResult) {
                scannerResult.style.display = 'none';
            }
        });
    }
}

// Scan QR: takes one frame from the camera, looks for a QR code in it with
// jsQR, and validates the code it finds.
function attachScanButton(scanner) {
    const scanButton = document.getElementById('scan-btn');
    if (!scanButton) {
        return;
    }
    // Needs the camera running. The button is disabled while it scans.
    scanButton.addEventListener('click', async () => {
        const video = document.getElementById('scanner-video');
        if (!video || !video.srcObject) {
            toast('Camera not started', 'error');
            return;
        }
        scanButton.disabled = true;
        scanButton.textContent = 'Scanning…';
        try {
            const jsQR = await loadJsQR();
            const canvas = document.getElementById('scanner-canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const canvasContext = canvas.getContext('2d');
            canvasContext.drawImage(video, 0, 0);
            const imageData = canvasContext.getImageData(0, 0, canvas.width, canvas.height);
            const qrCode = jsQR(imageData.data, imageData.width, imageData.height);
            if (qrCode && qrCode.data) {
                await validateToken(qrCode.data, scanner.queueId, scanner.scanType);
            } else {
                toast('No QR code detected, try again', 'info');
            }
        } catch (error) {
            toast('Scan failed: ' + error.message, 'error');
        } finally {
            scanButton.disabled = false;
            scanButton.textContent = 'Scan QR';
        }
    });
}

// Validate: checks a code typed or pasted in by hand.
function attachManualValidateButton(scanner) {
    const validateButton = document.getElementById('manual-validate-btn');
    if (!validateButton) {
        return;
    }
    validateButton.addEventListener('click', async () => {
        const token = document.getElementById('manual-token').value.trim();
        if (!token) {
            return;
        }
        await validateToken(token, scanner.queueId, scanner.scanType);
    });
}

function loadJsQR() {
    if (window.jsQR) {
        return Promise.resolve(window.jsQR);
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        script.onload = () => resolve(window.jsQR);
        script.onerror = () => reject(new Error('Could not load QR decoder'));
        document.head.appendChild(script);
    });
}

// Sends a QR token to the API as an entrance or exit scan, and shows the
// answer under the scanner.
async function validateToken(token, queueId, scanType = 'entrance') {
    const scannerResult = document.getElementById('scanner-result');
    try {
        const data = await api(`/queues/${queueId}/scan`, {
            method: 'POST',
            body: { token, scan_type: scanType }
        });
        scannerResult.className = 'scanner-result valid';
        scannerResult.innerHTML = `${Icons.check} ${escapeHtml(data.message)}<br><strong>#${data.queue_number} · ${escapeHtml(data.name)}</strong>`;
        scannerResult.style.display = 'block';
        document.getElementById('manual-token').value = '';
    } catch (error) {
        scannerResult.className = 'scanner-result invalid';
        scannerResult.innerHTML = `${Icons.x} ${escapeHtml(error.message)}`;
        scannerResult.style.display = 'block';
    }
}
