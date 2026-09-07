use axum::{
    extract::{ConnectInfo, Request},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// Simple fixed-window rate limiter, keyed by an arbitrary string (peer IP
/// in practice). Intentionally hand-rolled rather than pulling in a
/// third-party tower/axum rate-limiting crate — this project can't verify
/// a specific crate version against its exact axum/tower versions without
/// actually running `cargo build`, and a hand-rolled limiter using only std
/// primitives avoids that risk entirely.
///
/// This is in-memory and per-process: fine for a single backend instance,
/// but won't coordinate across multiple replicas behind a load balancer —
/// worth swapping for a shared store (Redis, etc.) before scaling out
/// horizontally.
struct RateLimiter {
    windows: Mutex<HashMap<String, (Instant, u32)>>,
    max_requests: u32,
    window: Duration,
}

impl RateLimiter {
    fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            windows: Mutex::new(HashMap::new()),
            max_requests,
            window,
        }
    }

    /// Returns true if this request is allowed under the limit.
    fn allow(&self, key: &str) -> bool {
        let mut windows = self.windows.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        let entry = windows.entry(key.to_string()).or_insert((now, 0));

        if now.duration_since(entry.0) > self.window {
            *entry = (now, 1);
            // Bound memory growth from one-off client addresses. Cleanup is
            // intentionally opportunistic so the limiter stays dependency-free.
            if windows.len() > 4096 {
                windows.retain(|_, (started, _)| now.duration_since(*started) <= self.window);
            }
            return true;
        }

        if entry.1 >= self.max_requests {
            return false;
        }

        entry.1 += 1;
        true
    }
}

fn too_many_requests() -> Response {
    (StatusCode::TOO_MANY_REQUESTS, "Too many requests — please slow down.").into_response()
}

/// Builds a rate-limiting middleware function for a specific limit. Each
/// call site gets its own independent limiter — apply via
/// `.route_layer(axum::middleware::from_fn(limit_report_creation))` etc.
/// (see routes.rs for the concrete instances and which routes use them).
macro_rules! rate_limit_fn {
    ($fn_name:ident, $max:expr, $window_secs:expr) => {
        pub async fn $fn_name(
            ConnectInfo(addr): ConnectInfo<SocketAddr>,
            request: Request,
            next: Next,
        ) -> Response {
            static LIMITER: OnceLock<RateLimiter> = OnceLock::new();
            let limiter = LIMITER.get_or_init(|| RateLimiter::new($max, Duration::from_secs($window_secs)));
            if limiter.allow(&addr.ip().to_string()) {
                next.run(request).await
            } else {
                too_many_requests()
            }
        }
    };
}

// Auth endpoints: strict limits to slow down credential stuffing / spam
// account creation.
rate_limit_fn!(limit_login, 10, 60); // 10 attempts/min per IP
rate_limit_fn!(limit_register, 5, 60); // 5 registrations/min per IP

// Interactive write endpoints prone to spam/abuse.
rate_limit_fn!(limit_report_creation, 10, 60); // 10 reports/min per IP
rate_limit_fn!(limit_report_vote, 30, 60); // 30 confirm/dismiss actions/min per IP
rate_limit_fn!(limit_parking_reserve, 20, 60); // 20 check-in attempts/min per IP
rate_limit_fn!(limit_billboard_purchase, 10, 60); // 10 purchase attempts/min per IP
rate_limit_fn!(limit_geocode, 20, 60); // 20 searches/min per IP — protects the public geocoder endpoints from
// accidental request storms while the backend cache absorbs repeated queries.
