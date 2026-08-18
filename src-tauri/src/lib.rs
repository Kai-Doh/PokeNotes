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
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
