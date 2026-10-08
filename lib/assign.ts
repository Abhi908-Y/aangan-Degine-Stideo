import { sql } from "./db";

export interface Offer { slot_id: number; designer_id: number; designer_name: string; starts_at: string; spoken: string }

const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
});

// Pick the designer with the fewest open leads who has a free slot in the next 5 days,
// then offer up to `n` of their earliest slots. Mock calendar today; Cal.com later.
export async function offerSlots(n = 3): Promise<Offer[]> {
  const rows = await sql`
    WITH load AS (
      SELECT d.id, d.name,
             (SELECT count(*) FROM leads l WHERE l.designer_id = d.id AND l.status IN ('open','booked')) AS open_leads
      FROM designers d WHERE d.active
    ),
    free AS (
      SELECT s.id AS slot_id, s.designer_id, s.starts_at
      FROM designer_slots s
      WHERE NOT s.booked AND s.starts_at > now() + interval '2 hours'
        AND s.starts_at < now() + interval '5 days'
    ),
    pick AS (
      SELECT l.id, l.name FROM load l
      WHERE EXISTS (SELECT 1 FROM free f WHERE f.designer_id = l.id)
      ORDER BY l.open_leads ASC, random() LIMIT 1
    )
    SELECT f.slot_id, p.id AS designer_id, p.name AS designer_name, f.starts_at
    FROM free f JOIN pick p ON p.id = f.designer_id
    ORDER BY f.starts_at LIMIT ${n}`;
  return rows.map((r: any) => ({
    slot_id: r.slot_id, designer_id: r.designer_id, designer_name: r.designer_name,
    starts_at: new Date(r.starts_at).toISOString(), spoken: fmt.format(new Date(r.starts_at)),
  }));
}

// Assign a designer for review leads (no slot needed): fewest open leads.
export async function leastLoadedDesigner(): Promise<{ id: number; name: string; telegram_chat_id: string | null }> {
  const [d] = await sql`
    SELECT d.id, d.name, d.telegram_chat_id FROM designers d WHERE d.active
    ORDER BY (SELECT count(*) FROM leads l WHERE l.designer_id = d.id AND l.status IN ('open','booked')) ASC, random()
    LIMIT 1`;
  return d as any;
}
