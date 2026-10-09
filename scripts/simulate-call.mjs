// Plays Vaani's part of a call against a running deployment, so the whole flow can be tested
// before Vaani is connected:  lookup_caller → classify → (book) → end-of-call webhook.
//
//   node scripts/simulate-call.mjs tests/calls/t01-book.json [baseUrl]
//
// The scenario file holds what Vaani's LLM would have extracted during the call:
//   { "phone": "+91…", "fields": { …LeadFields… }, "pick_slot": 0 | null, "transcript": "…", "summary": "…",
//     "email": "caller@example.com", "duration_sec": 240 }
// pick_slot: index of the offered slot the caller chooses (BOOK tier only); null = hangs up without booking.
// Secrets come from the environment or .env.secrets.local (AANGAN_TOOL_SECRET).
import { readFileSync, existsSync } from "node:fs";

const [file, baseArg] = process.argv.slice(2);
if (!file) { console.error("usage: node scripts/simulate-call.mjs <scenario.json> [baseUrl]"); process.exit(1); }

if (existsSync(".env.secrets.local")) {
  for (const line of readFileSync(".env.secrets.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const base = (baseArg ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://aangan-voice-pi.vercel.app").replace(/\/$/, "");
const secret = process.env.AANGAN_TOOL_SECRET;
if (!secret) { console.error("AANGAN_TOOL_SECRET not set"); process.exit(1); }

const s = JSON.parse(readFileSync(file, "utf8"));
const callId = `sim-${Date.now()}`;

async function post(path, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-aangan-secret": secret },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

console.log(`📞 Simulated call from ${s.phone} → ${base}\n`);

const who = await post("/api/tools/lookup-caller", { phone: s.phone });
console.log("1. lookup_caller:", who.known ? `known caller (${who.name ?? "no name"}, lead ${who.lead_id})` : "new caller");

const c = await post("/api/tools/classify", { phone: s.phone, fields: s.fields });
console.log(`2. classify: tier ${c.tier} (lead ${c.lead_id})`);
console.log(`   agent says: "${c.say}"`);
if (c.slots?.length) c.slots.forEach((o, i) => console.log(`   slot ${i}: ${o.designer}, ${o.time}`));

if (c.tier === "BOOK" && c.slots?.length && s.pick_slot != null) {
  const pick = c.slots[s.pick_slot] ?? c.slots[0];
  const b = await post("/api/tools/book", { lead_id: c.lead_id, slot_id: pick.slot_id, email: s.email });
  console.log(`3. book: ${b.booked ? "booked" : b.need_email ? "needs the caller's email first" : "not booked (slot taken)"}`);
  console.log(`   agent says: "${b.say}"`);
} else if (c.tier === "BOOK") {
  console.log("3. book: caller hung up without choosing a slot");
}

const w = await post("/api/vaani/webhook", {
  call_id: callId,
  from: s.phone,
  started_at: new Date(Date.now() - (s.duration_sec ?? 180) * 1000).toISOString(),
  duration_sec: s.duration_sec ?? 180,
  transcript: s.transcript ?? "",
  summary: s.summary ?? "",
});
console.log(`4. end-of-call webhook: ${w.note ?? "stored"}`);
console.log(`\nDashboard: ${base}/dashboard?lead=${c.lead_id}`);
