import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PeapixService from '.';

describe('PeapixService', () => {
  let peapixService: PeapixService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    peapixService = new PeapixService();
    fetchSpy = vi.spyOn(global as any, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches feed with hardcoded US country and single item count', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            title: 'Cape Town Dawn',
            copyright: '© Test',
            fullUrl: 'https://images.example.com/a.jpg',
            thumbUrl: 'https://images.example.com/a_640.jpg',
            imageUrl: 'https://images.example.com/a_base.jpg',
            pageUrl: 'https://peapix.com/bing/1',
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      } as Response);

    await peapixService.getImage();

    const firstCallUrl = String(fetchSpy.mock.calls[0]?.[0]);
    expect(firstCallUrl).toContain('https://peapix.com/bing/feed');
    expect(firstCallUrl).toContain('country=gb');
    expect(firstCallUrl).toContain('n=1');
    expect(firstCallUrl).toContain('date=');
  });

  it('returns image buffer and metadata when feed and image fetch succeed', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            title: 'Dune Patrol',
            copyright: '© Eric Yang/Getty Image',
            fullUrl: 'https://images.example.com/a.jpg',
            thumbUrl: 'https://images.example.com/a_640.jpg',
            imageUrl: 'https://images.example.com/a_base.jpg',
            pageUrl: 'https://peapix.com/bing/1',
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
      } as Response);

    const image = await peapixService.getImage();

    expect(image).not.toBeNull();
    expect(image?.title).toBe('Dune Patrol');
    expect(image?.copyright).toBe('© Eric Yang/Getty Image');
    expect(image?.pageUrl).toBe('https://peapix.com/bing/1');
    expect(image?.buffer).toBeInstanceOf(Buffer);
    expect(image?.buffer.length).toBe(3);
  });

  it('returns null when feed is empty', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    const image = await peapixService.getImage();
    expect(image).toBeNull();
  });

  it('throws when feed fetch fails', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    } as Response);

    await expect(peapixService.getImage()).rejects.toThrow(
      'Failed to fetch Peapix Bing feed: 500 Server Error',
    );
  });

  it('throws when image fetch fails', async () => {
    fetchSpy
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            title: 'Dune Patrol',
            copyright: '© Eric Yang/Getty Image',
            fullUrl: 'https://images.example.com/a.jpg',
            thumbUrl: 'https://images.example.com/a_640.jpg',
            imageUrl: 'https://images.example.com/a_base.jpg',
            pageUrl: 'https://peapix.com/bing/1',
          },
        ],
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      } as Response);

    await expect(peapixService.getImage()).rejects.toThrow(
      'Peapix image fetch failed: 404 Not Found',
    );
  });
});
