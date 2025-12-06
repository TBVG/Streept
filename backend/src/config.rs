use anyhow::Context;
use std::env;

pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub osrm_url: String,
    pub parking_heartbeat_ttl_minutes: u64,
    pub cors_origin: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Config {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost/navigation_app".to_string()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-secret-key-change-in-production".to_string()),
            osrm_url: env::var("OSRM_URL")
                .unwrap_or_else(|_| "http://localhost:5000".to_string()),
            parking_heartbeat_ttl_minutes: env::var("PARKING_HEARTBEAT_TTL_MINUTES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(15),
            cors_origin: env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        })
    }
}

