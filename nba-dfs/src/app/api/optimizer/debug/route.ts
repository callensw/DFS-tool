import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getTodayDateString } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetDate = searchParams.get("date") || getTodayDateString();

  const supabase = createAdminClient();

  // 1. Check games
  const { data: games, error: gamesError } = await supabase
    .from("dfs_games")
    .select("id, date, home_team_id, visitor_team_id")
    .eq("date", targetDate);

  // 2. Get all game dates to see what's in the DB
  const { data: allGameDates } = await supabase
    .from("dfs_games")
    .select("date")
    .order("date", { ascending: false })
    .limit(20);

  // 3. Check projections
  const gameIds = games?.map((g) => g.id) || [];
  const { data: projections, error: projError } = await supabase
    .from("dfs_projections")
    .select("id, player_id, game_id, dk_proj")
    .in("game_id", gameIds.length > 0 ? gameIds : [0]);

  // 4. Check players with positions
  const playerIds = projections?.map((p) => p.player_id) || [];
  const { data: players, error: playersError } = await supabase
    .from("dfs_players")
    .select("id, first_name, last_name, position")
    .in("id", playerIds.length > 0 ? playerIds : [0])
    .limit(20);

  // 5. Check salaries
  const { data: salaries } = await supabase
    .from("dfs_dk_salaries")
    .select("*")
    .limit(10);

  // Position distribution
  const positionCounts: Record<string, number> = {};
  players?.forEach((p) => {
    const pos = p.position || "NULL";
    positionCounts[pos] = (positionCounts[pos] || 0) + 1;
  });

  return NextResponse.json({
    targetDate,
    todayFromHelper: getTodayDateString(),
    games: {
      count: games?.length || 0,
      error: gamesError?.message,
      sample: games?.slice(0, 3),
    },
    allGameDatesInDb: allGameDates?.map((g) => g.date).slice(0, 10),
    projections: {
      count: projections?.length || 0,
      error: projError?.message,
      sample: projections?.slice(0, 3),
    },
    players: {
      count: players?.length || 0,
      error: playersError?.message,
      positionDistribution: positionCounts,
      sample: players?.slice(0, 5),
    },
    salaries: {
      count: salaries?.length || 0,
      sample: salaries?.slice(0, 3),
    },
  });
}
