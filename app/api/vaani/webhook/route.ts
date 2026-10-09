// Vaani call events. call_started → remember the caller's number for this call id.
// call_postprocessing (end-of-call report) → store transcript, summary, cost; create the lead from Vaani's
// extracted fields if the call didn't already create one; pick up a Cal.com booking made during the call.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { parseVaaniEvent } from "@/lib/vaani";
import { leastLoadedDesigner } from "@/lib/assign";
import { sendTelegram, handoffNote } from "@/lib/telegram";
import { upsertDeal } from "@/lib/hubspot";
import { createLead, entitiesToFields, normalisePhone } from "@/lib/leads";
import { calFindRecentBooking } from "@/lib/calcom";

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const dash = (id: number) => `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/dashboard?lead=${id}`;

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
  const entities = (c.entities ?? {}) as Record<string, unknown>;
  const hasDetails = ["caller_name", "location_text", "project_intent", "property_category", "bhk"].some((k) => entities[k] != null && entities[k] !== "");

  // Caller's number: from the extraction (always present, also for web test calls), else from call_started.
  const [known] = await sql`SELECT phone, started_at, duration_sec, lead_id FROM calls WHERE vaani_call_id = ${c.callId}`;
  const phone = normalisePhone(entities.caller_mobile) ?? normalisePhone(c.phone) ?? normalisePhone(known?.phone) ?? c.phone ?? known?.phone ?? "unknown";
  const durationSec = c.durationSec ?? known?.duration_sec ?? undefined;
  const startedAt = c.startedAt ?? known?.started_at ?? undefined;

  const estimated = c.costInr == null;
  const cost = estimated ? ((durationSec ?? 0) / 60) * Number(process.env.VOICE_COST_PER_MIN_INR ?? 8) : c.costInr!;

  // Existing lead: this call already linked one (webhook retry), or the same caller in the last 2 hours.
  let [lead] = known?.lead_id
    ? await sql`SELECT * FROM leads WHERE id = ${known.lead_id}`
    : phone.startsWith("+")
      ? await sql`SELECT * FROM leads WHERE phone=${phone} AND created_at > now() - interval '2 hours' ORDER BY created_at DESC LIMIT 1`
      : [];
  let created = false;
  if (!lead && hasDetails) { lead = await createLead(phone, entitiesToFields(entities)); created = true; }

  await sql`
    INSERT INTO calls (vaani_call_id, phone, lead_id, started_at, duration_sec, after_hours, transcript, summary, cost_inr, cost_estimated)
    VALUES (${c.callId}, ${phone}, ${lead?.id ?? null}, ${startedAt ?? null}, ${durationSec ?? null}, ${isAfterHours(startedAt)},
            ${c.transcript ?? null}, ${c.summary ?? null}, ${cost}, ${estimated})
    ON CONFLICT (vaani_call_id) DO UPDATE SET
      phone = EXCLUDED.phone, lead_id = EXCLUDED.lead_id, duration_sec = EXCLUDED.duration_sec, transcript = EXCLUDED.transcript,
      summary = EXCLUDED.summary, cost_inr = EXCLUDED.cost_inr, cost_estimated = EXCLUDED.cost_estimated`;

  if (!lead) return Response.json({ ok: true, note: "call stored; no lead (no project details in the call)" });
  if (c.summary) await sql`UPDATE leads SET summary=${c.summary}, updated_at=now() WHERE id=${lead.id}`;

  if (lead.tier === "BOOK" && lead.status === "open") {
    // Booked during the call through Vaani's Cal.com integration?
    const email = lead.fields?.email as string | undefined;
    const b = email ? await calFindRecentBooking(email) : null;
    if (b) {
      const [d] = await sql`SELECT id, name, telegram_chat_id FROM designers WHERE active AND calcom_event_type_id IS NOT NULL
                            ORDER BY (calcom_event_type_id = ${b.eventTypeId}) DESC LIMIT 1`;
      const [slot] = await sql`INSERT INTO designer_slots (designer_id, starts_at, booked) VALUES (${d.id}, ${b.start}, TRUE)
                               ON CONFLICT (designer_id, starts_at) DO UPDATE SET booked = TRUE RETURNING id`;
      await sql`INSERT INTO bookings (lead_id, designer_id, slot_id, starts_at, booked_by, calcom_booking_uid)
                VALUES (${lead.id}, ${d.id}, ${slot.id}, ${b.start}, 'voice_agent', ${b.uid})`;
      await sql`UPDATE leads SET designer_id=${d.id}, status='booked', updated_at=now() WHERE id=${lead.id}`;
      await sql`INSERT INTO actions (lead_id, actor, action, detail) VALUES (${lead.id}, 'voice_agent', 'call_booked', ${JSON.stringify({ calcom_booking_uid: b.uid })})`;
      await sendTelegram(d.telegram_chat_id, handoffNote({
        heading: "🟢 Consultation call booked", name: lead.name, phone: lead.phone, fields: lead.fields,
        notes: lead.notes, when: fmt.format(new Date(b.start)), summary: c.summary, dashboardUrl: dash(lead.id),
      }));
      try {
        const dealId = await upsertDeal({ existingDealId: lead.hubspot_deal_id, name: lead.name, phone: lead.phone, tier: "BOOK", designer: d.name, summary: c.summary, budget: lead.fields?.budget_inr, budgetText: lead.fields?.budget_text, email });
        if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead.id}`;
      } catch (e) { console.error(e); }
      return Response.json({ ok: true, lead_id: lead.id, created, booked: true });
    }

    // Qualified but no slot booked → don't lose them: a designer calls back today.
    const d = await leastLoadedDesigner();
    await sql`UPDATE leads SET tier='REVIEW', designer_id=${d.id}, review_due_at=now() + interval '4 hours',
              reasons = reasons || '["Qualified, but no consultation was booked on the call — call back today"]'::jsonb
              WHERE id=${lead.id}`;
    await sendTelegram(d.telegram_chat_id, handoffNote({
      heading: "🟡 Qualified lead, no slot booked — call back within 4h", name: lead.name, phone: lead.phone,
      fields: lead.fields, summary: c.summary, notes: lead.notes, dashboardUrl: dash(lead.id),
    }));
    try {
      const dealId = await upsertDeal({ existingDealId: lead.hubspot_deal_id, name: lead.name, phone: lead.phone, tier: "REVIEW", designer: d.name, summary: c.summary, budget: lead.fields?.budget_inr, budgetText: lead.fields?.budget_text, email: lead.fields?.email });
      if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead.id}`;
    } catch (e) { console.error(e); }
  }
  return Response.json({ ok: true, lead_id: lead.id, created });
}
