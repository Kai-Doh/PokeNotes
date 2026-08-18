-- Real tournament move usage % (scraped from LimitlessVGC), same shape as
-- item_usage/ability_usage -- the per-Pokémon detail page has all three
-- tables side by side, this one was just left unparsed initially.
CREATE TABLE move_usage (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  move_id INTEGER NOT NULL REFERENCES moves(id) ON DELETE CASCADE,
  usage_pct REAL NOT NULL,
  PRIMARY KEY (format_id, pokemon_id, move_id)
);
CREATE INDEX idx_move_usage_lookup ON move_usage(format_id, pokemon_id);
