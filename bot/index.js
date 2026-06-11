// Run on Debian VPS: node index.js
// Required env vars: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBAPP_URL
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import {
    createClient
} from '@supabase/supabase-js';

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: true
});
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://queue.gftv.asia';

console.log('GFTVHelloQueueBot started.');

// ─── /start ──────────────────────────────────────────────────────────────────
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const param = match?.[1]?.trim();

    // Deep link: /start attend_CODE
    if (param?.startsWith('attend_')) {
        const code = param.replace('attend_', '').toUpperCase();
        await handleAttendLogin(chatId, msg.from, code);
        return;
    }

    const name = msg.from.first_name || 'there';

    await bot.sendMessage(chatId,
        `👋 Hi ${name}! Welcome to *GFTV HelloQueue Bot*.\n\nI help you manage your place in virtual queues at GFTV events.\n\nHere's what I can do:`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: '🎟️ Connect to a queue',
                        callback_data: 'cmd_attend'
                    }],
                    [{
                        text: '🔗 Link dashboard account',
                        callback_data: 'cmd_link'
                    }],
                    [{
                        text: '📋 My queue status',
                        callback_data: 'cmd_status'
                    }],
                    [{
                        text: '🔔 Notification settings',
                        callback_data: 'cmd_notify'
                    }],
                    [{
                        text: '🌐 Open HelloQueue',
                        url: WEBAPP_URL
                    }],
                ],
            },
        }
    );
});

// ─── /help ───────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        `*GFTV HelloQueue Bot Commands*\n\n` +
        `🎟️ /attend <CODE> — Connect your Telegram to a queue session. Get the code from the queue page.\n` +
        `🔗 /link <OTP> — Link your Telegram to a HelloQueue dashboard account. Get the OTP from dashboard settings.\n` +
        `🔓 /unlink — Unlink your Telegram from your dashboard account.\n` +
        `📋 /status — Check your current queue status.\n` +
        `🚪 /leavequeue — Leave your current queue.\n` +
        `🔔 /notify — Toggle turn and next-in-line notifications.\n` +
        `❓ /help — Show this message.`, {
            parse_mode: 'Markdown'
        }
    );
});

// ─── /attend <CODE> ──────────────────────────────────────────────────────────
bot.onText(/\/attend(?:\s+([A-Z0-9]+))?/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match?.[1]?.toUpperCase();
    if (!code) {
        return bot.sendMessage(chatId,
            '🎟️ To connect to a queue, open the queue page and tap *Connect Telegram* to get your code.', {
                parse_mode: 'Markdown'
            }
        );
    }
    await handleAttendLogin(chatId, msg.from, code);
});

async function handleAttendLogin(chatId, from, code) {
    const now = new Date().toISOString();

    const { data: loginCode } = await supabase
        .from('gftvqueue_attendee_login_codes')
        .select('id, expires_at, used_at')
        .eq('code', code)
        .maybeSingle();

    if (!loginCode) {
        return bot.sendMessage(chatId, '❌ Invalid code. Please get a new one from the queue page.');
    }
    if (loginCode.expires_at < now) {
        return bot.sendMessage(chatId, '⏰ This code has expired. Please get a new one from the queue page.');
    }
    if (loginCode.used_at) {
        return bot.sendMessage(chatId, '✅ This code has already been used.');
    }

    const displayName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Attendee';
    const telegramUsername = from.username || null;

    // Kill any existing attendee sessions for this account (single-session enforcement)
    await supabase
        .from('gftvqueue_attendee_sessions')
        .delete()
        .eq('telegram_user_id', chatId);

    const { data: newSession, error } = await supabase
        .from('gftvqueue_attendee_sessions')
        .insert({
            telegram_user_id: chatId,
            telegram_username: telegramUsername,
            display_name: displayName,
        })
        .select('token')
        .single();

    if (error || !newSession) {
        return bot.sendMessage(chatId, '❌ Something went wrong. Please try again.');
    }

    await supabase
        .from('gftvqueue_attendee_login_codes')
        .update({ used_at: now, session_token: newSession.token })
        .eq('id', loginCode.id);

    await bot.sendMessage(chatId,
        `✅ *You're connected!*\n\nYou can now go back to the queue page — it will load automatically.\n\nYou'll receive Telegram notifications here when it's your turn.`, {
            parse_mode: 'Markdown'
        }
    );
}

