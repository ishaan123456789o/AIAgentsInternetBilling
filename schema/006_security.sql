-- =============================================================================
-- Security hardening
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RLS on agent_developers
-- Previously missing — authenticated users with the anon key could read any
-- developer's email, wallet balance, and company name via the REST API.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_developers ENABLE ROW LEVEL SECURITY;

-- Developers can only read and update their own row.
CREATE POLICY "developer_read_own"
    ON agent_developers FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "developer_update_own"
    ON agent_developers FOR UPDATE
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Service-role key (backend) bypasses RLS automatically — no policy needed.

-- ---------------------------------------------------------------------------
-- Index on micro_transactions.request_hash
-- The idempotency guard in bill_agent_execution does:
--   SELECT 1 FROM micro_transactions WHERE request_hash = $1 AND session_id = $2
-- Without an index this is a full sequential scan of a high-volume partitioned
-- table. This composite index makes idempotency checks fast.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mt_request_hash
    ON micro_transactions (request_hash, session_id);

-- ---------------------------------------------------------------------------
-- RLS on data_providers and api_endpoints (read-only for authenticated users)
-- Providers and endpoints are configuration data — any authenticated developer
-- can read them, but only the service role can write.
-- ---------------------------------------------------------------------------
ALTER TABLE data_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_endpoints  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_providers"
    ON data_providers FOR SELECT
    TO authenticated
    USING (is_active = TRUE);

CREATE POLICY "authenticated_read_endpoints"
    ON api_endpoints FOR SELECT
    TO authenticated
    USING (is_active = TRUE);
