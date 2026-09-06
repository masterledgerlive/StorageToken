export async function notifyTelegram(
  config: { botToken?: string; chatId?: string },
  text: string
): Promise<boolean> {
  if (!config.botToken || !config.chatId) return false;
  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function formatInjectAlert(input: {
  ok: boolean;
  injectionId?: string;
  txHash?: string | null;
  error?: string;
  paidCredits?: string;
  entryPoint?: string;
}): string {
  if (input.ok) {
    return `[StorageToken] inject OK ${input.injectionId ?? ""} ${input.entryPoint ?? ""} credits=${input.paidCredits ?? "?"} hash=${input.txHash}`;
  }
  return `[StorageToken] inject FAIL ${input.entryPoint ?? ""} ${input.error ?? "Injection failed"}`;
}
