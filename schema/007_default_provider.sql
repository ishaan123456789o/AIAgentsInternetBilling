-- =============================================================================
-- Platform Default Provider
--
-- Without registered providers, _resolve_endpoint returns NULL and every
-- gateway request is proxied for free. This migration seeds a catch-all
-- provider that bills any URL at a platform-level default rate.
--
-- Billing resolution order (in ledger.py):
--   1. Exact base_url match → specific provider rate
--   2. No match            → Platform Default rate (this seed)
--
-- Set PLATFORM_DEFAULT_RATE in verification config to override $0.001/req.
-- Revenue share = 0.0 means 100% of each charge goes to the platform
-- (no external provider to share with).
-- =============================================================================

INSERT INTO data_providers (
    id,
    name,
    base_url,
    rate_per_success,
    revenue_share,
    is_active
) VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Platform Default',
    '',        -- empty base_url = wildcard sentinel
    0.00100000, -- $0.001 per verified execution (override via config)
    0.00000000, -- 100% platform share
    TRUE
) ON CONFLICT (id) DO NOTHING;

-- One wildcard endpoint per HTTP method.
-- path_pattern = '*' matches all paths via fnmatch in ledger.py.
INSERT INTO api_endpoints (id, provider_id, path_pattern, http_method, verification_mode, is_active)
VALUES
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '*', 'GET',    'standard', TRUE),
    ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', '*', 'POST',   'standard', TRUE),
    ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', '*', 'PUT',    'standard', TRUE),
    ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', '*', 'DELETE', 'standard', TRUE),
    ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', '*', 'PATCH',  'standard', TRUE)
ON CONFLICT (id) DO NOTHING;
