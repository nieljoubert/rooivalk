export type SteamAppRow = {
  appid: number;
  name: string;
  last_modified: number | null;
  price_change_number: number | null;
};

export type GetAppListResponse = {
  response: {
    apps: SteamAppRow[];
    have_more_results?: boolean;
    last_appid?: number;
  };
};

export type AppDetailsData = {
  name: string;
  steam_appid: number;
  is_free: boolean;
  short_description: string;
  developers?: string[];
  publishers?: string[];
  price_overview?: {
    currency: string;
    initial_formatted: string;
    final_formatted: string;
    discount_percent: number;
  };
  genres?: { id: string; description: string }[];
  categories?: { id: number; description: string }[];
  release_date?: { date: string };
  header_image?: string;
  platforms?: { windows: boolean; mac: boolean; linux: boolean };
  achievements?: { total: number };
  recommendations?: { total: number };
  supported_languages?: string;
};

export type AppDetailsResponse = {
  [appid: string]: {
    success: boolean;
    data?: AppDetailsData;
  };
};

export type SteamGameDetails = {
  appid: number;
  name: string;
  is_free: boolean;
  short_description: string;
  developers: string[];
  publishers: string[];
  price?: {
    currency: string;
    initial_formatted: string;
    final_formatted: string;
    discount_percent: number;
  };
  genres: string[];
  categories: string[];
  release_date: string;
  header_image: string;
  platforms: { windows: boolean; mac: boolean; linux: boolean };
  achievements_total: number;
  recommendations_total: number;
  supported_languages: string;
};
