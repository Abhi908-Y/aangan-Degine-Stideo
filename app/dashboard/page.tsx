// One shared dashboard. "All designers" = Nikhil's view (incl. running cost).
// Pick a designer to filter to their leads; their name is recorded on every click.
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const when = (d: string | Date) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(d));
// ₹12 L, ₹1.2 Cr, ₹12–15 L. Budget is for the studio's eyes only — never read to the caller.
const amt = (n: number) => (n >= 1e7 ? `${+(n / 1e7).toFixed(2)} Cr` : `${+(n / 1e5).toFixed(1)} L`);
const budget = (f: any): string | null => {
  const b = f?.budget_inr;
  if (b?.max) return `₹${b.min && b.min !== b.max ? `${amt(b.min).replace(/ (L|Cr)$/, "")}–` : ""}${amt(b.max)}`;
  return f?.budget_text ? `Budget: ${f.budget_text}` : null;
};
const TIER_LABEL: Record<string, string> = {
  BOOK: "Booked", REVIEW: "Needs review", DECLINE_FACTUAL: "Declined on call", DECLINE_SENSITIVE: "Auto-declined", ESCALATE: "Existing client",
};

export default async function Dashboard({ searchParams }: { searchParams: { designer?: string; lead?: string } }) {
  const designerId = searchParams.designer ? Number(searchParams.designer) : null;
  const designers = (await sql`SELECT id, name FROM designers WHERE active ORDER BY name`) as { id: number; name: string }[];
  const me = designers.find((d) => d.id === designerId);
  const actor = me?.name ?? "Nikhil";
  const back = `/dashboard${designerId ? `?designer=${designerId}` : ""}`;

  const leads = await sql`
    SELECT l.*, d.name AS designer, b.starts_at AS booked_at
    FROM leads l LEFT JOIN designers d ON d.id = l.designer_id LEFT JOIN bookings b ON b.lead_id = l.id
    WHERE l.created_at > date_trunc('month', now()) AND (${designerId}::int IS NULL OR l.designer_id = ${designerId})
    ORDER BY l.created_at DESC`;

  const [m] = await sql`
    SELECT count(*)::int AS calls,
           count(*) FILTER (WHERE after_hours)::int AS after_hours,
           coalesce(sum(cost_inr), 0)::float AS cost,
           bool_or(cost_estimated) AS estimated
    FROM calls WHERE created_at > date_trunc('month', now())`;

  const review = leads.filter((l: any) => l.tier === "REVIEW" && l.status === "open");
  const overdue = review.filter((l: any) => l.review_due_at && new Date(l.review_due_at) < new Date());
  const booked = leads.filter((l: any) => l.status === "booked");
  const declined = leads.filter((l: any) => l.tier.startsWith("DECLINE"));
  const escalations = leads.filter((l: any) => l.tier === "ESCALATE");

  const selected = searchParams.lead ? leads.find((l: any) => l.id === Number(searchParams.lead)) : null;
  const [call] = selected
    ? await sql`SELECT transcript, summary, duration_sec, cost_inr FROM calls WHERE lead_id=${selected.id} ORDER BY created_at DESC LIMIT 1`
    : [];

  const Actions = ({ id, options }: { id: number; options: [string, string][] }) => (
    <div className="acts">
      {options.map(([action, label]) => (
        <form key={action} method="post" action={`/api/leads/${id}/action`}>
          <input type="hidden" name="action" value={action} />
          <input type="hidden" name="actor" value={actor} />
          <input type="hidden" name="back" value={back} />
          <button className={action === "decline" ? "quiet" : ""}>{label}</button>
        </form>
      ))}
    </div>
  );

  const Row = ({ l, children }: { l: any; children?: React.ReactNode }) => {
    const f = l.fields ?? {};
    return (
      <li className={`row t-${l.tier.toLowerCase()}`}>
        <a className="who" href={`${back}${back.includes("?") ? "&" : "?"}lead=${l.id}`}>
          <strong>{l.name ?? "Unnamed caller"}</strong>
          <span>{[f.bhk ? `${f.bhk}BHK` : f.property_category, f.location_text, f.carpet_area_sqft && `${f.carpet_area_sqft} sq ft`, budget(f)].filter(Boolean).join(", ")}</span>
        </a>
        <span className="meta">{l.designer ?? "Unassigned"}</span>
        {children}
      </li>
    );
  };

  return (
    <main>
      <style>{css}</style>
      <header>
        <h1>Aangan enquiries</h1>
        <form method="get" className="toggle">
          <label htmlFor="designer">Showing</label>
          <select id="designer" name="designer" defaultValue={designerId ?? ""}>
            <option value="">All designers</option>
            {designers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button>Switch</button>
        </form>
      </header>

      <p className="sentence">
        This month the phone line took <b>{m.calls}</b> calls, <b>{m.after_hours}</b> of them after hours.{" "}
        <b className="ok">{booked.length}</b> consultations are booked, <b className="wait">{review.length}</b> leads wait for review
        {overdue.length > 0 && <>, and <b className="late">{overdue.length}</b> of those are overdue</>}.
        {!me && (
          <> Running the line cost <b>{inr(m.cost)}</b>
            {m.calls > 0 && <> — {inr(m.cost / m.calls)} a call{booked.length > 0 && <>, {inr(m.cost / booked.length)} a booking</>}</>}
            {m.estimated && <span className="fine"> (partly estimated from call minutes)</span>}.
          </>
        )}
      </p>

      <div className="cols">
        <section>
          <h2>Waiting for review</h2>
          {review.length === 0 ? <p className="empty">Nothing to review. New review leads land here with a deadline.</p> : (
            <ul>
              {review.map((l: any) => {
                const due = new Date(l.review_due_at), created = new Date(l.created_at), now = Date.now();
                const used = Math.min(1, Math.max(0, (now - created.getTime()) / (due.getTime() - created.getTime())));
                return (
                  <Row key={l.id} l={l}>
                    <span className="why">{(l.reasons ?? []).join("; ")}</span>
                    <span className={`clock ${now > due.getTime() ? "over" : ""}`} style={{ ["--used" as any]: used }}>
                      {now > due.getTime() ? `Overdue since ${when(due)}` : `Respond by ${when(due)}`}
                    </span>
                    <Actions id={l.id} options={[["call_booked", "Call booked"], ["contacted", "Contacted"], ["decline", "Decline"]]} />
                  </Row>
                );
              })}
            </ul>
          )}

          <h2>Booked consultations</h2>
          {booked.length === 0 ? <p className="empty">No booked calls yet this month.</p> : (
            <ul>
              {booked.map((l: any) => (
                <Row key={l.id} l={l}>
                  {l.booked_at && <span className="when">{when(l.booked_at)}</span>}
                  <Actions id={l.id} options={[["site_visit", "Site visit booked"], ["won", "Won"], ["lost", "Not a fit"]]} />
                </Row>
              ))}
            </ul>
          )}
        </section>

        <aside>
          {selected ? (
            <div className="detail">
              <h2>{selected.name ?? selected.phone}</h2>
              <p className="meta">{selected.phone} · {TIER_LABEL[selected.tier]} · {selected.designer ?? "Unassigned"}</p>
              {selected.summary && <p>{selected.summary}</p>}
              {(selected.notes ?? []).length > 0 && <p className="note">{selected.notes.join(" ")}</p>}
              <dl>
                <div><dt>budget</dt><dd>{budget(selected.fields) ?? "Not given"}{selected.fields?.budget_inr?.max && selected.fields?.budget_text ? ` ("${selected.fields.budget_text}")` : ""}</dd></div>
                {Object.entries(selected.fields ?? {}).filter(([k]) => k !== "budget_text").filter(([, v]) => v !== null && v !== "" && typeof v !== "object").map(([k, v]) => (
                  <div key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{String(v)}</dd></div>
                ))}
              </dl>
              {call?.transcript && <details><summary>Call transcript</summary><pre>{call.transcript}</pre></details>}
            </div>
          ) : (
            <>
              <h2>Declined</h2>
              {declined.length === 0 ? <p className="empty">No declines this month.</p> : (
                <ul>{declined.map((l: any) => (
                  <Row key={l.id} l={l}><span className="why">{TIER_LABEL[l.tier]}: {(l.reasons ?? []).join("; ")}</span></Row>
                ))}</ul>
              )}
              {escalations.length > 0 && (<>
                <h2>Existing clients</h2>
                <ul>{escalations.map((l: any) => <Row key={l.id} l={l}><span className="why">Senior callback promised within 15 minutes</span></Row>)}</ul>
              </>)}
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;700&display=swap');
:root{--paper:#F2F3EF;--ink:#1F2421;--slate:#5B655F;--line:#CDD2CB;--tulsi:#2E6B4E;--haldi:#A87A14;--brick:#9A3B2C;--card:#FBFBF8}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 'Hanken Grotesk',system-ui,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1180px;margin:0 auto;padding:28px 24px 64px}
header{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
h1{font-size:20px;font-weight:700;margin:0}
h2{font-size:17px;font-weight:700;margin:32px 0 10px}
.toggle{display:flex;gap:8px;align-items:center}
.toggle label{color:var(--slate)}
select,button{font:inherit;padding:6px 12px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--ink);cursor:pointer}
button:hover,select:hover{border-color:var(--ink)}
button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--tulsi);outline-offset:2px}
button.quiet{color:var(--brick)}
.sentence{font-size:clamp(22px,3vw,32px);line-height:1.35;max-width:30em;margin:28px 0 8px;letter-spacing:-.01em}
.sentence b{font-weight:700}.ok{color:var(--tulsi)}.wait{color:var(--haldi)}.late{color:var(--brick)}
.fine{font-size:15px;color:var(--slate)}
.cols{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:40px}
@media(max-width:860px){.cols{grid-template-columns:1fr}}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.row{display:grid;grid-template-columns:1fr auto;gap:4px 16px;padding:14px 0 14px 14px;border-bottom:1px solid var(--line);border-left:3px solid transparent}
.row.t-review{border-left-color:var(--haldi)}.row.t-book{border-left-color:var(--tulsi)}
.row.t-decline_factual,.row.t-decline_sensitive{border-left-color:var(--line)}.row.t-escalate{border-left-color:var(--brick)}
.who{color:inherit;text-decoration:none;display:flex;flex-direction:column}
.who span,.meta,.why,.when{color:var(--slate);font-size:14px}
.why{grid-column:1/-1}
.clock{grid-column:1/-1;font-size:14px;position:relative;padding-top:6px}
.clock::before{content:"";display:block;height:4px;border-radius:2px;margin-bottom:4px;
  background:linear-gradient(90deg,var(--haldi) calc(var(--used)*100%),var(--line) 0)}
.clock.over{color:var(--brick)}.clock.over::before{background:var(--brick)}
.acts{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.empty{color:var(--slate)}
.detail{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:4px 20px 20px;margin-top:20px}
.note{border-left:3px solid var(--haldi);padding-left:10px}
dl{display:grid;gap:6px;margin:16px 0}dl div{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted var(--line)}
dt{color:var(--slate);text-transform:capitalize}dd{margin:0;text-align:right}
pre{white-space:pre-wrap;font:14px/1.5 inherit;max-height:360px;overflow:auto}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
