-- Core Pokedex: every species AND every alternate form (mega, gmax, regional, etc.)
-- gets its own row, since forms differ in stats/types/abilities.
CREATE TABLE pokemon (
  id INTEGER PRIMARY KEY,              -- PokeAPI pokemon id
  species_id INTEGER NOT NULL,         -- PokeAPI species id, shared across forms of one species
  national_dex_number INTEGER NOT NULL,
  name TEXT NOT NULL UNIQUE,           -- e.g. "charizard-mega-x"
  display_name TEXT NOT NULL,          -- e.g. "Charizard"
  form_label TEXT,                     -- e.g. "Mega Charizard X", NULL for base form
  is_default_form INTEGER NOT NULL DEFAULT 0,
  form_category TEXT,                  -- 'mega','gmax','regional','alolan','galarian','hisuian','paldean','other', NULL for base
  generation INTEGER,
  type1 TEXT NOT NULL,
  type2 TEXT,
  base_hp INTEGER NOT NULL, base_atk INTEGER NOT NULL, base_def INTEGER NOT NULL,
  base_spa INTEGER NOT NULL, base_spd INTEGER NOT NULL, base_spe INTEGER NOT NULL,
  height_dm INTEGER, weight_hg INTEGER,
  sprite_default TEXT,
  sprite_shiny TEXT,
  sprite_official_art TEXT,
  sprite_home TEXT,
  is_mega INTEGER NOT NULL DEFAULT 0,
  is_gmax INTEGER NOT NULL DEFAULT 0,
  is_legendary INTEGER NOT NULL DEFAULT 0,
  is_mythical INTEGER NOT NULL DEFAULT 0,
  is_restricted INTEGER NOT NULL DEFAULT 0,  -- curated: VGC-style "restricted legendary" flag
  showdown_id TEXT UNIQUE                    -- normalized Showdown id, e.g. "charizardmegax"
);

CREATE TABLE abilities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  short_effect TEXT,
  effect TEXT,
  generation INTEGER
);

CREATE TABLE pokemon_abilities (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  is_hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pokemon_id, ability_id, slot)
);

CREATE TABLE moves (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,          -- Showdown-style id, e.g. "closecombat"
  display_name TEXT NOT NULL,         -- "Close Combat"
  type TEXT NOT NULL,
  category TEXT NOT NULL,             -- physical | special | status
  power INTEGER,
  accuracy INTEGER,                   -- NULL = never misses
  pp INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  target TEXT,
  short_effect TEXT,
  effect TEXT,
  generation INTEGER,
  is_zmove INTEGER NOT NULL DEFAULT 0,
  is_max_move INTEGER NOT NULL DEFAULT 0,
  flags TEXT                          -- JSON blob of Showdown move flags (contact, protect, sound, ...)
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT,
  short_effect TEXT,
  effect TEXT,
  sprite TEXT,
  generation INTEGER
);

CREATE TABLE learnsets (
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  move_id INTEGER NOT NULL REFERENCES moves(id) ON DELETE CASCADE,
  method TEXT NOT NULL,               -- level-up | machine | egg | tutor | other
  level INTEGER,                      -- for level-up method
  generation INTEGER NOT NULL,
  PRIMARY KEY (pokemon_id, move_id, method, generation)
);

-- Competitive formats: both Showdown tiers (gen9ou, gen9vgc2024regh, ...)
-- and official VGC/Championship regulations you log "Champions" battles against.
CREATE TABLE formats (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,          -- "gen9ou", "vgc2024regh", "gen9nationaldex"
  name TEXT NOT NULL,                 -- "Gen 9 OU"
  source TEXT NOT NULL,               -- 'showdown' | 'official'
  generation INTEGER,
  is_doubles INTEGER NOT NULL DEFAULT 0,
  ruleset TEXT                        -- JSON blob: clauses, level cap, restricted-legendary count, etc.
);

CREATE TABLE format_legality (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id) ON DELETE CASCADE,
  status TEXT NOT NULL,               -- 'allowed' | 'banned' | 'restricted'
  tier TEXT,                          -- Showdown tier tag, e.g. "OU", "UU", "Uber"
  notes TEXT,
  PRIMARY KEY (format_id, pokemon_id)
);

