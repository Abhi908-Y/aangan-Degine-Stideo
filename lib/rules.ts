// Tier rules for Aangan Studio phone enquiries.
// Source of truth: qualified.md (Nikhil's five criteria), services.md (scope + area),
// pricing.md (used ONLY here, internally, to add a note for the designer when the stated
// budget looks low — the voice agent never sees these numbers).
//
// Studio policy (Oct 2026): the only automatic decline is a site outside Pune / PCMC.
// Everything else that doesn't clearly fit goes to a designer. Budget is always asked and
// recorded for the CRM, but never changes the tier — only a designer declines over price.
//
// The AI extracts answers; these rules decide the tier. Every decision is explainable.

export type Tier = "BOOK" | "REVIEW" | "DECLINE_FACTUAL" | "DECLINE_SENSITIVE" | "ESCALATE";

export interface LeadFields {
  caller_type: "new_enquiry" | "existing_client" | "other";
  name?: string;
  project_intent: "design_and_execution" | "advice_only" | "decor_only" | "furniture_only" | "vastu_only" | "unclear";
  property_category: "residential" | "office" | "clinic" | "studio" | "restaurant" | "hotel" | "retail" | "gym" | "other" | "unknown";
  location_text?: string;
  carpet_area_sqft?: number | null;
  bhk?: number | null;
  scope_type?: "full_home" | "partial" | "single_room" | "commercial_fitout" | "unknown";
  rooms_count?: number | null;          // rooms being designed (partial / single room)
  completion_needed_by?: string | null; // ISO date the caller needs the project complete
  timeline_flexible?: boolean;          // "no rush", "whenever", "flexible"
  budget_inr?: { min?: number; max: number } | null; // asked on every call; null if not decided
  budget_text?: string;                 // the caller's own words, e.g. "around 12–15 lakhs", "not decided yet"
  decision_maker: "yes" | "authorised" | "unclear" | "no";
  structural_changes_requested?: boolean;
  notes_from_call?: string;
}

export interface Decision {
  tier: Tier;
  reasons: string[]; // for the dashboard only, never read to the caller
  notes: string[];   // uncertainties for the designer
  say: string;       // exact closing line for the voice agent
}

// ---- services.md --------------------------------------------------------
export const SERVICE_AREAS = [
  // Pune city
  "kothrud", "baner", "aundh", "wakad", "koregaon park", "kalyani nagar", "viman nagar",
  "hadapsar", "magarpatta", "nibm", "kondhwa", "undri", "shivane", "warje", "erandwane", "deccan",
  // PCMC
  "pimpri", "chinchwad", "pimple saudagar", "pimple nilakh", "ravet", "hinjewadi", "pcmc",
];
export const OUT_OF_AREA = ["talegaon", "lonavala", "nashik", "mumbai", "thane", "navi mumbai", "satara", "kolhapur", "nagpur", "aurangabad"];
const OUT_OF_SCOPE_CATEGORIES = ["restaurant", "hotel", "retail", "gym"];
const COMMERCIAL = ["office", "clinic", "studio"];

// ---- thresholds (proposed; confirm with Nikhil) -------------------------
export const TIMELINE_SHORT_WEEKS = 6;    // services.md: cannot be ready in under 6 weeks → designer judges
export const TIMELINE_REVIEW_WEEKS = 10;  // qualified.md: 8–10 weeks needed; under 10 goes to a designer
export const COMMERCIAL_MIN_SQFT = 500;   // front desk practice (T18) → designer judges
export const COMMERCIAL_MAX_SQFT = 3000;  // services.md: up to ~3,000 sq ft
const BUDGET_LOW_NOTE = 0.8;              // stated max < 80% of lowest plausible cost → note for the designer

// ---- pricing.md (internal only) -----------------------------------------
const RES_MIN_PER_SQFT = 1800;
const COMM_MIN_PER_SQFT = 1200;
const SINGLE_ROOM_MIN = 350000;

export function lowestPlausibleCost(f: LeadFields): number | null {
  const commercial = COMMERCIAL.includes(f.property_category);
  if (commercial && f.carpet_area_sqft) return f.carpet_area_sqft * COMM_MIN_PER_SQFT;
  if (f.property_category !== "residential") return null;
  if (f.scope_type === "single_room") return SINGLE_ROOM_MIN;
  if (f.scope_type === "partial" && f.rooms_count) return f.rooms_count * SINGLE_ROOM_MIN;
  if (f.carpet_area_sqft) return f.carpet_area_sqft * RES_MIN_PER_SQFT;
  return null;
}

function areaStatus(loc?: string): "in" | "out" | "unknown" {
  if (!loc) return "unknown";
  const l = loc.toLowerCase();
  if (OUT_OF_AREA.some((a) => l.includes(a))) return "out";
  if (SERVICE_AREAS.some((a) => l.includes(a))) return "in";
  return "unknown"; // e.g. "Pune" alone, Kharadi, Nanded City → a designer checks
}

