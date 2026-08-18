-- Small key/value store for app-level bookkeeping (e.g. when the bundled
-- pokedex data was last refreshed from the remote source).
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
