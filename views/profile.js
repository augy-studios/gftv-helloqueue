import {
    api,
    toast,
    Icons
} from '/js/app.js';

export async function renderProfileView(container, {
    user
}) {
    container.innerHTML = `
    <div class="page-title">Profile</div>
    <div style="max-width:520px;">
      <div class="glass" style="padding:22px;margin-bottom:16px;">
        <div class="section-label">Account</div>
        <div class="info-row"><span class="info-row-label">Display Name</span><span>${user.display_name}</span></div>
        <div class="info-row"><span class="info-row-label">Username</span><span>@${user.username}</span></div>
        <div class="info-row"><span class="info-row-label">Email</span><span>${user.email || '—'}</span></div>
        <div class="info-row">
          <span class="info-row-label">Role</span>
          <span>${user.is_admin ? 'Admin' : user.is_editor ? 'Editor' : 'Approved User'}</span>
        </div>
      </div>

      <div class="glass" style="padding:22px;" id="telegram-section">
        <div class="section-label">Telegram Integration</div>
        <div id="tg-content"><div class="loader"></div></div>
      </div>
    </div>
  `;

    await loadTelegramStatus(user);
}

async function loadTelegramStatus(user) {
    const tgContent = document.getElementById('tg-content');
    if (!tgContent) return;

    try {
        const {
            user: me
        } = await api('/auth/me');

        if (me.telegram_linked) {
            tgContent.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <span class="status-pill open">Linked</span>
          <span class="text-sm">@${me.telegram_username || 'unknown'}</span>
        </div>
        <div class="text-sm text-muted mt-1">Linked on ${new Date(me.telegram_linked_at).toLocaleDateString()}</div>
        <div class="text-sm text-muted mt-1">Notifications are sent to your Telegram via @GFTVHelloQueueBot.</div>
        <button class="btn btn-danger btn-sm mt-2" id="unlink-tg-btn">${Icons.x} Unlink Telegram</button>
      `;

            document.getElementById('unlink-tg-btn')?.addEventListener('click', async () => {
                if (!confirm('Unlink your Telegram account from HelloQueue?')) return;
                try {
                    await api('/user/telegram-link', {
                        method: 'DELETE'
                    });
                    toast('Telegram unlinked', 'info');
                    loadTelegramStatus(user);
                } catch (err) {
                    toast(err.message, 'error');
                }
            });
        } else {
            tgContent.innerHTML = `
        <div class="text-sm text-muted" style="margin-bottom:14px;">
          Link your Telegram account to receive queue notifications and join queues via @GFTVHelloQueueBot.
        </div>
        <button class="btn btn-primary btn-sm" id="gen-otp-btn">${Icons.link} Generate Link Code</button>
        <div id="otp-display" style="display:none;margin-top:16px;">
          <div class="glass-sm" style="padding:14px;text-align:center;">
            <div class="section-label">Your Link Code</div>
            <div id="otp-code" style="font-size:2.2rem;letter-spacing:0.2em;margin:8px 0;"></div>
            <div class="text-sm text-muted">Send <strong>/link <span id="otp-inline"></span></strong> to @GFTVHelloQueueBot on Telegram</div>
            <div id="otp-expires" class="text-sm text-muted mt-1"></div>
          </div>
          <button class="btn btn-ghost btn-sm mt-2 w-full" id="refresh-otp-btn">${Icons.refresh} Generate new code</button>
        </div>
      `;

            const genOtp = async () => {
                try {
                    const data = await api('/user/telegram-link', {
                        method: 'GET'
                    });
                    document.getElementById('otp-display').style.display = 'block';
                    document.getElementById('gen-otp-btn').style.display = 'none';
                    document.getElementById('otp-code').textContent = data.otp_code;
                    document.getElementById('otp-inline').textContent = data.otp_code;
                    const exp = new Date(data.expires_at);
                    document.getElementById('otp-expires').textContent = `Expires at ${exp.toLocaleTimeString()}`;

                    // Auto-poll to detect when linked
                    let checkTimer = setInterval(async () => {
                        const {
                            user: refreshed
                        } = await api('/auth/me').catch(() => ({
                            user: null
                        }));
                        if (refreshed?.telegram_linked) {
                            clearInterval(checkTimer);
                            toast('Telegram linked!', 'success');
                            loadTelegramStatus(user);
                        }
                    }, 3000);
                    setTimeout(() => clearInterval(checkTimer), 10 * 60 * 1000);
                } catch (err) {
                    toast(err.message, 'error');
                }
            };

            document.getElementById('gen-otp-btn')?.addEventListener('click', genOtp);
            document.getElementById('refresh-otp-btn')?.addEventListener('click', genOtp);
        }
    } catch (err) {
        tgContent.innerHTML = `<div class="empty-state">Failed to load Telegram status</div>`;
    }
}