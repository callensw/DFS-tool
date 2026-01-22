import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getTodayDateString, fetchAllPages, fetchFromBallDontLie } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

interface SeasonAverage {
  player_id: number;
  season: number;
  games_played: number;
  min: string;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  fg3m: number;
}

interface SeasonAveragesResponse {
  data: SeasonAverage[];
}

/**
 * Calculate DraftKings fantasy points from averages
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
  return (
    stats.pts * 1 +
    stats.reb * 1.25 +
    stats.ast * 1.5 +
    stats.stl * 2 +
    stats.blk * 2 +
    stats.turnover * -0.5 +
    stats.fg3m * 0.5
  );
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
  const season = searchParams.get("season") || "2025";

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

  // 3. Get players from those teams directly from API (with pagination)
  interface ApiPlayer {
    id: number;
    first_name: string;
    last_name: string;
    position: string;
    team: { id: number };
  }

  const playersResult = await fetchAllPages<ApiPlayer>(
    "/v1/players/active",
    undefined,
    100
  );

  if (playersResult.error) {
    console.error("[PROJECTIONS] Error fetching players:", playersResult.error);
    return NextResponse.json({
      success: false,
      count: 0,
      error: playersResult.error,
    });
  }

  // Filter to players on today's teams
  const allPlayers = playersResult.data || [];
  console.log(`[PROJECTIONS] Fetched ${allPlayers.length} total active players`);
  const players = allPlayers.filter(p => teamIds.has(p.team?.id));

  if (players.length === 0) {
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
      (g) => g.home_team_id === player.team?.id || g.visitor_team_id === player.team?.id
    );
    if (game) {
      playerGameMap.set(player.id, game.id);
    }
  });

  // 4. Fetch season averages from API for these players
  // Note: API uses player_id (singular), so we need individual requests
  // Process in parallel batches to stay within timeout limits
  const playerIds = players.map((p) => p.id);
  const seasonAveragesMap = new Map<number, SeasonAverage>();

  // Fetch in parallel batches of 10 to avoid rate limits and timeouts
  const parallelBatchSize = 10;
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < playerIds.length; i += parallelBatchSize) {
    const batchIds = playerIds.slice(i, i + parallelBatchSize);

    const results = await Promise.all(
      batchIds.map((playerId) =>
        fetchFromBallDontLie<SeasonAveragesResponse>("/v1/season_averages", {
          season,
          player_id: String(playerId),
        })
      )
    );

    results.forEach((result) => {
      if (result.data?.data?.[0]) {
        const avg = result.data.data[0];
        seasonAveragesMap.set(avg.player_id, avg);
        successCount++;
      } else if (result.error) {
        errorCount++;
      }
    });

    console.log(`[PROJECTIONS] Batch ${Math.floor(i / parallelBatchSize) + 1}: processed ${batchIds.length} players`);
  }

  console.log(`[PROJECTIONS] Total season averages: ${seasonAveragesMap.size} (${successCount} success, ${errorCount} errors)`);

  // 5. Generate projections for each player using season averages
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

    const seasonAvg = seasonAveragesMap.get(player.id);

    if (!seasonAvg || seasonAvg.games_played < 3) {
      playersWithoutStats++;
      continue;
    }

    playersWithStats++;

    // Calculate DK projection from season averages
    const dk_proj = Math.round(calculateDkPoints({
      pts: seasonAvg.pts,
      reb: seasonAvg.reb,
      ast: seasonAvg.ast,
      stl: seasonAvg.stl,
      blk: seasonAvg.blk,
      turnover: seasonAvg.turnover,
      fg3m: seasonAvg.fg3m,
    }) * 100) / 100;

    // Estimate floor (80% of average) and ceiling (130% of average)
    const dk_floor = Math.round(dk_proj * 0.8 * 100) / 100;
    const dk_ceiling = Math.round(dk_proj * 1.3 * 100) / 100;
    const minutes_proj = Math.round(parseMinutes(seasonAvg.min) * 10) / 10;

    projections.push({
      player_id: player.id,
      game_id: gameId,
      minutes_proj,
      dk_proj,
      dk_floor,
      dk_ceiling,
      ownership_proj: null,
    });
  }

  if (projections.length === 0) {
    console.log("[PROJECTIONS] No projections generated (no season averages found)");
    return NextResponse.json({
      success: true,
      count: 0,
      date: targetDate,
      season,
      players_checked: players.length,
      players_with_stats: playersWithStats,
      players_without_stats: playersWithoutStats,
      message: "No projections generated - players have no season averages",
      debug: {
        total_averages_found: seasonAveragesMap.size,
        sample_player_ids: playerIds.slice(0, 5),
      },
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
  const avgProjection = projections.reduce((sum, p) => sum + p.dk_proj, 0) / projections.length;
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
    season,
    games_count: games.length,
    players_checked: players.length,
    players_with_stats: playersWithStats,
    players_without_stats: playersWithoutStats,
    average_projection: Math.round(avgProjection * 100) / 100,
    top_projections: topProjections,
  });
}