// ─── /link <OTP> ─────────────────────────────────────────────────────────────
bot.onText(/\/link(?:\s+(\d{6}))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const otp = match?. [1];

    if (!otp) {
        return bot.sendMessage(chatId,
            '🔗 To link your account:\n\n1. Go to *HelloQueue* → Profile → Link Telegram\n2. Get your 6-digit OTP code\n3. Send: `/link 123456`', {
                parse_mode: 'Markdown'
            }
        );
    }

    // Validate OTP
    const now = new Date().toISOString();
    const {
        data: otpRow
    } = await supabase
        .from('gftvqueue_telegram_otps')
        .select('id, user_id, expires_at, used_at')
        .eq('otp_code', otp)
        .maybeSingle();

    if (!otpRow) {
        return bot.sendMessage(chatId, '❌ Invalid code. Please generate a new one from the HelloQueue site.');
    }
    if (otpRow.used_at) {
        return bot.sendMessage(chatId, '❌ This code has already been used. Please generate a new one.');
    }
    if (otpRow.expires_at < now) {
        return bot.sendMessage(chatId, '❌ This code has expired. Please generate a new one from HelloQueue.');
    }

    // Check if this Telegram account is already linked to another user
    const {
        data: existingLink
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('user_id')
        .eq('telegram_user_id', chatId)
        .maybeSingle();

    if (existingLink && existingLink.user_id !== otpRow.user_id) {
        return bot.sendMessage(chatId, '⚠️ This Telegram account is already linked to a different HelloQueue account. Use /unlink first.');
    }

    // Get user info
    const {
        data: user
    } = await supabase
        .from('gftvhello_users')
        .select('id, display_name, username')
        .eq('id', otpRow.user_id)
        .single();

    if (!user) {
        return bot.sendMessage(chatId, '❌ Could not find the HelloQueue account. Please try again.');
    }

    // Upsert the link
    await supabase.from('gftvqueue_telegram_links').upsert({
        user_id: otpRow.user_id,
        telegram_user_id: chatId,
        telegram_username: msg.from.username || null,
        linked_at: now,
    }, {
        onConflict: 'user_id'
    });

    // Mark OTP used
    await supabase
        .from('gftvqueue_telegram_otps')
        .update({
            used_at: now
        })
        .eq('id', otpRow.id);

    await bot.sendMessage(chatId,
        `✅ *Account linked!*\n\nYou're now linked to HelloQueue as *${user.display_name}* (@${user.username}).\n\nYou'll receive queue notifications here. Use /joinqueue to join a queue!`, {
            parse_mode: 'Markdown'
        }
    );
});

