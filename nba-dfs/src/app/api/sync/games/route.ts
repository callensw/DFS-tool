import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  fetchFromBallDontLie,
  BallDontLieResponse,
  ApiGame,
  getTodayDateString,
} from "@/lib/balldontlie";

export async function GET(request: Request) {
  console.log("[SYNC/GAMES] Starting games sync...");

  // Allow date override via query param
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || getTodayDateString();

  console.log(`[SYNC/GAMES] Syncing games for date: ${date}`);

  try {
    // Fetch games from BALLDONTLIE API
    const result = await fetchFromBallDontLie<BallDontLieResponse<ApiGame>>(
      "/v1/nba/games",
      { "dates[]": date }
    );

    if (result.error) {
      console.error("[SYNC/GAMES] API error:", result.error);
      return NextResponse.json(
        { success: false, count: 0, error: result.error },
        { status: result.status }
      );
    }

    const games = result.data?.data || [];
    console.log(`[SYNC/GAMES] Fetched ${games.length} games from API`);

    if (games.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: `No games found for ${date}`,
        date,
      });
    }

    // Transform to our schema
    const gamesToUpsert = games.map((game) => ({
      id: game.id,
      date: game.date,
      datetime: game.date, // API returns date, not full datetime
      season: game.season,
      status: game.status,
      home_team_id: game.home_team.id,
      visitor_team_id: game.visitor_team.id,
      home_team_score: game.home_team_score,
      visitor_team_score: game.visitor_team_score,
    }));

    // Upsert to Supabase
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("games")
      .upsert(gamesToUpsert, { onConflict: "id" })
      .select();

    if (error) {
      console.error("[SYNC/GAMES] Supabase error:", error);
      return NextResponse.json(
        { success: false, count: 0, error: error.message },
        { status: 500 }
      );
    }

    console.log(`[SYNC/GAMES] Upserted ${data?.length || 0} games`);

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      date,
    });
  } catch (error) {
    console.error("[SYNC/GAMES] Unexpected error:", error);
    return NextResponse.json(
      {
        success: false,
        count: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
