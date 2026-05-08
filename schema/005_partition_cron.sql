-- =============================================================================
-- Partition management for micro_transactions
--
-- micro_transactions is partitioned by RANGE(created_at). Without a monthly
-- maintenance job, Postgres will reject any INSERT whose created_at falls
-- outside an existing partition with:
--   "no partition of relation found for row"
--
-- OPTION A — pg_cron (recommended if your Supabase plan includes it):
--   Enable via: CREATE EXTENSION IF NOT EXISTS pg_cron;
--   Then schedule the job below.
--
-- OPTION B — call create_next_month_partition() manually or from an
--   external cron (GitHub Actions, Fly.io, etc.) on the 25th of each month.
-- =============================================================================

-- Creates a partition for the calendar month that follows the current date.
-- Idempotent: safe to run multiple times (IF NOT EXISTS).
CREATE OR REPLACE FUNCTION create_next_month_partition()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    next_month_start DATE;
    next_month_end   DATE;
    partition_name   TEXT;
BEGIN
    next_month_start := DATE_TRUNC('month', NOW() + INTERVAL '1 month')::DATE;
    next_month_end   := (next_month_start + INTERVAL '1 month')::DATE;
    partition_name   := 'micro_transactions_' || TO_CHAR(next_month_start, 'YYYY_MM');

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN   pg_namespace n ON n.oid = c.relnamespace
        WHERE  c.relname = partition_name
          AND  n.nspname = 'public'
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF micro_transactions FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            next_month_start,
            next_month_end
        );
        RETURN 'Created partition: ' || partition_name;
    END IF;

    RETURN 'Partition already exists: ' || partition_name;
END;
$$;

-- Also create the current month's partition in case this migration runs mid-month
-- and the current month isn't covered yet.
CREATE OR REPLACE FUNCTION create_current_month_partition()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    this_month_start DATE;
    this_month_end   DATE;
    partition_name   TEXT;
BEGIN
    this_month_start := DATE_TRUNC('month', NOW())::DATE;
    this_month_end   := (this_month_start + INTERVAL '1 month')::DATE;
    partition_name   := 'micro_transactions_' || TO_CHAR(this_month_start, 'YYYY_MM');

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN   pg_namespace n ON n.oid = c.relnamespace
        WHERE  c.relname = partition_name
          AND  n.nspname = 'public'
    ) THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF micro_transactions FOR VALUES FROM (%L) TO (%L)',
            partition_name,
            this_month_start,
            this_month_end
        );
        RETURN 'Created partition: ' || partition_name;
    END IF;

    RETURN 'Partition already exists: ' || partition_name;
END;
$$;

-- Run once now to ensure coverage
SELECT create_current_month_partition();
SELECT create_next_month_partition();

-- =============================================================================
-- OPTION A: schedule with pg_cron (run on the 25th of every month at 09:00 UTC)
--
-- Uncomment if pg_cron is available on your Supabase plan:
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- SELECT cron.schedule(
--     'create-next-month-partition',
--     '0 9 25 * *',
--     $$SELECT create_next_month_partition()$$
-- );
-- =============================================================================
