export const STEAM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS steam_apps (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  search_name TEXT,
  last_modified INTEGER,
  price_change_number INTEGER
);

CREATE INDEX IF NOT EXISTS idx_steam_apps_search_name ON steam_apps(search_name);

CREATE TABLE IF NOT EXISTS steam_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
