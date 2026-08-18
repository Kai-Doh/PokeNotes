use axum::http::{HeaderMap, StatusCode};
use rand::RngCore;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Resolves the bearer token in `headers` to a device_id, or a 401/400 to return as-is.
pub fn authenticate(conn: &Connection, headers: &HeaderMap) -> Result<String, StatusCode> {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let token_hash = hash_token(token);

    conn.query_row(
        "SELECT device_id FROM devices WHERE token_hash = ?1",
        [&token_hash],
        |row| row.get::<_, String>(0),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)
}
