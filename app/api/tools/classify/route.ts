// Called by Vaani DURING the call, once the agent has the answers.
// Rules decide the tier; the response tells the agent exactly what to say next.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { readToolArgs } from "@/lib/vaani";
import { decide, LeadFields, LINES } from "@/lib/rules";
import { offerSlots, leastLoadedDesigner } from "@/lib/assign";
import { sendTelegram, handoffNote } from "@/lib/telegram";
import { upsertDeal } from "@/lib/hubspot";

const REVIEW_HOURS = 24;
const dash = (id: number) => `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/dashboard?lead=${id}`;

export async function POST(req: Request) {
  const denied = checkToolSecret(req); if (denied) return denied;
  const args = await readToolArgs(req);
  // Accept the answers nested under `fields` (as defined) or sent flat alongside `phone`.
  const { phone, fields: nested, ...flat } = args as { phone?: string; fields?: LeadFields } & Record<string, unknown>;
  const fields = (nested && typeof nested === "object" ? nested : flat) as LeadFields;
  if (!phone || !fields?.caller_type) {
    return Response.json({
      error: "missing_arguments",
      hint: "Call classify again with phone (e.g. +919876543210) and fields: caller_type, project_intent, property_category, location_text, decision_maker, plus everything else you collected.",
    });
  }
  let d = decide(fields);

  // Tier 1 needs a free slot. If no designer has one soon, it becomes a review lead.
  let offers = d.tier === "BOOK" ? await offerSlots(3) : [];
  if (d.tier === "BOOK" && offers.length === 0) {
    d = { ...d, tier: "REVIEW", reasons: [...d.reasons, "No designer slot free in the next 5 days"], say: LINES.review };
  }

  const status = d.tier === "DECLINE_FACTUAL" ? "declined" : d.tier === "ESCALATE" ? "escalated" : "open";

  // Reuse a lead from the same caller in the last 2 hours (dropped call, T17), else create one.
  const [existing] = await sql`SELECT id FROM leads WHERE phone = ${phone} AND created_at > now() - interval '2 hours' ORDER BY created_at DESC LIMIT 1`;
  const [lead] = existing
    ? await sql`UPDATE leads SET tier=${d.tier}, status=${status}, reasons=${JSON.stringify(d.reasons)}, notes=${JSON.stringify(d.notes)},
                  fields=${JSON.stringify(fields)}, name=${fields.name ?? null}, updated_at=now() WHERE id=${existing.id} RETURNING id`
    : await sql`INSERT INTO leads (phone, name, tier, status, reasons, notes, fields)
                VALUES (${phone}, ${fields.name ?? null}, ${d.tier}, ${status}, ${JSON.stringify(d.reasons)}, ${JSON.stringify(d.notes)}, ${JSON.stringify(fields)})
                RETURNING id`;
  await sql`INSERT INTO actions (lead_id, actor, action, detail) VALUES (${lead.id}, 'voice_agent', 'classified', ${JSON.stringify(d)})`;

  if (d.tier === "REVIEW") {
    const designer = await leastLoadedDesigner();
    await sql`UPDATE leads SET designer_id=${designer.id}, review_due_at=now() + make_interval(hours => ${REVIEW_HOURS}) WHERE id=${lead.id}`;
    await sendTelegram(designer.telegram_chat_id, handoffNote({
      heading: `🟡 Review needed within ${REVIEW_HOURS}h`, name: fields.name, phone, fields,
      notes: [...d.reasons, ...d.notes], dashboardUrl: dash(lead.id),
    }));
    try {
      const dealId = await upsertDeal({ name: fields.name, phone, tier: "REVIEW", designer: designer.name, summary: d.reasons.join("; "), budget: fields.budget_inr, budgetText: fields.budget_text });
      if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead.id}`;
    } catch (e) { console.error(e); }
  }

  if (d.tier === "ESCALATE") {
    await sendTelegram(process.env.TELEGRAM_FOUNDER_CHAT_ID, handoffNote({
      heading: "🔴 Existing client — call back within 15 minutes", name: fields.name, phone, fields,
      summary: fields.notes_from_call, dashboardUrl: dash(lead.id),
    }));
  }

  return Response.json({
    lead_id: lead.id,
    tier: d.tier,
    say: d.say,
    // Only for Tier 1: read these out, let the caller pick, then call the book tool with slot_id.
    slots: offers.map((o) => ({ slot_id: o.slot_id, designer: o.designer_name, time: o.spoken })),
  });
}
