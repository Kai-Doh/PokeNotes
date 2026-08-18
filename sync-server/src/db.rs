use rusqlite::Connection;
use std::path::Path;

pub fn open(db_path: &Path) -> anyhow::Result<Connection> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS devices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL UNIQUE,
          token_hash TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS oplog (
          seq INTEGER PRIMARY KEY AUTOINCREMENT,
          device_id TEXT NOT NULL,
          table_name TEXT NOT NULL,
          row_id INTEGER NOT NULL,
          op TEXT NOT NULL,
          row_json TEXT NOT NULL,
          hlc TEXT NOT NULL,
          received_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_oplog_seq ON oplog(seq);
        ",
    )?;
    Ok(conn)
}
