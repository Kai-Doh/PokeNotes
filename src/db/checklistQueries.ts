import type Database from "@tauri-apps/plugin-sql";

export interface ChecklistItem {
  id: number;
  event_name: string;
  text: string;
  done: number;
  position: number;
  created_at: string;
}

export function listChecklistItems(db: Database, eventName: string): Promise<ChecklistItem[]> {
  return db.select<ChecklistItem[]>(
    "SELECT * FROM event_checklist_items WHERE event_name = ? ORDER BY position ASC, id ASC",
    [eventName],
  );
}

export async function addChecklistItem(db: Database, eventName: string, text: string): Promise<void> {
  const rows = await db.select<{ next: number }[]>(
    "SELECT COALESCE(MAX(position), -1) + 1 as next FROM event_checklist_items WHERE event_name = ?",
    [eventName],
  );
  await db.execute(
    "INSERT INTO event_checklist_items (event_name, text, position) VALUES (?, ?, ?)",
    [eventName, text, rows[0].next],
  );
}

export function setChecklistItemDone(db: Database, id: number, done: boolean): Promise<unknown> {
  return db.execute("UPDATE event_checklist_items SET done = ? WHERE id = ?", [done ? 1 : 0, id]);
}

export function deleteChecklistItem(db: Database, id: number): Promise<unknown> {
  return db.execute("DELETE FROM event_checklist_items WHERE id = ?", [id]);
}
