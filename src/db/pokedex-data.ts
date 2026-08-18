import type Database from "@tauri-apps/plugin-sql";

export type SeedProgress = { step: string; done: number; total: number };
export type OnProgress = (p: SeedProgress) => void;

const MAX_BOUND_PARAMS = 800; // stay well under SQLite's parameter limit either way

// Every pokedex reference table, in insert order (parents before children so
// foreign keys resolve) with its matching seed JSON file name and columns.
// Clearing for a refresh happens in the reverse of this order.
const TABLE_SPECS: { table: string; file: string; columns: string[] }[] = [
  {
    table: "pokemon",
    file: "pokemon",
    columns: [
      "id", "species_id", "national_dex_number", "name", "display_name", "form_label",
      "is_default_form", "form_category", "generation", "type1", "type2",
      "base_hp", "base_atk", "base_def", "base_spa", "base_spd", "base_spe",
      "height_dm", "weight_hg", "sprite_default", "sprite_shiny", "sprite_official_art",
      "sprite_home", "is_mega", "is_gmax", "is_legendary", "is_mythical", "is_restricted", "showdown_id", "showdown_name",
    ],
  },
  {
    table: "abilities",
    file: "abilities",
    columns: ["id", "name", "display_name", "short_effect", "effect", "generation"],
  },
  {
    table: "pokemon_abilities",
    file: "pokemon_abilities",
    columns: ["pokemon_id", "ability_id", "slot", "is_hidden"],
  },
  {
    table: "moves",
    file: "moves",
    columns: [
      "id", "name", "display_name", "type", "category", "power", "accuracy", "pp",
      "priority", "target", "short_effect", "effect", "generation", "is_zmove", "is_max_move", "flags",
    ],
  },
  {
    table: "items",
    file: "items",
    columns: ["id", "name", "display_name", "category", "is_battle_item", "short_effect", "effect", "sprite", "generation"],
  },
  {
    table: "formats",
    file: "formats",
    columns: ["id", "code", "name", "source", "generation", "is_doubles", "ruleset"],
  },
  {
    table: "format_legality",
    file: "format_legality",
    columns: ["format_id", "pokemon_id", "status", "tier", "notes"],
  },
  {
    table: "learnsets",
    file: "learnsets",
    columns: ["pokemon_id", "move_id", "method", "level", "generation"],
  },
  {
    table: "pokemon_usage",
    file: "pokemon_usage",
    columns: ["format_id", "pokemon_id", "rank", "usage_pct"],
  },
  {
    table: "item_usage",
    file: "item_usage",
    columns: ["format_id", "pokemon_id", "item_id", "usage_pct"],
  },
  {
    table: "ability_usage",
    file: "ability_usage",
    columns: ["format_id", "pokemon_id", "ability_id", "usage_pct"],
  },
];

