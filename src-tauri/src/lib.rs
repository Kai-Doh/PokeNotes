use tauri_plugin_sql::{Migration, MigrationKind};

const DB_URL: &str = "sqlite:pokenotes.db";

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init schema",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "app meta",
            sql: include_str!("../migrations/0002_app_meta.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "item battle flag",
            sql: include_str!("../migrations/0003_item_battle_flag.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "showdown name",
            sql: include_str!("../migrations/0004_showdown_name.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "usage stats",
            sql: include_str!("../migrations/0005_usage_stats.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "move usage",
            sql: include_str!("../migrations/0006_move_usage.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "item legality",
            sql: include_str!("../migrations/0007_item_legality.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "item spritesheet",
            sql: include_str!("../migrations/0008_item_spritesheet.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "battle notes",
            sql: include_str!("../migrations/0009_battle_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "battle my pokemon moves",
            sql: include_str!("../migrations/0010_battle_my_pokemon_moves.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "sync",
            sql: include_str!("../migrations/0011_sync.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "event checklist",
            sql: include_str!("../migrations/0012_event_checklist.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init());

    // Self-updater and process-relaunch only make sense on desktop -- Android
    // and iOS builds update through whatever store distributed them instead,
    // and neither plugin's Rust crate is even pulled in for those targets
    // (see the cfg-gated dependency in Cargo.toml).
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
