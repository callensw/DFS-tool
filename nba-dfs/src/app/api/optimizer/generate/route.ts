import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getTodayDateString } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

const SALARY_CAP = 50000;
const ROSTER_SIZE = 8;
const MAX_PLAYERS_PER_GAME = 4;

// DraftKings roster positions
const ROSTER_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"] as const;
type RosterSlot = (typeof ROSTER_SLOTS)[number];

interface PlayerPool {
  id: number;
  name: string;
  position: string;
  team: string;
  salary: number;
  projection: number;
  floor: number;
  ceiling: number;
  gameId: number;
  value: number; // projection / salary * 1000
}

interface LineupPlayer extends PlayerPool {
  rosterSlot: RosterSlot;
}

interface Lineup {
  players: LineupPlayer[];
  totalSalary: number;
  totalProjection: number;
}

// Check if a player can fill a roster slot
// Handles BALLDONTLIE positions (G, F, C, G-F, F-C) and DK positions (PG, SG, SF, PF, C)
function canFillSlot(position: string, slot: RosterSlot): boolean {
  const pos = position.toUpperCase().trim();

  // Normalize position - BALLDONTLIE uses G, F, C; we need to map to DK format
  const isGuard = pos === "G" || pos.includes("PG") || pos.includes("SG") || pos.startsWith("G");
  const isForward = pos === "F" || pos.includes("SF") || pos.includes("PF") || pos.startsWith("F");
  const isCenter = pos === "C" || pos.includes("C");

  switch (slot) {
    case "PG":
      // PG slot: accepts PG, G, or any guard
      return pos.includes("PG") || pos === "G" || (isGuard && !pos.includes("SG"));
    case "SG":
      // SG slot: accepts SG, G, or any guard
      return pos.includes("SG") || pos === "G" || (isGuard && !pos.includes("PG"));
    case "SF":
      // SF slot: accepts SF, F, or any forward
      return pos.includes("SF") || pos === "F" || (isForward && !pos.includes("PF"));
    case "PF":
      // PF slot: accepts PF, F, or any forward
      return pos.includes("PF") || pos === "F" || (isForward && !pos.includes("SF"));
    case "C":
      // C slot: accepts C or any center
      return isCenter;
    case "G":
      // G flex slot: accepts any guard
      return isGuard;
    case "F":
      // F flex slot: accepts any forward
      return isForward;
    case "UTIL":
      // UTIL: accepts anyone
      return true;
    default:
      return false;
  }
}

// Add random variance to projections for lineup diversity
function addVariance(projection: number, variance: number): number {
  const multiplier = 1 + (Math.random() - 0.5) * 2 * variance;
  return projection * multiplier;
}

