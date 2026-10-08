export async function sendTelegram(chatId: string | null | undefined, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) { console.warn("Telegram skipped (no token or chat id):", text.slice(0, 80)); return; }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) console.error("Telegram error", res.status, await res.text());
}

const esc = (s: unknown) => String(s ?? "—").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

export function handoffNote(o: {
  heading: string; name?: string; phone: string; fields: any; summary?: string; notes?: string[];
  when?: string; dashboardUrl: string;
}): string {
  const f = o.fields ?? {};
  const lines = [
    `<b>${esc(o.heading)}</b>`,
    `${esc(o.name ?? "Caller")} · ${esc(o.phone)}`,
    o.when ? `📅 <b>${esc(o.when)}</b>` : "",
    `🏠 ${esc(f.property_category)} · ${esc(f.bhk ? f.bhk + "BHK" : "")} ${f.carpet_area_sqft ? esc(f.carpet_area_sqft) + " sq ft" : ""}`,
    `📍 ${esc(f.location_text)}`,
    `🗓 ${f.completion_needed_by ? "Complete by " + esc(f.completion_needed_by) : f.timeline_flexible ? "Flexible timeline" : "Timeline unclear"}`,
    o.summary ? `\n${esc(o.summary)}` : "",
    o.notes?.length ? `\n⚠️ ${o.notes.map(esc).join("\n⚠️ ")}` : "",
    `\n<a href="${o.dashboardUrl}">Open on dashboard</a>`,
  ];
  return lines.filter(Boolean).join("\n");
}
