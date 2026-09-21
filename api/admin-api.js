// Бэкенд для админ-панели: список пользователей, переписка, рассылка.
// Доступ только с правильным паролем в заголовке x-admin-password.
const { kv } = require('@vercel/kv');

module.exports = async (req, res) => {
  const password = req.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const action = req.query.action;

  try {
    // ---- список пользователей ----
    if (req.method === 'GET' && action === 'list') {
      const ids = await kv.smembers('bot:users');
      const users = (await Promise.all(ids.map((id) => kv.get(`bot:user:${id}`)))).filter(Boolean);
      users.sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
      res.status(200).json({ users });
      return;
    }

    // ---- переписка с одним пользователем ----
    if (req.method === 'GET' && action === 'messages') {
      const chatId = req.query.chatId;
      const raw = await kv.lrange(`bot:messages:${chatId}`, 0, -1);
      const messages = raw.map((m) => (typeof m === 'string' ? JSON.parse(m) : m));
      res.status(200).json({ messages });
      return;
    }

    // ---- ответить одному пользователю ----
    if (req.method === 'POST' && action === 'reply') {
      const { chatId, text } = req.body;
      await sendTelegramMessage(chatId, text);
      await kv.rpush(
        `bot:messages:${chatId}`,
        JSON.stringify({ from: 'admin', text, ts: new Date().toISOString() })
      );
      res.status(200).json({ ok: true });
      return;
    }

    // ---- рассылка всем ----
    if (req.method === 'POST' && action === 'broadcast') {
      const { text } = req.body;
      const ids = await kv.smembers('bot:users');
      let sent = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await sendTelegramMessage(id, text);
          await kv.rpush(
            `bot:messages:${id}`,
            JSON.stringify({ from: 'admin', text, ts: new Date().toISOString() })
          );
          sent++;
        } catch (e) {
          failed++; // скорее всего пользователь заблокировал бота
        }
        await new Promise((r) => setTimeout(r, 40)); // ~25 сообщений/сек, лимит Telegram
      }
      res.status(200).json({ sent, failed });
      return;
    }

    res.status(400).json({ error: 'bad request' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
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
