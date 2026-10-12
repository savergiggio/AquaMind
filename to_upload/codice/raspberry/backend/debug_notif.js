
require('dotenv').config();
const Database = require('better-sqlite3');
const fetch = require('node-fetch');
const path = require('path');

const dbPath = process.env.DB_PATH || './data/aquamind.db';
const db = new Database(dbPath);

function getNotificationSettings() {
    let settings = db.prepare('SELECT * FROM notification_settings WHERE id = 1').get();
    return settings;
}

async function sendNotification(title, message) {
    const settings = getNotificationSettings();
    if (!settings) {
        console.log('No settings found');
        return;
    }
    console.log('Settings found:', JSON.stringify(settings, null, 2));

    const promises = [];

    // Send to ntfy locally to test
    if (settings.ntfy_topic) {
        console.log(`Attempting ntfy to: ${settings.ntfy_server}/${settings.ntfy_topic}`);
        const fullMessage = `${title}\n\n${message}`;
        promises.push(
            fetch(`${settings.ntfy_server}/${settings.ntfy_topic}`, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                body: fullMessage
            })
                .then(res => console.log('ntfy status:', res.status))
                .catch(err => console.error('ntfy failed:', err.message))
        );
    }

    if (settings.telegram_bot_token && settings.telegram_chat_id) {
        console.log('Attempting Telegram...');
        promises.push(
            fetch(`https://api.telegram.org/bot${settings.telegram_bot_token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: settings.telegram_chat_id,
                    text: `🐠 <b>${title}</b>\n\n${message}`,
                    parse_mode: 'HTML'
                })
            })
                .then(res => res.json())
                .then(data => console.log('Telegram response:', data))
                .catch(err => console.error('Telegram failed:', err.message))
        );
    }

    await Promise.all(promises);
}

// Run test
sendNotification('Test Debug', 'Questo è un test manuale dal debugger.');
