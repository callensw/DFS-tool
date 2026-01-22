import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getTodayDateString } from "@/lib/balldontlie";

interface PlayerStats {
  player_id: number;
  game_id: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  fg3m: number;
  dk_points: number;
  minutes: string;
}

/**
 * Calculate percentile value from sorted array
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

/**
 * Calculate average of array
 */
function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Parse minutes string (e.g., "32:45" or "32") to decimal
 */
function parseMinutes(min: string | null): number {
  if (!min) return 0;
  if (min.includes(":")) {
    const [mins, secs] = min.split(":").map(Number);
    return mins + (secs || 0) / 60;
  }
  return parseFloat(min) || 0;
}

export async function GET(request: Request) {
  console.log("[PROJECTIONS] Starting projection generation...");

  const { searchParams } = new URL(request.url);
  const targetDate = searchParams.get("date") || getTodayDateString();

  const supabase = createAdminClient();

  // 1. Get today's games
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, home_team_id, visitor_team_id")
    .eq("date", targetDate);

  if (gamesError) {
    console.error("[PROJECTIONS] Error fetching games:", gamesError);
    return NextResponse.json({
      success: false,
      count: 0,
      error: gamesError.message,
    });
  }

  if (!games || games.length === 0) {
    console.log("[PROJECTIONS] No games found for date:", targetDate);
    return NextResponse.json({
      success: true,
      count: 0,
      date: targetDate,
      message: "No games found for this date",
    });
  }

  console.log(`[PROJECTIONS] Found ${games.length} games for ${targetDate}`);

  // 2. Get team IDs from today's games
  const teamIds = new Set<number>();
  games.forEach((game) => {
    teamIds.add(game.home_team_id);
    teamIds.add(game.visitor_team_id);
  });

  // 3. Get players from those teams
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, team_id, first_name, last_name")
    .in("team_id", Array.from(teamIds))
    .eq("is_active", true);

  if (playersError) {
    console.error("[PROJECTIONS] Error fetching players:", playersError);
    return NextResponse.json({
      success: false,
      count: 0,
      error: playersError.message,
    });
  }

  if (!players || players.length === 0) {
    console.log("[PROJECTIONS] No players found for teams in today's games");
    return NextResponse.json({
      success: true,
      count: 0,
      date: targetDate,
      message: "No players found for teams playing today",
    });
  }

  console.log(`[PROJECTIONS] Found ${players.length} players to project`);

  // Create a map of player_id to their game_id for today
  const playerGameMap = new Map<number, number>();
  players.forEach((player) => {
    const game = games.find(
      (g) => g.home_team_id === player.team_id || g.visitor_team_id === player.team_id
    );
    if (game) {
      playerGameMap.set(player.id, game.id);
    }
  });

  // 4. Get last 10 games of stats for each player
  const playerIds = players.map((p) => p.id);

  const { data: allStats, error: statsError } = await supabase
    .from("player_game_stats")
    .select("*")
    .in("player_id", playerIds)
    .order("game_id", { ascending: false });

  if (statsError) {
    console.error("[PROJECTIONS] Error fetching stats:", statsError);
    return NextResponse.json({
      success: false,
      count: 0,
      error: statsError.message,
    });
  }

  // Group stats by player and take last 10
  const statsByPlayer = new Map<number, PlayerStats[]>();
  (allStats || []).forEach((stat) => {
    const existing = statsByPlayer.get(stat.player_id) || [];
    if (existing.length < 10) {
      existing.push(stat as PlayerStats);
      statsByPlayer.set(stat.player_id, existing);
    }
  });

  // 5. Generate projections for each player
  const projections: Array<{
    player_id: number;
    game_id: number;
    minutes_proj: number;
    dk_proj: number;
    dk_floor: number;
    dk_ceiling: number;
    ownership_proj: number | null;
  }> = [];

  let playersWithStats = 0;
  let playersWithoutStats = 0;

  for (const player of players) {
    const gameId = playerGameMap.get(player.id);
    if (!gameId) continue;

    const stats = statsByPlayer.get(player.id) || [];

    if (stats.length === 0) {
      playersWithoutStats++;
      // Player has no stats - skip or use league average
      // For now, we skip players without history
      continue;
    }

    playersWithStats++;

    // Extract dk_points array
    const dkPoints = stats.map((s) => s.dk_points || 0);
    const minutes = stats.map((s) => parseMinutes(s.minutes));

    // Calculate projections
    const dk_proj = Math.round(average(dkPoints) * 100) / 100;
    const dk_floor = Math.round(percentile(dkPoints, 10) * 100) / 100;
    const dk_ceiling = Math.round(percentile(dkPoints, 90) * 100) / 100;
    const minutes_proj = Math.round(average(minutes) * 10) / 10;

    projections.push({
      player_id: player.id,
      game_id: gameId,
      minutes_proj,
      dk_proj,
      dk_floor,
      dk_ceiling,
      ownership_proj: null, // Will be set later with more advanced logic
    });
  }

  if (projections.length === 0) {
    console.log("[PROJECTIONS] No projections generated (no player stats found)");
    return NextResponse.json({
      success: true,
      count: 0,
      date: targetDate,
      players_checked: players.length,
      players_with_stats: playersWithStats,
      players_without_stats: playersWithoutStats,
      message: "No projections generated - players have no historical stats",
    });
  }

  // 6. Upsert projections to database
  const { error: upsertError } = await supabase
    .from("projections")
    .upsert(projections, {
      onConflict: "player_id,game_id",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error("[PROJECTIONS] Upsert error:", upsertError);
    return NextResponse.json({
      success: false,
      count: 0,
      error: upsertError.message,
    });
  }

  console.log(`[PROJECTIONS] Generated ${projections.length} projections`);

  // Calculate some summary stats
  const avgProjection = average(projections.map((p) => p.dk_proj));
  const topProjections = projections
    .sort((a, b) => b.dk_proj - a.dk_proj)
    .slice(0, 5)
    .map((p) => {
      const player = players.find((pl) => pl.id === p.player_id);
      return {
        player: player ? `${player.first_name} ${player.last_name}` : `ID:${p.player_id}`,
        dk_proj: p.dk_proj,
        dk_floor: p.dk_floor,
        dk_ceiling: p.dk_ceiling,
      };
    });

  return NextResponse.json({
    success: true,
    count: projections.length,
    date: targetDate,
    games_count: games.length,
    players_checked: players.length,
    players_with_stats: playersWithStats,
    players_without_stats: playersWithoutStats,
    average_projection: Math.round(avgProjection * 100) / 100,
    top_projections: topProjections,
  });
}
