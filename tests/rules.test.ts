// Run: npm test
// Each case is a phone transcript from Aangan_Sep_2026_Enquiries.pdf, encoded as the
// fields the voice agent would extract. Expected tier = what the rules should decide.
import { decide, LeadFields, Tier } from "../lib/rules";

type Case = { id: string; date: string; expect: Tier; f: LeadFields };
const base = { caller_type: "new_enquiry", project_intent: "design_and_execution", decision_maker: "yes" } as const;

const cases: Case[] = [
  { id: "T01 Priya, Kothrud 3BHK, March", date: "2026-09-02", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Kothrud, Dahanukar Colony", carpet_area_sqft: 1400, bhk: 3, scope_type: "full_home", completion_needed_by: "2027-03-31" } },
  { id: "T02 Wakad 2BHK, moving in November", date: "2026-09-03", expect: "REVIEW",
    f: { ...base, property_category: "residential", location_text: "Wakad", carpet_area_sqft: 950, bhk: 2, scope_type: "full_home", completion_needed_by: "2026-11-01" } },
  { id: "T03 Nashik home office", date: "2026-09-03", expect: "DECLINE_FACTUAL",
    f: { ...base, property_category: "residential", location_text: "Nashik", scope_type: "partial", rooms_count: 2, timeline_flexible: true } },
  { id: "T04 living room ideas only", date: "2026-09-04", expect: "DECLINE_FACTUAL",
    f: { ...base, project_intent: "advice_only", property_category: "residential", location_text: "unknown", decision_maker: "yes", timeline_flexible: true } },
  { id: "T05 Aarti, Koregaon Park 4BHK, Feb", date: "2026-09-05", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Koregaon Park", carpet_area_sqft: 2400, bhk: 4, scope_type: "full_home", completion_needed_by: "2027-02-01" } },
  { id: "T06 Baner startup office 800 sq ft, Dec", date: "2026-09-05", expect: "BOOK",
    f: { ...base, property_category: "office", location_text: "Baner", carpet_area_sqft: 800, scope_type: "commercial_fitout", completion_needed_by: "2026-12-01" } },
  { id: "T07 before Diwali (3 weeks)", date: "2026-09-08", expect: "DECLINE_FACTUAL",
    f: { ...base, property_category: "residential", location_text: "Pune", scope_type: "partial", rooms_count: 2, completion_needed_by: "2026-09-29" } },
  { id: "T09 existing client complaint", date: "2026-09-10", expect: "ESCALATE",
    f: { ...base, caller_type: "existing_client", property_category: "residential", location_text: "Viman Nagar" } },
  { id: "T10 Kharadi 1BHK, ₹1–1.5L", date: "2026-09-11", expect: "DECLINE_SENSITIVE",
    f: { ...base, property_category: "residential", location_text: "Kharadi", carpet_area_sqft: 550, bhk: 1, scope_type: "partial", rooms_count: 2, timeline_flexible: true, budget_volunteered_inr: { min: 100000, max: 150000 } } },
  { id: "T11 rented Baner 2BHK", date: "2026-09-12", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Baner", bhk: 2, scope_type: "partial", rooms_count: 3, timeline_flexible: true } },
  { id: "T12 Kalyani Nagar villa 5,500 sq ft", date: "2026-09-15", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Kalyani Nagar", carpet_area_sqft: 5500, scope_type: "full_home", completion_needed_by: "2027-03-01" } },
  { id: "T13 Aundh 3BHK, pushes for price", date: "2026-09-16", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Aundh", carpet_area_sqft: 1100, bhk: 3, scope_type: "partial", rooms_count: 4, timeline_flexible: true } },
  { id: "T14 son calling for parents, Hadapsar", date: "2026-09-17", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Hadapsar", bhk: 3, scope_type: "full_home", timeline_flexible: true, decision_maker: "unclear" } },
  { id: "T15 Smita, Undri, possession in 6 weeks", date: "2026-09-18", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Undri", carpet_area_sqft: 875, bhk: 2, scope_type: "full_home", timeline_flexible: true } },
  { id: "T16 Girish, Viman Nagar (repeat caller)", date: "2026-09-19", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Viman Nagar", bhk: 3, scope_type: "full_home", timeline_flexible: true } },
  { id: "T17 Ritu, Pimple Saudagar, March", date: "2026-09-22", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Pimple Saudagar", carpet_area_sqft: 1050, bhk: 3, scope_type: "full_home", completion_needed_by: "2027-03-31" } },
  { id: "T18 coworking pod 180 sq ft", date: "2026-09-23", expect: "DECLINE_SENSITIVE",
    f: { ...base, property_category: "office", location_text: "Pune", carpet_area_sqft: 180, scope_type: "commercial_fitout", timeline_flexible: true } },
  { id: "T19 restaurant, Koregaon Park", date: "2026-09-24", expect: "DECLINE_FACTUAL",
    f: { ...base, property_category: "restaurant", location_text: "Koregaon Park", timeline_flexible: true } },
  { id: "T20 Pooja, Magarpatta 2BHK, Jan start", date: "2026-09-25", expect: "BOOK",
    f: { ...base, property_category: "residential", location_text: "Magarpatta", carpet_area_sqft: 900, bhk: 2, scope_type: "full_home", timeline_flexible: true } },
];
// T08 (missed call, no conversation) has no fields to classify — solved by the agent answering.

let failed = 0;
for (const c of cases) {
  const d = decide(c.f, new Date(c.date + "T12:00:00+05:30"));
  const ok = d.tier === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(42)} → ${d.tier}${ok ? "" : `  (expected ${c.expect})`}`);
  console.log(`      reasons: ${d.reasons.join("; ")}${d.notes.length ? ` | notes: ${d.notes.join("; ")}` : ""}`);
}
console.log(`\n${cases.length - failed}/${cases.length} transcripts classified as expected`);
if (failed) process.exit(1);
