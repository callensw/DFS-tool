import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Simple test endpoint to debug BALLDONTLIE season_averages API format
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get("player_id") || "237"; // Default to LeBron James
  const season = searchParams.get("season") || "2026";

  const apiKey = process.env.BALLDONTLIE_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  // Try different URL formats
  const formats = [
    `https://api.balldontlie.io/v1/season_averages?season=${season}&player_id=${playerId}`,
    `https://api.balldontlie.io/v1/season_averages?season=${season}&player_ids=${playerId}`,
    `https://api.balldontlie.io/v1/season_averages?season=${season}&player_ids[]=${playerId}`,
  ];

  const results: Array<{ url: string; status: number; data?: unknown; error?: string }> = [];

  for (const url of formats) {
    try {
      const response = await fetch(url, {
        headers: { Authorization: apiKey },
        cache: "no-store",
      });

      const data = await response.json().catch(() => null);

      results.push({
        url,
        status: response.status,
        data: response.ok ? data : undefined,
        error: !response.ok ? `${response.status} ${response.statusText}` : undefined,
      });
    } catch (err) {
      results.push({
        url,
        status: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    player_id: playerId,
    season,
    results,
  });
}
