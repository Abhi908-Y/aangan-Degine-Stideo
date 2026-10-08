// Dashboard buttons. Every click is logged with WHO did it (shared login, so the
// designer picks their name in the toggle) and synced to HubSpot.
import { sql } from "@/lib/db";
import { setDealStage } from "@/lib/hubspot";
import { messageCaller, AUTO_DECLINE_TEXT } from "@/lib/messaging";

const STAGE: Record<string, string | undefined> = {
  call_booked: process.env.HUBSPOT_STAGE_BOOKED ?? "appointmentscheduled",
  site_visit: process.env.HUBSPOT_STAGE_SITE_VISIT ?? "presentationscheduled",
  won: "closedwon",
  decline: "closedlost",
  lost: "closedlost",
};
const STATUS: Record<string, string> = {
  call_booked: "booked", site_visit: "booked", contacted: "open", won: "closed", lost: "closed", decline: "decline_message_sent",
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const form = await req.formData();
  const action = String(form.get("action"));
  const actor = String(form.get("actor") || "Nikhil");
  const back = String(form.get("back") || "/dashboard");
  if (!(action in STATUS)) return Response.json({ error: "unknown action" }, { status: 400 });

  const [lead] = await sql`UPDATE leads SET status=${STATUS[action]}, updated_at=now() WHERE id=${Number(params.id)} RETURNING *`;
  if (!lead) return Response.json({ error: "not found" }, { status: 404 });
  await sql`INSERT INTO actions (lead_id, actor, action) VALUES (${lead.id}, ${actor}, ${action})`;

  if (action === "decline") await messageCaller(lead.phone, AUTO_DECLINE_TEXT); // reason never given
  try { await setDealStage(lead.hubspot_deal_id, STAGE[action]); } catch (e) { console.error(e); }

  return Response.redirect(new URL(back, req.url), 303);
}
