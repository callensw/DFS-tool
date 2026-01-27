import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const SALARY_CAP = 50000;
const ROSTER_SIZE = 8;
const MAX_PLAYERS_PER_TEAM = 4;

// DraftKings roster positions
const ROSTER_SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"] as const;
type RosterSlot = (typeof ROSTER_SLOTS)[number];

interface PlayerPool {
  id: number;
  dkPlayerId: number;
  name: string;
  position: string;
  team: string;
  salary: number;
  projection: number;
  value: number;
}

interface LineupPlayer extends PlayerPool {
  rosterSlot: RosterSlot;
}

interface Lineup {
  players: LineupPlayer[];
  totalSalary: number;
  totalProjection: number;
}

/**
 * Check if a player can fill a roster slot based on DK position eligibility.
 * DK positions can be: PG, SG, SF, PF, C, PG/SG, SF/PF, etc.
 */
function canFillSlot(position: string, slot: RosterSlot): boolean {
  const pos = position.toUpperCase().trim();
  const positions = pos.split("/");

  switch (slot) {
    case "PG":
      return positions.includes("PG");
    case "SG":
      return positions.includes("SG");
    case "SF":
      return positions.includes("SF");
    case "PF":
      return positions.includes("PF");
    case "C":
      return positions.includes("C");
    case "G":
      return positions.includes("PG") || positions.includes("SG");
    case "F":
      return positions.includes("SF") || positions.includes("PF");
    case "UTIL":
      return true;
    default:
      return false;
  }
}

function addVariance(value: number, variance: number): number {
  const multiplier = 1 + (Math.random() - 0.5) * 2 * variance;
  return value * multiplier;
}

let lastFailureReason = "";

