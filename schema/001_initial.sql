-- =============================================================================
-- Outcome-Verified Agent Gateway — Supabase Schema
-- Optimized for high-throughput micro-logging with composite indexes and
-- time-based partitioning strategy via Range on created_at.
-- =============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- data_providers
-- The web services / APIs whose content agents are trying to access.
-- ---------------------------------------------------------------------------
CREATE TABLE data_providers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    base_url        TEXT NOT NULL UNIQUE,
    rate_per_success NUMERIC(12, 8) NOT NULL DEFAULT 0.001, -- USD per verified execution
    revenue_share   NUMERIC(5, 4)  NOT NULL DEFAULT 0.70,   -- 70% to provider
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dp_base_url ON data_providers (base_url);

-- ---------------------------------------------------------------------------
-- agent_developers
-- The companies / individuals whose agents consume the gateway.
-- ---------------------------------------------------------------------------
CREATE TABLE agent_developers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    company_name    TEXT,
    wallet_balance  NUMERIC(14, 8) NOT NULL DEFAULT 0.00,  -- prepaid credits (USD)
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_wallet_non_negative CHECK (wallet_balance >= 0)
);

CREATE INDEX idx_ad_email ON agent_developers (email);

-- ---------------------------------------------------------------------------
-- api_endpoints
-- Specific endpoints a data provider has registered + their pricing overrides.
-- ---------------------------------------------------------------------------
CREATE TABLE api_endpoints (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id         UUID NOT NULL REFERENCES data_providers (id) ON DELETE CASCADE,
    path_pattern        TEXT NOT NULL,            -- e.g. '/search*', '/article/*'
    http_method         TEXT NOT NULL DEFAULT 'GET',
    rate_override       NUMERIC(12, 8),           -- NULL = inherit from provider
    verification_mode   TEXT NOT NULL DEFAULT 'standard'  -- 'standard' | 'strict' | 'permissive'
                            CHECK (verification_mode IN ('standard', 'strict', 'permissive')),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (provider_id, path_pattern, http_method)
);

CREATE INDEX idx_ae_provider ON api_endpoints (provider_id);

-- ---------------------------------------------------------------------------
-- agent_sessions
-- One row per logical agent task / conversation thread.
-- Tracks token auth and rolling context state for loop / rot detection.
-- ---------------------------------------------------------------------------
CREATE TABLE agent_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id        UUID NOT NULL REFERENCES agent_developers (id) ON DELETE CASCADE,
    bearer_token        TEXT NOT NULL UNIQUE,    -- hashed on insert via trigger
    agent_name          TEXT,
    context_window_used INTEGER NOT NULL DEFAULT 0,
    request_count       INTEGER NOT NULL DEFAULT 0,
    failure_count       INTEGER NOT NULL DEFAULT 0,
    last_request_hash   TEXT,                    -- SHA-256 of last payload for loop detection
    loop_strike_count   INTEGER NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- bearer_token is looked up on every proxied request — must be fast
CREATE UNIQUE INDEX idx_as_bearer ON agent_sessions (bearer_token);
CREATE INDEX idx_as_developer    ON agent_sessions (developer_id);
CREATE INDEX idx_as_active       ON agent_sessions (is_active, expires_at);

-- ---------------------------------------------------------------------------
-- micro_transactions
-- Append-only ledger row per verified execution event.
-- This table will be the hottest table; keep rows narrow.
-- Partition by month via Postgres declarative partitioning if volume demands.
-- ---------------------------------------------------------------------------
CREATE TABLE micro_transactions (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    session_id      UUID NOT NULL REFERENCES agent_sessions (id),
    endpoint_id     UUID NOT NULL REFERENCES api_endpoints (id),
    developer_id    UUID NOT NULL REFERENCES agent_developers (id),
    provider_id     UUID NOT NULL REFERENCES data_providers (id),
    amount_usd      NUMERIC(12, 8) NOT NULL,
    provider_share  NUMERIC(12, 8) NOT NULL,
    platform_share  NUMERIC(12, 8) NOT NULL,
    verification_score  NUMERIC(5, 4) NOT NULL,  -- 0.0–1.0 confidence
    request_hash    TEXT NOT NULL,               -- dedup fingerprint
    response_status INTEGER NOT NULL,
    latency_ms      INTEGER NOT NULL,
    proof_metadata  JSONB,                       -- optional: scores, flags, model version
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)                 -- partition key must be part of PK
) PARTITION BY RANGE (created_at);

-- Seed the first two partitions (extend monthly via migration or cron)
CREATE TABLE micro_transactions_2026_05
    PARTITION OF micro_transactions
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE micro_transactions_2026_06
    PARTITION OF micro_transactions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Composite index: developer spend queries are the most common dashboard read
CREATE INDEX idx_mt_developer_time ON micro_transactions (developer_id, created_at DESC);
CREATE INDEX idx_mt_session        ON micro_transactions (session_id, created_at DESC);
CREATE INDEX idx_mt_provider_time  ON micro_transactions (provider_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Triggers: keep updated_at fresh on mutable tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dp_updated_at  BEFORE UPDATE ON data_providers   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_ad_updated_at  BEFORE UPDATE ON agent_developers  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_as_updated_at  BEFORE UPDATE ON agent_sessions    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security (Supabase) — developers can only read their own data
-- ---------------------------------------------------------------------------
ALTER TABLE agent_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_transactions ENABLE ROW LEVEL SECURITY;

-- Service-role (backend) bypasses RLS. Anon/authenticated roles are scoped.
CREATE POLICY "developer_own_sessions"
    ON agent_sessions FOR SELECT
    USING (developer_id = auth.uid());

CREATE POLICY "developer_own_transactions"
    ON micro_transactions FOR SELECT
    USING (developer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Seed: one demo data provider so the gateway starts with valid config
-- ---------------------------------------------------------------------------
INSERT INTO data_providers (name, base_url, rate_per_success, revenue_share)
VALUES ('Demo Provider', 'https://httpbin.org', 0.0005, 0.70);
