-- =============================================================================
-- Atomic billing function
-- Called by the Verification Engine after Proof-of-Execution == True.
-- Runs in a single transaction: debit wallet + insert ledger row.
-- Idempotent on request_hash — safe to retry without double-charging.
-- =============================================================================

CREATE OR REPLACE FUNCTION bill_agent_execution(
    p_session_id         UUID,
    p_endpoint_id        UUID,
    p_developer_id       UUID,
    p_provider_id        UUID,
    p_amount_usd         NUMERIC,
    p_provider_share     NUMERIC,
    p_platform_share     NUMERIC,
    p_verification_score NUMERIC,
    p_request_hash       TEXT,
    p_response_status    INTEGER,
    p_latency_ms         INTEGER,
    p_proof_metadata     JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Idempotency guard: skip if this exact request was already billed
    IF EXISTS (
        SELECT 1 FROM micro_transactions
        WHERE request_hash = p_request_hash
          AND session_id   = p_session_id
    ) THEN
        RETURN;
    END IF;

    -- Debit the developer wallet (raises exception if insufficient — rolls back)
    UPDATE agent_developers
    SET    wallet_balance = wallet_balance - p_amount_usd,
           updated_at     = NOW()
    WHERE  id             = p_developer_id
      AND  wallet_balance >= p_amount_usd;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient wallet balance for developer %', p_developer_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Append the ledger row
    INSERT INTO micro_transactions (
        session_id, endpoint_id, developer_id, provider_id,
        amount_usd, provider_share, platform_share,
        verification_score, request_hash,
        response_status, latency_ms, proof_metadata
    ) VALUES (
        p_session_id, p_endpoint_id, p_developer_id, p_provider_id,
        p_amount_usd, p_provider_share, p_platform_share,
        p_verification_score, p_request_hash,
        p_response_status, p_latency_ms, p_proof_metadata
    );
END;
$$;
