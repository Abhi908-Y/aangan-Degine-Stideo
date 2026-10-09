// Called by Vaani DURING the call when a Tier 1 caller picks a slot.
// Cal.com designers: the booking is created in Cal.com, which sends a calendar invite to the
// designer and to the customer's email. Other designers: the mock calendar slot is claimed.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { toolArgs } from "@/lib/vaani";
import { sendTelegram, handoffNote } from "@/lib/telegram";
import { upsertDeal } from "@/lib/hubspot";
import { offerSlots } from "@/lib/assign";
import { calBook } from "@/lib/calcom";

const fmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function retry(say: string) {
  const offers = await offerSlots(3);
  return Response.json({
    booked: false, say,
    slots: offers.map((o) => ({ slot_id: o.slot_id, designer: o.designer_name, time: o.spoken })),
  });
}

export async function POST(req: Request) {
  const denied = checkToolSecret(req); if (denied) return denied;
  const { lead_id, slot_id, email: rawEmail } = toolArgs(await req.json());
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

  const [slotInfo] = await sql`
    SELECT s.id, s.starts_at, s.booked, d.id AS designer_id, d.name, d.telegram_chat_id, d.calcom_event_type_id
    FROM designer_slots s JOIN designers d ON d.id = s.designer_id WHERE s.id = ${slot_id}`;
  if (!slotInfo) return retry("Sorry, I couldn't find that time. Here are the next available times.");

  // Cal.com sends the customer's calendar invite by email, so we need one before booking.
  if (slotInfo.calcom_event_type_id && !EMAIL.test(email)) {
    return Response.json({
      booked: false, need_email: true,
      say: "So I can send you the calendar invite, could you tell me your email address, please?",
    });
  }

  // Atomic claim: only succeeds if nobody else took the slot in the meantime.
  const [slot] = await sql`UPDATE designer_slots SET booked = TRUE WHERE id=${slot_id} AND NOT booked RETURNING id, designer_id, starts_at`;
  if (!slot) return retry("Sorry, that slot was just taken. Here are the next available times.");

  const [lead] = await sql`SELECT * FROM leads WHERE id=${lead_id}`;
  if (!lead) {
    await sql`UPDATE designer_slots SET booked = FALSE WHERE id=${slot.id}`;
    return Response.json({ error: "lead not found" }, { status: 404 });
  }

  let calUid: string | null = null;
  if (slotInfo.calcom_event_type_id) {
    const r = await calBook({
      eventTypeId: slotInfo.calcom_event_type_id, start: new Date(slot.starts_at).toISOString(),
      name: lead.name ?? "Aangan caller", email, phone: lead.phone, leadId: lead.id,
    });
    if (!r.ok) {
      console.error(r.error);
      await sql`UPDATE designer_slots SET booked = FALSE WHERE id=${slot.id}`;
      return retry("Sorry, that time just became unavailable. Here are the next available times.");
    }
    calUid = r.uid;
  }

  const designer = { id: slotInfo.designer_id, name: slotInfo.name, telegram_chat_id: slotInfo.telegram_chat_id };
  await sql`INSERT INTO bookings (lead_id, designer_id, slot_id, starts_at, booked_by, calcom_booking_uid)
            VALUES (${lead_id}, ${designer.id}, ${slot.id}, ${slot.starts_at}, 'voice_agent', ${calUid})`;
  const [updated] = await sql`
    UPDATE leads SET designer_id=${designer.id}, status='booked', updated_at=now(),
      fields = CASE WHEN ${email}::text = '' THEN fields ELSE fields || jsonb_build_object('email', ${email}::text) END
    WHERE id=${lead_id} RETURNING *`;
  await sql`INSERT INTO actions (lead_id, actor, action, detail)
            VALUES (${lead_id}, 'voice_agent', 'call_booked', ${JSON.stringify({ slot_id, designer: designer.name, calcom_booking_uid: calUid })})`;

  const when = fmt.format(new Date(slot.starts_at));
  await sendTelegram(designer.telegram_chat_id, handoffNote({
    heading: "🟢 Consultation call booked", name: updated.name, phone: updated.phone, fields: updated.fields,
    notes: updated.notes, when, dashboardUrl: `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/dashboard?lead=${lead_id}`,
  }));
  try {
    const dealId = await upsertDeal({ existingDealId: updated.hubspot_deal_id, name: updated.name, phone: updated.phone, tier: "BOOK", designer: designer.name, budget: updated.fields?.budget_inr, budgetText: updated.fields?.budget_text, email: updated.fields?.email });
    if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead_id}`;
  } catch (e) { console.error(e); }

  return Response.json({
    booked: true,
    say: calUid
      ? `You're booked with ${designer.name} on ${when}. You'll get a calendar invite at your email shortly.`
      : `You're booked with ${designer.name} on ${when}.`,
  });
}
