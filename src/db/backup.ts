import type Database from "@tauri-apps/plugin-sql";

// Parent-to-child order (matters for FK-safe inserts on restore -- delete
// uses this reversed). Only user-authored data: the bundled Pokédex/moves/
// items/formats tables are identical across installs of the same app
// version, so backing them up would just bloat the file for no benefit.
const USER_TABLES = [
  "teams", "battles",
  "team_members", "battle_my_pokemon", "battle_opponent_pokemon", "battle_notes",
] as const;

/** Writes a complete, consistent snapshot of the live database to `path` via SQLite's own VACUUM INTO -- safe to run while the app is open. */
export async function backupDatabase(db: Database, path: string): Promise<void> {
  await db.execute("VACUUM INTO ?", [path]);
}

/**
 * Restores user data (teams, battle log) from a previously-saved backup
 * file, leaving the bundled reference data (Pokédex, moves, items, formats)
 * untouched. Assumes the backup came from a compatible schema version --
 * restoring across an app version that changed the user-table shape isn't
 * handled here.
 */
export async function restoreDatabase(db: Database, path: string): Promise<void> {
  await db.execute("ATTACH DATABASE ? AS backup", [path]);
  try {
    for (const table of [...USER_TABLES].reverse()) {
      await db.execute(`DELETE FROM main.${table}`);
    }
    for (const table of USER_TABLES) {
      await db.execute(`INSERT INTO main.${table} SELECT * FROM backup.${table}`);
    }
  } finally {
    await db.execute("DETACH DATABASE backup");
  }
}
