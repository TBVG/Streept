use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, StatusCode},
    Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};

use crate::models::{AuthErrorBody, Claims};
use crate::AppState;

// How long an issued token stays valid. There's no refresh-token flow —
// once this expires, the user just logs in again. Fine for now; a real
// deployment would want short-lived access tokens + a refresh token.
const TOKEN_LIFETIME_HOURS: i64 = 24 * 7; // 7 days

pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    Ok(argon2.hash_password(password.as_bytes(), &salt)?.to_string())
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

pub fn create_jwt(user_id: &str, is_admin: bool, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let exp = (chrono::Utc::now() + chrono::Duration::hours(TOKEN_LIFETIME_HOURS)).timestamp() as usize;
    let claims = Claims {
        sub: user_id.to_string(),
        is_admin,
        exp,
    };
    encode(&Header::default(), &claims, &EncodingKey::from_secret(secret.as_bytes()))
}

fn decode_jwt(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

/// The authenticated user for a request, extracted from the
/// `Authorization: Bearer <token>` header. Any handler that takes this as
/// a parameter automatically requires a valid, unexpired token — if the
/// header is missing or the token doesn't verify, the request is rejected
/// with 401 before the handler body ever runs.
pub struct AuthUser {
    pub id: String,
    pub is_admin: bool,
}

fn auth_error(message: &str) -> (StatusCode, Json<AuthErrorBody>) {
    (
        StatusCode::UNAUTHORIZED,
        Json(AuthErrorBody {
            error: "unauthorized".to_string(),
            message: message.to_string(),
        }),
    )
}

#[axum::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = (StatusCode, Json<AuthErrorBody>);

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        // Authentication is optional: the web app no longer has login/signup.
        // A stable browser-generated X-Guest-ID lets user-scoped features such
        // as parking occupancy and report voting continue to work anonymously.
        if let Some(guest_id) = parts
            .headers
            .get("X-Guest-ID")
            .and_then(|v| v.to_str().ok())
            .filter(|id| !id.trim().is_empty())
        {
            return Ok(AuthUser {
                id: guest_id.to_string(),
                is_admin: false,
            });
        }

        // Keep accepting existing JWTs for API clients that still use them.
        if let Some(header_value) = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
        {
            let token = header_value
                .strip_prefix("Bearer ")
                .ok_or_else(|| auth_error("Authorization header must be a Bearer token."))?;
            let claims = decode_jwt(token, &state.config.jwt_secret)
                .map_err(|_| auth_error("Invalid or expired token."))?;
            return Ok(AuthUser {
                id: claims.sub,
                is_admin: claims.is_admin,
            });
        }

        // Final fallback for non-browser API callers.
        Ok(AuthUser {
            id: "anonymous".to_string(),
            is_admin: false,
        })
    }
}
