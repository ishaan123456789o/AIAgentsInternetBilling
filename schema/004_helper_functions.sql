-- =============================================================================
-- Helper functions referenced by application code
-- =============================================================================

-- Called by the gateway on every proxied request (fire-and-forget).
-- A single SQL UPDATE avoids the fetch-then-write race condition.
CREATE OR REPLACE FUNCTION increment_session_counter(
    p_session_id  UUID,
    p_fingerprint TEXT
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE agent_sessions
    SET    request_count     = request_count + 1,
           last_request_hash = p_fingerprint,
           updated_at        = NOW()
    WHERE  id = p_session_id;
$$;
