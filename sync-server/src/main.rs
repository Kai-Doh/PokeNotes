mod auth;
mod db;
mod routes;

use axum::routing::{get, post};
use axum::Router;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Parser)]
#[command(name = "pokenotes-sync-server")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the sync HTTP server.
    Serve {
        #[arg(long, env = "SYNC_DB_PATH", default_value = "./data/sync.db")]
        db: PathBuf,
        #[arg(long, env = "PORT", default_value_t = 8787)]
        port: u16,
    },
    /// Mint a new device auth token and register the device.
    /// Prints the plaintext token once -- it is not stored anywhere, only its hash.
    MintToken {
        #[arg(long, env = "SYNC_DB_PATH", default_value = "./data/sync.db")]
        db: PathBuf,
        #[arg(long)]
        device_id: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cli = Cli::parse();

    match cli.command {
        Command::Serve { db, port } => serve(db, port).await,
        Command::MintToken { db, device_id } => mint_token(db, device_id),
    }
}

async fn serve(db_path: PathBuf, port: u16) -> anyhow::Result<()> {
    let conn = db::open(&db_path)?;
    let state: routes::AppState = Arc::new(Mutex::new(conn));

    let app = Router::new()
        .route("/health", get(routes::health))
        .route("/sync/push", post(routes::push))
        .route("/sync/pull", get(routes::pull))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("pokenotes-sync-server listening on {addr}, db at {}", db_path.display());
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn mint_token(db_path: PathBuf, device_id: String) -> anyhow::Result<()> {
    let conn = db::open(&db_path)?;
    let token = auth::generate_token();
    let token_hash = auth::hash_token(&token);

    conn.execute(
        "INSERT INTO devices (device_id, token_hash) VALUES (?1, ?2)
         ON CONFLICT(device_id) DO UPDATE SET token_hash = excluded.token_hash",
        rusqlite::params![device_id, token_hash],
    )?;

    println!("Device '{device_id}' registered.");
    println!("Token (copy this now, it will not be shown again):");
    println!("{token}");
    Ok(())
}
