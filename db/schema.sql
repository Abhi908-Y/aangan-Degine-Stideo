-- Aangan Studio phone enquiry system: Neon (Postgres) schema

CREATE TABLE IF NOT EXISTS designers (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  telegram_chat_id TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- Mock calendar until Cal.com is connected. One row per bookable 30-min slot.
CREATE TABLE IF NOT EXISTS designer_slots (
  id          SERIAL PRIMARY KEY,
  designer_id INT NOT NULL REFERENCES designers(id),
  starts_at   TIMESTAMPTZ NOT NULL,
  booked      BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (designer_id, starts_at)
);

-- One row per enquiry (a caller can have several calls about the same lead)
CREATE TABLE IF NOT EXISTS leads (
  id                SERIAL PRIMARY KEY,
  phone             TEXT NOT NULL,
  name              TEXT,
  tier              TEXT NOT NULL CHECK (tier IN ('BOOK','REVIEW','DECLINE_FACTUAL','DECLINE_SENSITIVE','ESCALATE')),
  status            TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','booked','declined','decline_message_sent','escalated','closed')),
  reasons           JSONB NOT NULL DEFAULT '[]',   -- why this tier (shown on dashboard, never to caller)
  notes             JSONB NOT NULL DEFAULT '[]',   -- uncertainties for the designer (rubric criteria 4 and 5)
  fields            JSONB NOT NULL DEFAULT '{}',   -- extracted answers
  summary           TEXT,
  designer_id       INT REFERENCES designers(id),
  review_due_at     TIMESTAMPTZ,                   -- deadline for REVIEW leads
  hubspot_deal_id   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_designer_idx ON leads (designer_id, status);

CREATE TABLE IF NOT EXISTS calls (
  id              SERIAL PRIMARY KEY,
  vaani_call_id   TEXT UNIQUE,
  phone           TEXT NOT NULL,
  lead_id         INT REFERENCES leads(id),
  started_at      TIMESTAMPTZ,
  duration_sec    INT,
  after_hours     BOOLEAN,
  transcript      TEXT,
  summary         TEXT,
  cost_inr        NUMERIC(10,2),
  cost_estimated  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id          SERIAL PRIMARY KEY,
  lead_id     INT NOT NULL REFERENCES leads(id),
  designer_id INT NOT NULL REFERENCES designers(id),
  slot_id     INT NOT NULL REFERENCES designer_slots(id),
  starts_at   TIMESTAMPTZ NOT NULL,
  booked_by   TEXT NOT NULL,           -- 'voice_agent' or designer name
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit trail: who did what. Feeds HubSpot sync and keeps the shared dashboard trustworthy.
CREATE TABLE IF NOT EXISTS actions (
  id          SERIAL PRIMARY KEY,
  lead_id     INT REFERENCES leads(id),
  actor       TEXT NOT NULL,           -- 'system', 'voice_agent', or designer name
  action      TEXT NOT NULL,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cal.com (Oct 2026). A designer with an event type id books through Cal.com, which sends the
-- calendar invite to the designer and the customer. Safe to re-run.
ALTER TABLE designers ADD COLUMN IF NOT EXISTS calcom_event_type_id INT;
ALTER TABLE bookings  ADD COLUMN IF NOT EXISTS calcom_booking_uid TEXT;
