-- Live anonymous parked-car positions.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE parking_occupancy
    ADD COLUMN IF NOT EXISTS parked_location GEOGRAPHY(POINT, 4326),
    ADD COLUMN IF NOT EXISTS public_id UUID DEFAULT gen_random_uuid();

UPDATE parking_occupancy
SET public_id = gen_random_uuid()
WHERE public_id IS NULL;

ALTER TABLE parking_occupancy
    ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_occupancy_public_id
    ON parking_occupancy (public_id);
CREATE INDEX IF NOT EXISTS idx_parking_occupancy_location
    ON parking_occupancy USING GIST (parked_location);
