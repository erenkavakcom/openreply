import "server-only";

/** A short message to the owner's Telegram, when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set. Never throws. */
export async function notifyPhone(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch (e) {
    console.error("[telegram]", (e as Error).message);
    return false;
  }
}