function generateLineup(
  playerPool: PlayerPool[],
  variance: number = 0.15,
  existingLineups: Lineup[] = []
): Lineup | null {
  const playersWithVariance = playerPool.map((p) => ({
    ...p,
    adjustedValue: addVariance(p.value, variance),
  }));

  playersWithVariance.sort((a, b) => b.adjustedValue - a.adjustedValue);

  const lineup: LineupPlayer[] = [];
  const usedPlayerIds = new Set<number>();
  const teamPlayerCounts = new Map<string, number>();
  let remainingSalary = SALARY_CAP;
  const filledSlots = new Set<RosterSlot>();

  const slotOrder: RosterSlot[] = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
  const MIN_SALARY = 3500;

  for (const slot of slotOrder) {
    if (filledSlots.has(slot)) continue;

    const slotsRemaining = ROSTER_SIZE - lineup.length - 1;
    const reservedSalary = slotsRemaining * MIN_SALARY;
    const maxSalaryForThisSlot = remainingSalary - reservedSalary;

    let bestPlayer: (typeof playersWithVariance)[0] | null = null;

    for (const player of playersWithVariance) {
      if (usedPlayerIds.has(player.dkPlayerId)) continue;
      if (!canFillSlot(player.position, slot)) continue;
      if (player.salary > maxSalaryForThisSlot) continue;

      const teamCount = teamPlayerCounts.get(player.team) || 0;
      if (teamCount >= MAX_PLAYERS_PER_TEAM) continue;

      if (existingLineups.length > 0 && slot === "UTIL") {
        const playerIds = [...lineup.map((p) => p.dkPlayerId), player.dkPlayerId];
        const isTooSimilar = existingLineups.some((existing) => {
          const existingIds = new Set(existing.players.map((p) => p.dkPlayerId));
          const overlap = playerIds.filter((id) => existingIds.has(id)).length;
          return overlap >= 7;
        });
        if (isTooSimilar) continue;
      }

      bestPlayer = player;
      break;
    }

    if (!bestPlayer) {
      lastFailureReason = `Could not fill ${slot} slot. Remaining salary: $${remainingSalary}. Lineup size: ${lineup.length}`;
      return null;
    }

    lineup.push({ ...bestPlayer, rosterSlot: slot });
    usedPlayerIds.add(bestPlayer.dkPlayerId);
    remainingSalary -= bestPlayer.salary;
    teamPlayerCounts.set(bestPlayer.team, (teamPlayerCounts.get(bestPlayer.team) || 0) + 1);
    filledSlots.add(slot);
  }

  if (lineup.length !== ROSTER_SIZE) {
    return null;
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
  const slateId = searchParams.get("slateId");
  const lineupCount = Math.min(parseInt(searchParams.get("count") || "20"), 150);

  if (!slateId) {
    return NextResponse.json({
      success: false,
      error: "slateId is required. Get available slates from /api/slates",
      lineups: [],
    });
  }

  const supabase = createAdminClient();

  // 1. Get slate info
  const { data: slate, error: slateError } = await supabase
    .from("dfs_dk_slates")
    .select("*")
    .eq("id", slateId)
    .single();

  if (slateError || !slate) {
    return NextResponse.json({
      success: false,
      error: `Slate ${slateId} not found`,
      lineups: [],
    });
  }

  console.log(`[OPTIMIZER] Using slate: ${slate.name} (${slate.game_count} games)`);

  // 2. Get DK salaries for this slate
  const { data: salaries, error: salariesError } = await supabase
    .from("dfs_dk_salaries")
    .select("*")
    .eq("slate_id", slateId);

  if (salariesError || !salaries || salaries.length === 0) {
    return NextResponse.json({
      success: false,
      error: "No players found for this slate. Try syncing DK salaries first.",
      lineups: [],
    });
  }

  console.log(`[OPTIMIZER] Found ${salaries.length} players on slate`);

  // 3. Build player pool using DK data directly
  // For projections, we'll use a simple formula based on salary (can be enhanced later)
  const playerPool: PlayerPool[] = salaries
    .filter((s) => s.salary >= 3500) // Filter out minimum salary players
    .map((s, index) => {
      // Simple projection estimate: higher salary = higher projection
      // This can be replaced with actual projections from another source
      const baseProjection = (s.salary - 3500) / 150 + 10;
      const projection = Math.round(baseProjection * 100) / 100;
      const value = projection > 0 ? (projection / s.salary) * 1000 : 0;

      return {
        id: index,
        dkPlayerId: s.dk_player_id,
        name: s.name_id || `Player ${s.dk_player_id}`,
        position: s.roster_position || "UTIL",
        team: s.team || "N/A",
        salary: s.salary,
        projection,
        value: Math.round(value * 100) / 100,
      };
    });

  console.log(`[OPTIMIZER] Player pool size: ${playerPool.length}`);

  // Count positions
  const positionCounts = {
    PG: playerPool.filter((p) => canFillSlot(p.position, "PG")).length,
    SG: playerPool.filter((p) => canFillSlot(p.position, "SG")).length,
    SF: playerPool.filter((p) => canFillSlot(p.position, "SF")).length,
    PF: playerPool.filter((p) => canFillSlot(p.position, "PF")).length,
    C: playerPool.filter((p) => canFillSlot(p.position, "C")).length,
    G: playerPool.filter((p) => canFillSlot(p.position, "G")).length,
    F: playerPool.filter((p) => canFillSlot(p.position, "F")).length,
  };

  if (playerPool.length < ROSTER_SIZE) {
    return NextResponse.json({
      success: false,
      error: `Not enough players in pool (need ${ROSTER_SIZE}, have ${playerPool.length})`,
      lineups: [],
      debug: { playerPoolSize: playerPool.length, positionCounts },
    });
  }

  // 4. Generate lineups
  const generatedLineups: Lineup[] = [];
  let attempts = 0;
  const maxAttempts = lineupCount * 10;

  while (generatedLineups.length < lineupCount && attempts < maxAttempts) {
    attempts++;
    const variance = 0.1 + (generatedLineups.length / lineupCount) * 0.2;
    const lineup = generateLineup(playerPool, variance, generatedLineups);

    if (lineup) {
      const isDuplicate = generatedLineups.some((existing) => {
        const existingIds = new Set(existing.players.map((p) => p.dkPlayerId));
        const newIds = lineup.players.map((p) => p.dkPlayerId);
        const overlap = newIds.filter((id) => existingIds.has(id)).length;
        return overlap === ROSTER_SIZE;
      });

      if (!isDuplicate) {
        generatedLineups.push(lineup);
      }
    }
  }

  console.log(`[OPTIMIZER] Generated ${generatedLineups.length} lineups in ${attempts} attempts`);

  generatedLineups.sort((a, b) => b.totalProjection - a.totalProjection);

  return NextResponse.json({
    success: true,
    slate: {
      id: slate.id,
      name: slate.name,
      gameCount: slate.game_count,
      startTime: slate.start_time,
    },
    count: generatedLineups.length,
    debug: {
      playerPoolSize: playerPool.length,
      positionCounts,
      attempts,
      lastFailureReason,
    },
    lineups: generatedLineups.map((lineup, index) => ({
      rank: index + 1,
      totalSalary: lineup.totalSalary,
      totalProjection: lineup.totalProjection,
      salaryCap: SALARY_CAP,
      salaryRemaining: SALARY_CAP - lineup.totalSalary,
      players: lineup.players.map((p) => ({
        dkPlayerId: p.dkPlayerId,
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
