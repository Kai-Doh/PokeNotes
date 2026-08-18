-- Whether a battle item actually exists/isn't banned in a given format --
-- distinct from is_battle_item (which just says "plausible held item" at
-- all, globally). Some items exist in the game data but not in Gen 9 at
-- all (isNonstandard "Past", e.g. Mega Stones outside National Dex), and
-- some are banned per-format on top of that (e.g. Ability Shield in the
-- Champions ruleset) -- both only resolvable by asking Showdown's own
-- validator per format, not by inspecting the item alone.
CREATE TABLE item_legality (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  PRIMARY KEY (format_id, item_id)
);
CREATE INDEX idx_item_legality_format ON item_legality(format_id);
