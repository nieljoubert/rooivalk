import type { PeapixFeedResponseItem } from '@/types';

const PEAPIX_BING_FEED_URL = 'https://peapix.com/bing/feed';
const PEAPIX_COUNTRY = 'gb';
const PEAPIX_FEED_COUNT = '1';

export type PeapixImage = {
  title: string;
  copyright: string;
  pageUrl: string;
  buffer: Buffer;
};

class PeapixService {
  private buildFeedUrl(): string {
    const feedUrl = new URL(PEAPIX_BING_FEED_URL);

    feedUrl.searchParams.set('country', PEAPIX_COUNTRY);
    feedUrl.searchParams.set('n', PEAPIX_FEED_COUNT);
    // Cache-bust: the Peapix API does not appear to use this parameter
    feedUrl.searchParams.set('date', Date.now().toString());

    return feedUrl.toString();
  }

  private isFeedItem(item: unknown): item is PeapixFeedResponseItem {
    if (!item || typeof item !== 'object') {
      return false;
    }

    const record = item as Record<string, unknown>;
    return (
      typeof record.title === 'string' &&
      typeof record.copyright === 'string' &&
      typeof record.fullUrl === 'string' &&
      typeof record.thumbUrl === 'string' &&
      typeof record.imageUrl === 'string' &&
      typeof record.pageUrl === 'string'
    );
  }

  private async getFeedImage(): Promise<PeapixFeedResponseItem | null> {
    const response = await fetch(this.buildFeedUrl());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Peapix Bing feed: ${response.status} ${response.statusText}`,
      );
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload) || payload.length === 0) {
      return null;
    }

    const first = payload[0];
    if (!this.isFeedItem(first)) {
      console.warn(
        'Peapix feed item failed type validation:',
        JSON.stringify(first),
      );
      return null;
    }

    return first;
  }

  public async getImage(): Promise<PeapixImage | null> {
    const feedImage = await this.getFeedImage();
    if (!feedImage) {
      return null;
    }

    const imageResponse = await fetch(feedImage.fullUrl);
    if (!imageResponse.ok) {
      throw new Error(
        `Peapix image fetch failed: ${imageResponse.status} ${imageResponse.statusText}`,
      );
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    return {
      title: feedImage.title,
      copyright: feedImage.copyright,
      pageUrl: feedImage.pageUrl,
      buffer: Buffer.from(arrayBuffer),
    };
  }
}

export default PeapixService;
