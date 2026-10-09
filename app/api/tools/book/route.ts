// Called by Vaani DURING the call when a Tier 1 caller picks a slot.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { toolArgs } from "@/lib/vaani";
import { sendTelegram, handoffNote } from "@/lib/telegram";
import { upsertDeal } from "@/lib/hubspot";
import { messageCaller } from "@/lib/messaging";
import { offerSlots } from "@/lib/assign";

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });

export async function POST(req: Request) {
  const denied = checkToolSecret(req); if (denied) return denied;
  const { lead_id, slot_id } = toolArgs(await req.json());

  // Atomic claim: only succeeds if nobody else took the slot in the meantime.
  const [slot] = await sql`UPDATE designer_slots SET booked = TRUE WHERE id=${slot_id} AND NOT booked RETURNING id, designer_id, starts_at`;
  if (!slot) {
    const offers = await offerSlots(3);
    return Response.json({
      booked: false,
      say: "Sorry, that slot was just taken. Here are the next available times.",
      slots: offers.map((o) => ({ slot_id: o.slot_id, designer: o.designer_name, time: o.spoken })),
    });
  }

  const [designer] = await sql`SELECT id, name, telegram_chat_id FROM designers WHERE id=${slot.designer_id}`;
  await sql`INSERT INTO bookings (lead_id, designer_id, slot_id, starts_at, booked_by) VALUES (${lead_id}, ${designer.id}, ${slot.id}, ${slot.starts_at}, 'voice_agent')`;
  const [lead] = await sql`UPDATE leads SET designer_id=${designer.id}, status='booked', updated_at=now() WHERE id=${lead_id} RETURNING *`;
  await sql`INSERT INTO actions (lead_id, actor, action, detail) VALUES (${lead_id}, 'voice_agent', 'call_booked', ${JSON.stringify({ slot_id, designer: designer.name })})`;

  const when = fmt.format(new Date(slot.starts_at));
  await sendTelegram(designer.telegram_chat_id, handoffNote({
    heading: "🟢 Consultation call booked", name: lead.name, phone: lead.phone, fields: lead.fields,
    notes: lead.notes, when, dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/dashboard?lead=${lead_id}`,
  }));
  await messageCaller(lead.phone, `Your consultation with ${designer.name} from Aangan Studio is confirmed for ${when}. To reschedule, reply to this message or call the studio.`);
  try {
    const dealId = await upsertDeal({ existingDealId: lead.hubspot_deal_id, name: lead.name, phone: lead.phone, tier: "BOOK", designer: designer.name, budget: lead.fields?.budget_inr, budgetText: lead.fields?.budget_text });
    if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead_id}`;
  } catch (e) { console.error(e); }

  return Response.json({ booked: true, say: `You're booked with ${designer.name} on ${when}. You'll get a confirmation message shortly.` });
}
