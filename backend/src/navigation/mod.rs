//! Rust-owned navigation domain.
//!
//! The navigation domain is intentionally split by responsibility so the
//! backend remains the system of record for navigation intelligence while the
//! browser focuses on rendering and device integration.

pub mod geometry;
pub mod route_decision;
pub mod runtime;

pub use route_decision::{
    NavigationAnalysisRequest,
    NavigationAnalysisResponse,
    NavigationReport,
    RoadIntelligenceInput,
    RouteDecisionProfile,
    analyze,
};
