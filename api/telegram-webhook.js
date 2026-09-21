// Принимает все сообщения от Telegram, запоминает пользователей и их сообщения.
const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  try {
    const update = req.body;
    const message = update && update.message;

    if (!message || !message.chat) {
      res.status(200).send('OK');
      return;
    }

    const chatId = String(message.chat.id);
    const now = new Date().toISOString();

    let user = await kv.get(`bot:user:${chatId}`);
    if (!user) {
      user = {
        id: chatId,
        username: message.from?.username || null,
        first_name: message.from?.first_name || '',
        last_name: message.from?.last_name || '',
        joined_at: now,
      };
      await kv.sadd('bot:users', chatId);
    }
    user.last_message_at = now;
    await kv.set(`bot:user:${chatId}`, user);

    // Сохраняем текст сообщения в историю переписки
    const text = message.text || '[не текстовое сообщение]';
    await kv.rpush(`bot:messages:${chatId}`, JSON.stringify({ from: 'user', text, ts: now }));
    await kv.ltrim(`bot:messages:${chatId}`, -500, -1); // не даём расти бесконечно

    // Приветствие на /start
    if (text === '/start') {
      await sendTelegramMessage(
        chatId,
        'Привет! 👋\nНапиши сюда сообщение — я передам его дальше.'
      );
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error(err);
    // Telegram всё равно не должен получать ошибку, иначе будет ретраить
    res.status(200).send('OK');
  }
};

async function sendTelegramMessage(chatId, text) {
  const token = process.env.BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data;
}
