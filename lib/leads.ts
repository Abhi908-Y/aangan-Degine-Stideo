// Creating a lead from a finished call. Used by the Vaani webhook: Vaani's custom tools don't
// forward the agent's arguments, so the lead is built AFTER the call from the fields Vaani's
// post-call extraction pulls out of the conversation (see VAANI_DATA_POINTS).
import { sql } from "./db";
import { decide, LeadFields } from "./rules";
import { leastLoadedDesigner, pinnedDesignerId } from "./assign";
import { sendTelegram, handoffNote } from "./telegram";
import { upsertDeal } from "./hubspot";

const REVIEW_HOURS = 24;
const dash = (id: number) => `${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/dashboard?lead=${id}`;

// ---- Vaani extraction → LeadFields ------------------------------------------

/** The data points configured on the Vaani agent (analysis.extraction). Names ≤ 30 chars. */
export const VAANI_DATA_POINTS: { name: string; prompt: string; values?: string[] }[] = [
  { name: "caller_name", prompt: "The caller's name." },
  { name: "caller_mobile", prompt: "The caller's mobile number as they said it, digits only with country code if given (e.g. 919876543210 or 9876543210)." },
  { name: "caller_email", prompt: "The caller's email address if they gave one, in lowercase (e.g. priya.k@gmail.com)." },
  { name: "caller_type", prompt: "existing_client if they mention an ongoing project, an assigned designer or a complaint about work in progress; new_enquiry if they want a new project; other otherwise.", values: ["new_enquiry", "existing_client", "other"] },
  { name: "project_intent", prompt: "What they want: design_and_execution (full design and execution), advice_only (ideas, a visit, a second opinion), decor_only (styling, colours, rearranging), furniture_only (just furniture sourcing), vastu_only (just Vastu advice), or unclear.", values: ["design_and_execution", "advice_only", "decor_only", "furniture_only", "vastu_only", "unclear"] },
  { name: "property_category", prompt: "Type of property.", values: ["residential", "office", "clinic", "studio", "restaurant", "hotel", "retail", "gym", "other", "unknown"] },
  { name: "location_text", prompt: "The locality or area of the property exactly as the caller said it (e.g. Baner, Kothrud, Talegaon). Not just 'Pune' if they named an area." },
  { name: "carpet_area_sqft", prompt: "Carpet area in square feet as a number, if given." },
  { name: "bhk", prompt: "Number of bedrooms (BHK) as a number, if given." },
  { name: "scope_type", prompt: "full_home (whole home), partial (a floor or some rooms), single_room, commercial_fitout (office/clinic/studio), or unknown.", values: ["full_home", "partial", "single_room", "commercial_fitout", "unknown"] },
  { name: "rooms_count", prompt: "For partial or single-room projects, how many rooms, as a number." },
  { name: "completion_text", prompt: "When they need the project complete, in their own words (e.g. 'by March', 'before Diwali', 'no rush')." },
  { name: "completion_needed_by", prompt: "When they need it complete, as a date YYYY-MM-DD. Use the call date as today; for a month only, use the last day of the next occurrence of that month. Empty if not given or flexible." },
  { name: "timeline_flexible", prompt: "yes if they said no rush / flexible / whenever, otherwise no.", values: ["yes", "no"] },
  { name: "budget_text", prompt: "Their budget answer in their own words (e.g. 'around 15 lakhs', 'not decided')." },
  { name: "budget_min_inr", prompt: "Lower end of the budget they stated, in rupees as a plain number (15 lakhs = 1500000). Empty if not given." },
  { name: "budget_max_inr", prompt: "Upper end of the budget they stated, in rupees as a plain number (for a single figure, that figure). Empty if not given." },
  { name: "decision_maker", prompt: "yes if the caller decides; authorised if deciding with someone who knows they're calling; no if just researching for someone else; unclear otherwise.", values: ["yes", "authorised", "unclear", "no"] },
  { name: "structural_changes", prompt: "yes if they asked to move or break walls or other structural changes, otherwise no.", values: ["yes", "no"] },
  { name: "consultation_booked", prompt: "yes if a consultation was booked on the calendar during the call, otherwise no.", values: ["yes", "no"] },
  { name: "notes_from_call", prompt: "Anything specific: kitchen, wardrobes, style, possession date, rented or owned, complaint details. One or two sentences." },
];

