import { sql } from "./db";
import { calSlots } from "./calcom";

export interface Offer { slot_id: number; designer_id: number; designer_name: string; starts_at: string; spoken: string }

const fmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit",
});
const HOUR = 3600 * 1000;

// While the studio runs with one real designer, every lead goes to that designer:
// set ASSIGN_ALL_TO_DESIGNER_ID (e.g. 1). Remove it to share leads across all active designers again.
export const pinnedDesignerId = (): number | null => Number(process.env.ASSIGN_ALL_TO_DESIGNER_ID) || null;
const WINDOW_DAYS = 7;

const toOffer = (r: any): Offer => ({
  slot_id: r.slot_id, designer_id: r.designer_id, designer_name: r.designer_name,
  starts_at: new Date(r.starts_at).toISOString(), spoken: fmt.format(new Date(r.starts_at)),
});

// Pick the designer with the fewest open leads who has a free slot soon, then offer up to `n`
// of their earliest slots. Designers connected to Cal.com (calcom_event_type_id) are used first
// and their real availability is read live; everyone else uses the mock designer_slots calendar.
export async function offerSlots(n = 3): Promise<Offer[]> {
  const pinned = pinnedDesignerId();
  const cal = await sql`
    SELECT d.id, d.name, d.calcom_event_type_id,
           (SELECT count(*) FROM leads l WHERE l.designer_id = d.id AND l.status IN ('open','booked')) AS open_leads
    FROM designers d WHERE d.active AND d.calcom_event_type_id IS NOT NULL AND (${pinned}::int IS NULL OR d.id = ${pinned})
    ORDER BY open_leads ASC, random()`;

  if (cal.length > 0) {
    const from = new Date(Date.now() + 2 * HOUR), to = new Date(Date.now() + WINDOW_DAYS * 24 * HOUR);
    for (const d of cal.slice(0, 3)) {
      let starts: string[];
      try { starts = (await calSlots(d.calcom_event_type_id, from, to)).slice(0, n); }
      catch (e) { console.error(e); continue; }
      if (starts.length === 0) continue;
      // Mirror the offered times into designer_slots so the book tool can refer to them by id.
      // Cal.com is the source of truth: a time it reports as free is free.
      const offers: Offer[] = [];
      for (const s of starts) {
        const [row] = await sql`
          INSERT INTO designer_slots (designer_id, starts_at) VALUES (${d.id}, ${s})
          ON CONFLICT (designer_id, starts_at) DO UPDATE SET booked = FALSE
          RETURNING id AS slot_id, designer_id, starts_at`;
        offers.push(toOffer({ ...row, designer_name: d.name }));
      }
      return offers;
    }
    return []; // Cal.com designers exist but none is free → the caller goes to review
  }

  const rows = await sql`
    WITH load AS (
      SELECT d.id, d.name,
             (SELECT count(*) FROM leads l WHERE l.designer_id = d.id AND l.status IN ('open','booked')) AS open_leads
      FROM designers d WHERE d.active AND (${pinned}::int IS NULL OR d.id = ${pinned})
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
  return rows.map(toOffer);
}

// Assign a designer for review leads (no slot needed): the pinned designer, else fewest open leads.
export async function leastLoadedDesigner(): Promise<{ id: number; name: string; telegram_chat_id: string | null }> {
  const pinned = pinnedDesignerId();
  const [d] = await sql`
    SELECT d.id, d.name, d.telegram_chat_id FROM designers d WHERE d.active AND (${pinned}::int IS NULL OR d.id = ${pinned})
    ORDER BY (SELECT count(*) FROM leads l WHERE l.designer_id = d.id AND l.status IN ('open','booked')) ASC, random()
    LIMIT 1`;
  return d as any;
}
