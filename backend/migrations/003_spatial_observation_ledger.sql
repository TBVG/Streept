-- Privacy-conscious spatial learning ledger. Stores coarse maneuver/road outcomes
-- without raw GPS traces, photos, emails, or account identifiers.
CREATE TABLE spatial_observations (
    id VARCHAR(255) PRIMARY KEY,
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    observation_type VARCHAR(40) NOT NULL CHECK (observation_type IN (
        'maneuver_completed', 'maneuver_missed', 'hazard_observed', 'lane_misalignment'
    )),
    route_generation BIGINT NOT NULL CHECK (route_generation >= 0),
    maneuver_key VARCHAR(255),
    way_id BIGINT,
    maneuver VARCHAR(120) NOT NULL DEFAULT '',
    lane_alignment VARCHAR(16) NOT NULL CHECK (lane_alignment IN ('aligned', 'misaligned', 'unknown')),
    confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spatial_observations_way_time
    ON spatial_observations (way_id, observed_at DESC);
CREATE INDEX idx_spatial_observations_type_time
    ON spatial_observations (observation_type, observed_at DESC);
