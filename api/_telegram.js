// Sends a message from the bot through the Telegram Bot API's sendMessage
// method. Markdown is the default parse mode; `options` can change it or add
// buttons. A failure is logged, never thrown, so a handler carries on.
export async function sendTelegramMessage(chatId, text, options = {}) {
    if (!chatId) {
        return;
    }
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.error('[Telegram] TELEGRAM_BOT_TOKEN is not set — message not sent to', chatId);
        return;
    }

    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown',
            ...options,
        };

        const response = await fetch(
            `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
            }
        );

        if (!response.ok) {
            const errorDetails = await response.json();
            console.error('Telegram send error:', errorDetails);
        }
    } catch (error) {
        console.error('Telegram fetch error:', error);
    }
}
