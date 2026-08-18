use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use crate::auth::authenticate;

pub type AppState = Arc<Mutex<Connection>>;

#[derive(Deserialize)]
pub struct PushEntry {
    table_name: String,
    row_id: i64,
    op: String,
    row_json: String,
    hlc: String,
}

#[derive(Deserialize)]
pub struct PushRequest {
    entries: Vec<PushEntry>,
}

#[derive(Serialize)]
pub struct PushResponse {
    accepted: usize,
    latest_seq: i64,
}

pub async fn push(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PushRequest>,
) -> Result<Json<PushResponse>, StatusCode> {
    let conn = state.lock().unwrap();
    let device_id = authenticate(&conn, &headers)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    for entry in &body.entries {
        tx.execute(
            "INSERT INTO oplog (device_id, table_name, row_id, op, row_json, hlc) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                device_id,
                entry.table_name,
                entry.row_id,
                entry.op,
                entry.row_json,
                entry.hlc
            ],
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    tx.commit().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let latest_seq = latest_seq(&conn)?;

    Ok(Json(PushResponse {
        accepted: body.entries.len(),
        latest_seq,
    }))
}

#[derive(Deserialize)]
pub struct PullQuery {
    #[serde(default)]
    since: i64,
}

#[derive(Serialize)]
pub struct PullEntry {
    seq: i64,
    table_name: String,
    row_id: i64,
    op: String,
    row_json: String,
    hlc: String,
}

#[derive(Serialize)]
pub struct PullResponse {
    entries: Vec<PullEntry>,
    latest_seq: i64,
}

pub async fn pull(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, StatusCode> {
    let conn = state.lock().unwrap();
    let device_id = authenticate(&conn, &headers)?;

    // Entries from the requesting device itself are skipped -- it already
    // has them locally (that's how they got pushed), and its trigger-set
    // `_hlc` already matches what it would receive back.
    let mut stmt = conn
        .prepare(
            "SELECT seq, table_name, row_id, op, row_json, hlc FROM oplog
             WHERE seq > ?1 AND device_id != ?2 ORDER BY seq ASC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let entries = stmt
        .query_map(params![query.since, device_id], |row| {
            Ok(PullEntry {
                seq: row.get(0)?,
                table_name: row.get(1)?,
                row_id: row.get(2)?,
                op: row.get(3)?,
                row_json: row.get(4)?,
                hlc: row.get(5)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(stmt);

    let latest_seq = latest_seq(&conn)?;

    Ok(Json(PullResponse {
        entries,
        latest_seq,
    }))
}

fn latest_seq(conn: &Connection) -> Result<i64, StatusCode> {
    conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM oplog", [], |r| r.get(0))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub async fn health() -> &'static str {
    "ok"
}