async function bulkInsert(
  db: Database,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  onBatch?: (done: number) => void,
) {
  if (rows.length === 0) return;
  const batchSize = Math.max(1, Math.floor(MAX_BOUND_PARAMS / columns.length));
  const placeholders = `(${columns.map(() => "?").join(",")})`;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${batch.map(() => placeholders).join(",")}`;
    const values = batch.flatMap((row) => columns.map((c) => row[c] ?? null));
    await db.execute(sql, values);
    onBatch?.(Math.min(i + batchSize, rows.length));
  }
}

async function clearPokedexTables(db: Database) {
  for (const spec of [...TABLE_SPECS].reverse()) {
    await db.execute(`DELETE FROM ${spec.table}`).catch(() => {});
  }
}

/**
 * Fetches every seed file (via `fetchOne`) and loads it into the database.
 * `clearFirst` wipes existing pokedex rows before loading (used for refresh);
 * a first-run seed skips that since the tables are already empty.
 */
async function loadPokedexTables(
  db: Database,
  fetchOne: (file: string) => Promise<unknown[]>,
  onProgress: OnProgress | undefined,
  clearFirst: boolean,
) {
  const report = (step: string, done: number, total: number) => onProgress?.({ step, done, total });

  report("Downloading Pokédex data...", 0, 1);
  const data = await Promise.all(TABLE_SPECS.map((spec) => fetchOne(spec.file)));

  if (clearFirst) {
    report("Clearing old data...", 0, 1);
    await clearPokedexTables(db);
  }

  try {
    for (let i = 0; i < TABLE_SPECS.length; i++) {
      const spec = TABLE_SPECS[i];
      const rows = data[i] as Record<string, unknown>[];
      report(spec.table, 0, rows.length);
      await bulkInsert(db, spec.table, spec.columns, rows, (done) => report(spec.table, done, rows.length));
    }
  } catch (err) {
    console.error("[pokenotes] pokedex load failed, clearing partial data:", err);
    // Without a real cross-call transaction (see bulkInsert's caller history),
    // a failure partway through can leave partial rows behind. Clear them so
    // the next attempt (retry, or the `count > 0` skip-check) starts clean.
    await clearPokedexTables(db);
    throw err;
  }

  await db.execute(
    "INSERT INTO app_meta (key, value) VALUES ('pokedex_updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [new Date().toISOString()],
  );
}

// `cache: "no-store"` matters here beyond just dev-mode freshness: WebView2
// keeps a real persistent HTTP cache across app relaunches (separate from the
// app data dir), so a stale cached response for the same URL can silently
// survive a full restart. That would also break "Refresh Pokédex Data" in
// production, since it re-fetches these exact same URLs.
async function fetchLocalSeed(file: string): Promise<unknown[]> {
  const res = await fetch(`./seed/${file}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load seed/${file}.json: ${res.status}`);
  return res.json();
}

// React 18 StrictMode intentionally double-invokes effects in dev, and a
// cleanup flag alone only suppresses state updates -- it doesn't abort
// in-flight work. Without this guard, two concurrent seed attempts both see
// an empty `pokemon` table and race to insert the same rows twice, which
// fails with a UNIQUE constraint violation on the second insert. Caching the
// in-flight promise makes every caller (StrictMode's two mounts included)
// share the same single seed run.
let seedPromise: Promise<void> | null = null;

/** Populates the local pokedex from bundled seed JSON, if it hasn't been already. */
export function seedDatabaseIfNeeded(db: Database, onProgress?: OnProgress): Promise<void> {
  if (!seedPromise) seedPromise = seedIfNeeded(db, onProgress);
  return seedPromise;
}

async function seedIfNeeded(db: Database, onProgress?: OnProgress) {
  const [{ count }] = await db.select<{ count: number }[]>("SELECT COUNT(*) as count FROM pokemon");
  console.log(`[pokenotes] existing pokemon count: ${count}`);
  if (count > 0) return;
  await loadPokedexTables(db, fetchLocalSeed, onProgress, false);
}

const REMOTE_SEED_BASE = "https://raw.githubusercontent.com/Kai-Doh/PokeNotes/main/public/seed";

async function fetchRemoteSeed(file: string): Promise<unknown[]> {
  const res = await fetch(`${REMOTE_SEED_BASE}/${file}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to download ${file}.json: ${res.status}`);
  return res.json();
}

/**
 * Re-downloads the pokedex dataset from GitHub and replaces the local copy.
 * Use this to pick up tier shifts, new regulations, or newly added Pokémon
 * without waiting for a full app update.
 */
export async function refreshPokedexData(db: Database, onProgress?: OnProgress): Promise<void> {
  await loadPokedexTables(db, fetchRemoteSeed, onProgress, true);
}

export async function getPokedexUpdatedAt(db: Database): Promise<string | null> {
  const rows = await db.select<{ value: string }[]>("SELECT value FROM app_meta WHERE key = 'pokedex_updated_at'");
  return rows[0]?.value ?? null;
}
