// Messages to the CALLER (booking confirmation, auto-decline). The channel is not decided yet:
// plug in your SMS provider here (e.g. the one your Vaani number runs on). Until then this
// logs, so the rest of the flow — and the audit trail — works end to end.
export async function messageCaller(phone: string, text: string): Promise<{ sent: boolean }> {
  console.log(`[caller message → ${phone}] ${text}`);
  return { sent: false };
}

export const AUTO_DECLINE_TEXT =
  "Thank you for reaching out to Aangan Studio. After reviewing your request, we're not the right fit for this project right now — but please do get in touch if your plans change.";