function weeksUntil(iso: string, now: Date): number {
  return (new Date(iso).getTime() - now.getTime()) / (7 * 24 * 3600 * 1000);
}

// ---- closing lines the agent reads out ----------------------------------
export const LINES = {
  book: "Our designer is free at the times I'm about to offer — which one works best for you?",
  review: "Thank you for sharing all of this. For this request, I'll need to take it back to my team — one of our designers will review your details and connect with you.",
  escalate: "I'm sorry this has happened. I'm flagging it to our senior team right now, and someone senior will call you back within 15 minutes.",
  area: (place: string) =>
    `Thank you so much for calling Aangan Studio. Unfortunately we don't serve ${place} yet — we currently work only in Pune city and PCMC. If we start working in your area, we'll get back to you, but for now we won't be able to take this on. Thank you for thinking of us.`,
};

export function decide(f: LeadFields, now: Date = new Date()): Decision {
  const reasons: string[] = [];
  const notes: string[] = [];
  let review = false;

  // Existing clients are not leads.
  if (f.caller_type === "existing_client") {
    return { tier: "ESCALATE", reasons: ["Existing client — not a new enquiry"], notes, say: LINES.escalate };
  }

  // Criterion 2 — service area. The ONLY automatic decline: we can't serve the site at all.
  const area = areaStatus(f.location_text);
  if (area === "out") {
    return {
      tier: "DECLINE_FACTUAL",
      reasons: [`Criterion 2: ${f.location_text} is outside Pune / PCMC`],
      notes,
      say: LINES.area(f.location_text!),
    };
  }
  if (area === "unknown") {
    reasons.push(`Criterion 2: location "${f.location_text ?? "not given"}" not on the service-area list`);
    review = true;
  }

  // Criterion 1 — real project. Anything short of design + execution → a designer decides.
  if (["advice_only", "decor_only", "furniture_only", "vastu_only"].includes(f.project_intent)) {
    reasons.push(`Criterion 1: ${f.project_intent.replace("_", " ")} — not design + execution, designer to decide`);
    review = true;
  } else if (f.project_intent === "unclear") {
    reasons.push("Criterion 1: unclear whether they want execution");
    review = true;
  }

  // Scope — category
  if (OUT_OF_SCOPE_CATEGORIES.includes(f.property_category)) {
    reasons.push(`Scope: ${f.property_category} is outside our usual services, designer to decide`);
    review = true;
  } else if (f.property_category === "other" || f.property_category === "unknown") {
    reasons.push("Scope: property type unclear");
    review = true;
  }

  // Scope — commercial size
  if (COMMERCIAL.includes(f.property_category) && f.carpet_area_sqft) {
    if (f.carpet_area_sqft < COMMERCIAL_MIN_SQFT) {
      reasons.push(`Scope: ${f.carpet_area_sqft} sq ft is below the usual ${COMMERCIAL_MIN_SQFT} sq ft commercial minimum`);
      review = true;
    } else if (f.carpet_area_sqft > COMMERCIAL_MAX_SQFT) {
      reasons.push(`Scope: ${f.carpet_area_sqft} sq ft is above the ~${COMMERCIAL_MAX_SQFT} sq ft commercial limit`);
      review = true;
    }
  }

  // Criterion 3 — timeline
  if (f.completion_needed_by) {
    const w = weeksUntil(f.completion_needed_by, now);
    if (w < TIMELINE_SHORT_WEEKS) {
      reasons.push(`Criterion 3: needs completion in ${w.toFixed(1)} weeks — under our ${TIMELINE_SHORT_WEEKS}-week minimum, designer to decide`);
      review = true;
    } else if (w < TIMELINE_REVIEW_WEEKS) {
      reasons.push(`Criterion 3: needs completion in ${w.toFixed(1)} weeks — tight, designer to judge`);
      review = true;
    }
  } else if (!f.timeline_flexible) {
    reasons.push("Criterion 3: completion date not established");
    review = true;
  }

  // Criterion 4 — budget. Asked on every call, recorded for the CRM, NEVER changes the tier.
  // If it looks low against pricing.md, the designer gets a private note; nothing is said to the caller.
  if (f.budget_inr?.max) {
    const floor = lowestPlausibleCost(f);
    if (floor && f.budget_inr.max / floor < BUDGET_LOW_NOTE) {
      notes.push("Stated budget looks low for the described scope — discuss at consultation");
    }
  } else {
    notes.push(`Budget not given${f.budget_text ? ` ("${f.budget_text}")` : ""}`);
  }

  // Criterion 5 — decision-maker (unclear = qualified, with a note)
  if (f.decision_maker === "unclear") notes.push("Decision-maker not confirmed on the call");
  if (f.decision_maker === "no") {
    reasons.push("Criterion 5: caller is researching, not authorised to proceed");
    review = true;
  }

  if (f.structural_changes_requested) notes.push("Caller mentioned structural changes — we don't move walls");

  if (review) return { tier: "REVIEW", reasons, notes, say: LINES.review };
  return { tier: "BOOK", reasons: ["Passes all five criteria"], notes, say: LINES.book };
}
