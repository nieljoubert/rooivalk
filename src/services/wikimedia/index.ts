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
    const cityName = location.name;

    const response = await fetch(this.buildSearchUrl(cityName), {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(
        `Wikimedia API returned ${response.status} ${response.statusText} for "${cityName}"`,
      );
    }

    // .json() can throw SyntaxError on malformed responses (e.g. HTML error pages with 200 status)
    const data = (await response.json()) as WikimediaQueryResponse;
    if (data.error) {
      throw new Error(
        `Wikimedia API error for "${cityName}": ${data.error.code} - ${data.error.info}`,
      );
    }

    const pages = data.query?.pages;
    if (!pages) {
      console.warn(`Wikimedia returned no pages for "${cityName}"`);
      return null;
    }

    // Keep only images with supported MIME types (JPEG, PNG, WebP); excludes SVG, TIFF, etc.
    const imagePages = Object.values(pages).filter((page) => {
      const info = page.imageinfo?.[0];
      return info?.url && isWikimediaMime(info.mime);
    });

    if (imagePages.length === 0) {
      console.warn(
        `No suitable images found on Wikimedia for "${cityName}" (${Object.keys(pages).length} pages checked)`,
      );
      return null;
    }

    const picked = imagePages[Math.floor(Math.random() * imagePages.length)];
    const imageInfo = picked.imageinfo?.[0];
    if (!imageInfo?.url || !isWikimediaMime(imageInfo.mime)) {
      console.warn(
        `Wikimedia: picked image "${picked.title}" for "${cityName}" but imageInfo was unexpectedly missing`,
      );
      return null;
    }

    let imageResponse: Response;
    try {
      imageResponse = await fetch(imageInfo.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(
        `Image download failed for "${cityName}" (${imageInfo.url}): ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!imageResponse.ok) {
      throw new Error(
        `Image download returned ${imageResponse.status} ${imageResponse.statusText} for "${cityName}" (${imageInfo.url})`,
      );
    }

    const contentLength = imageResponse.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
      console.warn(
        `Wikimedia image too large (${contentLength} bytes), skipping: ${imageInfo.url}`,
      );
      return null;
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await imageResponse.arrayBuffer();
    } catch (err) {
      throw new Error(
        `Image body read failed for "${cityName}" (${imageInfo.url}): ${err instanceof Error ? err.message : err}`,
      );
    }
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
      cityName,
      mimeType: imageInfo.mime,
      sourceUrl: imageInfo.descriptionurl,
      buffer: Buffer.from(arrayBuffer),
    };
  }
}

export default WikimediaService;
