import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  fetchAllPages,
  ApiStats,
} from "@/lib/balldontlie";

/**
 * Calculate DraftKings fantasy points
 * PTS=1, REB=1.25, AST=1.5, STL=2, BLK=2, TOV=-0.5, 3PM=0.5
 * Double-double bonus=1.5, Triple-double bonus=3
 */
function calculateDkPoints(stats: {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  fg3m: number;
}): number {
  const basePoints =
    stats.pts * 1 +
    stats.reb * 1.25 +
    stats.ast * 1.5 +
    stats.stl * 2 +
    stats.blk * 2 +
    stats.turnover * -0.5 +
    stats.fg3m * 0.5;

  // Count double-digit categories
  let doubleCount = 0;
  if (stats.pts >= 10) doubleCount++;
  if (stats.reb >= 10) doubleCount++;
  if (stats.ast >= 10) doubleCount++;
  if (stats.stl >= 10) doubleCount++;
  if (stats.blk >= 10) doubleCount++;

  // Apply bonus
  let bonus = 0;
  if (doubleCount >= 3) {
    bonus = 3; // Triple-double
  } else if (doubleCount >= 2) {
    bonus = 1.5; // Double-double
  }

  return Math.round((basePoints + bonus) * 100) / 100;
}

export async function GET(request: Request) {
  console.log("[SYNC/STATS] Starting stats sync...");

  const { searchParams } = new URL(request.url);
  const playerIds = searchParams.get("player_ids")?.split(",").filter(Boolean) || [];
  const season = searchParams.get("season") || "2024";

  if (playerIds.length === 0) {
    return NextResponse.json({
      success: false,
      count: 0,
      error: "player_ids query parameter required (comma-separated)",
    });
  }

  // Build params for API call
  const params: Record<string, string | string[]> = {
    season,
    "player_ids[]": playerIds,
  };

  // Fetch stats from BALLDONTLIE
  const { data: stats, error: fetchError } = await fetchAllPages<ApiStats>(
    "/v1/nba/stats",
    params as Record<string, string>,
    100
  );

  if (fetchError) {
    console.error("[SYNC/STATS] Fetch error:", fetchError);

    if (fetchError.includes("Unauthorized")) {
      return NextResponse.json({
        success: false,
        count: 0,
        error: fetchError,
        tier_required: "ALL-STAR",
      });
    }

    return NextResponse.json({
      success: false,
      count: 0,
      error: fetchError,
    });
  }

  if (!stats || stats.length === 0) {
    console.log("[SYNC/STATS] No stats found");
    return NextResponse.json({
      success: true,
      count: 0,
      message: "No stats found for specified players/season",
    });
  }

  console.log(`[SYNC/STATS] Fetched ${stats.length} stat records`);

  // Transform stats for database
  const dbStats = stats.map((stat) => ({
    player_id: stat.player.id,
    game_id: stat.game.id,
    minutes: stat.min,
    pts: stat.pts,
    reb: stat.reb,
    ast: stat.ast,
    stl: stat.stl,
    blk: stat.blk,
    turnover: stat.turnover,
    fg3m: stat.fg3m,
    dk_points: calculateDkPoints({
      pts: stat.pts,
      reb: stat.reb,
      ast: stat.ast,
      stl: stat.stl,
      blk: stat.blk,
      turnover: stat.turnover,
      fg3m: stat.fg3m,
    }),
  }));

  // Upsert to Supabase
  const supabase = createAdminClient();

  const { error: upsertError } = await supabase
    .from("player_game_stats")
    .upsert(dbStats, {
      onConflict: "player_id,game_id",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error("[SYNC/STATS] Upsert error:", upsertError);
    return NextResponse.json({
      success: false,
      count: 0,
      error: upsertError.message,
    });
  }

  console.log(`[SYNC/STATS] Upserted ${dbStats.length} stat records`);

  return NextResponse.json({
    success: true,
    count: dbStats.length,
    season,
    players_requested: playerIds.length,
  });
}
