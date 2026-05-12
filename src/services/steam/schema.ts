export const STEAM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS steam_apps (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  last_modified INTEGER,
  price_change_number INTEGER
);

CREATE INDEX IF NOT EXISTS idx_steam_apps_name ON steam_apps(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS steam_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
