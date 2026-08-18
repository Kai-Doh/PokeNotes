import type Database from "@tauri-apps/plugin-sql";
import { fetch } from "@tauri-apps/plugin-http";

// Must match the ALTER TABLE list in migrations/0011_sync.sql.
const SYNCABLE_TABLES = [
  "teams",
  "team_members",
  "battles",
  "battle_my_pokemon",
  "battle_opponent_pokemon",
  "battle_notes",
  "event_checklist_items",
] as const;

export interface SyncConfig {
  serverUrl: string;
  authToken: string;
  deviceId: string;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
}

async function getMeta(db: Database, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM _sync_meta WHERE key = ?",
    [key],
  );
  return rows[0]?.value ?? null;
}

async function setMeta(db: Database, key: string, value: string): Promise<void> {
  await db.execute(
    "INSERT INTO _sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function getSyncConfig(db: Database): Promise<SyncConfig | null> {
  const [serverUrl, authToken, deviceId] = await Promise.all([
    getMeta(db, "server_url"),
    getMeta(db, "auth_token"),
    getMeta(db, "device_id"),
  ]);
  if (!serverUrl || !authToken || !deviceId) return null;
  return { serverUrl, authToken, deviceId };
}

export async function setSyncConfig(db: Database, serverUrl: string, authToken: string): Promise<void> {
  let deviceId = await getMeta(db, "device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await setMeta(db, "device_id", deviceId);
  }
  await setMeta(db, "server_url", serverUrl.replace(/\/+$/, ""));
  await setMeta(db, "auth_token", authToken);
}

export async function clearSyncConfig(db: Database): Promise<void> {
  await db.execute("DELETE FROM _sync_meta WHERE key IN ('server_url', 'auth_token')");
}

interface PendingOplogRow {
  id: number;
  table_name: string;
  row_id: number;
  op: string;
  row_json: string;
  hlc: string;
}

async function pushPending(db: Database, config: SyncConfig): Promise<number> {
  const pending = await db.select<PendingOplogRow[]>(
    "SELECT id, table_name, row_id, op, row_json, hlc FROM _oplog WHERE pushed = 0 ORDER BY id ASC LIMIT 500",
  );
  if (pending.length === 0) return 0;

  const res = await fetch(`${config.serverUrl}/sync/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.authToken}`,
    },
    body: JSON.stringify({
      entries: pending.map((p) => ({
        table_name: p.table_name,
        row_id: p.row_id,
        op: p.op,
        row_json: p.row_json,
        hlc: p.hlc,
      })),
    }),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status} ${await res.text()}`);

  const ids = pending.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(", ");
  await db.execute(`UPDATE _oplog SET pushed = 1 WHERE id IN (${placeholders})`, ids);
  return pending.length;
}

interface RemoteOplogEntry {
  seq: number;
  table_name: string;
  row_id: number;
  op: "upsert" | "delete";
  row_json: string;
  hlc: string;
}

async function applyRemoteEntry(db: Database, entry: RemoteOplogEntry): Promise<void> {
  if (!SYNCABLE_TABLES.includes(entry.table_name as (typeof SYNCABLE_TABLES)[number])) return;
  const table = entry.table_name;

  const existing = await db.select<{ _hlc: string }[]>(
    `SELECT _hlc FROM ${table} WHERE id = ?`,
    [entry.row_id],
  );
  // Last-write-wins: skip if our local row is already at least as new.
  if (existing[0] && existing[0]._hlc >= entry.hlc) return;

  await db.execute(
    "INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
  );
  try {
    if (entry.op === "delete") {
      if (existing[0]) await db.execute(`DELETE FROM ${table} WHERE id = ?`, [entry.row_id]);
    } else {
      const row = JSON.parse(entry.row_json) as Record<string, unknown>;
      const cols = Object.keys(row);
      const placeholders = cols.map(() => "?").join(", ");
      const updates = cols.map((c) => `${c} = excluded.${c}`).join(", ");
      await db.execute(
        `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updates}`,
        cols.map((c) => row[c]),
      );
    }
  } finally {
    await db.execute(
      "INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0'",
    );
  }
}

async function pullRemote(db: Database, config: SyncConfig): Promise<number> {
  const since = (await getMeta(db, "last_pull_seq")) ?? "0";
  const res = await fetch(`${config.serverUrl}/sync/pull?since=${since}`, {
    headers: { Authorization: `Bearer ${config.authToken}` },
  });
  if (!res.ok) throw new Error(`sync pull failed: ${res.status} ${await res.text()}`);

  const body = (await res.json()) as { entries: RemoteOplogEntry[]; latest_seq: number };
  for (const entry of body.entries) {
    await applyRemoteEntry(db, entry);
  }
  await setMeta(db, "last_pull_seq", String(body.latest_seq));
  return body.entries.length;
}

export async function syncNow(db: Database): Promise<SyncResult> {
  const config = await getSyncConfig(db);
  if (!config) return { pushed: 0, pulled: 0 };

  const pushed = await pushPending(db, config);
  const pulled = await pullRemote(db, config);
  return { pushed, pulled };
}
