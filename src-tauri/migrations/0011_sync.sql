-- Multi-device sync support (self-hosted server, see sync-server/).
--
-- Design: every syncable table gets an `_hlc` column used for last-write-wins
-- conflict resolution, and an AFTER INSERT/UPDATE/DELETE trigger that snapshots
-- the row into `_oplog` (the local pending-push queue) whenever it changes.
-- Existing query code (teamQueries.ts, battleQueries.ts, ...) never has to
-- change -- the triggers do all the bookkeeping invisibly.
--
-- `_hlc` is deliberately NOT a textbook hybrid logical clock (no cross-device
-- logical counter advanced on both local writes and incoming remote data) --
-- it's wall-clock-milliseconds + a random tiebreaker + device id, zero-padded
-- so lexicographic string comparison matches chronological order. Far simpler
-- to generate from a plain SQL trigger, and good enough for a solo user's
-- occasional multi-device edits. If clock skew between devices ever actually
-- causes a lost edit in practice, the fix is a real HLC counter stored in
-- `_sync_meta` -- this schema doesn't need to change to support that later.
--
-- The reference tables (pokemon/moves/items/abilities/formats) are NOT
-- synced -- they're identical, PokeAPI-id-sourced data bundled with the app
-- on every device, not user data.

PRAGMA recursive_triggers = OFF;

CREATE TABLE _sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
-- keys used: device_id, server_url, auth_token, last_pull_seq, _applying
-- ("_applying" is a transient flag the sync-apply code sets to '1' while
-- writing incoming remote rows, so those writes don't re-trigger oplog
-- entries and echo straight back to the server they came from.)

CREATE TABLE _oplog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  op TEXT NOT NULL,       -- 'upsert' | 'delete'
  row_json TEXT NOT NULL, -- full row snapshot at the time of change (just the pk for deletes)
  hlc TEXT NOT NULL,
  pushed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_oplog_pending ON _oplog(pushed);

ALTER TABLE teams ADD COLUMN _hlc TEXT;
ALTER TABLE team_members ADD COLUMN _hlc TEXT;
ALTER TABLE battles ADD COLUMN _hlc TEXT;
ALTER TABLE battle_my_pokemon ADD COLUMN _hlc TEXT;
ALTER TABLE battle_opponent_pokemon ADD COLUMN _hlc TEXT;
ALTER TABLE battle_notes ADD COLUMN _hlc TEXT;

-- ============================== teams ==============================

CREATE TRIGGER trg_teams_oplog_insert AFTER INSERT ON teams
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE teams SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'teams', id, 'upsert',
    json_object('id', id, 'name', name, 'format_id', format_id, 'notes', notes,
                'created_at', created_at, 'updated_at', updated_at, '_hlc', _hlc),
    _hlc
  FROM teams WHERE id = NEW.id;
END;

CREATE TRIGGER trg_teams_oplog_update AFTER UPDATE ON teams
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE teams SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'teams', id, 'upsert',
    json_object('id', id, 'name', name, 'format_id', format_id, 'notes', notes,
                'created_at', created_at, 'updated_at', updated_at, '_hlc', _hlc),
    _hlc
  FROM teams WHERE id = NEW.id;
END;