// Generate a single lineup using greedy algorithm
function generateLineup(
  playerPool: PlayerPool[],
  variance: number = 0.15,
  existingLineups: Lineup[] = []
): Lineup | null {
  // Add variance to projections for diversity
  const playersWithVariance = playerPool.map((p) => ({
    ...p,
    adjustedProjection: addVariance(p.projection, variance),
    adjustedValue: addVariance(p.value, variance),
  }));

  // Sort by adjusted value
  playersWithVariance.sort((a, b) => b.adjustedValue - a.adjustedValue);

  const lineup: LineupPlayer[] = [];
  const usedPlayerIds = new Set<number>();
  const gamePlayerCounts = new Map<number, number>();
  let remainingSalary = SALARY_CAP;

  // Track which slots are filled
  const filledSlots = new Set<RosterSlot>();

  // Fill slots in order of scarcity (specific positions first, then flex, then UTIL)
  const slotOrder: RosterSlot[] = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];

  for (const slot of slotOrder) {
    if (filledSlots.has(slot)) continue;

    // Find best available player for this slot
    let bestPlayer: (typeof playersWithVariance)[0] | null = null;

    for (const player of playersWithVariance) {
      // Skip if already used
      if (usedPlayerIds.has(player.id)) continue;

      // Skip if can't fill this slot
      if (!canFillSlot(player.position, slot)) continue;

      // Skip if over salary
      if (player.salary > remainingSalary) continue;

      // Skip if too many from same game
      const gameCount = gamePlayerCounts.get(player.gameId) || 0;
      if (gameCount >= MAX_PLAYERS_PER_GAME) continue;

      // Check if lineup would be too similar to existing lineups
      if (existingLineups.length > 0 && slot === "UTIL") {
        const playerIds = [...lineup.map((p) => p.id), player.id];
        const isTooSimilar = existingLineups.some((existing) => {
          const existingIds = new Set(existing.players.map((p) => p.id));
          const overlap = playerIds.filter((id) => existingIds.has(id)).length;
          return overlap >= 7; // At least 7 same players
        });
        if (isTooSimilar) continue;
      }

      bestPlayer = player;
      break;
    }

    if (!bestPlayer) {
      // Try again with less strict criteria for flex positions
      if (slot === "UTIL") {
        // If we can't fill UTIL, lineup failed
        return null;
      }
      continue;
    }

    // Add player to lineup
    lineup.push({
      ...bestPlayer,
      rosterSlot: slot,
    });

    usedPlayerIds.add(bestPlayer.id);
    remainingSalary -= bestPlayer.salary;
    gamePlayerCounts.set(
      bestPlayer.gameId,
      (gamePlayerCounts.get(bestPlayer.gameId) || 0) + 1
    );
    filledSlots.add(slot);
  }

  // Verify we have a complete lineup
  if (lineup.length !== ROSTER_SIZE) {
    return null;
  }

  // Try to upgrade players with remaining salary
  lineup.sort((a, b) => a.value - b.value);

  for (let i = 0; i < lineup.length && remainingSalary > 0; i++) {
    const currentPlayer = lineup[i];
    const maxUpgradeSalary = currentPlayer.salary + remainingSalary;

    // Find better player for this slot
    for (const player of playersWithVariance) {
      if (usedPlayerIds.has(player.id)) continue;
      if (!canFillSlot(player.position, currentPlayer.rosterSlot)) continue;
      if (player.salary > maxUpgradeSalary) continue;

      const gameCount = gamePlayerCounts.get(player.gameId) || 0;
      const currentGameCount = gamePlayerCounts.get(currentPlayer.gameId) || 0;
      if (
        player.gameId !== currentPlayer.gameId &&
        gameCount >= MAX_PLAYERS_PER_GAME
      )
        continue;

      // Only upgrade if significantly better
      if (player.projection > currentPlayer.projection * 1.1) {
        // Swap players
        remainingSalary += currentPlayer.salary - player.salary;
        usedPlayerIds.delete(currentPlayer.id);
        usedPlayerIds.add(player.id);

        // Update game counts
        gamePlayerCounts.set(currentPlayer.gameId, currentGameCount - 1);
        gamePlayerCounts.set(
          player.gameId,
          (gamePlayerCounts.get(player.gameId) || 0) + 1
        );

        lineup[i] = {
          ...player,
          rosterSlot: currentPlayer.rosterSlot,
        };
        break;
      }
    }
  }

  const totalSalary = lineup.reduce((sum, p) => sum + p.salary, 0);
  const totalProjection = lineup.reduce((sum, p) => sum + p.projection, 0);

  return {
    players: lineup,
    totalSalary,
    totalProjection: Math.round(totalProjection * 100) / 100,
  };
}

