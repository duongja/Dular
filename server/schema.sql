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

ALTER TABLE users ADD COLUMN IF NOT EXISTS ckb_lock_arg TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ckb_sponsored_at TIMESTAMPTZ;

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

CREATE TABLE IF NOT EXISTS receive_route_reservations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  requested_amount_base_units NUMERIC(32, 0) NOT NULL CHECK (requested_amount_base_units > 0),
  reserved_at TIMESTAMPTZ,
  attempted_at TIMESTAMPTZ,
  channel_id TEXT,
  channel_outpoint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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

CREATE TABLE IF NOT EXISTS ramp_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('deposit', 'withdrawal')),
  kes_amount NUMERIC(14, 0) NOT NULL CHECK (kes_amount > 0),
  rate_kes_per_rusd_micros NUMERIC(32, 0) NOT NULL CHECK (rate_kes_per_rusd_micros > 0),
  gross_rusd_base_units NUMERIC(32, 0) NOT NULL CHECK (gross_rusd_base_units > 0),
  fee_rusd_base_units NUMERIC(32, 0) NOT NULL CHECK (fee_rusd_base_units >= 0),
  rusd_amount_base_units NUMERIC(32, 0) NOT NULL CHECK (rusd_amount_base_units > 0),
  fee_bps INTEGER NOT NULL CHECK (fee_bps >= 0 AND fee_bps <= 10000),
  rate_source TEXT NOT NULL,
  quoted_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ramp_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL UNIQUE REFERENCES ramp_quotes(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdrawal')),
  phone TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  kes_amount NUMERIC(14, 0) NOT NULL CHECK (kes_amount > 0),
  rate_kes_per_rusd_micros NUMERIC(32, 0) NOT NULL CHECK (rate_kes_per_rusd_micros > 0),
  gross_rusd_base_units NUMERIC(32, 0) NOT NULL CHECK (gross_rusd_base_units > 0),
  fee_rusd_base_units NUMERIC(32, 0) NOT NULL CHECK (fee_rusd_base_units >= 0),
  rusd_amount_base_units NUMERIC(32, 0) NOT NULL CHECK (rusd_amount_base_units > 0),
  fee_bps INTEGER NOT NULL,
  rate_source TEXT NOT NULL,
  quoted_at TIMESTAMPTZ NOT NULL,
  quote_expires_at TIMESTAMPTZ NOT NULL,
  browser_pubkey TEXT NOT NULL,
  browser_invoice TEXT,
  operator_invoice TEXT,
  invoice_payment_hash TEXT UNIQUE,
  invoice_expires_at TIMESTAMPTZ,
  fiber_payment_hash TEXT,
  fiber_status TEXT,
  fiber_fee_base_units NUMERIC(32, 0),
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  conversation_id TEXT UNIQUE,
  originator_conversation_id TEXT UNIQUE,
  receipt_number TEXT,
  failure_code TEXT,
  failure_message TEXT,
  refund_invoice TEXT,
  refund_payment_hash TEXT,
  refund_invoice_expires_at TIMESTAMPTZ,
  refund_lease_token UUID,
  route_funding_reserved_at TIMESTAMPTZ,
  route_funding_attempted_at TIMESTAMPTZ,
  route_channel_id TEXT,
  route_channel_outpoint TEXT,
  provider_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  mpesa_confirmed_at TIMESTAMPTZ,
  rusd_received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, idempotency_key)
);

CREATE TABLE IF NOT EXISTS ramp_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES ramp_orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mpesa_callbacks ADD COLUMN IF NOT EXISTS ramp_order_id UUID REFERENCES ramp_orders(id) ON DELETE SET NULL;
ALTER TABLE mpesa_callbacks ADD COLUMN IF NOT EXISTS payload_hash TEXT;
ALTER TABLE ramp_orders ADD COLUMN IF NOT EXISTS refund_lease_token UUID;
ALTER TABLE ramp_orders ADD COLUMN IF NOT EXISTS refund_invoice_expires_at TIMESTAMPTZ;
ALTER TABLE ramp_orders ADD COLUMN IF NOT EXISTS route_funding_reserved_at TIMESTAMPTZ;
ALTER TABLE ramp_orders ADD COLUMN IF NOT EXISTS route_funding_attempted_at TIMESTAMPTZ;
ALTER TABLE ramp_orders ADD COLUMN IF NOT EXISTS route_channel_id TEXT;
ALTER TABLE ramp_orders ADD COLUMN IF NOT EXISTS route_channel_outpoint TEXT;

CREATE TABLE IF NOT EXISTS ussd_sessions (
  session_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  service_code TEXT,
  network_code TEXT,
  latest_text TEXT NOT NULL DEFAULT '',
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ussd_pins (
  phone TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ussd_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  service_code TEXT,
  network_code TEXT,
  input_text TEXT NOT NULL DEFAULT '',
  response_prefix TEXT NOT NULL CHECK (response_prefix IN ('CON', 'END')),
  response_body TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ckb_lock_arg ON users(ckb_lock_arg) WHERE ckb_lock_arg IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_fiber_pubkey ON users(fiber_pubkey) WHERE ckb_lock_arg IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_requests(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_user_created ON mpesa_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_created ON mpesa_callbacks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mpesa_callbacks_conversation ON mpesa_callbacks(conversation_id, originator_conversation_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpesa_callbacks_payload_hash ON mpesa_callbacks(kind, payload_hash) WHERE payload_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ramp_quotes_user_created ON ramp_quotes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ramp_orders_user_created ON ramp_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ramp_orders_status_updated ON ramp_orders(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ramp_order_events_order_created ON ramp_order_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ussd_sessions_phone_updated ON ussd_sessions(phone, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ussd_logs_session_created ON ussd_logs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ussd_logs_phone_created ON ussd_logs(phone, created_at DESC);
