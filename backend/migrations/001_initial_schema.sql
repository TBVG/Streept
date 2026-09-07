-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users Table
CREATE TABLE users (
    id VARCHAR(255) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name VARCHAR(255),
    is_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email ON users (LOWER(email));

-- Parking Spaces Table
-- Parking lots: capacity-based, not individually reservable. Occupancy is
-- detected automatically (see parking_occupancy below and
-- handlers::checkin_parking/checkout_parking) rather than manually
-- reserved in advance — nobody can actually reserve a public parking spot
-- in real life, only report/detect that it's taken.
CREATE TABLE parking_spaces (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255),
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    total_spaces INT NOT NULL DEFAULT 1,
    occupied_spaces INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One active occupancy record per user (a person can only actually be
-- parked in one place at a time) — checking in elsewhere replaces it
-- rather than stacking. last_seen_at is updated by periodic heartbeats
-- while parked, and drives the auto-checkout sweep for anyone who leaves
-- without their client explicitly checking out (app closed, phone died).
CREATE TABLE parking_occupancy (
    user_id VARCHAR(255) PRIMARY KEY,
    lot_id VARCHAR(255) NOT NULL REFERENCES parking_spaces(id) ON DELETE CASCADE,
    checked_in_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create spatial index for parking spaces
CREATE INDEX idx_parking_spaces_location ON parking_spaces USING GIST (location);
CREATE INDEX idx_parking_occupancy_lot ON parking_occupancy (lot_id);

-- Reports Table
CREATE TABLE reports (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(50) NOT NULL CHECK (type IN ('cop', 'hazard', 'construction', 'accident', 'traffic_jam', 'closed_lane')),
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    photo_url TEXT,
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reporter_id VARCHAR(255) NOT NULL,
    confirmations INT NOT NULL DEFAULT 0,
    dismissals INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- One vote per (report, voter) — a second vote from the same voter changes
-- their existing vote rather than stacking another one. This is what makes
-- confirmations/dismissals meaningful instead of trivially brigadeable by
-- one person clicking repeatedly.
CREATE TABLE report_votes (
    report_id VARCHAR(255) NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    voter_id VARCHAR(255) NOT NULL,
    vote_type VARCHAR(10) NOT NULL CHECK (vote_type IN ('confirm', 'dismiss')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (report_id, voter_id)
);

-- Create spatial index for reports
CREATE INDEX idx_reports_location ON reports USING GIST (location);
-- PostgreSQL index predicates must be IMMUTABLE; NOW() is not.
-- Use a regular index so expiry queries remain indexable without making
-- the migration fail during container startup.
CREATE INDEX idx_reports_expires ON reports (expires_at);

-- Billboards Table
CREATE TABLE billboards (
    id VARCHAR(255) PRIMARY KEY,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    is_purchased BOOLEAN NOT NULL DEFAULT false,
    purchased_by VARCHAR(255),
    ad_image_url TEXT,
    ad_target_url TEXT,
    display_start TIMESTAMP WITH TIME ZONE,
    display_end TIMESTAMP WITH TIME ZONE,
    click_count INT NOT NULL DEFAULT 0,
    moderation_status VARCHAR(20) NOT NULL DEFAULT 'approved'
        CHECK (moderation_status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create spatial index for billboards
CREATE INDEX idx_billboards_location ON billboards USING GIST (location);
CREATE INDEX idx_billboards_purchased ON billboards (is_purchased, display_end);

-- Note: parking occupancy staleness cleanup is implemented directly in
-- Rust (handlers::sweep_stale_parking_occupancy), not as a SQL function
-- here — it also needs to broadcast a WebSocket update for each affected
-- lot, which a plain SQL function can't do. (An earlier version of this
-- migration had a redundant, never-called SQL function doing the same
-- thing in parallel — removed to avoid the same "dead SQL function"
-- pattern this project has already had to fix once before for reports and
-- billboards.)

-- Function to clean up expired reports
CREATE OR REPLACE FUNCTION cleanup_expired_reports()
RETURNS void AS $$
BEGIN
    DELETE FROM reports
    WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired billboard purchases
CREATE OR REPLACE FUNCTION cleanup_expired_billboards()
RETURNS void AS $$
BEGIN
    UPDATE billboards
    SET is_purchased = false,
        purchased_by = NULL,
        ad_image_url = NULL,
        ad_target_url = NULL,
        display_start = NULL,
        display_end = NULL,
        click_count = 0,
        moderation_status = 'approved'
    WHERE display_end < NOW()
    AND is_purchased = true;
END;
$$ LANGUAGE plpgsql;

-- Insert some sample parking spaces (San Francisco area)
INSERT INTO parking_spaces (id, name, location, total_spaces) VALUES
    ('park1', 'Market St Lot', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326), 24),
    ('park2', 'Civic Center Garage', ST_SetSRID(ST_MakePoint(-122.4094, 37.7849), 4326), 60),
    ('park3', 'Mission St Lot', ST_SetSRID(ST_MakePoint(-122.4294, 37.7649), 4326), 15);

-- Insert some sample billboards
INSERT INTO billboards (id, location) VALUES
    ('bill1', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)),
    ('bill2', ST_SetSRID(ST_MakePoint(-122.4094, 37.7849), 4326)),
    ('bill3', ST_SetSRID(ST_MakePoint(-122.4294, 37.7649), 4326));