// ─── /unlink ─────────────────────────────────────────────────────────────────
bot.onText(/\/unlink/, async (msg) => {
    const chatId = msg.chat.id;

    const {
        data: link
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('user_id')
        .eq('telegram_user_id', chatId)
        .maybeSingle();

    if (!link) {
        return bot.sendMessage(chatId, '⚠️ Your Telegram account is not linked to any HelloQueue account.');
    }

    await bot.sendMessage(chatId, 'Are you sure you want to unlink your Telegram account from HelloQueue?', {
        reply_markup: {
            inline_keyboard: [
                [{
                    text: '✅ Yes, unlink',
                    callback_data: 'confirm_unlink'
                }],
                [{
                    text: '❌ Cancel',
                    callback_data: 'cancel_unlink'
                }],
            ],
        },
    });
});

// ─── /joinqueue ──────────────────────────────────────────────────────────────
bot.onText(/\/joinqueue/, async (msg) => {
    await handleJoinQueue(msg.chat.id, msg.from);
});

async function handleJoinQueue(chatId, from) {
    // Check if linked
    const {
        data: link
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('user_id')
        .eq('telegram_user_id', chatId)
        .maybeSingle();

    if (!link) {
        return bot.sendMessage(chatId,
            '🔗 You need to link your HelloQueue account first.\nUse /link <OTP> or get an OTP from the HelloQueue site.', {
                parse_mode: 'Markdown'
            }
        );
    }

    // List active events and open queues
    const {
        data: events
    } = await supabase
        .from('gftvqueue_events')
        .select('id, name, access_code')
        .eq('status', 'active');

    if (!events || events.length === 0) {
        return bot.sendMessage(chatId, '📭 No active events with open queues right now. Check back later!');
    }

    // For each event, get open queues
    const openQueues = [];
    for (const event of events) {
        const {
            data: queues
        } = await supabase
            .from('gftvqueue_queues')
            .select('id, name, access_code, max_serving')
            .eq('event_id', event.id)
            .eq('status', 'open');

        if (queues) {
            for (const q of queues) {
                openQueues.push({
                    ...q,
                    event_name: event.name,
                    event_access_code: event.access_code
                });
            }
        }
    }

    if (openQueues.length === 0) {
        return bot.sendMessage(chatId, '📭 No queues are currently open. Check back later!');
    }

    const buttons = openQueues.map(q => [{
        text: `${q.event_name} - ${q.name}`,
        callback_data: `join_${q.id}`,
    }]);

    await bot.sendMessage(chatId, '🎟️ *Select a queue to join:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons
        },
    });
}

// ─── /status ─────────────────────────────────────────────────────────────────
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;

    const {
        data: entries
    } = await supabase
        .from('gftvqueue_entries')
        .select('queue_number, status, joined_at, gftvqueue_queues(name, gftvqueue_events(name))')
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving', 'missed'])
        .order('joined_at', {
            ascending: false
        });

    if (!entries || entries.length === 0) {
        return bot.sendMessage(chatId, "📋 You're not currently in any queues.");
    }

    let statusText = '*Your Active Queues:*\n\n';
    for (const entry of entries) {
        const statusEmoji = {
            waiting: '⏳',
            serving: '🎉',
            missed: '😔'
        } [entry.status] || '❓';
        statusText += `${statusEmoji} *${entry.gftvqueue_queues?.gftvqueue_events?.name}* - ${entry.gftvqueue_queues?.name}\n`;
        statusText += `   Number: #${entry.queue_number} | Status: ${entry.status}\n\n`;
    }

    await bot.sendMessage(chatId, statusText, {
        parse_mode: 'Markdown'
    });
});

// ─── /leavequeue ─────────────────────────────────────────────────────────────
bot.onText(/\/leavequeue/, async (msg) => {
    const chatId = msg.chat.id;

    const {
        data: entries
    } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, gftvqueue_queues(id, name)')
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving']);

    if (!entries || entries.length === 0) {
        return bot.sendMessage(chatId, "📋 You're not currently in any queues.");
    }

    if (entries.length === 1) {
        const entry = entries[0];
        await bot.sendMessage(chatId, `Leave queue *${entry.gftvqueue_queues?.name}* (Number #${entry.queue_number})?`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: '✅ Yes, leave',
                        callback_data: `leave_${entry.id}`
                    }],
                    [{
                        text: '❌ Cancel',
                        callback_data: 'cancel'
                    }],
                ],
            },
        });
    } else {
        const buttons = entries.map(e => [{
            text: `Leave: ${e.gftvqueue_queues?.name} (#${e.queue_number})`,
            callback_data: `leave_${e.id}`,
        }]);
        await bot.sendMessage(chatId, 'Select which queue to leave:', {
            reply_markup: {
                inline_keyboard: buttons
            },
        });
    }
});

