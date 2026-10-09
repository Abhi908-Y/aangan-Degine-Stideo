// HubSpot = the sales pipeline. Only BOOK and REVIEW leads become deals;
// declines and escalations stay in Neon so the pipeline isn't cluttered.
const API = "https://api.hubapi.com";

async function hs(path: string, method: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HubSpot ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export async function upsertDeal(o: {
  existingDealId?: string | null; name?: string; phone: string; tier: "BOOK" | "REVIEW";
  summary?: string; designer?: string;
  budget?: { min?: number; max: number } | null; budgetText?: string; // CRM tracking only
}): Promise<string | null> {
  if (!process.env.HUBSPOT_TOKEN) { console.warn("HubSpot skipped (no token)"); return null; }
  const stage = o.tier === "BOOK" ? process.env.HUBSPOT_STAGE_BOOKED : process.env.HUBSPOT_STAGE_REVIEW;
  const props = {
    dealname: `${o.name ?? "Phone enquiry"} · ${o.phone}`,
    pipeline: process.env.HUBSPOT_PIPELINE_ID ?? "default",
    dealstage: stage,
    description: `Tier: ${o.tier}${o.designer ? ` · Designer: ${o.designer}` : ""}${o.budgetText ? ` · Budget: ${o.budgetText}` : ""}\n\n${o.summary ?? ""}`.slice(0, 5000),
    ...(o.budget?.max ? { amount: String(o.budget.max) } : {}), // stated budget (upper end) as the deal amount
  };
  if (o.existingDealId) {
    await hs(`/crm/v3/objects/deals/${o.existingDealId}`, "PATCH", { properties: props });
    return o.existingDealId;
  }
  const contact = await hs("/crm/v3/objects/contacts", "POST", {
    properties: { firstname: o.name ?? "", phone: o.phone },
  });
  const deal = await hs("/crm/v3/objects/deals", "POST", { properties: props });
  await hs(`/crm/v4/objects/deals/${deal.id}/associations/default/contacts/${contact.id}`, "PUT");
  return deal.id as string;
}

export async function setDealStage(dealId: string | null, stage: string | undefined) {
  if (!process.env.HUBSPOT_TOKEN || !dealId || !stage) return;
  await hs(`/crm/v3/objects/deals/${dealId}`, "PATCH", { properties: { dealstage: stage } });
}
