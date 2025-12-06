-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Parking Spaces Table
CREATE TABLE parking_spaces (
    id VARCHAR(255) PRIMARY KEY,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT true,
    occupied_by VARCHAR(255),
    occupied_at TIMESTAMP WITH TIME ZONE,
    photo_url TEXT,
    pending BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create spatial index for parking spaces
CREATE INDEX idx_parking_spaces_location ON parking_spaces USING GIST (location);
CREATE INDEX idx_parking_spaces_available ON parking_spaces (is_available, pending) WHERE is_available = true;

-- Reports Table
CREATE TABLE reports (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(50) NOT NULL CHECK (type IN ('cop', 'hazard', 'construction', 'accident', 'traffic_jam', 'closed_lane')),
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    photo_url TEXT,
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reporter_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create spatial index for reports
CREATE INDEX idx_reports_location ON reports USING GIST (location);
CREATE INDEX idx_reports_expires ON reports (expires_at) WHERE expires_at > NOW();

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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create spatial index for billboards
CREATE INDEX idx_billboards_location ON billboards USING GIST (location);
CREATE INDEX idx_billboards_purchased ON billboards (is_purchased, display_end);

-- Function to clean up expired parking reservations
CREATE OR REPLACE FUNCTION cleanup_expired_parking()
RETURNS void AS $$
BEGIN
    UPDATE parking_spaces
    SET is_available = true,
        pending = false,
        occupied_by = NULL,
        occupied_at = NULL,
        photo_url = NULL
    WHERE (occupied_at < NOW() - INTERVAL '15 minutes' OR occupied_at IS NULL)
    AND is_available = false;
END;
$$ LANGUAGE plpgsql;

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
        display_end = NULL
    WHERE display_end < NOW()
    AND is_purchased = true;
END;
$$ LANGUAGE plpgsql;

-- Insert some sample parking spaces (San Francisco area)
INSERT INTO parking_spaces (id, location, is_available) VALUES
    ('park1', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326), true),
    ('park2', ST_SetSRID(ST_MakePoint(-122.4094, 37.7849), 4326), true),
    ('park3', ST_SetSRID(ST_MakePoint(-122.4294, 37.7649), 4326), true);

-- Insert some sample billboards
INSERT INTO billboards (id, location) VALUES
    ('bill1', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)),
    ('bill2', ST_SetSRID(ST_MakePoint(-122.4094, 37.7849), 4326)),
    ('bill3', ST_SetSRID(ST_MakePoint(-122.4294, 37.7649), 4326));

