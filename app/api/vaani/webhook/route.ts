// Vaani call events. call_started → remember the caller's number for this call id.
// call_postprocessing (end-of-call report) → store transcript, summary, cost and tidy up the lead.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { parseVaaniEvent } from "@/lib/vaani";
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
  const ev = parseVaaniEvent(await req.json());

  if (ev.kind === "ignored") return Response.json({ ok: true, ignored: ev.event });
  if (ev.kind === "started") {
    if (ev.phone) {
      await sql`INSERT INTO calls (vaani_call_id, phone, started_at, after_hours) VALUES (${ev.callId}, ${ev.phone}, now(), ${isAfterHours()})
                ON CONFLICT (vaani_call_id) DO UPDATE SET phone = EXCLUDED.phone`;
    }
    return Response.json({ ok: true });
  }
  if (ev.kind === "ended") {
    if (ev.durationSec) await sql`UPDATE calls SET duration_sec = ${Math.round(ev.durationSec)} WHERE vaani_call_id = ${ev.callId}`;
    return Response.json({ ok: true });
  }

  const c = ev.call;
  // Vaani's report has no caller number — use the one saved from call_started.
  const [known] = await sql`SELECT phone, started_at, duration_sec FROM calls WHERE vaani_call_id = ${c.callId}`;
  const phone = c.phone ?? known?.phone ?? "unknown";
  const durationSec = c.durationSec ?? known?.duration_sec ?? undefined;
  const startedAt = c.startedAt ?? known?.started_at ?? undefined;

  const estimated = c.costInr == null;
  const cost = estimated ? ((durationSec ?? 0) / 60) * Number(process.env.VOICE_COST_PER_MIN_INR ?? 8) : c.costInr!;
  const [lead] = await sql`SELECT * FROM leads WHERE phone=${phone} AND created_at > now() - interval '2 hours' ORDER BY created_at DESC LIMIT 1`;

  await sql`
    INSERT INTO calls (vaani_call_id, phone, lead_id, started_at, duration_sec, after_hours, transcript, summary, cost_inr, cost_estimated)
    VALUES (${c.callId}, ${phone}, ${lead?.id ?? null}, ${startedAt ?? null}, ${durationSec ?? null}, ${isAfterHours(startedAt)},
            ${c.transcript ?? null}, ${c.summary ?? null}, ${cost}, ${estimated})
    ON CONFLICT (vaani_call_id) DO UPDATE SET
      lead_id = EXCLUDED.lead_id, duration_sec = EXCLUDED.duration_sec, transcript = EXCLUDED.transcript,
      summary = EXCLUDED.summary, cost_inr = EXCLUDED.cost_inr, cost_estimated = EXCLUDED.cost_estimated`;

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
      const dealId = await upsertDeal({ existingDealId: lead.hubspot_deal_id, name: lead.name, phone: lead.phone, tier: "REVIEW", designer: d.name, summary: c.summary, budget: lead.fields?.budget_inr, budgetText: lead.fields?.budget_text });
      if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead.id}`;
    } catch (e) { console.error(e); }
  }
  return Response.json({ ok: true });
}
