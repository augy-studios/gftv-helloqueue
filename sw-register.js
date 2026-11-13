// Service worker registration and the update prompt bar.
// See update-bar-spec.md at the repo root.
//
// The rule the whole design rests on: a new worker never activates on its
// own. It downloads, installs, and waits. The only thing that promotes it is a
// person pressing Reload here. sw.js therefore calls skipWaiting() nowhere
// except in its 'skip-waiting' message handler, and that message is only ever
// posted from this file.

const SERVICE_WORKER_URL = '/sw.js';

const COPY = {
    label: 'Update',
    ready: 'A new version of HelloQueue is ready.',
    reload: 'Reload',
    later: 'Not now',
};

let registration = null;
let waitingWorker = null;
let reloading = false;
// For this page view only, and never stored. "Not now" means not now.
let dismissed = false;

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

// Shows the update bar while a new worker is waiting and nobody has pressed
// "Not now", and removes it otherwise. It reuses the bar already on the page,
// if there is one.
function render() {
    const existing = document.querySelector('.update-notice');

    if (!waitingWorker || dismissed) {
        if (existing) {
            existing.remove();
        }
        return;
    }

    let bar = existing;
    if (existing === null || existing === undefined) {
        bar = document.createElement('div');
    }
    bar.className = 'update-notice';
    // Nothing is wrong, so status rather than alert: an alert interrupts a
    // screen reader mid-sentence to say a website is slightly newer.
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-label', COPY.label);
    bar.innerHTML = `
    <div class="update-notice-inner">
      <p>${escapeHtml(COPY.ready)}</p>
      <button type="button" class="btn btn-primary btn-sm" data-sw-update>
        ${escapeHtml(COPY.reload)}
      </button>
      <button type="button" class="btn btn-ghost btn-sm" data-sw-later>
        ${escapeHtml(COPY.later)}
      </button>
    </div>
  `;

    bar.querySelector('[data-sw-update]').addEventListener('click', () => {
        // The only place anything asks for skipWaiting. The reload happens on
        // controllerchange, not here.
        if (waitingWorker) {
            waitingWorker.postMessage('skip-waiting');
        }
    });

    bar.querySelector('[data-sw-later]').addEventListener('click', () => {
        dismissed = true;
        render();
    });

    if (!existing) {
        // Directly below the official bar when it is present: that one is
        // always the topmost thing on the page. Otherwise the very top.
        const officialBar = document.getElementById('officialBar');
        if (officialBar) {
            officialBar.after(bar);
        } else {
            document.body.prepend(bar);
        }
    }
}

// Notices a new worker that's waiting, now or later, and shows the bar for it.
function watchForUpdate() {
    if (!registration) {
        return;
    }

    // A worker already waiting when the page opened. This is the ordinary case
    // on the second page view after a deploy; without it the prompt would only
    // reach somebody who had the page open at the moment the new worker
    // finished installing.
    if (registration.waiting && navigator.serviceWorker.controller) {
        waitingWorker = registration.waiting;
        render();
    }

    registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) {
            return;
        }

        installing.addEventListener('statechange', () => {
            // `installed` with a controller present means an update. With no
            // controller it is a first install, and there is no previous
            // version on screen to protect.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                let newWorker = registration.waiting;
                if (newWorker === null || newWorker === undefined) {
                    newWorker = installing;
                }
                waitingWorker = newWorker;
                render();
            }
        });
    });
}

// Registers sw.js, then watches for updates. Reloads the page once the new
// worker has taken over.
function registerWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    navigator.serviceWorker
        .register(SERVICE_WORKER_URL)
        .then((newRegistration) => {
            registration = newRegistration;
            watchForUpdate();
        })
        .catch((cause) => {
            // A refused registration is not a reason to break the page.
            console.warn('service worker registration failed:', cause);
        });

    // The swap, once somebody has accepted it. Reloading here rather than in
    // the click handler is what makes the page come back on the new version:
    // the controller has changed by this point, so the reload is served by the
    // new worker and not the one being replaced. The flag guards against
    // controllerchange firing more than once.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) {
            return;
        }
        reloading = true;
        window.location.reload();
    });
}

// Registration on `load`, not immediately: installing fetches everything the
// worker precaches, and starting that while the page is still fetching its own
// assets makes a first visit slower for no gain.
if (document.readyState === 'complete') {
    registerWorker();
} else {
    window.addEventListener('load', registerWorker, { once: true });
}
