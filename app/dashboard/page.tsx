// Aangan Studio — enquiries console. One shared dashboard: "All designers" is Nikhil's view
// (incl. cost); picking a designer filters to their leads and records their name on every click.
// Server-rendered, no client JS: filters, search and the lead panel are plain links and GET forms.
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type SP = { designer?: string; lead?: string; view?: string; q?: string };

const TZ = "Asia/Kolkata";
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const lakh = (n: number) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : `₹${+(n / 1e5).toFixed(1)} L`);
const fmt = (d: string | Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...o }).format(new Date(d));
const when = (d: string | Date) => fmt(d, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dayKey = (d: string | Date) => fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" });
const istHour = (d: string | Date) => Number(fmt(d, { hour: "numeric", hour12: false })) % 24;

function rel(target: Date, now: number) {
  const mins = Math.round((target.getTime() - now) / 60000), a = Math.abs(mins);
  const s = a < 60 ? `${a}m` : a < 48 * 60 ? `${Math.round(a / 60)}h` : `${Math.round(a / 1440)}d`;
  return mins >= 0 ? `in ${s}` : `${s} ago`;
}

function budget(f: any): string | null {
  const b = f?.budget_inr;
  if (b?.max) return b.min && b.min !== b.max ? `${lakh(b.min).replace(/ (L|Cr)$/, "")}–${lakh(b.max).replace("₹", "")}` : lakh(b.max);
  return f?.budget_text ? f.budget_text : null;
}

type Status = { key: string; label: string };
function status(l: any, now: number): Status {
  if (l.status === "booked") return { key: "booked", label: "Booked" };
  if (l.tier === "ESCALATE") return { key: "client", label: "Existing client" };
  if (l.tier.startsWith("DECLINE")) return { key: "declined", label: "Out of area" };
  if (l.status === "closed") return { key: "closed", label: "Closed" };
  if (l.tier === "REVIEW" && l.status === "open")
    return l.review_due_at && new Date(l.review_due_at).getTime() < now ? { key: "overdue", label: "Overdue" } : { key: "review", label: "Needs review" };
  return { key: "open", label: "Open" };
}

// "[18:38:48] AGENT: hi" / "Agent: hi" / "Caller: hi" → chat bubbles
function bubbles(t: string): { who: "agent" | "caller"; time?: string; text: string }[] {
  const out: { who: "agent" | "caller"; time?: string; text: string }[] = [];
  for (const line of t.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:\[([^\]]+)\]\s*)?(agent|assistant|user|caller|customer)\s*:\s*(.*)$/i);
    if (m) out.push({ who: /agent|assistant/i.test(m[2]) ? "agent" : "caller", time: m[1], text: m[3] });
    else if (line.trim() && out.length) out[out.length - 1].text += " " + line.trim();
  }
  return out;
}