CREATE TABLE format_banned_items (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (format_id, item_id)
);

CREATE TABLE format_banned_moves (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  move_id INTEGER NOT NULL REFERENCES moves(id) ON DELETE CASCADE,
  PRIMARY KEY (format_id, move_id)
);

CREATE TABLE format_banned_abilities (
  format_id INTEGER NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
  ability_id INTEGER NOT NULL REFERENCES abilities(id) ON DELETE CASCADE,
  PRIMARY KEY (format_id, ability_id)
);

-- Reusable team builds
CREATE TABLE teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  format_id INTEGER REFERENCES formats(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),
  nickname TEXT,
  item_id INTEGER REFERENCES items(id),
  ability_id INTEGER REFERENCES abilities(id),
  nature TEXT,
  tera_type TEXT,
  level INTEGER NOT NULL DEFAULT 100,
  move1_id INTEGER REFERENCES moves(id),
  move2_id INTEGER REFERENCES moves(id),
  move3_id INTEGER REFERENCES moves(id),
  move4_id INTEGER REFERENCES moves(id),
  ev_hp INTEGER NOT NULL DEFAULT 0, ev_atk INTEGER NOT NULL DEFAULT 0, ev_def INTEGER NOT NULL DEFAULT 0,
  ev_spa INTEGER NOT NULL DEFAULT 0, ev_spd INTEGER NOT NULL DEFAULT 0, ev_spe INTEGER NOT NULL DEFAULT 0,
  iv_hp INTEGER NOT NULL DEFAULT 31, iv_atk INTEGER NOT NULL DEFAULT 31, iv_def INTEGER NOT NULL DEFAULT 31,
  iv_spa INTEGER NOT NULL DEFAULT 31, iv_spd INTEGER NOT NULL DEFAULT 31, iv_spe INTEGER NOT NULL DEFAULT 31
);

-- Battle notes: the core feature. Source distinguishes Showdown imports,
-- official "Pokemon Champions" app battles, and fully manual entries.
CREATE TABLE battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                -- 'showdown' | 'champions' | 'manual'
  format_id INTEGER REFERENCES formats(id),
  my_team_id INTEGER REFERENCES teams(id),
  opponent_name TEXT,
  event_name TEXT,                     -- tournament/event, for champion battles
  result TEXT,                         -- 'win' | 'loss' | 'tie'
  replay_url TEXT,
  raw_log TEXT,                        -- full Showdown replay log text, if imported
  battle_date TEXT,
  notes TEXT,                          -- freeform overall analysis
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- What I actually used in this specific battle (may diverge from a saved team,
-- e.g. VGC "bring 4 of 6")
CREATE TABLE battle_my_pokemon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),
  item_id INTEGER REFERENCES items(id),
  ability_id INTEGER REFERENCES abilities(id),
  tera_type TEXT,
  was_brought INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

-- Opponent's scouted team (sets may be partially known)
CREATE TABLE battle_opponent_pokemon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  battle_id INTEGER NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),
  observed_item_id INTEGER REFERENCES items(id),
  observed_ability_id INTEGER REFERENCES abilities(id),
  observed_tera_type TEXT,
  observed_move1_id INTEGER REFERENCES moves(id),
  observed_move2_id INTEGER REFERENCES moves(id),
  observed_move3_id INTEGER REFERENCES moves(id),
  observed_move4_id INTEGER REFERENCES moves(id),
  notes TEXT
);

CREATE INDEX idx_pokemon_species ON pokemon(species_id);
CREATE INDEX idx_pokemon_dex ON pokemon(national_dex_number);
CREATE INDEX idx_learnsets_pokemon ON learnsets(pokemon_id);
CREATE INDEX idx_learnsets_move ON learnsets(move_id);
CREATE INDEX idx_format_legality_format ON format_legality(format_id);
CREATE INDEX idx_format_legality_pokemon ON format_legality(pokemon_id);
CREATE INDEX idx_battles_format ON battles(format_id);
CREATE INDEX idx_battle_my_pokemon_battle ON battle_my_pokemon(battle_id);
CREATE INDEX idx_battle_opponent_pokemon_battle ON battle_opponent_pokemon(battle_id);
CREATE INDEX idx_team_members_team ON team_members(team_id);
