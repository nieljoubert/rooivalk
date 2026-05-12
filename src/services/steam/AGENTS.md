# SteamService Agent Guidelines

## Overview

SteamService fetches and caches Steam app data for use by the `get_game_listing` chat tool. It maintains a local SQLite index of the full Steam app catalogue (synced nightly) and fetches full store listing details on demand from the Steam Store API.

## Key Responsibilities

- Syncing the Steam app list from the official Web API into SQLite (`steam_apps` table)
- Searching the local index by game name
- Fetching full game details (price, description, genres, platforms) from the Store API
- Region is hardcoded to ZA (`STEAM_CC`)

## Architecture Notes

- Uses `DatabaseSync` from `node:sqlite` (Node.js built-in) — same pattern as `MemoryService`
- Opens separate write and readOnly connections to the shared `ROOIVALK_DB_PATH` database
- All types (raw API response types and the public `SteamGameDetails` return type) live in `src/services/steam/types.ts`
- `STEAM_API_KEY` is required for syncing (`GetAppList`); `appdetails` fetches require no key

## Sync Schedule

- Triggered by a `node-cron` job at `0 0 * * *` (midnight), wired up in `src/index.ts`
- If `STEAM_API_KEY` is absent, sync is skipped with a warning

## Common Tasks

| Task                       | File(s)                                                                          | Notes                                                          |
| -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Add a new store (e.g. PSN) | `tool-executor.ts`, `tool-names.ts`, both `tools.ts`                             | Add a new service class; extend the `store` enum               |
| Adjust returned fields     | `src/services/steam/index.ts` (`getGameDetails`) + `src/services/steam/types.ts` | Keep `SteamGameDetails` minimal                                |
| Change sync frequency      | `src/index.ts`                                                                   | Modify the cron expression                                     |
| Add price-change tracking  | `src/services/steam/index.ts`, `schema.ts`                                       | `price_change_number` is already stored — compare on each sync |
