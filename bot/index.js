// The GFTV HelloQueue Telegram bot, polling Telegram for updates.
// Run it with `node index.js`. It needs TELEGRAM_BOT_TOKEN, SUPABASE_URL,
// SUPABASE_SERVICE_KEY and WEBAPP_URL.
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { createClient } from '@supabase/supabase-js';

// The HelloQueue site the bot links to: WEBAPP_URL when it's set, otherwise
// the live site.
function readWebAppUrl() {
    if (process.env.WEBAPP_URL) {
        return process.env.WEBAPP_URL;
    }
    return 'https://queue.gftv.asia';
}

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: true
});
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const WEBAPP_URL = readWebAppUrl();

console.log('GFTVHelloQueueBot started.');

// The emoji shown beside an entry's status in a status list.
function statusEmojiFor(status) {
    const emojiByStatus = {
        waiting: '⏳',
        serving: '🎉',
        missed: '😔'
    };
    if (emojiByStatus[status]) {
        return emojiByStatus[status];
    }
    return '❓';
}

// 🔔 when a notification is on, 🔕 when it's off.
function notificationIcon(isOn) {
    if (isOn) {
        return '🔔';
    }
    return '🔕';
}

// "enabled" when a notification is on, "disabled" when it's off.
function notificationStateWord(isOn) {
    if (isOn) {
        return 'enabled';
    }
    return 'disabled';
}

// The name of an entry's queue, from the joined gftvqueue_queues row, or
// undefined when that row is missing.
function queueNameOf(entry) {
    const queue = entry.gftvqueue_queues;
    if (!queue) {
        return undefined;
    }
    return queue.name;
}

// The name of the event an entry's queue belongs to, from the joined
// gftvqueue_queues.gftvqueue_events row, or undefined when either is missing.
function eventNameOf(entry) {
    const queue = entry.gftvqueue_queues;
    if (!queue || !queue.gftvqueue_events) {
        return undefined;
    }
    return queue.gftvqueue_events.name;
}

