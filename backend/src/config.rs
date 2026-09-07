use std::env;

pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub osrm_url: String,
    pub traffic_refresh_seconds: u64,
    pub cors_origin: String,
    pub route_cache_ttl_seconds: u64,
    pub vehicle_ingest_token: Option<String>,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Config {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgresql://postgres:postgres@localhost/navigation_app".to_string()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-secret-key-change-in-production".to_string()),
            osrm_url: env::var("OSRM_URL")
                .or_else(|_| env::var("ROUTING_URL"))
                .unwrap_or_else(|_| "https://router.project-osrm.org".to_string()),
            traffic_refresh_seconds: env::var("TRAFFIC_REFRESH_SECONDS")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(30),
            cors_origin: env::var("CORS_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            route_cache_ttl_seconds: env::var("ROUTE_CACHE_TTL_SECONDS")
                .ok().and_then(|v| v.parse().ok()).unwrap_or(30),
            vehicle_ingest_token: env::var("VEHICLE_INGEST_TOKEN").ok().filter(|v| !v.trim().is_empty()),
        })
    }

    /// A fixed, deterministic config for tests — doesn't touch env vars or
    /// database_url (tests get their pool directly from #[sqlx::test], not
    /// through this config). Not cfg-gated: integration tests in `tests/`
    /// compile this crate as a normal (non-`cfg(test)`) dependency, so a
    /// `#[cfg(test)]` guard here wouldn't actually be visible to them.
    pub fn for_test() -> Self {
        Config {
            database_url: String::new(),
            jwt_secret: "test-secret-do-not-use-in-production".to_string(),
            osrm_url: "http://localhost:5000".to_string(),
            traffic_refresh_seconds: 30,
            cors_origin: "http://localhost:3000".to_string(),
            route_cache_ttl_seconds: 1,
            vehicle_ingest_token: Some("test-vehicle-token".to_string()),
        }
    }
}

