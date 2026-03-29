import type { WeatherLocation } from '@/types';

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type WikimediaMimeType = (typeof IMAGE_MIMES)[number];

function isWikimediaMime(mime: string): mime is WikimediaMimeType {
  return (IMAGE_MIMES as readonly string[]).includes(mime);
}

export type WikimediaImage = {
  title: string;
  cityName: string;
  mimeType: WikimediaMimeType;
  sourceUrl: string;
  buffer: Buffer;
};

type WikimediaQueryResponse = {
  error?: { code: string; info: string };
  query?: {
    pages?: Record<
      string,
      {
        title: string;
        imageinfo?: {
          url: string;
          descriptionurl: string;
          mime: string;
        }[];
      }
    >;
  };
};

const WIKIMEDIA_API_URL = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'rooivalk github.com/fjlaubscher/rooivalk';

class WikimediaService {
  private buildSearchUrl(searchTerm: string): string {
    const url = new URL(WIKIMEDIA_API_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrsearch', searchTerm);
    url.searchParams.set('gsrlimit', '20');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|mime');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    return url.toString();
  }

  public async getCityImage(
    location: WeatherLocation,
  ): Promise<WikimediaImage | null> {
    const searchTerm = location.name;

    try {
      const response = await fetch(this.buildSearchUrl(searchTerm), {
        headers: { 'User-Agent': USER_AGENT },
      });

      if (!response.ok) {
        console.error(
          `Wikimedia API returned ${response.status} ${response.statusText} for "${searchTerm}"`,
        );
        return null;
      }

      const data = (await response.json()) as WikimediaQueryResponse;
      if (data.error) {
        console.error(
          `Wikimedia API error for "${searchTerm}": ${data.error.code} - ${data.error.info}`,
        );
        return null;
      }

      const pages = data.query?.pages;
      if (!pages) {
        console.warn(`Wikimedia returned no pages for "${searchTerm}"`);
        return null;
      }

      // Filter to raster photo formats (JPEG, PNG, WebP); excludes SVGs and other non-raster types
      const imagePages = Object.values(pages).filter((page) => {
        const info = page.imageinfo?.[0];
        return info?.url && isWikimediaMime(info.mime);
      });

      if (imagePages.length === 0) {
        console.warn(
          `No suitable images found on Wikimedia for "${searchTerm}" (${Object.keys(pages).length} pages checked)`,
        );
        return null;
      }

      const picked = imagePages[Math.floor(Math.random() * imagePages.length)];
      const imageInfo = picked.imageinfo?.[0];
      if (!imageInfo?.url || !isWikimediaMime(imageInfo.mime)) {
        console.warn(
          `Wikimedia: picked image "${picked.title}" for "${searchTerm}" but imageInfo was unexpectedly missing`,
        );
        return null;
      }

      const imageResponse = await fetch(imageInfo.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (!imageResponse.ok) {
        console.error(
          `Failed to download Wikimedia image: ${imageResponse.status} ${imageResponse.statusText}`,
        );
        return null;
      }

      const contentLength = imageResponse.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
        console.warn(
          `Wikimedia image too large (${contentLength} bytes), skipping: ${imageInfo.url}`,
        );
        return null;
      }

      const arrayBuffer = await imageResponse.arrayBuffer();
      if (arrayBuffer.byteLength > 10 * 1024 * 1024) {
        console.warn(
          `Wikimedia image too large after download (${arrayBuffer.byteLength} bytes), skipping`,
        );
        return null;
      }
      return {
        title: picked.title
          .replace(/^File:/, '')
          .replace(/\.(jpe?g|png|webp|gif|tiff?)$/i, ''),
        cityName: location.name,
        mimeType: imageInfo.mime,
        sourceUrl: imageInfo.descriptionurl,
        buffer: Buffer.from(arrayBuffer),
      };
    } catch (error) {
      console.error(
        `Error fetching Wikimedia image for ${location.name}:`,
        error,
      );
      return null;
    }
  }
}

export default WikimediaService;
