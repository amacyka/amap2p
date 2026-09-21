// Принимает все сообщения от Telegram, запоминает пользователей и их сообщения.
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  try {
    const update = JSON.parse(event.body || '{}');
    const message = update.message;

    if (!message || !message.chat) {
      return { statusCode: 200, body: 'OK' };
    }

    const store = getStore('bot');
    const chatId = String(message.chat.id);
    const userKey = `user:${chatId}`;
    const now = new Date().toISOString();

    let user = await store.get(userKey, { type: 'json' });
    if (!user) {
      user = {
        id: chatId,
        username: message.from?.username || null,
        first_name: message.from?.first_name || '',
        last_name: message.from?.last_name || '',
        joined_at: now,
      };
    }
    user.last_message_at = now;
    await store.setJSON(userKey, user);

    // Сохраняем текст сообщения в историю переписки
    const text = message.text || '[не текстовое сообщение]';
    const msgKey = `messages:${chatId}`;
    let history = (await store.get(msgKey, { type: 'json' })) || [];
    history.push({ from: 'user', text, ts: now });
    if (history.length > 500) history = history.slice(-500); // не даём расти бесконечно
    await store.setJSON(msgKey, history);

    // Приветствие на /start
    if (text === '/start') {
      await sendTelegramMessage(
        chatId,
        'Привет! 👋\nНапиши сюда сообщение — я передам его дальше.'
      );
    }

    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error(err);
    // Telegram всё равно не должен получать ошибку, иначе будет ретраить
    return { statusCode: 200, body: 'OK' };
  }
};

async function sendTelegramMessage(chatId, text) {
  const token = process.env.BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data;
}
