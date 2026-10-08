// Vaani end-of-call report: store the call (transcript, summary, cost) and tidy up the lead.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { normalizeEndOfCall } from "@/lib/vaani";
import { leastLoadedDesigner } from "@/lib/assign";
import { sendTelegram, handoffNote } from "@/lib/telegram";
import { upsertDeal } from "@/lib/hubspot";

function isAfterHours(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const h = Number(new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(d));
  return h < 10 || h >= 19;
}

export async function POST(req: Request) {
  const denied = checkToolSecret(req); if (denied) return denied;
  const c = normalizeEndOfCall(await req.json());

  const estimated = c.costInr == null;
  const cost = estimated ? ((c.durationSec ?? 0) / 60) * Number(process.env.VOICE_COST_PER_MIN_INR ?? 8) : c.costInr!;
  const [lead] = await sql`SELECT * FROM leads WHERE phone=${c.phone} AND created_at > now() - interval '2 hours' ORDER BY created_at DESC LIMIT 1`;

  await sql`
    INSERT INTO calls (vaani_call_id, phone, lead_id, started_at, duration_sec, after_hours, transcript, summary, cost_inr, cost_estimated)
    VALUES (${c.callId}, ${c.phone}, ${lead?.id ?? null}, ${c.startedAt ?? null}, ${c.durationSec ?? null}, ${isAfterHours(c.startedAt)},
            ${c.transcript ?? null}, ${c.summary ?? null}, ${cost}, ${estimated})
    ON CONFLICT (vaani_call_id) DO NOTHING`;

  if (!lead) return Response.json({ ok: true, note: "call stored; no lead (e.g. dropped before questions)" });
  if (c.summary) await sql`UPDATE leads SET summary=${c.summary}, updated_at=now() WHERE id=${lead.id}`;

  // Tier 1 caller hung up before picking a slot → don't lose them: send to review.
  if (lead.tier === "BOOK" && lead.status === "open") {
    const d = await leastLoadedDesigner();
    await sql`UPDATE leads SET tier='REVIEW', designer_id=${d.id}, review_due_at=now() + interval '4 hours',
              reasons = reasons || '["Qualified, but call ended before a slot was booked — call back today"]'::jsonb
              WHERE id=${lead.id}`;
    await sendTelegram(d.telegram_chat_id, handoffNote({
      heading: "🟡 Qualified lead, no slot booked — call back within 4h", name: lead.name, phone: lead.phone,
      fields: lead.fields, summary: c.summary, notes: lead.notes, dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/dashboard?lead=${lead.id}`,
    }));
    try {
      const dealId = await upsertDeal({ existingDealId: lead.hubspot_deal_id, name: lead.name, phone: lead.phone, tier: "REVIEW", designer: d.name, summary: c.summary });
      if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead.id}`;
    } catch (e) { console.error(e); }
  }
  return Response.json({ ok: true });
}
