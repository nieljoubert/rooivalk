import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import SteamService from './index.ts';

const mockFetch = vi.fn();

describe('SteamService', () => {
  let tmpDir: string;
  let dbPath: string;
  let service: SteamService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rooivalk-steam-'));
    dbPath = join(tmpDir, 'test.db');
    service = new SteamService(dbPath);
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    service.close();
    vi.unstubAllGlobals();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findGame', () => {
    it('returns null when no apps exist', () => {
      expect(service.findGame('Elden Ring')).toBeNull();
    });

    it('finds a game by partial match', () => {
      (service as any)._writeDb.exec(
        "INSERT INTO steam_apps (appid, name, search_name) VALUES (1245620, 'Elden Ring', 'elden ring')",
      );
      const result = service.findGame('Elden');
      expect(result).not.toBeNull();
      expect(result!.appid).toBe(1245620);
      expect(result!.name).toBe('Elden Ring');
    });

    it('is case-insensitive', () => {
      (service as any)._writeDb.exec(
        "INSERT INTO steam_apps (appid, name, search_name) VALUES (1245620, 'Elden Ring', 'elden ring')",
      );
      expect(service.findGame('elden ring')).not.toBeNull();
    });

    it('sorts exact matches before partial matches', () => {
      (service as any)._writeDb.exec(
        "INSERT INTO steam_apps (appid, name, search_name) VALUES (1, 'Elden Ring Nightreign', 'elden ring nightreign')",
      );
      (service as any)._writeDb.exec(
        "INSERT INTO steam_apps (appid, name, search_name) VALUES (2, 'Elden Ring', 'elden ring')",
      );
      const result = service.findGame('Elden Ring');
      expect(result!.appid).toBe(2);
    });

    it('returns null when no name matches', () => {
      (service as any)._writeDb.exec(
        "INSERT INTO steam_apps (appid, name, search_name) VALUES (1, 'Elden Ring', 'elden ring')",
      );
      expect(service.findGame('Minecraft')).toBeNull();
    });

    it('finds a game with trademark symbols by plain-text query', () => {
      (service as any)._writeDb.exec(
        "INSERT INTO steam_apps (appid, name, search_name) VALUES (553850, 'HELLDIVERS™ 2', 'helldivers 2')",
      );
      const result = service.findGame('Helldivers 2');
      expect(result).not.toBeNull();
      expect(result!.appid).toBe(553850);
      expect(result!.name).toBe('HELLDIVERS™ 2');
    });
  });

  describe('getGameDetails', () => {
    const appId = 1245620;

    function makeApiResponse(data: object) {
      return {
        ok: true,
        json: async () => ({ [appId]: data }),
      };
    }

    it('returns SteamGameDetails mapped from the API response', async () => {
      mockFetch.mockResolvedValue(
        makeApiResponse({
          success: true,
          data: {
            name: 'Elden Ring',
            steam_appid: appId,
            is_free: false,
            short_description: 'An open world action RPG.',
            developers: ['FromSoftware'],
            publishers: ['Bandai Namco'],
            price_overview: {
              currency: 'ZAR',
              initial_formatted: 'R1,049',
              final_formatted: 'R999',
              discount_percent: 5,
            },
            genres: [
              { id: '1', description: 'Action' },
              { id: '2', description: 'RPG' },
            ],
            categories: [{ id: 1, description: 'Single-player' }],
            release_date: { date: '25 Feb, 2022' },
            header_image: 'https://cdn.steam.com/header.jpg',
            platforms: { windows: true, mac: false, linux: false },
            achievements: { total: 42 },
            recommendations: { total: 100000 },
            supported_languages: 'English, Japanese',
          },
        }),
      );

      const details = await service.getGameDetails(appId);

      expect(details).not.toBeNull();
      expect(details!.appid).toBe(appId);
      expect(details!.store_url).toBe(
        `https://store.steampowered.com/app/${appId}/`,
      );
      expect(details!.name).toBe('Elden Ring');
      expect(details!.is_free).toBe(false);
      expect(details!.genres).toEqual(['Action', 'RPG']);
      expect(details!.categories).toEqual(['Single-player']);
      expect(details!.achievements_total).toBe(42);
      expect(details!.recommendations_total).toBe(100000);
      expect(details!.price).toEqual({
        currency: 'ZAR',
        initial_formatted: 'R1,049',
        final_formatted: 'R999',
        discount_percent: 5,
      });
      expect(details!.platforms).toEqual({
        windows: true,
        mac: false,
        linux: false,
      });
    });

    it('returns null when success is false', async () => {
      mockFetch.mockResolvedValue(makeApiResponse({ success: false }));
      expect(await service.getGameDetails(appId)).toBeNull();
    });

    it('returns null when data is missing from a successful response', async () => {
      mockFetch.mockResolvedValue(makeApiResponse({ success: true }));
      expect(await service.getGameDetails(appId)).toBeNull();
    });

    it('throws when the API returns a non-ok HTTP status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });
      await expect(service.getGameDetails(appId)).rejects.toThrow(
        'appdetails failed: 429',
      );
    });

    it('handles a free game with no price_overview', async () => {
      mockFetch.mockResolvedValue(
        makeApiResponse({
          success: true,
          data: {
            name: 'Counter-Strike 2',
            steam_appid: appId,
            is_free: true,
            short_description: 'Free to play.',
            platforms: { windows: true, mac: false, linux: true },
          },
        }),
      );

      const details = await service.getGameDetails(appId);
      expect(details!.is_free).toBe(true);
      expect(details!.price).toBeUndefined();
      expect(details!.genres).toEqual([]);
      expect(details!.categories).toEqual([]);
      expect(details!.achievements_total).toBe(0);
      expect(details!.supported_languages).toBe('');
    });

    it('includes the ZA country code in the request URL', async () => {
      mockFetch.mockResolvedValue(
        makeApiResponse({
          success: true,
          data: {
            name: 'Test Game',
            steam_appid: appId,
            is_free: true,
            short_description: 'Test.',
          },
        }),
      );

      await service.getGameDetails(appId);
      const calledUrl = mockFetch.mock.calls[0]![0] as string;
      expect(calledUrl).toContain('cc=ZA');
      expect(calledUrl).toContain(`appids=${appId}`);
    });
  });

  describe('syncAppList', () => {
    it('warns and skips fetch when no API key is set', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await service.syncAppList();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('STEAM_API_KEY not set'),
      );
      expect(mockFetch).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('inserts apps into the database and records last_synced', async () => {
      const serviceWithKey = new SteamService(
        join(tmpDir, 'sync.db'),
        'test-api-key',
      );

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            apps: [
              {
                appid: 1,
                name: 'Game A',
                last_modified: 1234567890,
                price_change_number: 0,
              },
              { appid: 2, name: 'Game B' },
            ],
            have_more_results: false,
          },
        }),
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await serviceWithKey.syncAppList();
      logSpy.mockRestore();

      const row = (serviceWithKey as any)._readDb
        .prepare('SELECT name FROM steam_apps WHERE appid = ?')
        .get(1) as { name: string } | undefined;
      expect(row?.name).toBe('Game A');

      const meta = (serviceWithKey as any)._readDb
        .prepare("SELECT value FROM steam_meta WHERE key = 'last_synced'")
        .get() as { value: string } | undefined;
      expect(Number(meta?.value)).toBeGreaterThan(0);

      serviceWithKey.close();
    });

    it('follows pagination until have_more_results is false', async () => {
      const serviceWithKey = new SteamService(
        join(tmpDir, 'sync.db'),
        'test-api-key',
      );

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: {
              apps: [{ appid: 1, name: 'Page 1 Game' }],
              have_more_results: true,
              last_appid: 1,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            response: {
              apps: [{ appid: 2, name: 'Page 2 Game' }],
              have_more_results: false,
            },
          }),
        });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await serviceWithKey.syncAppList();
      logSpy.mockRestore();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondUrl = mockFetch.mock.calls[1]![0] as string;
      expect(secondUrl).toContain('last_appid=1');

      serviceWithKey.close();
    });

    it('throws when GetAppList returns a non-ok HTTP status', async () => {
      const serviceWithKey = new SteamService(
        join(tmpDir, 'sync.db'),
        'test-api-key',
      );

      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(serviceWithKey.syncAppList()).rejects.toThrow(
        'GetAppList failed: 403',
      );

      serviceWithKey.close();
    });
  });

  describe('read-only handle', () => {
    it('rejects writes at the SQLite level', () => {
      const readDb = (service as any)._readDb as {
        exec: (sql: string) => void;
      };
      expect(() =>
        readDb.exec("INSERT INTO steam_apps (appid, name) VALUES (99, 'Test')"),
      ).toThrow();
    });
  });
});
