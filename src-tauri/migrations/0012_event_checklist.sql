-- Per-event prep checklists. `event_name` is a free-text tag (matching the
-- same field already used on battles), not a foreign key -- there is no
-- dedicated "events" table, so this just groups items by that string.

CREATE TABLE event_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT NOT NULL,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  _hlc TEXT
);
CREATE INDEX idx_event_checklist_event ON event_checklist_items(event_name);

CREATE TRIGGER trg_event_checklist_items_oplog_insert AFTER INSERT ON event_checklist_items
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE event_checklist_items SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'event_checklist_items', id, 'upsert',
    json_object('id', id, 'event_name', event_name, 'text', text, 'done', done,
                'position', position, 'created_at', created_at, '_hlc', _hlc),
    _hlc
  FROM event_checklist_items WHERE id = NEW.id;
END;

CREATE TRIGGER trg_event_checklist_items_oplog_update AFTER UPDATE ON event_checklist_items
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE event_checklist_items SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'event_checklist_items', id, 'upsert',
    json_object('id', id, 'event_name', event_name, 'text', text, 'done', done,
                'position', position, 'created_at', created_at, '_hlc', _hlc),
    _hlc
  FROM event_checklist_items WHERE id = NEW.id;
END;

CREATE TRIGGER trg_event_checklist_items_oplog_delete AFTER DELETE ON event_checklist_items
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('event_checklist_items', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;