CREATE TRIGGER trg_teams_oplog_delete AFTER DELETE ON teams
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('teams', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;

-- ============================== team_members ==============================

CREATE TRIGGER trg_team_members_oplog_insert AFTER INSERT ON team_members
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE team_members SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'team_members', id, 'upsert',
    json_object('id', id, 'team_id', team_id, 'slot', slot, 'pokemon_id', pokemon_id,
                'nickname', nickname, 'item_id', item_id, 'ability_id', ability_id,
                'nature', nature, 'tera_type', tera_type, 'level', level,
                'move1_id', move1_id, 'move2_id', move2_id, 'move3_id', move3_id, 'move4_id', move4_id,
                'ev_hp', ev_hp, 'ev_atk', ev_atk, 'ev_def', ev_def, 'ev_spa', ev_spa, 'ev_spd', ev_spd, 'ev_spe', ev_spe,
                'iv_hp', iv_hp, 'iv_atk', iv_atk, 'iv_def', iv_def, 'iv_spa', iv_spa, 'iv_spd', iv_spd, 'iv_spe', iv_spe,
                '_hlc', _hlc),
    _hlc
  FROM team_members WHERE id = NEW.id;
END;

CREATE TRIGGER trg_team_members_oplog_update AFTER UPDATE ON team_members
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE team_members SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'team_members', id, 'upsert',
    json_object('id', id, 'team_id', team_id, 'slot', slot, 'pokemon_id', pokemon_id,
                'nickname', nickname, 'item_id', item_id, 'ability_id', ability_id,
                'nature', nature, 'tera_type', tera_type, 'level', level,
                'move1_id', move1_id, 'move2_id', move2_id, 'move3_id', move3_id, 'move4_id', move4_id,
                'ev_hp', ev_hp, 'ev_atk', ev_atk, 'ev_def', ev_def, 'ev_spa', ev_spa, 'ev_spd', ev_spd, 'ev_spe', ev_spe,
                'iv_hp', iv_hp, 'iv_atk', iv_atk, 'iv_def', iv_def, 'iv_spa', iv_spa, 'iv_spd', iv_spd, 'iv_spe', iv_spe,
                '_hlc', _hlc),
    _hlc
  FROM team_members WHERE id = NEW.id;
END;

CREATE TRIGGER trg_team_members_oplog_delete AFTER DELETE ON team_members
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('team_members', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;

-- ============================== battles ==============================
-- Note: raw_log (a full Showdown replay log, can be tens of KB) gets
-- re-embedded in the oplog snapshot on every edit to any column of a battle
-- row, not just when raw_log itself changes. Accepted for v1 simplicity at
-- personal scale; worth splitting out separately if that ever matters.

CREATE TRIGGER trg_battles_oplog_insert AFTER INSERT ON battles
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battles SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battles', id, 'upsert',
    json_object('id', id, 'source', source, 'format_id', format_id, 'format_label', format_label,
                'my_team_id', my_team_id, 'opponent_name', opponent_name, 'event_name', event_name,
                'result', result, 'replay_url', replay_url, 'raw_log', raw_log,
                'battle_date', battle_date, 'notes', notes,
                'created_at', created_at, 'updated_at', updated_at, '_hlc', _hlc),
    _hlc
  FROM battles WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battles_oplog_update AFTER UPDATE ON battles
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battles SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battles', id, 'upsert',
    json_object('id', id, 'source', source, 'format_id', format_id, 'format_label', format_label,
                'my_team_id', my_team_id, 'opponent_name', opponent_name, 'event_name', event_name,
                'result', result, 'replay_url', replay_url, 'raw_log', raw_log,
                'battle_date', battle_date, 'notes', notes,
                'created_at', created_at, 'updated_at', updated_at, '_hlc', _hlc),
    _hlc
  FROM battles WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battles_oplog_delete AFTER DELETE ON battles
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('battles', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;

-- ============================== battle_my_pokemon ==============================

CREATE TRIGGER trg_battle_my_pokemon_oplog_insert AFTER INSERT ON battle_my_pokemon
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battle_my_pokemon SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battle_my_pokemon', id, 'upsert',
    json_object('id', id, 'battle_id', battle_id, 'pokemon_id', pokemon_id, 'item_id', item_id,
                'ability_id', ability_id, 'tera_type', tera_type, 'was_brought', was_brought,
                'notes', notes, 'move1_id', move1_id, 'move2_id', move2_id, 'move3_id', move3_id,
                'move4_id', move4_id, '_hlc', _hlc),
    _hlc
  FROM battle_my_pokemon WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battle_my_pokemon_oplog_update AFTER UPDATE ON battle_my_pokemon
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battle_my_pokemon SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battle_my_pokemon', id, 'upsert',
    json_object('id', id, 'battle_id', battle_id, 'pokemon_id', pokemon_id, 'item_id', item_id,
                'ability_id', ability_id, 'tera_type', tera_type, 'was_brought', was_brought,
                'notes', notes, 'move1_id', move1_id, 'move2_id', move2_id, 'move3_id', move3_id,
                'move4_id', move4_id, '_hlc', _hlc),
    _hlc
  FROM battle_my_pokemon WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battle_my_pokemon_oplog_delete AFTER DELETE ON battle_my_pokemon
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('battle_my_pokemon', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;

-- ============================== battle_opponent_pokemon ==============================

CREATE TRIGGER trg_battle_opponent_pokemon_oplog_insert AFTER INSERT ON battle_opponent_pokemon
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battle_opponent_pokemon SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battle_opponent_pokemon', id, 'upsert',
    json_object('id', id, 'battle_id', battle_id, 'pokemon_id', pokemon_id,
                'observed_item_id', observed_item_id, 'observed_ability_id', observed_ability_id,
                'observed_tera_type', observed_tera_type,
                'observed_move1_id', observed_move1_id, 'observed_move2_id', observed_move2_id,
                'observed_move3_id', observed_move3_id, 'observed_move4_id', observed_move4_id,
                'notes', notes, '_hlc', _hlc),
    _hlc
  FROM battle_opponent_pokemon WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battle_opponent_pokemon_oplog_update AFTER UPDATE ON battle_opponent_pokemon
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battle_opponent_pokemon SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battle_opponent_pokemon', id, 'upsert',
    json_object('id', id, 'battle_id', battle_id, 'pokemon_id', pokemon_id,
                'observed_item_id', observed_item_id, 'observed_ability_id', observed_ability_id,
                'observed_tera_type', observed_tera_type,
                'observed_move1_id', observed_move1_id, 'observed_move2_id', observed_move2_id,
                'observed_move3_id', observed_move3_id, 'observed_move4_id', observed_move4_id,
                'notes', notes, '_hlc', _hlc),
    _hlc
  FROM battle_opponent_pokemon WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battle_opponent_pokemon_oplog_delete AFTER DELETE ON battle_opponent_pokemon
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('battle_opponent_pokemon', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;

-- ============================== battle_notes ==============================

CREATE TRIGGER trg_battle_notes_oplog_insert AFTER INSERT ON battle_notes
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battle_notes SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battle_notes', id, 'upsert',
    json_object('id', id, 'battle_id', battle_id, 'turn_number', turn_number, 'tag', tag,
                'body', body, 'created_at', created_at, '_hlc', _hlc),
    _hlc
  FROM battle_notes WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battle_notes_oplog_update AFTER UPDATE ON battle_notes
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '1') ON CONFLICT(key) DO UPDATE SET value = '1';
  UPDATE battle_notes SET _hlc = (
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  ) WHERE id = NEW.id;
  INSERT INTO _sync_meta (key, value) VALUES ('_applying', '0') ON CONFLICT(key) DO UPDATE SET value = '0';
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  SELECT 'battle_notes', id, 'upsert',
    json_object('id', id, 'battle_id', battle_id, 'turn_number', turn_number, 'tag', tag,
                'body', body, 'created_at', created_at, '_hlc', _hlc),
    _hlc
  FROM battle_notes WHERE id = NEW.id;
END;

CREATE TRIGGER trg_battle_notes_oplog_delete AFTER DELETE ON battle_notes
WHEN COALESCE((SELECT value FROM _sync_meta WHERE key = '_applying'), '0') != '1'
BEGIN
  INSERT INTO _oplog (table_name, row_id, op, row_json, hlc)
  VALUES ('battle_notes', OLD.id, 'delete', json_object('id', OLD.id),
    printf('%015d', CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)) || '-' ||
    lower(hex(randomblob(4))) || '-' ||
    COALESCE((SELECT value FROM _sync_meta WHERE key = 'device_id'), 'unconfigured')
  );
END;
