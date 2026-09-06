export async function notifyTelegram(
  config: { botToken?: string; chatId?: string },
  text: string
): Promise<boolean> {
  if (!config.botToken || !config.chatId) return false;
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
  });
  return res.ok;
}