export async function GET(request: Request) {
  console.log("[OPTIMIZER] Starting lineup generation...");

  const { searchParams } = new URL(request.url);
  const targetDate = searchParams.get("date") || getTodayDateString();
  const lineupCount = Math.min(
    parseInt(searchParams.get("count") || "20"),
    150
  );

  const supabase = createAdminClient();

  // 1. Get games for the target date
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id, home_team_id, visitor_team_id")
    .eq("date", targetDate);

  if (gamesError) {
    console.error("[OPTIMIZER] Error fetching games:", gamesError);
    return NextResponse.json({
      success: false,
      error: gamesError.message,
      lineups: [],
    });
  }

  if (!games || games.length === 0) {
    return NextResponse.json({
      success: false,
      error: "No games found for this date",
      lineups: [],
      date: targetDate,
    });
  }

  const gameIds = games.map((g) => g.id);
  console.log(`[OPTIMIZER] Found ${games.length} games for ${targetDate}`);

  // 2. Get projections for games
  const { data: projections, error: projError } = await supabase
    .from("projections")
    .select("*")
    .in("game_id", gameIds);

  if (projError || !projections || projections.length === 0) {
    return NextResponse.json({
      success: false,
      error: "No projections found for this date",
      lineups: [],
      date: targetDate,
    });
  }

  console.log(`[OPTIMIZER] Found ${projections.length} projections`);

  // 3. Get player info
  const playerIds = projections.map((p) => p.player_id);
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("*")
    .in("id", playerIds);

  if (playersError || !players) {
    return NextResponse.json({
      success: false,
      error: "Error fetching player data",
      lineups: [],
    });
  }

  // 4. Get salaries
  const { data: salaries } = await supabase
    .from("dk_salaries")
    .select("*")
    .in("player_id", playerIds);

  // 5. Get teams
  const { data: teams } = await supabase.from("teams").select("*");

  // Build lookup maps
  const playerMap = new Map(players.map((p) => [p.id, p]));
  const salaryMap = new Map((salaries || []).map((s) => [s.player_id, s]));
  const teamMap = new Map((teams || []).map((t) => [t.id, t]));

  // 6. Build player pool
  const playerPool: PlayerPool[] = [];

  for (const proj of projections) {
    const player = playerMap.get(proj.player_id);
    if (!player) continue;

    const team = teamMap.get(player.team_id);
    const salaryData = salaryMap.get(player.id);

    // Use actual salary or estimate based on projection
    const salary = salaryData?.salary || Math.round(proj.dk_proj * 200 + 3500);

    // Skip players with very low projections
    if (proj.dk_proj < 5) continue;

    const value = salary > 0 ? (proj.dk_proj / salary) * 1000 : 0;

    playerPool.push({
      id: player.id,
      name: `${player.first_name} ${player.last_name}`,
      position: player.position || "UTIL",
      team: team?.abbreviation || "N/A",
      salary,
      projection: proj.dk_proj,
      floor: proj.dk_floor,
      ceiling: proj.dk_ceiling,
      gameId: proj.game_id,
      value: Math.round(value * 100) / 100,
    });
  }

  console.log(`[OPTIMIZER] Player pool size: ${playerPool.length}`);

  if (playerPool.length < ROSTER_SIZE) {
    return NextResponse.json({
      success: false,
      error: `Not enough players in pool (need ${ROSTER_SIZE}, have ${playerPool.length})`,
      lineups: [],
    });
  }

  // 7. Generate lineups
  const generatedLineups: Lineup[] = [];
  let attempts = 0;
  const maxAttempts = lineupCount * 10;

  while (generatedLineups.length < lineupCount && attempts < maxAttempts) {
    attempts++;

    // Increase variance as we generate more lineups
    const variance = 0.1 + (generatedLineups.length / lineupCount) * 0.2;

    const lineup = generateLineup(playerPool, variance, generatedLineups);

    if (lineup) {
      // Check for duplicates
      const isDuplicate = generatedLineups.some((existing) => {
        const existingIds = new Set(existing.players.map((p) => p.id));
        const newIds = lineup.players.map((p) => p.id);
        const overlap = newIds.filter((id) => existingIds.has(id)).length;
        return overlap === ROSTER_SIZE;
      });

      if (!isDuplicate) {
        generatedLineups.push(lineup);
      }
    }
  }

  console.log(
    `[OPTIMIZER] Generated ${generatedLineups.length} lineups in ${attempts} attempts`
  );

  // Sort lineups by projected points
  generatedLineups.sort((a, b) => b.totalProjection - a.totalProjection);

  // 8. Save lineups to database
  const lineupsToSave = generatedLineups.map((lineup) => ({
    game_date: targetDate,
    total_salary: lineup.totalSalary,
    projected_points: lineup.totalProjection,
    players: lineup.players.map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      salary: p.salary,
      projection: p.projection,
      rosterSlot: p.rosterSlot,
    })),
  }));

  if (lineupsToSave.length > 0) {
    const { error: saveError } = await supabase
      .from("lineups")
      .insert(lineupsToSave);

    if (saveError) {
      console.error("[OPTIMIZER] Error saving lineups:", saveError);
    } else {
      console.log(`[OPTIMIZER] Saved ${lineupsToSave.length} lineups`);
    }
  }

  return NextResponse.json({
    success: true,
    date: targetDate,
    count: generatedLineups.length,
    lineups: generatedLineups.map((lineup, index) => ({
      rank: index + 1,
      totalSalary: lineup.totalSalary,
      totalProjection: lineup.totalProjection,
      salaryCap: SALARY_CAP,
      salaryRemaining: SALARY_CAP - lineup.totalSalary,
      players: lineup.players.map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        salary: p.salary,
        projection: p.projection,
        rosterSlot: p.rosterSlot,
      })),
    })),
  });
}
