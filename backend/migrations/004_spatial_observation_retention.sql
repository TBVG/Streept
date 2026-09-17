-- Alpha 175: bounded spatial-memory retention.
-- The product only exposes a 30-day learning window, while the ledger keeps a
-- larger safety margin for late syncs and diagnostics. This index makes the
-- scheduled purge inexpensive as the dataset grows.
CREATE INDEX IF NOT EXISTS idx_spatial_observations_observed_at ON spatial_observations(observed_at DESC);

CREATE OR REPLACE FUNCTION purge_old_spatial_observations(retention_days integer DEFAULT 90)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE deleted_count bigint;
BEGIN
  retention_days := GREATEST(30, LEAST(retention_days, 180));
  DELETE FROM spatial_observations
  WHERE observed_at < NOW() - make_interval(days => retention_days);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
