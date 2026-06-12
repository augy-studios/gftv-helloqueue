export async function sendTelegramMessage(chatId, text, options = {}) {
    if (!chatId) return;
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.error('[Telegram] TELEGRAM_BOT_TOKEN is not set — message not sent to', chatId);
        return;
    }

    try {
        const payload = {
            chat_id: chatId,
            text,
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
            const err = await response.json();
            console.error('Telegram send error:', err);
        }
    } catch (err) {
        console.error('Telegram fetch error:', err);
    }
}