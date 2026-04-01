import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { YR_COORDINATES } from '@/constants';
import WikimediaService from '.';

const TEST_LOCATION = Object.values(YR_COORDINATES)[0];

const VALID_API_RESPONSE = {
  query: {
    pages: {
      '1': {
        title: 'File:Dubai Marina Skyline.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/commons/a/a1/Dubai_Marina_Skyline.jpg',
            descriptionurl:
              'https://commons.wikimedia.org/wiki/File:Dubai_Marina_Skyline.jpg',
            mime: 'image/jpeg',
          },
        ],
      },
      '2': {
        title: 'File:Dubai Map.svg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/commons/b/b2/Dubai_Map.svg',
            descriptionurl:
              'https://commons.wikimedia.org/wiki/File:Dubai_Map.svg',
            mime: 'image/svg+xml',
          },
        ],
      },
    },
  },
};

describe('WikimediaService', () => {
  let service: WikimediaService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new WikimediaService();
    fetchSpy = vi.spyOn(global as any, 'fetch');
    // Pin random to select the first image from search results
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns image buffer and metadata on success', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => VALID_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '3' }),
        arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
      } as unknown as Response);

    const image = await service.getCityImage(TEST_LOCATION);

    expect(image).not.toBeNull();
    expect(image?.title).toBe('Dubai Marina Skyline');
    expect(image?.cityName).toBe('Bonnievale, South Africa');
    expect(image?.mimeType).toBe('image/jpeg');
    expect(image?.sourceUrl).toBe(
      'https://commons.wikimedia.org/wiki/File:Dubai_Marina_Skyline.jpg',
    );
    expect(image?.buffer).toBeInstanceOf(Buffer);
    expect(image?.buffer.length).toBe(3);
  });

  it('filters out non-photo MIME types', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => VALID_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '1' }),
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      } as unknown as Response);

    const image = await service.getCityImage(TEST_LOCATION);

    // Should pick the JPEG, not the SVG
    expect(image?.title).toBe('Dubai Marina Skyline');
  });

  it('throws when API returns non-OK status', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
    } as Response);

    await expect(service.getCityImage(TEST_LOCATION)).rejects.toThrow(
      'Wikimedia API returned 500 Server Error',
    );
  });

  it('returns null when API response has no pages', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: {} }),
    } as Response);

    const image = await service.getCityImage(TEST_LOCATION);
    expect(image).toBeNull();
  });

  it('returns null when all pages have non-image MIME types', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '1': {
              title: 'File:Map.svg',
              imageinfo: [
                {
                  url: 'https://example.com/map.svg',
                  mime: 'image/svg+xml',
                },
              ],
            },
          },
        },
      }),
    } as Response);

    const image = await service.getCityImage(TEST_LOCATION);
    expect(image).toBeNull();
  });

  it('throws when image download fails', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => VALID_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

    await expect(service.getCityImage(TEST_LOCATION)).rejects.toThrow(
      'Image download returned 404 Not Found',
    );
  });

  it('throws when fetch throws a network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    await expect(service.getCityImage(TEST_LOCATION)).rejects.toThrow(
      'Network error',
    );
  });

  it('sanitizes title with multiple dots correctly', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          query: {
            pages: {
              '1': {
                title: 'File:St.Paul.Cathedral.jpg',
                imageinfo: [
                  {
                    url: 'https://example.com/img.jpg',
                    descriptionurl: 'https://example.com/desc',
                    mime: 'image/jpeg',
                  },
                ],
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '1' }),
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      } as unknown as Response);

    const image = await service.getCityImage(TEST_LOCATION);
    expect(image?.title).toBe('St.Paul.Cathedral');
  });

  it('throws when API returns error in response body', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        error: { code: 'nosearch', info: 'search is disabled' },
      }),
    } as Response);

    await expect(service.getCityImage(TEST_LOCATION)).rejects.toThrow(
      'Wikimedia API error',
    );
  });

  it('returns null when response has no query key at all', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const image = await service.getCityImage(TEST_LOCATION);
    expect(image).toBeNull();
  });

  it('returns null and warns when image exceeds size limit', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => VALID_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({
          'content-length': String(20 * 1024 * 1024),
        }),
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      } as unknown as Response);

    const image = await service.getCityImage(TEST_LOCATION);
    expect(image).toBeNull();
  });

  it('throws when image download fetch throws a network error', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => VALID_API_RESPONSE,
      } as Response)
      .mockRejectedValueOnce(new Error('Connection reset'));

    await expect(service.getCityImage(TEST_LOCATION)).rejects.toThrow(
      'Image download failed for',
    );
  });

  it('throws when arrayBuffer() fails during image body read', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => VALID_API_RESPONSE,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-length': '3' }),
        arrayBuffer: async () => {
          throw new Error('Unexpected end of stream');
        },
      } as unknown as Response);

    await expect(service.getCityImage(TEST_LOCATION)).rejects.toThrow(
      'Image body read failed for',
    );
  });

  it('builds search URL with correct parameters', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ query: {} }),
    } as Response);

    await service.getCityImage(TEST_LOCATION);

    const url = String(fetchSpy.mock.calls[0]?.[0]);
    expect(url).toContain('commons.wikimedia.org');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('gsrsearch')).toBe(TEST_LOCATION.name);
    expect(url).toContain('gsrnamespace=6');
    expect(url).toContain('gsrlimit=20');
    expect(url).toContain('iiprop=url');
    expect(url).toContain('format=json');
  });
});
