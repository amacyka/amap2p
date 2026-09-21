// Бэкенд для админ-панели: список пользователей, переписка, рассылка.
// Доступ только с правильным паролем в заголовке x-admin-password.
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const password = event.headers['x-admin-password'];
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'unauthorized' }) };
  }

  const store = getStore('bot');
  const action = event.queryStringParameters?.action;

  try {
    // ---- список пользователей ----
    if (event.httpMethod === 'GET' && action === 'list') {
      const { blobs } = await store.list({ prefix: 'user:' });
      const users = await Promise.all(
        blobs.map((b) => store.get(b.key, { type: 'json' }))
      );
      users.sort(
        (a, b) => new Date(b.last_message_at) - new Date(a.last_message_at)
      );
      return { statusCode: 200, body: JSON.stringify({ users }) };
    }

    // ---- переписка с одним пользователем ----
    if (event.httpMethod === 'GET' && action === 'messages') {
      const chatId = event.queryStringParameters.chatId;
      const history = (await store.get(`messages:${chatId}`, { type: 'json' })) || [];
      return { statusCode: 200, body: JSON.stringify({ messages: history }) };
    }

    // ---- ответить одному пользователю ----
    if (event.httpMethod === 'POST' && action === 'reply') {
      const { chatId, text } = JSON.parse(event.body);
      await sendTelegramMessage(chatId, text);
      const msgKey = `messages:${chatId}`;
      let history = (await store.get(msgKey, { type: 'json' })) || [];
      history.push({ from: 'admin', text, ts: new Date().toISOString() });
      await store.setJSON(msgKey, history);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    // ---- рассылка всем ----
    if (event.httpMethod === 'POST' && action === 'broadcast') {
      const { text } = JSON.parse(event.body);
      const { blobs } = await store.list({ prefix: 'user:' });
      let sent = 0;
      let failed = 0;
      for (const b of blobs) {
        const user = await store.get(b.key, { type: 'json' });
        try {
          await sendTelegramMessage(user.id, text);
          const msgKey = `messages:${user.id}`;
          let history = (await store.get(msgKey, { type: 'json' })) || [];
          history.push({ from: 'admin', text, ts: new Date().toISOString() });
          await store.setJSON(msgKey, history);
          sent++;
        } catch (e) {
          failed++; // скорее всего пользователь заблокировал бота
        }
        await new Promise((r) => setTimeout(r, 40)); // ~25 сообщений/сек, лимит Telegram
      }
      return { statusCode: 200, body: JSON.stringify({ sent, failed }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'bad request' }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'server error' }) };
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
