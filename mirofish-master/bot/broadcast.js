async function sendTelegram(token, chatId, text) {
  if (!token || !chatId) throw new Error('telegram token/chatId missing');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

async function sendDiscord(url, text) {
  if (!url) throw new Error('discord webhook missing');
  const chunks = text.match(/[\s\S]{1,1900}(?=\n|$)/g) || [text];
  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunk }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`discord ${res.status}`);
  }
  return true;
}

module.exports = { sendTelegram, sendDiscord };
