//! Integration tests. Each test gets its own freshly-migrated, isolated
//! Postgres database via #[sqlx::test] (see docs.rs/sqlx/attr.test.html) —
//! requires DATABASE_URL to point at a Postgres server the test runner's
//! role can CREATE DATABASE on (a local dev Postgres is normal; this is
//! not the app's runtime database).
//!
//! Handlers are called directly as plain async functions rather than
//! through a running HTTP server — their extractor parameters (State,
//! AuthUser, Json, Path) are just structs we can construct by hand, which
//! avoids needing a real server/port for every test.

use axum::extract::{Json, Path, State};
use navigation_backend::auth::AuthUser;
use navigation_backend::config::Config;
use navigation_backend::handlers;
use navigation_backend::models::*;
use navigation_backend::AppState;
use sqlx::PgPool;

fn test_state(pool: PgPool) -> AppState {
    AppState::from_pool_for_test(pool, Config::for_test())
}

fn fake_user(id: &str) -> AuthUser {
    AuthUser {
        id: id.to_string(),
        is_admin: false,
    }
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

#[sqlx::test]
async fn register_then_login_succeeds(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);

    let register_result = handlers::register(
        State(state.clone()),
        Json(RegisterRequest {
            email: "driver@example.com".to_string(),
            password: "correct-horse-battery".to_string(),
            display_name: Some("Driver".to_string()),
        }),
    )
    .await;
    assert!(register_result.is_ok(), "registration should succeed");
    let registered_user_id = register_result.unwrap().0.user_id;

    let login_result = handlers::login(
        State(state),
        Json(LoginRequest {
            email: "driver@example.com".to_string(),
            password: "correct-horse-battery".to_string(),
        }),
    )
    .await;
    assert!(login_result.is_ok(), "login with correct credentials should succeed");
    assert_eq!(login_result.unwrap().0.user_id, registered_user_id);

    Ok(())
}

#[sqlx::test]
async fn login_with_wrong_password_fails(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);

    handlers::register(
        State(state.clone()),
        Json(RegisterRequest {
            email: "driver@example.com".to_string(),
            password: "correct-horse-battery".to_string(),
            display_name: None,
        }),
    )
    .await
    .expect("registration should succeed");

    let login_result = handlers::login(
        State(state),
        Json(LoginRequest {
            email: "driver@example.com".to_string(),
            password: "wrong-password".to_string(),
        }),
    )
    .await;

    assert!(login_result.is_err(), "login with wrong password must fail");
    let (status, _) = login_result.unwrap_err();
    assert_eq!(status, axum::http::StatusCode::UNAUTHORIZED);

    Ok(())
}

#[sqlx::test]
async fn duplicate_email_registration_fails(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);

    let make_req = || {
        Json(RegisterRequest {
            email: "driver@example.com".to_string(),
            password: "correct-horse-battery".to_string(),
            display_name: None,
        })
    };

    handlers::register(State(state.clone()), make_req())
        .await
        .expect("first registration should succeed");

    let second = handlers::register(State(state), make_req()).await;
    assert!(second.is_err(), "registering the same email twice must fail");
    let (status, body) = second.unwrap_err();
    assert_eq!(status, axum::http::StatusCode::CONFLICT);
    assert_eq!(body.0.error, "email_taken");

    Ok(())
}

// ---------------------------------------------------------------------
// Parking — capacity counts, not exclusive reservations. The correctness
// property that matters now is different: concurrent check-ins to the
// same lot must not lose an update (a classic read-modify-write race), and
// switching lots / repeat check-ins must adjust counts correctly rather
// than leaking or double-counting.
// ---------------------------------------------------------------------

