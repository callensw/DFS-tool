import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getTodayDateString } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

/**
 * Generate mock DraftKings salaries based on player projections.
 * Higher projections = higher salaries.
 *
 * Salary formula: Base salary + (projection * multiplier)
 * - Base salary: $3,500
 * - Multiplier: ~$200 per projected point
 * - Max salary: $12,000
 * - Min salary: $3,500
 */
export async function GET(request: Request) {
  console.log("[SALARIES/MOCK] Generating mock salaries...");

  const { searchParams } = new URL(request.url);
  const targetDate = searchParams.get("date") || getTodayDateString();

  const supabase = createAdminClient();

  // 1. Get games for the target date
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id")
    .eq("date", targetDate);

  if (gamesError) {
    console.error("[SALARIES/MOCK] Error fetching games:", gamesError);
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
  console.log(`[SALARIES/MOCK] Found ${games.length} games for ${targetDate}`);

  // 2. Get projections for these games
  const { data: projections, error: projError } = await supabase
    .from("projections")
    .select("player_id, dk_proj, game_id")
    .in("game_id", gameIds);

  if (projError) {
    console.error("[SALARIES/MOCK] Error fetching projections:", projError);
    return NextResponse.json({
      success: false,
      error: projError.message,
    });
  }

  if (!projections || projections.length === 0) {
    return NextResponse.json({
      success: false,
      error: "No projections found for this date. Run /api/projections/generate first.",
      date: targetDate,
    });
  }

  console.log(`[SALARIES/MOCK] Found ${projections.length} projections`);

  // 3. Get player info for positions
  const playerIds = projections.map((p) => p.player_id);
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, first_name, last_name, position")
    .in("id", playerIds);

  if (playersError) {
    console.error("[SALARIES/MOCK] Error fetching players:", playersError);
    return NextResponse.json({
      success: false,
      error: playersError.message,
    });
  }

  const playerMap = new Map(players?.map((p) => [p.id, p]) || []);

  // 4. Generate mock salaries
  const mockSalaries = projections.map((proj) => {
    const player = playerMap.get(proj.player_id);

    // Salary formula: Higher projection = higher salary
    // Base: $3,500, Max: $12,000
    const baseSalary = 3500;
    const multiplier = 200;
    const rawSalary = baseSalary + (proj.dk_proj * multiplier);

    // Round to nearest $100 and cap between $3,500 and $12,000
    const salary = Math.min(12000, Math.max(3500, Math.round(rawSalary / 100) * 100));

    // Map position to DraftKings format
    const rawPosition = player?.position || "";
    const dkPosition = mapToDkPosition(rawPosition);

    return {
      player_id: proj.player_id,
      game_date: targetDate,
      salary,
      position: dkPosition,
      name_id: player ? `${player.first_name} ${player.last_name}` : null,
    };
  });

  // 5. Upsert to dk_salaries table
  const { error: upsertError } = await supabase
    .from("dk_salaries")
    .upsert(mockSalaries, {
      onConflict: "player_id,game_date",
      ignoreDuplicates: false,
    });

  if (upsertError) {
    console.error("[SALARIES/MOCK] Upsert error:", upsertError);
    return NextResponse.json({
      success: false,
      error: upsertError.message,
    });
  }

  // Calculate stats
  const avgSalary = Math.round(
    mockSalaries.reduce((sum, s) => sum + s.salary, 0) / mockSalaries.length
  );
  const maxSalary = Math.max(...mockSalaries.map((s) => s.salary));
  const minSalary = Math.min(...mockSalaries.map((s) => s.salary));

  // Get top salaries with player names
  const topSalaries = mockSalaries
    .sort((a, b) => b.salary - a.salary)
    .slice(0, 10)
    .map((s) => ({
      name: s.name_id,
      salary: s.salary,
      position: s.position,
    }));

  console.log(`[SALARIES/MOCK] Generated ${mockSalaries.length} mock salaries`);

  return NextResponse.json({
    success: true,
    count: mockSalaries.length,
    date: targetDate,
    stats: {
      avgSalary,
      maxSalary,
      minSalary,
    },
    topSalaries,
  });
}

/**
 * Map BALLDONTLIE positions to DraftKings positions.
 * BALLDONTLIE uses: G, F, C, G-F, F-C, etc.
 * DraftKings uses: PG, SG, SF, PF, C
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

  // Combo positions
  if (pos === "G" || pos === "PG-SG" || pos === "SG-PG") return "PG/SG";
  if (pos === "F" || pos === "SF-PF" || pos === "PF-SF") return "SF/PF";
  if (pos === "G-F" || pos === "SG-SF") return "SG/SF";
  if (pos === "F-C" || pos === "PF-C" || pos === "C-PF") return "PF/C";
  if (pos === "F-G" || pos === "SF-SG") return "SF/SG";

  // Fallback based on first letter
  if (pos.startsWith("G")) return "PG/SG";
  if (pos.startsWith("F")) return "SF/PF";
  if (pos.startsWith("C")) return "C";

  return "UTIL";
}
