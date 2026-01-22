import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getTodayDateString } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

/**
 * Generate DraftKings-style salaries based on player projections.
 *
 * This creates realistic salary distributions similar to actual DK slates:
 * - Elite players (55+ proj): $10,500 - $12,500
 * - Stars (45-55 proj): $8,500 - $10,500
 * - Mid-tier (35-45 proj): $6,500 - $8,500
 * - Value plays (25-35 proj): $5,000 - $6,500
 * - Punt plays (15-25 proj): $4,000 - $5,000
 * - Min plays (5-15 proj): $3,500 - $4,000
 *
 * Runs automatically via cron job after projections are generated.
 */
export async function GET(request: Request) {
  console.log("[SALARIES] Generating DK-style salaries...");

  const { searchParams } = new URL(request.url);
  const targetDate = searchParams.get("date") || getTodayDateString();

  const supabase = createAdminClient();

  // 1. Get games for the target date
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id")
    .eq("date", targetDate);

  if (gamesError) {
    console.error("[SALARIES] Error fetching games:", gamesError);
    return NextResponse.json({
      success: false,
      error: gamesError.message,
    });
  }

  if (!games || games.length === 0) {
    return NextResponse.json({
      success: false,
      error: `No games found for ${targetDate}`,
      date: targetDate,
    });
  }

  const gameIds = games.map((g) => g.id);
  console.log(`[SALARIES] Found ${games.length} games for ${targetDate}`);

  // 2. Get projections for these games
  const { data: projections, error: projError } = await supabase
    .from("projections")
    .select("player_id, dk_proj, game_id")
    .in("game_id", gameIds);

  if (projError) {
    console.error("[SALARIES] Error fetching projections:", projError);
    return NextResponse.json({
      success: false,
      error: projError.message,
    });
  }

  if (!projections || projections.length === 0) {
    return NextResponse.json({
      success: false,
      error: "No projections found. Run /api/projections/generate first.",
      date: targetDate,
    });
  }

  console.log(`[SALARIES] Found ${projections.length} projections`);

  // 3. Get player info for positions
  const playerIds = projections.map((p) => p.player_id);
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, first_name, last_name, position")
    .in("id", playerIds);

  if (playersError) {
    console.error("[SALARIES] Error fetching players:", playersError);
    return NextResponse.json({
      success: false,
      error: playersError.message,
    });
  }

  const playerMap = new Map(players?.map((p) => [p.id, p]) || []);

  // 4. Generate DK-style salaries
  const salaries = projections.map((proj) => {
    const player = playerMap.get(proj.player_id);
    const salary = calculateDKSalary(proj.dk_proj);
    const rawPosition = player?.position || "";
    const dkPosition = mapToDkPosition(rawPosition);

    return {
      player_id: proj.player_id,
      game_id: proj.game_id,
      salary,
      roster_position: dkPosition,
    };
  });

  // 5. Upsert to dk_salaries table
  const { error: upsertError } = await supabase
    .from("dk_salaries")
    .upsert(salaries, {
      onConflict: "player_id,game_id",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error("[SALARIES] Upsert error:", upsertError);
    return NextResponse.json({
      success: false,
      error: upsertError.message,
    });
  }

  // Calculate stats
  const avgSalary = Math.round(
    salaries.reduce((sum, s) => sum + s.salary, 0) / salaries.length
  );
  const maxSalary = Math.max(...salaries.map((s) => s.salary));
  const minSalary = Math.min(...salaries.map((s) => s.salary));

  // Get salary distribution
  const distribution = {
    elite: salaries.filter((s) => s.salary >= 10500).length,
    stars: salaries.filter((s) => s.salary >= 8500 && s.salary < 10500).length,
    midTier: salaries.filter((s) => s.salary >= 6500 && s.salary < 8500).length,
    value: salaries.filter((s) => s.salary >= 5000 && s.salary < 6500).length,
    punt: salaries.filter((s) => s.salary < 5000).length,
  };

  // Get top salaries with player names
  const topSalaries = salaries
    .map((s) => {
      const player = playerMap.get(s.player_id);
      const proj = projections.find((p) => p.player_id === s.player_id);
      return {
        name: player ? `${player.first_name} ${player.last_name}` : "Unknown",
        salary: s.salary,
        projection: proj?.dk_proj || 0,
        position: s.roster_position,
      };
    })
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 10);

  console.log(`[SALARIES] Generated ${salaries.length} salaries`);

  return NextResponse.json({
    success: true,
    count: salaries.length,
    date: targetDate,
    stats: {
      avgSalary,
      maxSalary,
      minSalary,
      distribution,
    },
    topSalaries,
  });
}

/**
 * Calculate DraftKings-style salary based on projected fantasy points.
 * Uses a tiered system similar to actual DK pricing.
 */
function calculateDKSalary(projection: number): number {
  let salary: number;

  if (projection >= 55) {
    // Elite tier: $10,500 - $12,500
    salary = 10500 + (projection - 55) * 100;
  } else if (projection >= 45) {
    // Star tier: $8,500 - $10,500
    salary = 8500 + (projection - 45) * 200;
  } else if (projection >= 35) {
    // Above average: $6,500 - $8,500
    salary = 6500 + (projection - 35) * 200;
  } else if (projection >= 25) {
    // Mid-tier: $5,000 - $6,500
    salary = 5000 + (projection - 25) * 150;
  } else if (projection >= 15) {
    // Value tier: $4,000 - $5,000
    salary = 4000 + (projection - 15) * 100;
  } else if (projection >= 5) {
    // Punt tier: $3,500 - $4,000
    salary = 3500 + (projection - 5) * 50;
  } else {
    // Minimum
    salary = 3500;
  }

  // Round to nearest $100 and cap
  salary = Math.round(salary / 100) * 100;
  return Math.min(12500, Math.max(3500, salary));
}

/**
 * Map BALLDONTLIE positions to DraftKings roster positions.
 */
function mapToDkPosition(position: string): string {
  if (!position) return "UTIL";

  const pos = position.toUpperCase().trim();

  // Direct mappings
  if (pos === "C") return "C";
  if (pos === "PG") return "PG";
  if (pos === "SG") return "SG";
  if (pos === "SF") return "SF";
  if (pos === "PF") return "PF";

  // Combo positions - DK uses slash format
  if (pos === "G" || pos === "PG-SG" || pos === "SG-PG") return "PG/SG";
  if (pos === "F" || pos === "SF-PF" || pos === "PF-SF") return "SF/PF";
  if (pos === "G-F" || pos === "SG-SF") return "SG/SF";
  if (pos === "F-C" || pos === "PF-C" || pos === "C-PF") return "PF/C";
  if (pos === "F-G" || pos === "SF-SG") return "SF/SG";
  if (pos === "C-F") return "C/PF";

  // Fallback based on first letter
  if (pos.startsWith("G")) return "PG/SG";
  if (pos.startsWith("F")) return "SF/PF";
  if (pos.startsWith("C")) return "C";

  return "UTIL";
}
