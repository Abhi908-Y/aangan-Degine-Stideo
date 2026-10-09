// Push this repo's agent setup to Vaani:  npm run vaani:sync
// - system prompt  ← prompts/voice-agent.md (below the --- line)
// - custom tools   ← switched off (Vaani doesn't forward their arguments; kept for later)
// - memories       ← remember previous calls (repeat callers)
// - extraction     ← VAANI_DATA_POINTS from lib/leads.ts (the webhook builds the lead from these)
// Needs VAANI_API_KEY (env or .env.secrets.local) and VAANI_AGENT_ID (default: the Aangan agent).
import { readFileSync, existsSync } from "node:fs";
import { VAANI_DATA_POINTS } from "../lib/leads";

if (existsSync(".env.secrets.local")) {
  for (const line of readFileSync(".env.secrets.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const KEY = process.env.VAANI_API_KEY;
const AGENT = process.env.VAANI_AGENT_ID ?? "bf90fa75-d80d-4e41-99ec-2cc29c045296";
if (!KEY) { console.error("VAANI_API_KEY not set"); process.exit(1); }
const API = `https://api.vaanivoice.ai/api/agent/${AGENT}`;
const headers = { "X-API-Key": KEY, "Content-Type": "application/json" };

async function call(method: string, url: string, body?: unknown) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const md = readFileSync("prompts/voice-agent.md", "utf8");
  const prompt = md.split(/\n---\n/).slice(1).join("\n---\n").trim();
  if (/[{}]/.test(prompt)) throw new Error("Prompt contains { } — Vaani treats those as variables.");

  const agent = await call("GET", API);
  const p = agent.persona ?? agent.config?.persona;

  await call("PATCH", `${API}/persona`, {
    identity: { system_prompt: prompt },
    actions: {
      agent_id: p.actions.agent_id, agent_name: p.actions.agent_name,
      functions: p.actions.functions.map((f: any) => ({ ...f, agent_config: { ...f.agent_config, is_enabled: false } })),
    },
    memories: { ...p.memories, use_previous_call_contexts: true },
  });
  await call("PATCH", `${API}/analysis`, {
    extraction: {
      data_collection: {
        enabled: true,
        data_points: VAANI_DATA_POINTS.map((d) => ({ name: d.name, prompt: d.prompt, ...(d.values ? { values: d.values } : {}), nullable: true })),
      },
    },
  });

  const after = await call("GET", API);
  const ap = after.persona ?? after.config?.persona, an = after.analysis ?? after.config?.analysis;
  console.log("Vaani agent", AGENT);
  console.log("  prompt synced:     ", ap.identity.system_prompt === prompt, `(${prompt.length} chars)`);
  console.log("  custom tools on:   ", ap.actions.functions.filter((f: any) => f.agent_config?.is_enabled).length);
  console.log("  remember callers:  ", ap.memories.use_previous_call_contexts);
  console.log("  extraction fields: ", an.extraction.data_collection.enabled ? an.extraction.data_collection.data_points.length : "off");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
