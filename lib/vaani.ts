// Everything Vaani-specific is isolated here.
// Webhook events (docs.vaanivoice.ai/guides/webhook-setup): call_started carries the caller's
// phone_number; call_postprocessing (after the call) carries transcript, summary, entities and
// call_duration in MILLISECONDS under `data`. call_ended's call_duration is in seconds.

/** Tool calls: return the arguments object the agent passed to our tool. */
export function toolArgs(body: any): any {
  // TEMPORARY (testing phase): log Vaani's raw tool payload to learn its exact shape. Remove before go-live.
  console.log("[vaani tool payload]", JSON.stringify(body).slice(0, 2000));
  return body?.arguments ?? body?.args ?? body?.parameters ?? body?.input ?? body;
}

export interface EndOfCall {
  callId: string; phone?: string; startedAt?: string; durationSec?: number;
  transcript?: string; summary?: string; costInr?: number; entities?: Record<string, unknown>;
}

export type VaaniEvent =
  | { kind: "started"; callId: string; phone?: string }
  | { kind: "ended"; callId: string; durationSec?: number }
  | { kind: "report"; call: EndOfCall }
  | { kind: "ignored"; event: string };

const str = (v: unknown) => (v == null || v === "" ? undefined : String(v));

/** Map whatever Vaani (or our simulator) sends into one of our event shapes. */
export function parseVaaniEvent(body: any): VaaniEvent {
  const event = String(body?.event ?? "");
  const c = body?.data ?? body?.call ?? body;
  const callId = String(c?.call_id ?? body?.call_id ?? c?.room_name ?? body?.room_name ?? c?.id ?? crypto.randomUUID());

  if (event === "call_started") return { kind: "started", callId, phone: str(body?.phone_number ?? c?.phone_number) };
  if (event === "call_ended") return { kind: "ended", callId, durationSec: Number(c?.call_duration) || undefined };
  if (event && event !== "call_postprocessing") return { kind: "ignored", event };

  // call_postprocessing (Vaani) or no event at all (simulator / other providers).
  const ms = event === "call_postprocessing";
  const rawDuration = Number(c?.call_duration ?? c?.duration_sec ?? c?.duration ?? c?.durationSeconds ?? 0);
  return {
    kind: "report",
    call: {
      callId,
      phone: str(c?.phone_number ?? c?.from ?? c?.caller_number ?? c?.customer?.number ?? c?.phone),
      startedAt: c?.started_at ?? c?.startedAt ?? c?.start_time,
      durationSec: rawDuration ? Math.round(ms ? rawDuration / 1000 : rawDuration) : undefined,
      transcript: typeof (c?.transcript ?? c?.transcription) === "string" ? (c.transcript ?? c.transcription) : JSON.stringify(c?.transcript ?? ""),
      summary: c?.summary ?? c?.analysis?.summary,
      costInr: c?.cost_inr ?? c?.cost ?? undefined,
      entities: c?.entities ?? c?.entity,
    },
  };
}
