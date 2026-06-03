CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL UNIQUE,
  display_name TEXT,
  fiber_pubkey TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_base_units NUMERIC(32, 0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount_base_units NUMERIC(32, 0) NOT NULL CHECK (amount_base_units > 0),
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, direction, user_id)
);

CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  phone TEXT NOT NULL,
  kes_amount NUMERIC(14, 2) NOT NULL CHECK (kes_amount > 0),
  rusd_base_units NUMERIC(32, 0) NOT NULL CHECK (rusd_base_units > 0),
  status TEXT NOT NULL,
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  conversation_id TEXT UNIQUE,
  originator_conversation_id TEXT UNIQUE,
  receipt_number TEXT,
  fiber_invoice TEXT,
  fiber_payment_hash TEXT,
  fiber_status TEXT,
  fiber_fee_base_units NUMERIC(32, 0),
  fiber_route JSONB NOT NULL DEFAULT '[]'::jsonb,
  credited_at TIMESTAMPTZ,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fiber_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payment_hash TEXT UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
  amount_base_units NUMERIC(32, 0) NOT NULL,
  fee_base_units NUMERIC(32, 0) NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  route JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_type TEXT,
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mpesa_callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  conversation_id TEXT,
  originator_conversation_id TEXT,
  result_code TEXT,
  receipt_number TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS fiber_invoice TEXT;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS fiber_payment_hash TEXT;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS fiber_status TEXT;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS fiber_fee_base_units NUMERIC(32, 0);
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS fiber_route JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE mpesa_transactions ADD COLUMN IF NOT EXISTS credited_at TIMESTAMPTZ;

ALTER TABLE fiber_payments ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE fiber_payments ADD COLUMN IF NOT EXISTS source_id TEXT;

ALTER TABLE mpesa_callbacks ADD COLUMN IF NOT EXISTS originator_conversation_id TEXT;
ALTER TABLE mpesa_callbacks ADD COLUMN IF NOT EXISTS result_code TEXT;
ALTER TABLE mpesa_callbacks ADD COLUMN IF NOT EXISTS receipt_number TEXT;

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_requests(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_user_created ON mpesa_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_created ON mpesa_callbacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_conversation ON mpesa_callbacks(conversation_id, originator_conversation_id);