const VIEWS: [string, string][] = [["all", "All"], ["action", "Needs action"], ["booked", "Booked"], ["declined", "Out of area"], ["client", "Existing clients"]];

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const now = Date.now();
  const designerId = searchParams.designer ? Number(searchParams.designer) : null;
  const view = VIEWS.some(([k]) => k === searchParams.view) ? searchParams.view! : "all";
  const q = (searchParams.q ?? "").trim().toLowerCase();

  const designers = (await sql`SELECT id, name FROM designers WHERE active ORDER BY name`) as { id: number; name: string }[];
  const me = designers.find((d) => d.id === designerId);
  const actor = me?.name ?? "Nikhil";

  const link = (over: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged: SP = { designer: searchParams.designer, view: view === "all" ? undefined : view, q: searchParams.q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const s = p.toString();
    return `/dashboard${s ? `?${s}` : ""}`;
  };
  const back = link({ lead: undefined });

  const leads = (await sql`
    SELECT l.*, d.name AS designer, b.starts_at AS booked_at
    FROM leads l LEFT JOIN designers d ON d.id = l.designer_id LEFT JOIN bookings b ON b.lead_id = l.id
    WHERE l.created_at > date_trunc('month', now()) AND (${designerId}::int IS NULL OR l.designer_id = ${designerId})
    ORDER BY l.created_at DESC`) as any[];

  const calls = (await sql`
    SELECT c.started_at, c.created_at, c.after_hours, c.cost_inr, c.cost_estimated
    FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.created_at > date_trunc('month', now()) AND (${designerId}::int IS NULL OR l.designer_id = ${designerId})`) as any[];

  const upcoming = (await sql`
    SELECT b.starts_at, l.id, l.name, l.phone, l.fields, d.name AS designer
    FROM bookings b JOIN leads l ON l.id = b.lead_id JOIN designers d ON d.id = b.designer_id
    WHERE b.starts_at > now() - interval '1 hour' AND (${designerId}::int IS NULL OR b.designer_id = ${designerId})
    ORDER BY b.starts_at LIMIT 12`) as any[];

  // ---- numbers ----------------------------------------------------------------
  const st = new Map(leads.map((l) => [l.id, status(l, now)]));
  const count = (k: string) => leads.filter((l) => st.get(l.id)!.key === k).length;
  const booked = count("booked"), review = count("review"), overdue = count("overdue"), declined = count("declined"), client = count("client");
  const cost = calls.reduce((s, c) => s + Number(c.cost_inr ?? 0), 0);
  const afterHours = calls.filter((c) => c.after_hours).length;
  const estimated = calls.some((c) => c.cost_estimated);
  const pipeline = leads.filter((l) => ["booked", "review", "overdue"].includes(st.get(l.id)!.key))
    .reduce((s, l) => s + Number(l.fields?.budget_inr?.max ?? 0), 0);
  const hours = Array.from({ length: 24 }, () => 0);
  for (const c of calls) hours[istHour(c.started_at ?? c.created_at)]++;
  const peak = Math.max(1, ...hours);

  const queue = leads
    .filter((l) => ["review", "overdue"].includes(st.get(l.id)!.key))
    .sort((a, b) => new Date(a.review_due_at ?? 0).getTime() - new Date(b.review_due_at ?? 0).getTime());

  const byDay = new Map<string, any[]>();
  for (const u of upcoming) { const k = dayKey(u.starts_at); byDay.set(k, [...(byDay.get(k) ?? []), u]); }
  const todayKey = dayKey(new Date()), tomorrowKey = dayKey(new Date(now + 86400000));

  const tableRows = leads.filter((l) => {
    const k = st.get(l.id)!.key;
    if (view === "action" && !["review", "overdue"].includes(k)) return false;
    if (view !== "all" && view !== "action" && k !== view) return false;
    if (!q) return true;
    return [l.name, l.phone, l.fields?.location_text, l.fields?.email].filter(Boolean).join(" ").toLowerCase().includes(q);
  });
  const viewCount = (k: string) => k === "all" ? leads.length : k === "action" ? review + overdue : count(k);

  // ---- selected lead ------------------------------------------------------------
  const selected = searchParams.lead ? leads.find((l) => l.id === Number(searchParams.lead)) : null;
  const [call] = selected
    ? await sql`SELECT transcript, summary, duration_sec, cost_inr FROM calls WHERE lead_id=${selected.id} ORDER BY created_at DESC LIMIT 1`
    : [];
  const history = selected
    ? ((await sql`SELECT actor, action, created_at FROM actions WHERE lead_id=${selected.id} ORDER BY created_at`) as any[])
    : [];

  const Actions = ({ l }: { l: any }) => {
    const k = st.get(l.id)!.key;
    const options: [string, string][] =
      k === "booked" ? [["site_visit", "Site visit booked"], ["won", "Won"], ["lost", "Not a fit"]]
      : k === "review" || k === "overdue" ? [["call_booked", "Consultation booked"], ["contacted", "Contacted"], ["decline", "Not a fit"]]
      : [];
    if (!options.length) return null;
    return (
      <div className="acts">
        {options.map(([action, label], i) => (
          <form key={action} method="post" action={`/api/leads/${l.id}/action`}>
            <input type="hidden" name="action" value={action} />
            <input type="hidden" name="actor" value={actor} />
            <input type="hidden" name="back" value={link({ lead: String(l.id) })} />
            <button className={i === 0 ? "btn primary" : action === "decline" || action === "lost" ? "btn ghost danger" : "btn ghost"}>{label}</button>
          </form>
        ))}
      </div>
    );
  };

  const Badge = ({ l }: { l: any }) => { const s = st.get(l.id)!; return <span className={`badge b-${s.key}`}>{s.label}</span>; };
  const facts = (f: any) => [f?.bhk ? `${f.bhk} BHK` : f?.property_category !== "unknown" ? f?.property_category : null, f?.location_text, f?.carpet_area_sqft && `${Number(f.carpet_area_sqft).toLocaleString("en-IN")} sq ft`].filter(Boolean).join(" · ");
  const initials = (n?: string) => (n ?? "?").replace(/^TEST\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="shell">
      <style>{css}</style>

      <aside className="side">
        <a className="brand" href={link({ lead: undefined, view: undefined, q: undefined })}>
          <span className="mark" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M4 20V9l8-5 8 5v11h-5v-6H9v6z" /></svg>
          </span>
          <span><b>Aangan</b><small>Enquiry desk</small></span>
        </a>

        <nav className="nav">
          <a href="#queue">Your queue{review + overdue > 0 && <em>{review + overdue}</em>}</a>
          <a href="#upcoming">Consultations{upcoming.length > 0 && <em>{upcoming.length}</em>}</a>
          <a href="#all">All enquiries</a>
        </nav>

        <form method="get" className="who">
          <label htmlFor="designer">Viewing as</label>
          <select id="designer" name="designer" defaultValue={designerId ?? ""}>
            <option value="">Nikhil · all designers</option>
            {designers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button className="btn small">Switch</button>
        </form>

        <p className="foot">Calls answered by the Vaani assistant. Updates live with every call.</p>
      </aside>

      <main className="main">
        <header className="top">
          <div>
            <p className="eyebrow">{fmt(new Date(), { month: "long", year: "numeric" })}</p>
            <h1>{me ? `${me.name}'s enquiries` : "Studio enquiries"}</h1>
          </div>
          <form method="get" className="search">
            {searchParams.designer && <input type="hidden" name="designer" value={searchParams.designer} />}
            <input type="search" name="q" placeholder="Search name, phone, area" defaultValue={searchParams.q ?? ""} aria-label="Search enquiries" />
          </form>
        </header>

        {overdue > 0 && (
          <a className="alert" href={link({ view: "action", lead: undefined }) + "#all"}>
            <span className="dot" /> {overdue} {overdue === 1 ? "caller is" : "callers are"} past the promised response time. Open the queue →
          </a>
        )}

        <section className="kpis">
          <div className="kpi"><span>Calls answered</span><b>{calls.length}</b><small>{afterHours} after hours</small></div>
          <div className="kpi good"><span>Consultations booked</span><b>{booked}</b><small>{upcoming.length} upcoming</small></div>
          <div className={`kpi ${overdue ? "bad" : "warn"}`}><span>Waiting for a designer</span><b>{review + overdue}</b><small>{overdue ? `${overdue} overdue` : "all on time"}</small></div>
          <div className="kpi"><span>Stated budgets in play</span><b>{pipeline ? lakh(pipeline) : "—"}</b><small>booked + in review</small></div>
          {!me && (
            <div className="kpi"><span>Cost of the line</span><b>{inr(cost)}</b>
              <small>{calls.length ? `${inr(cost / calls.length)}/call` : "no calls yet"}{booked ? ` · ${inr(cost / booked)}/booking` : ""}{estimated ? " · est." : ""}</small></div>
          )}
        </section>

        <div className="grid">
          <section className="card" id="queue">
            <div className="card-h"><h2>Your queue</h2><span>oldest deadline first</span></div>
            {queue.length === 0 ? <p className="empty">Nothing waiting. New review leads land here with a deadline.</p> : (
              <ul className="queue">
                {queue.map((l) => {
                  const due = new Date(l.review_due_at ?? l.created_at), created = new Date(l.created_at);
                  const used = Math.min(1, Math.max(0, (now - created.getTime()) / Math.max(1, due.getTime() - created.getTime())));
                  const late = st.get(l.id)!.key === "overdue";
                  return (
                    <li key={l.id} className={late ? "late" : ""}>
                      <a className="q-main" href={link({ lead: String(l.id) })}>
                        <span className="avatar">{initials(l.name)}</span>
                        <span className="q-text">
                          <b>{l.name ?? l.phone}</b>
                          <small>{[facts(l.fields), budget(l.fields)].filter(Boolean).join(" · ")}</small>
                          <small className="why">{(l.reasons ?? []).join(" · ")}</small>
                        </span>
                        <span className="q-due">
                          <b>{late ? `Overdue ${rel(due, now).replace(" ago", "")}` : `Due ${rel(due, now)}`}</b>
                          <small>{l.designer ?? "Unassigned"}</small>
                        </span>
                      </a>
                      <span className="bar" style={{ ["--used" as any]: used }} />
                      <Actions l={l} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card" id="upcoming">
            <div className="card-h"><h2>Consultations</h2><span>next 12</span></div>
            {upcoming.length === 0 ? <p className="empty">No consultations booked yet. Bookings made on the call appear here.</p> : (
              <div className="timeline">
                {[...byDay.entries()].map(([k, items]) => (
                  <div key={k} className="day">
                    <p className="day-h">{k === todayKey ? "Today" : k === tomorrowKey ? "Tomorrow" : fmt(items[0].starts_at, { weekday: "long", day: "numeric", month: "short" })}</p>
                    {items.map((u: any) => (
                      <a key={u.id + u.starts_at} className="slot" href={link({ lead: String(u.id) })}>
                        <time>{fmt(u.starts_at, { hour: "numeric", minute: "2-digit" })}</time>
                        <span><b>{u.name ?? u.phone}</b><small>{[facts(u.fields), u.designer].filter(Boolean).join(" · ")}</small></span>
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="stack">
            <section className="card">
              <div className="card-h"><h2>Outcomes</h2><span>{leads.length} enquiries</span></div>
              {leads.length === 0 ? <p className="empty">No enquiries this month yet.</p> : (<>
                <div className="mix" role="img" aria-label="Outcome mix">
                  {[["booked", booked], ["review", review + overdue], ["declined", declined], ["client", client]].map(([k, n]) =>
                    Number(n) > 0 ? <span key={k as string} className={`seg s-${k}`} style={{ flexGrow: Number(n) }} /> : null)}
                </div>
                <ul className="legend">
                  <li><i className="s-booked" />Booked <b>{booked}</b></li>
                  <li><i className="s-review" />With a designer <b>{review + overdue}</b></li>
                  <li><i className="s-declined" />Out of area <b>{declined}</b></li>
                  <li><i className="s-client" />Existing clients <b>{client}</b></li>
                </ul>
              </>)}
            </section>

            <section className="card">
              <div className="card-h"><h2>When calls arrive</h2><span>IST · this month</span></div>
              <div className="heat">
                {hours.map((n, h) => (
                  <span key={h} className={h >= 10 && h < 19 ? "desk" : ""} style={{ ["--a" as any]: n ? 0.18 + 0.82 * (n / peak) : 0 }}
                    title={`${h}:00–${h + 1}:00 · ${n} call${n === 1 ? "" : "s"}`} />
                ))}
              </div>
              <div className="heat-axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
              <p className="note"><i className="desk-key" /> front-desk hours (10am–7pm). Everything outside is the assistant on its own.</p>
            </section>
          </aside>
        </div>

        <section className="card" id="all">
          <div className="card-h wrap">
            <h2>All enquiries</h2>
            <nav className="tabs" aria-label="Filter enquiries">
              {VIEWS.map(([k, label]) => (
                <a key={k} href={link({ view: k === "all" ? undefined : k, lead: undefined }) + "#all"} className={view === k ? "on" : ""}>
                  {label}<em>{viewCount(k)}</em>
                </a>
              ))}
            </nav>
          </div>
          {q && <p className="filter-note">Showing matches for “{searchParams.q}” · <a href={link({ q: undefined }) + "#all"}>clear</a></p>}
          {tableRows.length === 0 ? <p className="empty">No enquiries match.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Caller</th><th>Project</th><th>Budget</th><th>Status</th><th>Designer</th><th>Received</th></tr></thead>
                <tbody>
                  {tableRows.map((l) => (
                    <tr key={l.id} className={selected?.id === l.id ? "sel" : ""}>
                      <td><a href={link({ lead: String(l.id) })}><b>{l.name ?? "Unnamed caller"}</b><small>{l.phone}</small></a></td>
                      <td>{facts(l.fields) || "—"}</td>
                      <td>{budget(l.fields) ?? <span className="muted">not given</span>}</td>
                      <td><Badge l={l} />{l.booked_at && <small>{when(l.booked_at)}</small>}</td>
                      <td>{l.designer ?? <span className="muted">—</span>}</td>
                      <td>{when(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {selected && (
        <>
          <a className="scrim" href={back} aria-label="Close lead" />
          <aside className="panel" aria-label={`Lead: ${selected.name ?? selected.phone}`}>
            <div className="panel-h">
              <span className="avatar big">{initials(selected.name)}</span>
              <div>
                <h2>{selected.name ?? "Unnamed caller"}</h2>
                <p><Badge l={selected} /> <span className="muted">{selected.designer ?? "Unassigned"} · {when(selected.created_at)}</span></p>
              </div>
              <a className="close" href={back} aria-label="Close">×</a>
            </div>

            <div className="contact">
              <a className="btn ghost" href={`tel:${selected.phone}`}>Call {selected.phone}</a>
              {selected.fields?.email && <a className="btn ghost" href={`mailto:${selected.fields.email}`}>{selected.fields.email}</a>}
            </div>

            {selected.booked_at && <p className="booked">Consultation · <b>{fmt(selected.booked_at, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}</b></p>}
            {st.get(selected.id)!.key.match(/review|overdue/) && selected.review_due_at &&
              <p className={`due ${st.get(selected.id)!.key}`}>Respond {rel(new Date(selected.review_due_at), now)} · by {when(selected.review_due_at)}</p>}

            <Actions l={selected} />

            {(call?.summary || selected.summary) && <><h3>What happened</h3><p className="summary">{call?.summary ?? selected.summary}</p></>}

            <h3>Project</h3>
            <dl className="facts">
              {([
                ["Location", selected.fields?.location_text],
                ["Property", [selected.fields?.bhk && `${selected.fields.bhk} BHK`, selected.fields?.property_category !== "unknown" && selected.fields?.property_category].filter(Boolean).join(", ")],
                ["Size", selected.fields?.carpet_area_sqft && `${Number(selected.fields.carpet_area_sqft).toLocaleString("en-IN")} sq ft`],
                ["Scope", selected.fields?.scope_type?.replace(/_/g, " ")],
                ["Wants", selected.fields?.project_intent?.replace(/_/g, " ")],
                ["Complete by", selected.fields?.completion_needed_by ? fmt(selected.fields.completion_needed_by, { month: "long", year: "numeric" }) : selected.fields?.timeline_flexible ? "Flexible" : null],
                ["Budget", budget(selected.fields)],
                ["Decides", selected.fields?.decision_maker],
              ] as [string, any][]).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}
            </dl>

            {(selected.notes ?? []).length > 0 && <><h3>For the designer</h3><ul className="notes">{selected.notes.map((n: string) => <li key={n}>{n}</li>)}</ul></>}
            {(selected.reasons ?? []).length > 0 && <><h3>Why this outcome</h3><ul className="reasons">{selected.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul></>}
            {selected.fields?.notes_from_call && <><h3>From the call</h3><p className="summary">{selected.fields.notes_from_call}</p></>}

            {call?.transcript && (() => {
              const b = bubbles(call.transcript);
              return (
                <details className="transcript">
                  <summary>Transcript{call.duration_sec ? ` · ${Math.round(call.duration_sec / 60)} min` : ""}</summary>
                  {b.length ? (
                    <div className="chat">{b.map((m, i) => <p key={i} className={m.who}>{m.text}{m.time && <time>{m.time}</time>}</p>)}</div>
                  ) : <pre>{call.transcript}</pre>}
                </details>
              );
            })()}

            {history.length > 0 && (
              <><h3>History</h3>
                <ol className="history">{history.map((h, i) => <li key={i}><b>{h.action.replace(/_/g, " ")}</b> · {h.actor} <time>{when(h.created_at)}</time></li>)}</ol></>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap');
:root{
  --bg:#F3F4F1;--card:#FFFFFF;--ink:#16211C;--ink-2:#4B5751;--ink-3:#7D8782;--line:#E3E6E1;
  --side:#13231C;--side-2:#1C3229;--side-ink:#DCE7E1;
  --green:#1E7A55;--green-bg:#E5F2EC;--amber:#B87503;--amber-bg:#FBF0DA;--red:#B23A2B;--red-bg:#FBE7E3;
  --blue:#2F5DA8;--blue-bg:#E6EDF8;--grey-bg:#EEF0EC;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 Manrope,system-ui,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
a{color:inherit}
.shell{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}

/* sidebar */
.side{background:var(--side);color:var(--side-ink);padding:22px 18px;display:flex;flex-direction:column;gap:26px;position:sticky;top:0;height:100vh}
.brand{display:flex;gap:12px;align-items:center;text-decoration:none}
.brand b{display:block;font-size:18px;color:#fff;letter-spacing:-.01em}.brand small{color:#9DB3A8;font-size:12px}
.mark{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#E3A33A,#C9781F);display:grid;place-items:center}
.mark svg{width:20px;height:20px;fill:#13231C}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;justify-content:space-between;align-items:center;text-decoration:none;padding:9px 12px;border-radius:9px;color:var(--side-ink);font-weight:600;font-size:14px}
.nav a:hover{background:var(--side-2)}
.nav em,.tabs em{font-style:normal;font-size:12px;font-weight:700;background:rgba(255,255,255,.12);padding:1px 8px;border-radius:99px}
.who{display:flex;flex-direction:column;gap:8px;margin-top:auto;background:var(--side-2);padding:14px;border-radius:12px}
.who label{font-size:12px;color:#9DB3A8;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
.who select{font:inherit;font-size:14px;padding:8px 10px;border-radius:8px;border:1px solid #2E4A3E;background:#0F1C16;color:#fff}
.foot{font-size:12px;color:#7F978B;margin:0}

/* main */
.main{padding:26px 32px 64px;display:flex;flex-direction:column;gap:20px;min-width:0}
.top{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.eyebrow{margin:0;color:var(--ink-3);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.07em}
h1{margin:2px 0 0;font-size:30px;letter-spacing:-.02em;font-weight:800}
.search input{font:inherit;width:280px;max-width:100%;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.alert{display:flex;align-items:center;gap:10px;text-decoration:none;background:var(--red-bg);color:var(--red);font-weight:600;padding:12px 16px;border-radius:12px;border:1px solid #F1C9C1}
.alert .dot{width:9px;height:9px;border-radius:50%;background:var(--red);box-shadow:0 0 0 4px rgba(178,58,43,.18)}

.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:2px;position:relative;overflow:hidden}
.kpi::before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--line)}
.kpi.good::before{background:var(--green)}.kpi.warn::before{background:var(--amber)}.kpi.bad::before{background:var(--red)}
.kpi span{font-size:13px;color:var(--ink-2);font-weight:600}
.kpi b{font-size:30px;font-weight:800;letter-spacing:-.02em}
.kpi small{color:var(--ink-3);font-size:12.5px}

.grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr) minmax(250px,.8fr);gap:16px;align-items:start}
.stack{display:flex;flex-direction:column;gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px}
.card-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:12px}
.card-h.wrap{flex-wrap:wrap;align-items:center}
.card-h h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.01em}
.card-h > span{color:var(--ink-3);font-size:12.5px}
.empty{color:var(--ink-3);margin:6px 0}
.muted{color:var(--ink-3)}

/* queue */
.queue{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.queue li{border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.queue li.late{border-color:#EFC2B9;background:#FFFBFA}
.q-main{display:flex;gap:12px;text-decoration:none;align-items:flex-start}
.q-text{display:flex;flex-direction:column;min-width:0;flex:1}
.q-text small{color:var(--ink-2);font-size:13px}
.q-text .why{color:var(--ink-3);font-size:12.5px}
.q-due{text-align:right;display:flex;flex-direction:column;flex-shrink:0}
.q-due b{font-size:13px;color:var(--amber)}.late .q-due b{color:var(--red)}
.q-due small{color:var(--ink-3);font-size:12.5px}
.bar{height:5px;border-radius:9px;background:linear-gradient(90deg,var(--amber) calc(var(--used)*100%),var(--grey-bg) 0)}
.late .bar{background:var(--red)}
.avatar{width:36px;height:36px;border-radius:50%;background:var(--grey-bg);display:grid;place-items:center;font-weight:800;font-size:13px;color:var(--ink-2);flex-shrink:0}
.avatar.big{width:48px;height:48px;font-size:16px;background:var(--green-bg);color:var(--green)}

/* consultations */
.timeline{display:flex;flex-direction:column;gap:14px}
.day-h{margin:0 0 6px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3)}
.slot{display:flex;gap:14px;align-items:center;text-decoration:none;padding:10px 12px;border-radius:10px;background:var(--green-bg);margin-bottom:6px}
.slot time{font-weight:800;color:var(--green);min-width:64px}
.slot span{display:flex;flex-direction:column}.slot small{color:var(--ink-2);font-size:12.5px}

/* outcomes + heat */
.mix{display:flex;gap:3px;height:14px;border-radius:99px;overflow:hidden}
.seg{display:block;min-width:6px}
.s-booked{background:var(--green)}.s-review{background:var(--amber)}.s-declined{background:#A7AFAA}.s-client{background:var(--blue)}
.legend{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:6px;font-size:13.5px;color:var(--ink-2)}
.legend li{display:flex;align-items:center;gap:8px}.legend b{margin-left:auto;color:var(--ink)}
.legend i{width:10px;height:10px;border-radius:3px;display:inline-block}
.heat{display:grid;grid-template-columns:repeat(24,1fr);gap:3px}
.heat span{aspect-ratio:1/2.2;border-radius:4px;background:rgba(30,122,85,var(--a));outline:1px solid var(--line);outline-offset:-1px}
.heat span.desk{outline-color:#C9D2CC}
.heat-axis{display:flex;justify-content:space-between;color:var(--ink-3);font-size:11px;margin-top:6px}
.note{color:var(--ink-3);font-size:12.5px;margin:10px 0 0;display:flex;gap:6px;align-items:center}
.desk-key{width:10px;height:10px;border:1.5px solid #9FB0A6;border-radius:3px;display:inline-block}

/* table */
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tabs a{text-decoration:none;font-size:13.5px;font-weight:700;padding:7px 12px;border-radius:99px;border:1px solid var(--line);color:var(--ink-2);display:flex;gap:8px;align-items:center}
.tabs a em{background:var(--grey-bg);color:var(--ink-2)}
.tabs a.on{background:var(--ink);border-color:var(--ink);color:#fff}.tabs a.on em{background:rgba(255,255,255,.18);color:#fff}
.filter-note{margin:0 0 10px;color:var(--ink-2);font-size:13px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);font-weight:800;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:12px;border-bottom:1px solid var(--line);vertical-align:top}
td a{text-decoration:none;display:flex;flex-direction:column}
td small{display:block;color:var(--ink-3);font-size:12.5px;margin-top:3px}
tr:hover td,tr.sel td{background:#F8FAF7}

.badge{display:inline-block;font-size:12px;font-weight:800;padding:3px 10px;border-radius:99px;white-space:nowrap}
.b-booked{background:var(--green-bg);color:var(--green)}.b-review{background:var(--amber-bg);color:var(--amber)}
.b-overdue{background:var(--red-bg);color:var(--red)}.b-declined,.b-closed,.b-open{background:var(--grey-bg);color:var(--ink-2)}.b-client{background:var(--blue-bg);color:var(--blue)}

/* buttons */
.acts{display:flex;gap:8px;flex-wrap:wrap}
.acts form{margin:0}
.btn{font:inherit;font-size:13.5px;font-weight:700;padding:8px 14px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}
.btn:hover{border-color:var(--ink-2)}
.btn.primary{background:var(--green);border-color:var(--green);color:#fff}.btn.primary:hover{background:#17654A}
.btn.danger{color:var(--red)}
.btn.small{padding:7px 12px;background:#2E4A3E;border-color:#2E4A3E;color:#fff}
a:focus-visible,button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--amber);outline-offset:2px}

/* lead panel */
.scrim{position:fixed;inset:0;background:rgba(19,35,28,.35);z-index:10}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(520px,100vw);background:var(--card);z-index:11;overflow-y:auto;padding:22px 24px 40px;box-shadow:-24px 0 48px rgba(19,35,28,.18);display:flex;flex-direction:column;gap:12px;animation:slide .18s ease-out}
@keyframes slide{from{transform:translateX(24px);opacity:.6}to{transform:none;opacity:1}}
.panel-h{display:flex;gap:14px;align-items:center}
.panel-h h2{margin:0;font-size:21px;font-weight:800;letter-spacing:-.01em}
.panel-h p{margin:4px 0 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}
.close{margin-left:auto;text-decoration:none;font-size:26px;line-height:1;color:var(--ink-3);padding:4px 8px;border-radius:8px}
.close:hover{background:var(--grey-bg)}
.contact{display:flex;gap:8px;flex-wrap:wrap}
.booked{margin:0;background:var(--green-bg);color:var(--green);padding:10px 14px;border-radius:10px}
.due{margin:0;padding:10px 14px;border-radius:10px;background:var(--amber-bg);color:var(--amber);font-weight:700}
.due.overdue{background:var(--red-bg);color:var(--red)}
.panel h3{margin:10px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);font-weight:800}
.summary{margin:0;color:var(--ink-2)}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}
.facts div{background:var(--bg);border-radius:10px;padding:8px 12px}
.facts dt{font-size:11.5px;color:var(--ink-3);font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.facts dd{margin:2px 0 0;font-weight:700;text-transform:capitalize}
.notes,.reasons{margin:0;padding-left:18px;color:var(--ink-2)}
.notes li::marker{color:var(--amber)}
.transcript{border:1px solid var(--line);border-radius:12px;padding:10px 14px}
.transcript summary{cursor:pointer;font-weight:800}
.chat{display:flex;flex-direction:column;gap:8px;margin-top:12px;max-height:420px;overflow-y:auto}
.chat p{margin:0;max-width:85%;padding:8px 12px;border-radius:14px;font-size:14px;position:relative}
.chat .agent{background:var(--grey-bg);align-self:flex-start;border-bottom-left-radius:4px}
.chat .caller{background:var(--green-bg);align-self:flex-end;border-bottom-right-radius:4px}
.chat time{display:block;font-size:11px;color:var(--ink-3);margin-top:2px}
.transcript pre{white-space:pre-wrap;font:13px/1.5 inherit}
.history{margin:0;padding-left:18px;color:var(--ink-2);font-size:13.5px;text-transform:capitalize}
.history time{color:var(--ink-3);text-transform:none}

@media (max-width:1180px){.grid{grid-template-columns:1fr 1fr}.stack{grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr}}
@media (max-width:860px){
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;gap:14px;padding:14px 16px}
  .nav{flex-direction:row;flex-wrap:wrap}.foot{display:none}
  .who{margin:0;flex-direction:row;align-items:center;padding:8px 10px;flex-wrap:wrap}
  .main{padding:18px 16px 48px}
  .grid,.stack{grid-template-columns:1fr;display:flex;flex-direction:column}
  .search input{width:100%}
  .facts{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.panel{animation:none}}
`;
