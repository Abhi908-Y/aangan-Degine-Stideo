# Aangan Studio — phone enquiry system (v1)

Every call to the studio gets answered within seconds, day or night. Good-fit callers leave with a
consultation booked on a designer's calendar; everyone else gets an honest next step. Designers get a
Telegram alert with the full context, the shared dashboard shows every lead and what the line costs,
and HubSpot holds the sales pipeline.

**Stack:** Vaani (voice) → Next.js API on Vercel → Neon (Postgres) → Telegram, HubSpot. Code on GitHub.

## How a call flows

1. A call comes in after hours or goes unanswered → Vaani picks up with the prompt in `prompts/voice-agent.md`.
2. The agent calls **`lookup_caller`**, so repeat callers aren't asked twice.
3. The agent asks the questions (never budget), then calls **`classify`**. `lib/rules.ts` decides the tier from
   Nikhil's five criteria — the AI gathers the answers, the rules decide:

| Tier | Caller hears | What happens |
|---|---|---|
| `BOOK` | Slots offered → **`book`** | Slot claimed, designer alerted on Telegram, HubSpot deal created |
| `REVIEW` | "A designer will review… and connect with you" | Assigned designer, 24h deadline, Telegram alert, HubSpot deal |
| `DECLINE_FACTUAL` | Honest reason (area, service type, advice-only, timeline too short) | Logged as declined |
| `DECLINE_SENSITIVE` | "We'll get back to you" (budget / size — reason never said) | Polite decline message sent ~20h later by the cron |
| `ESCALATE` | Senior callback within 15 minutes | Nikhil alerted on Telegram immediately |

4. Vaani sends the end-of-call report to **`/api/vaani/webhook`**: transcript, summary and cost are stored.
   A qualified caller who hung up before booking becomes a review lead with a 4-hour callback deadline.
5. **`/api/cron/sweep`** runs hourly (cron-job.org calls it with `Authorization: Bearer $CRON_SECRET`; `vercel.json`
   adds a daily fallback, since Vercel Hobby only allows daily crons): sends auto-decline messages and nudges overdue reviews.

## Setup

1. **GitHub:** push this folder to a new repo.
2. **Neon:** create a project, copy the connection string, then run `npm run db:setup` (reads `DATABASE_URL` from your shell or from `.env.local` after `vercel env pull`)
   (creates tables + 14 placeholder designers + a mock calendar for the next 14 days).
3. **Vercel:** import the repo, add every variable from `.env.example`, plus `NEXT_PUBLIC_BASE_URL`
   (your Vercel URL). Deploy.
4. **Telegram:** create a bot with @BotFather; each designer messages the bot once; put their chat ids in
   `designers.telegram_chat_id`, and Nikhil's in `TELEGRAM_FOUNDER_CHAT_ID`.
5. **HubSpot:** create a private app with contacts + deals write scopes; set `HUBSPOT_TOKEN`. Check the deal
   stage ids in your pipeline match the `HUBSPOT_STAGE_*` values.
6. **Vaani:** paste `prompts/voice-agent.md` as the system prompt, create the three tools in
   `prompts/tools.json`, point the end-of-call webhook at `/api/vaani/webhook`, and add the
   `x-aangan-secret` header everywhere.
7. Test with Vaani's web/test call first, then connect the phone number (forward the studio line to Vaani when unanswered or after hours).

## Check before going live

- **Vaani payload shapes.** `lib/vaani.ts` is the only Vaani-specific file. Make one test call, look at the
  request bodies in the Vercel logs, and adjust `toolArgs` / `normalizeEndOfCall` if field names differ.
  Also check what currency Vaani reports cost in — the dashboard assumes INR.
- **Caller messages.** `lib/messaging.ts` only logs for now. Plug in the SMS provider your number runs on,
  otherwise booking confirmations and auto-decline messages won't reach callers.
- **Calendars.** Bookings use the mock `designer_slots` table. Swap `lib/assign.ts` to Cal.com when designers' calendars are connected.
- **Thresholds** in `lib/rules.ts` (6/10-week timeline bands, 500 sq ft commercial minimum, 50% budget test)
  are proposals — confirm them with Nikhil. Areas not on the service list (e.g. Kharadi, Nanded City) go to review.

## Tests

`npm test` runs the rules against 19 of the 20 phone transcripts from September (T08 was a missed call
with no conversation). All 19 are classified as expected.
