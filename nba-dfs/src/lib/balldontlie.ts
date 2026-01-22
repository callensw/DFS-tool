/**
 * BALLDONTLIE API client utilities
 */

const BASE_URL = "https://api.balldontlie.io";

export interface BallDontLieResponse<T> {
  data: T[];
  meta?: {
    next_cursor?: number;
    per_page?: number;
  };
}

export interface ApiTeam {
  id: number;
  conference: string;
  division: string;
  city: string;
  name: string;
  full_name: string;
  abbreviation: string;
}

export interface ApiPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string;
  weight: string;
  jersey_number: string;
  college: string;
  country: string;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: ApiTeam;
}

export interface ApiGame {
  id: number;
  date: string;
  season: number;
  status: string;
  period: number;
  time: string;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: ApiTeam;
  visitor_team: ApiTeam;
}

export interface ApiInjury {
  player: ApiPlayer;
  status: string;
  return_date: string;
  description: string;
}

export interface ApiOdds {
  game: ApiGame;
  bookmakers: Array<{
    name: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

export interface ApiStats {
  id: number;
  min: string;
  fgm: number;
  fga: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  pf: number;
  pts: number;
  player: ApiPlayer;
  game: ApiGame;
}

export async function fetchFromBallDontLie<T>(
  endpoint: string,
  params?: Record<string, string | string[]>
): Promise<{ data: T | null; error: string | null; status: number }> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;

  if (!apiKey) {
    return { data: null, error: "BALLDONTLIE_API_KEY not configured", status: 500 };
  }

  const url = new URL(`${BASE_URL}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else {
        url.searchParams.append(key, value);
      }
    });
  }

  console.log(`[BALLDONTLIE] Fetching: ${url.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[BALLDONTLIE] Error ${response.status}: ${errorText}`);

      if (response.status === 401) {
        return {
          data: null,
          error: "Unauthorized - this endpoint requires a higher API tier",
          status: 401,
        };
      }

      return {
        data: null,
        error: `API error: ${response.status} ${response.statusText}`,
        status: response.status,
      };
    }

    const data = await response.json();
    return { data, error: null, status: response.status };
  } catch (error) {
    console.error("[BALLDONTLIE] Fetch error:", error);
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unknown error",
      status: 500,
    };
  }
}

export async function fetchAllPages<T>(
  endpoint: string,
  params?: Record<string, string>,
  perPage = 100
): Promise<{ data: T[]; error: string | null }> {
  const allData: T[] = [];
  let cursor: number | undefined;

  do {
    const queryParams: Record<string, string> = {
      ...params,
      per_page: perPage.toString(),
    };

    if (cursor) {
      queryParams.cursor = cursor.toString();
    }

    const result = await fetchFromBallDontLie<BallDontLieResponse<T>>(
      endpoint,
      queryParams
    );

    if (result.error) {
      return { data: allData, error: result.error };
    }

    if (result.data?.data) {
      allData.push(...result.data.data);
      cursor = result.data.meta?.next_cursor;
      console.log(`[BALLDONTLIE] Fetched ${result.data.data.length} items, total: ${allData.length}`);
    } else {
      break;
    }
  } while (cursor);

  return { data: allData, error: null };
}

export function getTodayDateString(): string {
  const today = new Date();
  return today.toISOString().split("T")[0];
}
