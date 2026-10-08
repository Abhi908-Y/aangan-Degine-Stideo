// Called by Vaani at the START of every call. Repeat callers (T16, T17) are recognised
// so the agent says "welcome back" and doesn't ask the same questions again.
import { sql } from "@/lib/db";
import { checkToolSecret } from "@/lib/auth";
import { toolArgs } from "@/lib/vaani";

export async function POST(req: Request) {
  const denied = checkToolSecret(req); if (denied) return denied;
  const { phone } = toolArgs(await req.json());
  const [lead] = await sql`
    SELECT l.id, l.name, l.tier, l.status, l.fields, l.summary, d.name AS designer, b.starts_at AS booked_at
    FROM leads l
    LEFT JOIN designers d ON d.id = l.designer_id
    LEFT JOIN bookings b ON b.lead_id = l.id
    WHERE l.phone = ${phone} AND l.created_at > now() - interval '60 days'
    ORDER BY l.created_at DESC LIMIT 1`;
  if (!lead) return Response.json({ known: false });
  return Response.json({
    known: true,
    lead_id: lead.id,
    name: lead.name,
    status: lead.status,
    designer: lead.designer,
    booked_at: lead.booked_at,
    already_collected: lead.fields, // the agent must NOT re-ask these
    instruction:
      "Greet them by name and say welcome back. Do not re-ask anything in already_collected — only confirm it briefly and ask what is missing. If they have a booking, confirm the time.",
  });
}
