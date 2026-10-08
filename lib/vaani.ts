// Vaani's tool-call and end-of-call payload shapes depend on which Vaani product and how the
// tools are configured. Everything Vaani-specific is isolated here — adjust these two
// functions once you see a real payload in the Vercel logs; nothing else needs to change.

/** Tool calls: return the arguments object the agent passed to our tool. */
export function toolArgs(body: any): any {
  return body?.arguments ?? body?.args ?? body?.parameters ?? body?.input ?? body;
}

export interface EndOfCall {
  callId: string; phone: string; startedAt?: string; durationSec?: number;
  transcript?: string; summary?: string; costInr?: number;
}

/** End-of-call webhook: map whatever Vaani sends into our shape. */
export function normalizeEndOfCall(body: any): EndOfCall {
  const c = body?.call ?? body?.data ?? body;
  return {
    callId: String(c?.call_id ?? c?.id ?? c?.callId ?? crypto.randomUUID()),
    phone: String(c?.from ?? c?.caller_number ?? c?.customer?.number ?? c?.phone ?? "unknown"),
    startedAt: c?.started_at ?? c?.startedAt ?? c?.start_time,
    durationSec: Number(c?.duration_sec ?? c?.duration ?? c?.durationSeconds ?? 0) || undefined,
    transcript: typeof c?.transcript === "string" ? c.transcript : JSON.stringify(c?.transcript ?? ""),
    summary: c?.summary ?? c?.analysis?.summary,
    costInr: c?.cost_inr ?? c?.cost ?? undefined,
  };
}
