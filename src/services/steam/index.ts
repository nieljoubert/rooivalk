import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { STEAM_CC, STEAM_USER_AGENT } from '../../constants.ts';
import { STEAM_SCHEMA_SQL } from './schema.ts';
import type {
  AppDetailsResponse,
  GetAppListResponse,
  SteamGameDetails,
} from './types.ts';

const META_LAST_SYNCED = 'last_synced';

function toSearchName(name: string): string {
  return name
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

class SteamService {
  private _writeDb: DatabaseSync;
  private _readDb: DatabaseSync;
  private _apiKey?: string;

  constructor(dbPath: string, apiKey?: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this._apiKey = apiKey;
    this._writeDb = new DatabaseSync(dbPath);
    this._writeDb.exec(STEAM_SCHEMA_SQL);
    this._readDb = new DatabaseSync(dbPath, { readOnly: true });
  }

  public async syncAppList(): Promise<void> {
    if (!this._apiKey) {
      console.warn('[SteamService] STEAM_API_KEY not set — skipping sync');
      return;
    }

    console.log('[SteamService] Syncing Steam app list...');

    const upsert = this._writeDb.prepare(
      `INSERT OR REPLACE INTO steam_apps (appid, name, search_name, last_modified, price_change_number)
       VALUES (?, ?, ?, ?, ?)`,
    );

    let lastAppId: number | undefined;
    let totalSynced = 0;

    do {
      const url = new URL(
        'https://api.steampowered.com/IStoreService/GetAppList/v1/',
      );
      url.searchParams.set('key', this._apiKey);
      url.searchParams.set('include_games', '1');
      url.searchParams.set('include_dlc', '1');
      url.searchParams.set('include_software', '0');
      url.searchParams.set('include_videos', '0');
      url.searchParams.set('include_hardware', '0');
      url.searchParams.set('max_results', '50000');
      if (lastAppId !== undefined) {
        url.searchParams.set('last_appid', String(lastAppId));
      }

      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': STEAM_USER_AGENT },
      });

      if (!response.ok) {
        throw new Error(
          `GetAppList failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as GetAppListResponse;
      const { apps, have_more_results, last_appid } = data.response;

      this._writeDb.exec('BEGIN');
      try {
        for (const app of apps) {
          upsert.run(
            app.appid,
            app.name,
            toSearchName(app.name),
            app.last_modified ?? null,
            app.price_change_number ?? null,
          );
        }
        this._writeDb.exec('COMMIT');
      } catch (err) {
        this._writeDb.exec('ROLLBACK');
        throw err;
      }

      totalSynced += apps.length;

      if (have_more_results && last_appid == null) {
        throw new Error(
          '[SteamService] have_more_results is true but last_appid is missing — aborting sync',
        );
      }
      lastAppId = have_more_results ? last_appid : undefined;
    } while (lastAppId !== undefined);

    this._writeDb
      .prepare(`INSERT OR REPLACE INTO steam_meta (key, value) VALUES (?, ?)`)
      .run(META_LAST_SYNCED, String(Date.now()));

    console.log(`[SteamService] Sync complete: ${totalSynced} apps indexed`);
  }

  public findGame(query: string): { appid: number; name: string } | null {
    const normalized = toSearchName(query);
    const escaped = normalized.replace(/[%_\\]/g, '\\$&');
    const row = this._readDb
      .prepare(
        `SELECT appid, name FROM steam_apps
         WHERE search_name LIKE ? ESCAPE '\\'
         ORDER BY CASE WHEN search_name = ? THEN 0 ELSE 1 END, name
         LIMIT 1`,
      )
      .get(`%${escaped}%`, normalized) as
      | { appid: number; name: string }
      | undefined;

    return row ?? null;
  }

  public async getGameDetails(appId: number): Promise<SteamGameDetails | null> {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=${STEAM_CC}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': STEAM_USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(
        `appdetails failed: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as AppDetailsResponse;
    const entry = data[String(appId)];

    if (!entry?.success || !entry.data) {
      return null;
    }

    const d = entry.data;

    return {
      appid: d.steam_appid,
      name: d.name,
      store_url: `https://store.steampowered.com/app/${d.steam_appid}/`,
      is_free: d.is_free,
      short_description: d.short_description,
      developers: d.developers ?? [],
      publishers: d.publishers ?? [],
      price: d.price_overview
        ? {
            currency: d.price_overview.currency,
            initial_formatted: d.price_overview.initial_formatted,
            final_formatted: d.price_overview.final_formatted,
            discount_percent: d.price_overview.discount_percent,
          }
        : undefined,
      genres: d.genres?.map((g) => g.description) ?? [],
      categories: d.categories?.map((c) => c.description) ?? [],
      release_date: d.release_date?.date ?? '',
      header_image: d.header_image ?? '',
      platforms: d.platforms ?? { windows: false, mac: false, linux: false },
      achievements_total: d.achievements?.total ?? 0,
      recommendations_total: d.recommendations?.total ?? 0,
      supported_languages: d.supported_languages ?? '',
    };
  }
  public close(): void {
    this._writeDb.close();
    this._readDb.close();
  }
}

export default SteamService;
