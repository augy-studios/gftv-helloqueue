// GFTV official site banner. See gftv-official.md at the repo root.
//
// A permanent, collapsible bar at the very top of every page stating that the
// site is official and teaching a reader how to check that for themselves.
// It proves nothing, and the copy never claims otherwise: it states the
// official domain endings and how to read a domain from the end.

import { Icons } from '/script.js';

// The two things a site has to know about officialness live together. Add a
// domain here and the bar copy follows; add it to the trusted sites page in
// the same change, since the bar says "the full list".
export const OFFICIAL_DOMAINS = ['globalfurry.tv', 'gftv.asia'];
export const TRUSTED_SITES_URL = 'https://gftv.asia/trusted-sites';

// Expansion is remembered per site. Dismissal is not a thing: the bar itself
// is always present, only the panel state is stored.
const STORAGE_KEY = 'gftv-helloqueue.officialBar';

const COPY = {
    line: 'An official Global Furry Television website',
    lineShort: 'An official GFTV website',
    toggle: 'How to identify',
    domainBody: 'Read the address from the end, at the last dot before the first single slash. A site ending in anything else is not GFTV, even if the name appears earlier in the address.',
    trustedLink: 'The full list of official GFTV sites',
    secureHeading: 'Secure sites use HTTPS',
    secureBody: 'Look for a padlock, or https:// at the start of the address. Only share personal details on an official site over a secure connection.',
};

// "a or b", "a, b or c".
function joinDomains(domains) {
    if (domains.length <= 1) {
        return domains.join('');
    }
    return `${domains.slice(0, -1).join(', ')} or ${domains[domains.length - 1]}`;
}

// Whether the reader left the panel open last time.
function readOpen() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'open';
    } catch {
        return false;
    }
}

// Remembers whether the panel is open, for the next page view.
function writeOpen(open) {
    try {
        if (open) {
            localStorage.setItem(STORAGE_KEY, 'open');
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch { /* storage unavailable, the bar still works for this page view */ }
}

// Puts the official bar at the very top of the page (once; a second call
// returns the bar already there) and wires up its "How to identify" toggle.
// The panel starts open if the reader left it open last time.
export function buildOfficialBar() {
    const existing = document.getElementById('officialBar');
    if (existing) {
        return existing;
    }

    const open = readOpen();
    // The panel's class and hidden attribute for its starting state.
    let panelOpenClass = '';
    let panelHiddenAttribute = ' hidden';
    if (open) {
        panelOpenClass = ' open';
        panelHiddenAttribute = '';
    }

    const bar = document.createElement('div');
    bar.className = 'gov-bar';
    bar.id = 'officialBar';
    bar.innerHTML = `
    <div class="gov-bar-inner">
      <img class="gov-bar-mark" src="/gftv-flag.png" alt="" width="24" height="16">
      <p class="gov-bar-line">
        <span class="gov-bar-line-long">${COPY.line}</span>
        <span class="gov-bar-line-short">${COPY.lineShort}</span>
      </p>
      <button type="button" class="gov-bar-toggle" id="officialBarToggle"
              aria-expanded="${open}" aria-controls="officialBarPanel">
        ${COPY.toggle}
        ${Icons.chevronDown}
      </button>
    </div>

    <div class="gov-bar-panel${panelOpenClass}" id="officialBarPanel"${panelHiddenAttribute}>
      <div class="gov-bar-panel-inner">
        <div class="gov-bar-points">
          <div class="gov-bar-point">
            ${Icons.globe}
            <div>
              <h2>Official GFTV sites end with ${joinDomains(OFFICIAL_DOMAINS)}</h2>
              <p>${COPY.domainBody}</p>
              <p><a href="${TRUSTED_SITES_URL}">${COPY.trustedLink}</a></p>
            </div>
          </div>
          <div class="gov-bar-point">
            ${Icons.lock}
            <div>
              <h2>${COPY.secureHeading}</h2>
              <p>${COPY.secureBody}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

    // The very top of <body>, above the header and above anything else.
    document.body.prepend(bar);

    const toggle = bar.querySelector('#officialBarToggle');
    const panel = bar.querySelector('#officialBarPanel');

    // Opens or closes the panel, and remembers which.
    function setOpen(shouldOpen) {
        toggle.setAttribute('aria-expanded', String(shouldOpen));
        writeOpen(shouldOpen);

        if (shouldOpen) {
            // Un-hide first, then flip the class a frame later so the height
            // transition has a starting point to run from.
            panel.hidden = false;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => panel.classList.add('open'));
            });
            return;
        }

        panel.classList.remove('open');
        // Out of the accessibility tree once the collapse has finished. The
        // timer covers the case where transitionend never fires.
        const hideIfStillClosed = () => {
            if (!panel.classList.contains('open')) {
                panel.hidden = true;
            }
        };
        panel.addEventListener('transitionend', hideIfStillClosed, { once: true });
        setTimeout(hideIfStillClosed, 260);
    }

    toggle.addEventListener('click', () => {
        setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    return bar;
}
