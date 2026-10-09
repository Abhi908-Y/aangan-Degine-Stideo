// Cal.com = designers' real calendars. A designer with designers.calcom_event_type_id set gets
// slots from Cal.com, and bookings are created there — Cal.com then sends a calendar invite to
// both the designer and the customer. Slots and bookings are public in Cal.com's API (they only
// need the event type id); the API key is sent so bookings are attributed to the studio account.
const API = "https://api.cal.com/v2";
const TZ = "Asia/Kolkata";

function headers(version: string) {
  const h: Record<string, string> = { "Content-Type": "application/json", "cal-api-version": version };
  if (process.env.CALCOM_API_KEY) h.Authorization = `Bearer ${process.env.CALCOM_API_KEY}`;
  return h;
}

/** Free start times (ISO, UTC) for an event type between two dates. */
export async function calSlots(eventTypeId: number, from: Date, to: Date): Promise<string[]> {
  const q = new URLSearchParams({
    eventTypeId: String(eventTypeId), start: from.toISOString(), end: to.toISOString(), timeZone: TZ,
  });
  const res = await fetch(`${API}/slots?${q}`, { headers: headers("2024-09-04"), cache: "no-store" });
  if (!res.ok) throw new Error(`Cal.com slots → ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return Object.values(j.data ?? {})
    .flat()
    .map((s: any) => new Date(s.start).toISOString())
    .filter((iso) => new Date(iso) >= from)
    .sort();
}

export type CalBooking = { ok: true; uid: string } | { ok: false; error: string };

/** Book a slot. Cal.com emails the calendar invite to the designer and the attendee. */
export async function calBook(o: {
  eventTypeId: number; start: string; name: string; email: string; phone?: string; leadId: number;
}): Promise<CalBooking> {
  const res = await fetch(`${API}/bookings`, {
    method: "POST",
    headers: headers("2024-08-13"),
    cache: "no-store",
    body: JSON.stringify({
      start: o.start,
      eventTypeId: o.eventTypeId,
      attendee: {
        name: o.name, email: o.email, timeZone: TZ, language: "en",
        ...(o.phone && /^\+\d{8,15}$/.test(o.phone) ? { phoneNumber: o.phone } : {}),
      },
      metadata: { lead_id: String(o.leadId), source: "aangan-voice" },
    }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: `Cal.com booking → ${res.status}: ${text.slice(0, 300)}` };
  const j = JSON.parse(text);
  return { ok: true, uid: String(j.data?.uid ?? j.data?.id ?? "") };
}
