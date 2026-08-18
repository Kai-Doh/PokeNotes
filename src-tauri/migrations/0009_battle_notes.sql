-- Free-text label for the format as reported by the source (e.g. Showdown's
-- "[Gen 9] VGC 2024 Reg H"), kept alongside the best-effort formats.id match
-- since most VGC regulation codes aren't in our formats table.
ALTER TABLE battles ADD COLUMN format_label TEXT;

-- Timeline annotations: one row per note, optionally pinned to a turn number
-- (NULL = battle-level note) with an optional tag chip (misplay/good_read/etc,
-- free text so the UI can offer presets without a rigid CHECK constraint).
CREATE TABLE battle_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  turn_number INTEGER,
  tag TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_battle_notes_battle ON battle_notes(battle_id);

-- The scouting-book lookup ("every set I've seen for this species") filters
-- battle_opponent_pokemon by pokemon_id across all battles; it only had a
-- battle_id index before.
CREATE INDEX idx_battle_opponent_pokemon_pokemon ON battle_opponent_pokemon(pokemon_id);