// ─── /notify ─────────────────────────────────────────────────────────────────
bot.onText(/\/notify/, async (msg) => {
    const chatId = msg.chat.id;

    const {
        data: entries
    } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, notify_serving, notify_next, gftvqueue_queues(name)')
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving']);

    if (!entries || entries.length === 0) {
        return bot.sendMessage(chatId, "📋 You're not in any active queues to adjust notifications for.");
    }

    for (const entry of entries) {
        const servingIcon = entry.notify_serving ? '🔔' : '🔕';
        const nextIcon = entry.notify_next ? '🔔' : '🔕';
        await bot.sendMessage(chatId,
            `*${entry.gftvqueue_queues?.name}* - #${entry.queue_number}\nToggle your notifications:`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: `${servingIcon} It's my turn`,
                            callback_data: `notif_serving_${entry.id}`
                        }],
                        [{
                            text: `${nextIcon} I'm next in line`,
                            callback_data: `notif_next_${entry.id}`
                        }],
                    ],
                },
            }
        );
    }
});

// ─── Callback query handler ───────────────────────────────────────────────────
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    await bot.answerCallbackQuery(query.id);

    if (data === 'cmd_attend') {
        await bot.sendMessage(chatId,
            '🎟️ To connect to a queue, open the queue page on HelloQueue and tap *Connect Telegram* to get your code.', {
                parse_mode: 'Markdown'
            }
        );
    } else if (data === 'cmd_link') {
        await bot.sendMessage(chatId, '🔗 To link your account:\n\n1. Log into HelloQueue at ' + WEBAPP_URL + '\n2. Go to Profile → Link Telegram\n3. Get your 6-digit OTP\n4. Send me: `/link <your-code>`', {
            parse_mode: 'Markdown'
        });
    } else if (data === 'cmd_joinqueue') {
        await handleJoinQueue(chatId, query.from);
    } else if (data === 'cmd_status') {
        await bot.emit('message', {
            chat: {
                id: chatId
            },
            from: query.from,
            text: '/status'
        });
        // Manually trigger status
        const {
            data: entries
        } = await supabase
            .from('gftvqueue_entries')
            .select('queue_number, status, gftvqueue_queues(name, gftvqueue_events(name))')
            .eq('telegram_user_id', chatId)
            .in('status', ['waiting', 'serving', 'missed']);

        if (!entries || entries.length === 0) {
            return bot.sendMessage(chatId, "📋 You're not currently in any queues.");
        }
        let statusText = '*Your Active Queues:*\n\n';
        for (const entry of entries) {
            const statusEmoji = {
                waiting: '⏳',
                serving: '🎉',
                missed: '😔'
            } [entry.status] || '❓';
            statusText += `${statusEmoji} #${entry.queue_number} - ${entry.gftvqueue_queues?.name} (${entry.status})\n`;
        }
        await bot.sendMessage(chatId, statusText, {
            parse_mode: 'Markdown'
        });
    } else if (data === 'confirm_unlink') {
        await supabase.from('gftvqueue_telegram_links').delete().eq('telegram_user_id', chatId);
        await bot.sendMessage(chatId, '✅ Your Telegram account has been unlinked from HelloQueue.');
    } else if (data === 'cancel_unlink' || data === 'cancel') {
        await bot.sendMessage(chatId, '❌ Action cancelled.');
    } else if (data.startsWith('join_')) {
        const queueId = data.replace('join_', '');
        await handleJoinQueueById(chatId, queueId);
    } else if (data.startsWith('leave_')) {
        const entryId = data.replace('leave_', '');
        await supabase.from('gftvqueue_entries').delete().eq('id', entryId);
        await bot.sendMessage(chatId, '✅ You have left the queue.');
    } else if (data.startsWith('notif_serving_')) {
        const entryId = data.replace('notif_serving_', '');
        const {
            data: entry
        } = await supabase.from('gftvqueue_entries').select('notify_serving').eq('id', entryId).single();
        if (entry) {
            const newVal = !entry.notify_serving;
            await supabase.from('gftvqueue_entries').update({
                notify_serving: newVal
            }).eq('id', entryId);
            await bot.sendMessage(chatId, `${newVal ? '🔔' : '🔕'} "It's my turn" notifications ${newVal ? 'enabled' : 'disabled'}.`);
        }
    } else if (data.startsWith('notif_next_')) {
        const entryId = data.replace('notif_next_', '');
        const {
            data: entry
        } = await supabase.from('gftvqueue_entries').select('notify_next').eq('id', entryId).single();
        if (entry) {
            const newVal = !entry.notify_next;
            await supabase.from('gftvqueue_entries').update({
                notify_next: newVal
            }).eq('id', entryId);
            await bot.sendMessage(chatId, `${newVal ? '🔔' : '🔕'} "I'm next in line" notifications ${newVal ? 'enabled' : 'disabled'}.`);
        }
    }
});