#[sqlx::test]
async fn concurrent_checkins_to_same_lot_both_succeed_and_count_correctly(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);
    // 'park1' comes from the seed data in the initial migration.
    let request = || Json(ParkingCheckinRequest { lot_id: "park1".to_string(), location: None });

    let state_a = state.clone();
    let state_b = state.clone();

    let (result_a, result_b) = tokio::join!(
        handlers::checkin_parking(State(state_a), fake_user("user-a"), request()),
        handlers::checkin_parking(State(state_b), fake_user("user-b"), request())
    );

    assert!(result_a.is_ok(), "first check-in should succeed");
    assert!(result_b.is_ok(), "second check-in should succeed");

    let lot = handlers::get_parking(
        State(state),
        axum::extract::Query(handlers::ParkingQuery { destination: "37.7749,-122.4194".to_string() }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("listing should return data")
    .into_iter()
    .find(|l| l.id == "park1")
    .expect("park1 should be in range");

    assert_eq!(
        lot.occupied_spaces, 2,
        "two concurrent check-ins must both be counted, not lost to a race"
    );

    Ok(())
}

#[sqlx::test]
async fn checking_into_a_new_lot_releases_the_previous_one(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);

    handlers::checkin_parking(
        State(state.clone()),
        fake_user("user-a"),
        Json(ParkingCheckinRequest { lot_id: "park1".to_string(), location: None }),
    )
    .await
    .expect("handler shouldn't error");

    // Same user, different lot, no explicit checkout in between — this is
    // the "left without checking out, and now shows up somewhere else"
    // case the check-in logic needs to reconcile.
    handlers::checkin_parking(
        State(state.clone()),
        fake_user("user-a"),
        Json(ParkingCheckinRequest { lot_id: "park2".to_string(), location: None }),
    )
    .await
    .expect("handler shouldn't error");

    let lots = handlers::get_parking(
        State(state),
        axum::extract::Query(handlers::ParkingQuery { destination: "37.7749,-122.4194".to_string() }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("listing should return data");

    let park1 = lots.iter().find(|l| l.id == "park1").unwrap();
    let park2 = lots.iter().find(|l| l.id == "park2").unwrap();
    assert_eq!(park1.occupied_spaces, 0, "old lot should be released when checking into a new one");
    assert_eq!(park2.occupied_spaces, 1, "new lot should reflect the check-in");

    Ok(())
}

#[sqlx::test]
async fn checkout_decrements_the_lot(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);

    handlers::checkin_parking(
        State(state.clone()),
        fake_user("user-a"),
        Json(ParkingCheckinRequest { lot_id: "park1".to_string(), location: None }),
    )
    .await
    .expect("handler shouldn't error");

    handlers::checkout_parking(State(state.clone()), fake_user("user-a"))
        .await
        .expect("checkout should succeed");

    let lot = handlers::get_parking(
        State(state),
        axum::extract::Query(handlers::ParkingQuery { destination: "37.7749,-122.4194".to_string() }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("listing should return data")
    .into_iter()
    .find(|l| l.id == "park1")
    .unwrap();

    assert_eq!(lot.occupied_spaces, 0, "checkout should decrement the lot's count");

    Ok(())
}

#[sqlx::test]
async fn repeat_checkin_to_same_lot_does_not_double_count(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);
    let request = || Json(ParkingCheckinRequest { lot_id: "park1".to_string(), location: None });

    handlers::checkin_parking(State(state.clone()), fake_user("user-a"), request())
        .await
        .expect("first check-in should succeed");
    // A repeat check-in to the same lot (e.g. the frontend's periodic
    // detection firing again while still parked) must not increment again.
    handlers::checkin_parking(State(state.clone()), fake_user("user-a"), request())
        .await
        .expect("repeat check-in should succeed");

    let lot = handlers::get_parking(
        State(state),
        axum::extract::Query(handlers::ParkingQuery { destination: "37.7749,-122.4194".to_string() }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("listing should return data")
    .into_iter()
    .find(|l| l.id == "park1")
    .unwrap();

    assert_eq!(lot.occupied_spaces, 1, "a repeat check-in to the same lot must not double-count");

    Ok(())
}

// ---------------------------------------------------------------------
// Report voting — confirm extends expiry, enough dismissals expire it
// immediately.
// ---------------------------------------------------------------------

async fn create_test_report(state: &AppState, reporter: &AuthUser) -> Report {
    handlers::create_report(
        State(state.clone()),
        AuthUser {
            id: reporter.id.clone(),
            is_admin: reporter.is_admin,
        },
        Json(CreateReportRequest {
            report_type: "hazard".to_string(),
            location: Location { lat: 37.7749, lng: -122.4194 },
            photo_url: None,
            expires_in_minutes: Some(30),
        }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("report creation should return the created report")
}

#[sqlx::test]
async fn confirming_a_report_extends_its_expiry(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);
    let report = create_test_report(&state, &fake_user("reporter")).await;
    let original_expiry = report.expires_at;

    let confirmed = handlers::confirm_report(State(state), fake_user("confirmer"), Path(report.id))
        .await
        .expect("handler shouldn't error")
        .0
        .data
        .expect("confirm should return the updated report");

    assert_eq!(confirmed.confirmations, 1);
    assert!(
        confirmed.expires_at >= original_expiry,
        "a confirmation should never shorten a report's remaining lifetime"
    );

    Ok(())
}

#[sqlx::test]
async fn enough_dismissals_expire_a_report_immediately(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);
    let report = create_test_report(&state, &fake_user("reporter")).await;

    // DISMISS_THRESHOLD is 2 (dismissals - confirmations >= 2) — two
    // distinct voters dismissing with no confirmations should trip it.
    handlers::dismiss_report(State(state.clone()), fake_user("voter-1"), Path(report.id.clone()))
        .await
        .expect("handler shouldn't error");
    let after_second = handlers::dismiss_report(State(state), fake_user("voter-2"), Path(report.id))
        .await
        .expect("handler shouldn't error")
        .0
        .data
        .expect("dismiss should return the updated report");

    assert!(
        after_second.expires_at <= chrono::Utc::now(),
        "report should be expired immediately once dismissals cross the threshold"
    );

    Ok(())
}

// ---------------------------------------------------------------------
// Billboard moderation — a fresh purchase must not be publicly visible
// until approved.
// ---------------------------------------------------------------------

#[sqlx::test]
async fn purchased_billboard_is_hidden_until_approved(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);
    // 'bill1' comes from the seed data in the initial migration.
    let display_start = chrono::Utc::now() + chrono::Duration::minutes(1);
    let display_end = display_start + chrono::Duration::hours(24);

    let purchase = handlers::purchase_billboard(
        State(state.clone()),
        fake_user("advertiser"),
        Path("bill1".to_string()),
        Json(BillboardPurchaseRequest {
            billboard_id: "bill1".to_string(),
            ad_image_url: "https://example.com/ad.png".to_string(),
            ad_target_url: "https://example.com".to_string(),
            display_start,
            display_end,
        }),
    )
    .await
    .expect("handler shouldn't error")
    .0;

    assert!(purchase.success, "purchase should succeed: {:?}", purchase.error);
    assert_eq!(
        purchase.data.as_ref().unwrap().moderation_status,
        "pending",
        "a fresh purchase must start pending, not auto-approved"
    );

    let listing = handlers::get_billboards(
        State(state.clone()),
        axum::extract::Query(handlers::BillboardsQuery {
            lat: 37.7749,
            lng: -122.4194,
            radius: 5000.0,
        }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("listing should return data");

    let bill1 = listing.iter().find(|b| b.id == "bill1").expect("bill1 should be in range");
    assert!(
        !bill1.is_purchased,
        "a pending (unapproved) billboard must not show as purchased/active to other users"
    );
    assert!(bill1.ad_image_url.is_none(), "ad content must be hidden until approved");

    // Now approve it as an admin and confirm it becomes visible.
    let admin = AuthUser {
        id: "admin-user".to_string(),
        is_admin: true,
    };
    handlers::moderate_billboard(
        State(state.clone()),
        admin,
        Path("bill1".to_string()),
        Json(handlers::ModerateBillboardRequest { approve: true }),
    )
    .await
    .expect("moderation should succeed");

    let listing_after = handlers::get_billboards(
        State(state),
        axum::extract::Query(handlers::BillboardsQuery {
            lat: 37.7749,
            lng: -122.4194,
            radius: 5000.0,
        }),
    )
    .await
    .expect("handler shouldn't error")
    .0
    .data
    .expect("listing should return data");

    let bill1_after = listing_after.iter().find(|b| b.id == "bill1").unwrap();
    assert!(bill1_after.is_purchased, "approved billboard should now show as active");
    assert!(bill1_after.ad_image_url.is_some(), "approved billboard's ad should now be visible");

    Ok(())
}

#[sqlx::test]
async fn non_admin_cannot_moderate_billboards(pool: PgPool) -> sqlx::Result<()> {
    let state = test_state(pool);
    let result = handlers::moderate_billboard(
        State(state),
        fake_user("not-an-admin"),
        Path("bill1".to_string()),
        Json(handlers::ModerateBillboardRequest { approve: true }),
    )
    .await;

    assert!(result.is_err(), "a non-admin must not be able to moderate billboards");
    assert_eq!(result.unwrap_err(), axum::http::StatusCode::FORBIDDEN);

    Ok(())
}
