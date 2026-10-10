// Run: npx tsx tests/leads.test.ts — Vaani's post-call extraction (strings) → LeadFields → tier.
import { entitiesToFields, normalisePhone } from "../lib/leads";
import { decide } from "../lib/rules";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };

const abhishek = entitiesToFields({
  caller_name: "Abhishek", caller_mobile: "9876543210", project_intent: "design and execution", property_category: "Residential",
  location_text: "Baner", bhk: "2", carpet_area_sqft: "1,200 sq ft", scope_type: "full home", completion_text: "in six months",
  completion_needed_by: "2027-04-10", timeline_flexible: "no", budget_text: "around 15 lakhs", budget_max_inr: "15 lakhs",
  decision_maker: "yes", caller_email: "Abhi@Gmail.com", structural_changes: "no", notes_from_call: "Owned flat",
});
check("numbers parsed", abhishek.bhk === 2 && abhishek.carpet_area_sqft === 1200 && abhishek.budget_inr?.max === 1500000, JSON.stringify({ bhk: abhishek.bhk, sqft: abhishek.carpet_area_sqft, budget: abhishek.budget_inr }));
check("enums normalised", abhishek.project_intent === "design_and_execution" && abhishek.property_category === "residential" && abhishek.scope_type === "full_home");
check("email lower-cased", (abhishek as any).email === "abhi@gmail.com");
check("Baner 2BHK in 6 months → BOOK", decide(abhishek, new Date("2026-10-10T12:00:00+05:30")).tier === "BOOK");
check("phone 9876543210 → +919876543210", normalisePhone("9876543210") === "+919876543210");
check("phone '+91 98765 43210' → +919876543210", normalisePhone("+91 98765 43210") === "+919876543210");
check("web-user is not a phone", normalisePhone("web-user") === undefined);

const meena = entitiesToFields({ caller_name: "Meena", location_text: "Talegaon", project_intent: "design_and_execution", property_category: "residential", decision_maker: "yes" });
check("Talegaon → declined", decide(meena).tier === "DECLINE_FACTUAL");

const sparse = entitiesToFields({ caller_name: "Ravi", location_text: "N/A", budget_max_inr: "null" });
check("missing values → unclear, goes to review", sparse.location_text === undefined && sparse.budget_inr === null && decide(sparse).tier === "REVIEW");

// Real Vaani call (10 Oct): "3 BHK in Baner" came back with property_category empty.
const realCall = entitiesToFields({
  caller_name: "Abhishek Yadav", caller_mobile: "8130254657", project_intent: "design_and_execution", property_category: "",
  location_text: "Baner", bhk: "3", scope_type: "full_home", completion_needed_by: "2027-03-31", budget_max_inr: "1500000", decision_maker: "yes",
});
check("3 BHK with empty type → residential → BOOK", realCall.property_category === "residential" && decide(realCall, new Date("2026-10-10T10:00:00+05:30")).tier === "BOOK");

if (failed) process.exit(1);