// ─── Join queue by ID ─────────────────────────────────────────────────────────
async function handleJoinQueueById(chatId, queueId) {
    const {
        data: link
    } = await supabase
        .from('gftvqueue_telegram_links')
        .select('user_id, telegram_username')
        .eq('telegram_user_id', chatId)
        .maybeSingle();

    if (!link) return bot.sendMessage(chatId, '🔗 Please link your account first using /link');

    const {
        data: user
    } = await supabase
        .from('gftvhello_users')
        .select('display_name')
        .eq('id', link.user_id)
        .single();

    const {
        data: queue
    } = await supabase
        .from('gftvqueue_queues')
        .select('*, gftvqueue_events(name, access_code)')
        .eq('id', queueId)
        .single();

    if (!queue || queue.status !== 'open') {
        return bot.sendMessage(chatId, '❌ This queue is no longer open.');
    }

    // Check already in queue
    const {
        data: existing
    } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

    if (existing) {
        return bot.sendMessage(chatId, `⚠️ You're already in this queue as #${existing.queue_number}.`);
    }

    // Get next number
    const {
        data: lastEntry
    } = await supabase
        .from('gftvqueue_entries')
        .select('queue_number')
        .eq('queue_id', queueId)
        .order('queue_number', {
            ascending: false
        })
        .limit(1)
        .maybeSingle();

    const queue_number = lastEntry ? lastEntry.queue_number + 1 : 1;

    const {
        count: aheadCount
    } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queueId)
        .eq('status', 'waiting');

    const {
        count: servingCount
    } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queueId)
        .eq('status', 'serving');

    await supabase.from('gftvqueue_entries').insert({
        queue_id: queueId,
        telegram_user_id: chatId,
        telegram_username: link.telegram_username,
        display_name: user?.display_name || 'Unknown',
        queue_number,
        status: 'waiting',
    });

    const atCapacity = servingCount >= queue.max_serving;
    const capacityMsg = atCapacity ? '\n\n⚠️ The den is currently at capacity. Please wait to be called.' : '';
    const position = (aheadCount || 0) + 1;
    const eventCode = queue.gftvqueue_events?.access_code;

    await bot.sendMessage(chatId,
        `✅ *You've joined the queue!*\n\nEvent: ${queue.gftvqueue_events?.name}\nQueue: ${queue.name}\nYour number: *#${queue_number}*\nPosition: *${position}*${capacityMsg}\n\nView your status: ${WEBAPP_URL}/queue/${eventCode}/${queue.access_code}`, {
            parse_mode: 'Markdown'
        }
    );
}

// ─── Error handling ───────────────────────────────────────────────────────────
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, error.message);
});

process.on('SIGINT', () => {
    console.log('Bot shutting down...');
    bot.stopPolling();
    process.exit(0);
});