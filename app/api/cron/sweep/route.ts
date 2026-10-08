// Runs hourly (vercel.json). Keeps every promise made on the phone:
//  1. Sensitive declines get the polite "not the right fit" message ~20h later, no reason given.
//  2. Overdue reviews nudge the designer, and Nikhil, on Telegram.
export const dynamic = "force-dynamic";
import { sql } from "@/lib/db";
import { messageCaller, AUTO_DECLINE_TEXT } from "@/lib/messaging";
import { sendTelegram } from "@/lib/telegram";

export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorised", { status: 401 });
  }

  const declines = await sql`
    UPDATE leads SET status='decline_message_sent', updated_at=now()
    WHERE tier='DECLINE_SENSITIVE' AND status='open' AND created_at < now() - interval '20 hours'
    RETURNING id, phone`;
  for (const l of declines) {
    await messageCaller(l.phone, AUTO_DECLINE_TEXT);
    await sql`INSERT INTO actions (lead_id, actor, action) VALUES (${l.id}, 'system', 'auto_decline_sent')`;
  }

  const overdue = await sql`
    SELECT l.id, l.name, l.phone, d.name AS designer, d.telegram_chat_id
    FROM leads l JOIN designers d ON d.id = l.designer_id
    WHERE l.tier='REVIEW' AND l.status='open' AND l.review_due_at < now()
      AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.lead_id=l.id AND a.action='overdue_nudge' AND a.created_at > now() - interval '12 hours')`;
  for (const l of overdue) {
    const msg = `⏰ Overdue review: ${l.name ?? l.phone} (assigned to ${l.designer}). The caller was promised a response.`;
    await sendTelegram(l.telegram_chat_id, msg);
    await sendTelegram(process.env.TELEGRAM_FOUNDER_CHAT_ID, msg);
    await sql`INSERT INTO actions (lead_id, actor, action) VALUES (${l.id}, 'system', 'overdue_nudge')`;
  }

  return Response.json({ auto_declines_sent: declines.length, overdue_nudged: overdue.length });
}
