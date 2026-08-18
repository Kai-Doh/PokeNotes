-- Real tournament usage % (scraped from LimitlessVGC's public rankings) for
-- the current official format, surfaced in the Team Builder's pickers as
-- "what's actually being played" alongside the legality data.
CREATE TABLE pokemon_usage (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  rank INTEGER,
  usage_pct REAL NOT NULL,
  PRIMARY KEY (format_id, pokemon_id)
);
CREATE INDEX idx_pokemon_usage_format ON pokemon_usage(format_id);

CREATE TABLE item_usage (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  usage_pct REAL NOT NULL,
  PRIMARY KEY (format_id, pokemon_id, item_id)
);
CREATE INDEX idx_item_usage_lookup ON item_usage(format_id, pokemon_id);

CREATE TABLE ability_usage (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  usage_pct REAL NOT NULL,
  PRIMARY KEY (format_id, pokemon_id, ability_id)
);
CREATE INDEX idx_ability_usage_lookup ON ability_usage(format_id, pokemon_id);
