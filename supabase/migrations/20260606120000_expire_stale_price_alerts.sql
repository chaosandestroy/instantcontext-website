-- =============================================================================
-- Migration: 30-day TTL expiry for active price alerts
--
-- Complements expire_zombie_price_alerts() (health-based) with a simple
-- created_at age cutoff. Does not touch RLS or auth policies.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.expire_stale_price_alerts(
  p_max_age INTERVAL DEFAULT INTERVAL '30 days'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired INTEGER := 0;
BEGIN
  UPDATE public.price_alerts a
  SET
    status = 'expired',
    updated_at = now()
  WHERE a.status = 'active'
    AND a.created_at < now() - p_max_age;

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_expired;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_price_alerts(INTERVAL) FROM PUBLIC;

-- Schedule daily cleanup when pg_cron is available (Supabase hosted).
DO $$
DECLARE
  has_pg_cron BOOLEAN;
  v_jobid BIGINT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron'
  ) INTO has_pg_cron;

  IF has_pg_cron THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    v_jobid := NULL;
    SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'price-alerts-expire-stale' LIMIT 1;
    IF v_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_jobid);
    END IF;
    PERFORM cron.schedule(
      'price-alerts-expire-stale',
      '15 3 * * *',
      'SELECT public.expire_stale_price_alerts();'
    );
  END IF;
END;
$$;
