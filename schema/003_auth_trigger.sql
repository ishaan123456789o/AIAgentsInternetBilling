-- =============================================================================
-- Auth → Developer account sync
--
-- When a user signs up via Supabase Auth, automatically create their
-- agent_developers row using the same UUID. This makes auth.uid() = developer_id
-- throughout the entire system, so RLS policies work without any join.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.agent_developers (id, email, company_name, wallet_balance)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'company_name', NULL),
        0.00
    )
    ON CONFLICT (id) DO NOTHING;   -- idempotent: re-running the migration is safe
    RETURN NEW;
END;
$$;

-- Fire after every new user in auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- Seed wallet function — used by the simulation script and manual top-ups
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_wallet_credits(
    p_developer_id UUID,
    p_amount       NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE agent_developers
    SET    wallet_balance = wallet_balance + p_amount,
           updated_at     = NOW()
    WHERE  id             = p_developer_id;
END;
$$;