// /start, and /start attend_<CODE> from the queue page's "Open Telegram Bot"
// link. With an attend_ code it connects the attendee to their queue session;
// otherwise it shows the welcome message and the menu buttons.
bot.onText(/\/start(?:\s+(.+))?/, async (message, match) => {
    const chatId = message.chat.id;

    if (match && match[1]) {
        const startParameter = match[1].trim();
        if (startParameter.startsWith('attend_')) {
            const code = startParameter.replace('attend_', '').toUpperCase();
            await handleAttendLogin(chatId, message.from, code);
            return;
        }
    }

    let name = 'there';
    if (message.from.first_name) {
        name = message.from.first_name;
    }

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

// /help: the list of commands.
bot.onText(/\/help/, async (message) => {
    await bot.sendMessage(message.chat.id,
        `*GFTV HelloQueue Bot Commands*\n\n` +
        `🎟️ /attend <CODE> - Connect your Telegram to a queue session. Get the code from the queue page.\n` +
        `🔗 /link <OTP> - Link your Telegram to a HelloQueue dashboard account. Get the OTP from dashboard settings.\n` +
        `🔓 /unlink - Unlink your Telegram from your dashboard account.\n` +
        `📋 /status - Check your current queue status.\n` +
        `🚪 /leavequeue - Leave your current queue.\n` +
        `🔔 /notify - Toggle turn and next-in-line notifications.\n` +
        `❓ /help - Show this message.`, {
            parse_mode: 'Markdown'
        }
    );
});

// /attend <CODE>: connects the attendee to their queue session with the code
// shown on the queue page.
bot.onText(/\/attend(?:\s+([A-Z0-9]+))?/i, async (message, match) => {
    const chatId = message.chat.id;
    let code;
    if (match && match[1]) {
        code = match[1].toUpperCase();
    }
    if (!code) {
        return bot.sendMessage(chatId,
            '🎟️ To connect to a queue, open the queue page and tap *Connect Telegram* to get your code.', {
                parse_mode: 'Markdown'
            }
        );
    }
    await handleAttendLogin(chatId, message.from, code);
});

// Connects a Telegram user to the queue page that showed them `code`. It
// checks the code, replaces any attendee session they already had with a new
// one, and marks the code used with the new session's token, which the queue
// page is polling for.
async function handleAttendLogin(chatId, telegramUser, code) {
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

    // The attendee's name: their first and last name, else their username,
    // else "Attendee".
    let displayName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ');
    if (!displayName && telegramUser.username) {
        displayName = telegramUser.username;
    }
    if (!displayName) {
        displayName = 'Attendee';
    }

    let telegramUsername = null;
    if (telegramUser.username) {
        telegramUsername = telegramUser.username;
    }

    // enforce single session
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
        `✅ *You're connected!*\n\nYou can now go back to the queue page - it will load automatically.\n\nYou'll receive Telegram notifications here when it's your turn.`, {
            parse_mode: 'Markdown'
        }
    );
}

// /link <OTP>: links this Telegram account to a HelloQueue dashboard account
// with the 6-digit code from the dashboard's Profile page. It refuses a code
// that's unknown, used or expired, and a Telegram account that's already
// linked to a different dashboard account.
bot.onText(/\/link(?:\s+(\d{6}))?/, async (message, match) => {
    const chatId = message.chat.id;
    let otp;
    if (match) {
        otp = match[1];
    }

    if (!otp) {
        return bot.sendMessage(chatId,
            '🔗 To link your account:\n\n1. Go to *HelloQueue* → Profile → Link Telegram\n2. Get your 6-digit OTP code\n3. Send: `/link 123456`', {
                parse_mode: 'Markdown'
            }
        );
    }

    const now = new Date().toISOString();
    const { data: otpRow } = await supabase
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

    const { data: existingLink } = await supabase
        .from('gftvqueue_telegram_links')
        .select('user_id')
        .eq('telegram_user_id', chatId)
        .maybeSingle();

    if (existingLink && existingLink.user_id !== otpRow.user_id) {
        return bot.sendMessage(chatId, '⚠️ This Telegram account is already linked to a different HelloQueue account. Use /unlink first.');
    }

    const { data: user } = await supabase
        .from('gftvhello_users')
        .select('id, display_name, username')
        .eq('id', otpRow.user_id)
        .single();

    if (!user) {
        return bot.sendMessage(chatId, '❌ Could not find the HelloQueue account. Please try again.');
    }

    let telegramUsername = null;
    if (message.from.username) {
        telegramUsername = message.from.username;
    }

    await supabase.from('gftvqueue_telegram_links').upsert({
        user_id: otpRow.user_id,
        telegram_user_id: chatId,
        telegram_username: telegramUsername,
        linked_at: now,
    }, {
        onConflict: 'user_id'
    });

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

// /unlink: asks to confirm unlinking this Telegram account from its dashboard
// account. The buttons send confirm_unlink or cancel_unlink.
bot.onText(/\/unlink/, async (message) => {
    const chatId = message.chat.id;

    const { data: link } = await supabase
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

// /joinqueue
bot.onText(/\/joinqueue/, async (message) => {
    await handleJoinQueue(message.chat.id, message.from);
});

// Lists every open queue of every active event as a button, for a Telegram
// account linked to a dashboard account. Pressing one sends join_<queueId>.
async function handleJoinQueue(chatId, telegramUser) {
    // Check if linked
    const { data: link } = await supabase
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

    const { data: events } = await supabase
        .from('gftvqueue_events')
        .select('id, name, access_code')
        .eq('status', 'active');

    if (!events || events.length === 0) {
        return bot.sendMessage(chatId, '📭 No active events with open queues right now. Check back later!');
    }

    const openQueues = [];
    for (const event of events) {
        const { data: queues } = await supabase
            .from('gftvqueue_queues')
            .select('id, name, access_code, max_serving')
            .eq('event_id', event.id)
            .eq('status', 'open');

        if (queues) {
            for (const queue of queues) {
                openQueues.push({
                    ...queue,
                    event_name: event.name,
                    event_access_code: event.access_code
                });
            }
        }
    }

    if (openQueues.length === 0) {
        return bot.sendMessage(chatId, '📭 No queues are currently open. Check back later!');
    }

    const buttons = openQueues.map((queue) => [{
        text: `${queue.event_name} - ${queue.name}`,
        callback_data: `join_${queue.id}`,
    }]);

    await bot.sendMessage(chatId, '🎟️ *Select a queue to join:*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons
        },
    });
}

// /status: lists the queues this Telegram account is waiting in, being
// served in, or has missed, newest first.
bot.onText(/\/status/, async (message) => {
    const chatId = message.chat.id;

    const { data: entries } = await supabase
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
        const statusEmoji = statusEmojiFor(entry.status);
        statusText += `${statusEmoji} *${eventNameOf(entry)}* - ${queueNameOf(entry)}\n`;
        statusText += `   Number: #${entry.queue_number} | Status: ${entry.status}\n\n`;
    }

    await bot.sendMessage(chatId, statusText, {
        parse_mode: 'Markdown'
    });
});

// /leavequeue: asks which queue to leave. One active entry gets a Yes/Cancel
// question; several get one Leave button each. The Leave buttons send
// leave_<entryId>, handled in the button handler below.
bot.onText(/\/leavequeue/, async (message) => {
    const chatId = message.chat.id;

    const { data: entries } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, gftvqueue_queues(id, name)')
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving']);

    if (!entries || entries.length === 0) {
        return bot.sendMessage(chatId, "📋 You're not currently in any queues.");
    }

    if (entries.length === 1) {
        const entry = entries[0];
        await bot.sendMessage(chatId, `Leave queue *${queueNameOf(entry)}* (Number #${entry.queue_number})?`, {
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
        const buttons = entries.map((entry) => [{
            text: `Leave: ${queueNameOf(entry)} (#${entry.queue_number})`,
            callback_data: `leave_${entry.id}`,
        }]);
        await bot.sendMessage(chatId, 'Select which queue to leave:', {
            reply_markup: {
                inline_keyboard: buttons
            },
        });
    }
});

// /notify: one message per active entry, with buttons that toggle its two
// notifications. The buttons send notif_serving_<entryId> and
// notif_next_<entryId>, handled in the button handler below.
bot.onText(/\/notify/, async (message) => {
    const chatId = message.chat.id;

    const { data: entries } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number, notify_serving, notify_next, gftvqueue_queues(name)')
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving']);

    if (!entries || entries.length === 0) {
        return bot.sendMessage(chatId, "📋 You're not in any active queues to adjust notifications for.");
    }

    for (const entry of entries) {
        const servingIcon = notificationIcon(entry.notify_serving);
        const nextIcon = notificationIcon(entry.notify_next);
        await bot.sendMessage(chatId,
            `*${queueNameOf(entry)}* - #${entry.queue_number}\nToggle your notifications:`, {
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

// The entry ID on a Leave or notification button (leave_, notif_serving_,
// notif_next_), or null for any other button.
function entryIdFromButton(data) {
    if (typeof data !== 'string') {
        return null;
    }
    for (const prefix of ['leave_', 'notif_serving_', 'notif_next_']) {
        if (data.startsWith(prefix)) {
            return data.slice(prefix.length);
        }
    }
    return null;
}

// True when the entry exists and was joined by the Telegram user who pressed
// the button (callback_query.from.id against gftvqueue_entries.telegram_user_id).
async function entryBelongsToPresser(entryId, presser) {
    if (!presser || presser.id === undefined || presser.id === null) {
        return false;
    }
    const {
        data: entry
    } = await supabase
        .from('gftvqueue_entries')
        .select('telegram_user_id')
        .eq('id', entryId)
        .maybeSingle();
    if (!entry) {
        return false;
    }
    return String(entry.telegram_user_id) === String(presser.id);
}

// Every inline button press. Leave and notification buttons are checked first
// (M4): only the Telegram user who joined with the entry may press them. Then
// the press is answered and handled by its callback data: cmd_* (the /start
// menu), confirm_unlink, cancel_unlink and cancel, join_<queueId>,
// leave_<entryId>, notif_serving_<entryId> and notif_next_<entryId>.
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const buttonData = query.data;

    // Leave and notification buttons act on one entry: only its owner may
    // press them. Anyone else gets a short notice and nothing changes.
    const buttonEntryId = entryIdFromButton(buttonData);
    if (buttonEntryId !== null) {
        const isOwner = await entryBelongsToPresser(buttonEntryId, query.from);
        if (!isOwner) {
            await bot.answerCallbackQuery(query.id, {
                text: "That isn't your entry"
            });
            return;
        }
    }

    await bot.answerCallbackQuery(query.id);

    if (buttonData === 'cmd_attend') {
        await bot.sendMessage(chatId,
            '🎟️ To connect to a queue, open the queue page on HelloQueue and tap *Connect Telegram* to get your code.', {
                parse_mode: 'Markdown'
            }
        );
    } else if (buttonData === 'cmd_link') {
        await bot.sendMessage(chatId, '🔗 To link your account:\n\n1. Log into HelloQueue at ' + WEBAPP_URL + '\n2. Go to Profile → Link Telegram\n3. Get your 6-digit OTP\n4. Send me: `/link <your-code>`', {
            parse_mode: 'Markdown'
        });
    } else if (buttonData === 'cmd_joinqueue') {
        await handleJoinQueue(chatId, query.from);
    } else if (buttonData === 'cmd_status') {
        await bot.emit('message', {
            chat: {
                id: chatId
            },
            from: query.from,
            text: '/status'
        });
        const { data: entries } = await supabase
            .from('gftvqueue_entries')
            .select('queue_number, status, gftvqueue_queues(name, gftvqueue_events(name))')
            .eq('telegram_user_id', chatId)
            .in('status', ['waiting', 'serving', 'missed']);

        if (!entries || entries.length === 0) {
            return bot.sendMessage(chatId, "📋 You're not currently in any queues.");
        }
        let statusText = '*Your Active Queues:*\n\n';
        for (const entry of entries) {
            const statusEmoji = statusEmojiFor(entry.status);
            statusText += `${statusEmoji} #${entry.queue_number} - ${queueNameOf(entry)} (${entry.status})\n`;
        }
        await bot.sendMessage(chatId, statusText, {
            parse_mode: 'Markdown'
        });
    } else if (buttonData === 'confirm_unlink') {
        await supabase.from('gftvqueue_telegram_links').delete().eq('telegram_user_id', chatId);
        await bot.sendMessage(chatId, '✅ Your Telegram account has been unlinked from HelloQueue.');
    } else if (buttonData === 'cancel_unlink' || buttonData === 'cancel') {
        await bot.sendMessage(chatId, '❌ Action cancelled.');
    } else if (buttonData.startsWith('join_')) {
        const queueId = buttonData.replace('join_', '');
        await handleJoinQueueById(chatId, queueId);
    } else if (buttonData.startsWith('leave_')) {
        const entryId = buttonData.replace('leave_', '');
        await supabase.from('gftvqueue_entries').delete().eq('id', entryId);
        await bot.sendMessage(chatId, '✅ You have left the queue.');
    } else if (buttonData.startsWith('notif_serving_')) {
        const entryId = buttonData.replace('notif_serving_', '');
        const { data: entry } = await supabase.from('gftvqueue_entries').select('notify_serving').eq('id', entryId).single();
        if (entry) {
            const newValue = !entry.notify_serving;
            await supabase.from('gftvqueue_entries').update({
                notify_serving: newValue
            }).eq('id', entryId);
            await bot.sendMessage(chatId, `${notificationIcon(newValue)} "It's my turn" notifications ${notificationStateWord(newValue)}.`);
        }
    } else if (buttonData.startsWith('notif_next_')) {
        const entryId = buttonData.replace('notif_next_', '');
        const { data: entry } = await supabase.from('gftvqueue_entries').select('notify_next').eq('id', entryId).single();
        if (entry) {
            const newValue = !entry.notify_next;
            await supabase.from('gftvqueue_entries').update({
                notify_next: newValue
            }).eq('id', entryId);
            await bot.sendMessage(chatId, `${notificationIcon(newValue)} "I'm next in line" notifications ${notificationStateWord(newValue)}.`);
        }
    }
});

// Joins a queue from a join_<queueId> button, for a Telegram account linked
// to a dashboard account. It refuses a queue that isn't open and a second
// active entry in the same queue, gives the next queue number, and replies
// with the number, the position and a link to the queue page.
async function handleJoinQueueById(chatId, queueId) {
    const { data: link } = await supabase
        .from('gftvqueue_telegram_links')
        .select('user_id, telegram_username')
        .eq('telegram_user_id', chatId)
        .maybeSingle();

    if (!link) {
        return bot.sendMessage(chatId, '🔗 Please link your account first using /link');
    }

    const { data: user } = await supabase
        .from('gftvhello_users')
        .select('display_name')
        .eq('id', link.user_id)
        .single();

    const { data: queue } = await supabase
        .from('gftvqueue_queues')
        .select('*, gftvqueue_events(name, access_code)')
        .eq('id', queueId)
        .single();

    if (!queue || queue.status !== 'open') {
        return bot.sendMessage(chatId, '❌ This queue is no longer open.');
    }

    const { data: existing } = await supabase
        .from('gftvqueue_entries')
        .select('id, queue_number')
        .eq('queue_id', queueId)
        .eq('telegram_user_id', chatId)
        .in('status', ['waiting', 'serving'])
        .maybeSingle();

    if (existing) {
        return bot.sendMessage(chatId, `⚠️ You're already in this queue as #${existing.queue_number}.`);
    }

    const { data: lastEntry } = await supabase
        .from('gftvqueue_entries')
        .select('queue_number')
        .eq('queue_id', queueId)
        .order('queue_number', {
            ascending: false
        })
        .limit(1)
        .maybeSingle();

    // One after the highest number this queue has given out, or 1 for the
    // first entry.
    let queueNumber = 1;
    if (lastEntry) {
        queueNumber = lastEntry.queue_number + 1;
    }

    const { count: aheadCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queueId)
        .eq('status', 'waiting');

    const { count: servingCount } = await supabase
        .from('gftvqueue_entries')
        .select('id', {
            count: 'exact',
            head: true
        })
        .eq('queue_id', queueId)
        .eq('status', 'serving');

    let displayName = 'Unknown';
    if (user && user.display_name) {
        displayName = user.display_name;
    }

    await supabase.from('gftvqueue_entries').insert({
        queue_id: queueId,
        telegram_user_id: chatId,
        telegram_username: link.telegram_username,
        display_name: displayName,
        queue_number: queueNumber,
        status: 'waiting',
        notify_serving: true,
        notify_next: true,
    });

    const atCapacity = servingCount >= queue.max_serving;
    let capacityNote = '';
    if (atCapacity) {
        capacityNote = '\n\n⚠️ The den is currently at capacity. Please wait to be called.';
    }

    let waitingAhead = 0;
    if (aheadCount) {
        waitingAhead = aheadCount;
    }
    const position = waitingAhead + 1;

    let eventName;
    let eventCode;
    if (queue.gftvqueue_events) {
        eventName = queue.gftvqueue_events.name;
        eventCode = queue.gftvqueue_events.access_code;
    }

    await bot.sendMessage(chatId,
        `✅ *You've joined the queue!*\n\nEvent: ${eventName}\nQueue: ${queue.name}\nYour number: *#${queueNumber}*\nPosition: *${position}*${capacityNote}\n\nView your status: ${WEBAPP_URL}/queue/${eventCode}/${queue.access_code}`, {
            parse_mode: 'Markdown'
        }
    );
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, error.message);
});

process.on('SIGINT', () => {
    console.log('Bot shutting down...');
    bot.stopPolling();
    process.exit(0);
});