const text = (v: unknown) => {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s === "" || /^(null|none|n\/a|na|not (given|mentioned|provided)|unknown|-)$/i.test(s) ? undefined : s;
};
function num(v: unknown): number | null {
  const s = text(v)?.toLowerCase().replace(/,/g, "");
  if (!s) return null;
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (/crore|\bcr\b/.test(s)) n *= 1e7; else if (/lakh|lac|\bl\b/.test(s)) n *= 1e5;
  return Number.isFinite(n) ? n : null;
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => {
  const s = text(v)?.toLowerCase().replace(/[\s-]+/g, "_") as T | undefined;
  return s && allowed.includes(s) ? s : fallback;
};
const yes = (v: unknown) => /^(yes|true|y)$/i.test(text(v) ?? "");

/** +91XXXXXXXXXX from whatever was said; undefined if it doesn't look like an Indian mobile. */
export function normalisePhone(v: unknown): string | undefined {
  const d = (text(v) ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (d.length > 10 && d.length <= 15) return `+${d}`;
  return undefined;
}

export function entitiesToFields(e: Record<string, unknown>): LeadFields {
  const bMax = num(e.budget_max_inr), bMin = num(e.budget_min_inr);
  const date = text(e.completion_needed_by);
  const bhk = num(e.bhk);
  const scope = oneOf(e.scope_type, ["full_home", "partial", "single_room", "commercial_fitout", "unknown"] as const, "unknown");
  let category = oneOf(e.property_category, ["residential", "office", "clinic", "studio", "restaurant", "hotel", "retail", "gym", "other", "unknown"] as const, "unknown");
  // Vaani's extraction sometimes leaves the type empty for "a 3 BHK" — a BHK or a home scope means residential.
  if (category === "unknown" && (bhk || ["full_home", "partial", "single_room"].includes(scope))) category = "residential";
  return {
    caller_type: oneOf(e.caller_type, ["new_enquiry", "existing_client", "other"] as const, "new_enquiry"),
    name: text(e.caller_name),
    project_intent: oneOf(e.project_intent, ["design_and_execution", "advice_only", "decor_only", "furniture_only", "vastu_only", "unclear"] as const, "unclear"),
    property_category: category,
    location_text: text(e.location_text),
    carpet_area_sqft: num(e.carpet_area_sqft),
    bhk,
    scope_type: scope,
    rooms_count: num(e.rooms_count),
    completion_needed_by: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    timeline_flexible: yes(e.timeline_flexible),
    budget_inr: bMax ? { ...(bMin && bMin !== bMax ? { min: bMin } : {}), max: bMax } : null,
    budget_text: text(e.budget_text),
    decision_maker: oneOf(e.decision_maker, ["yes", "authorised", "unclear", "no"] as const, "unclear"),
    structural_changes_requested: yes(e.structural_changes),
    notes_from_call: [text(e.notes_from_call), text(e.completion_text) && `Timeline: ${text(e.completion_text)}`].filter(Boolean).join(" · ") || undefined,
    ...(text(e.caller_email) ? { email: text(e.caller_email)!.toLowerCase() } : {}),
  } as LeadFields;
}

// ---- lead creation ------------------------------------------------------------

/** Apply the rules and create the lead, with designer, Telegram and HubSpot as the tier requires. */
export async function createLead(phone: string, fields: LeadFields): Promise<any> {
  const d = decide(fields);
  const status = d.tier === "DECLINE_FACTUAL" ? "declined" : d.tier === "ESCALATE" ? "escalated" : "open";
  const [lead] = await sql`
    INSERT INTO leads (phone, name, tier, status, reasons, notes, fields)
    VALUES (${phone}, ${fields.name ?? null}, ${d.tier}, ${status}, ${JSON.stringify(d.reasons)}, ${JSON.stringify(d.notes)}, ${JSON.stringify(fields)})
    RETURNING *`;
  await sql`INSERT INTO actions (lead_id, actor, action, detail) VALUES (${lead.id}, 'system', 'classified_after_call', ${JSON.stringify(d)})`;

  if (d.tier === "REVIEW") {
    const designer = await leastLoadedDesigner();
    await sql`UPDATE leads SET designer_id=${designer.id}, review_due_at=now() + make_interval(hours => ${REVIEW_HOURS}) WHERE id=${lead.id}`;
    await sendTelegram(designer.telegram_chat_id, handoffNote({
      heading: `🟡 Review needed within ${REVIEW_HOURS}h`, name: fields.name, phone, fields,
      notes: [...d.reasons, ...d.notes], dashboardUrl: dash(lead.id),
    }));
    try {
      const dealId = await upsertDeal({ name: fields.name, phone, tier: "REVIEW", designer: designer.name, summary: d.reasons.join("; "), budget: fields.budget_inr, budgetText: fields.budget_text, email: (fields as any).email });
      if (dealId) await sql`UPDATE leads SET hubspot_deal_id=${dealId} WHERE id=${lead.id}`;
    } catch (e) { console.error(e); }
  }
  // One-designer mode: existing clients and declines are also owned by that designer (Nikhil still gets the escalation alert).
  if (pinnedDesignerId() && (d.tier === "ESCALATE" || d.tier === "DECLINE_FACTUAL")) {
    await sql`UPDATE leads SET designer_id=${pinnedDesignerId()} WHERE id=${lead.id}`;
  }
  if (d.tier === "ESCALATE") {
    await sendTelegram(process.env.TELEGRAM_FOUNDER_CHAT_ID, handoffNote({
      heading: "🔴 Existing client — call back within 15 minutes", name: fields.name, phone, fields,
      summary: fields.notes_from_call, dashboardUrl: dash(lead.id),
    }));
  }
  const [fresh] = await sql`SELECT * FROM leads WHERE id=${lead.id}`;
  return fresh;
}
