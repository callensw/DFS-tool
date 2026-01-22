import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  fetchFromBallDontLie,
  BallDontLieResponse,
  ApiTeam,
} from "@/lib/balldontlie";

export async function GET() {
  console.log("[SYNC/TEAMS] Starting teams sync...");

  try {
    // Fetch teams from BALLDONTLIE API
    const result = await fetchFromBallDontLie<BallDontLieResponse<ApiTeam>>(
      "/v1/nba/teams"
    );

    if (result.error) {
      console.error("[SYNC/TEAMS] API error:", result.error);
      return NextResponse.json(
        { success: false, count: 0, error: result.error },
        { status: result.status }
      );
    }

    const teams = result.data?.data || [];
    console.log(`[SYNC/TEAMS] Fetched ${teams.length} teams from API`);

    if (teams.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "No teams returned from API",
      });
    }

    // Transform to our schema
    const teamsToUpsert = teams.map((team) => ({
      id: team.id,
      name: team.name,
      full_name: team.full_name,
      abbreviation: team.abbreviation,
      city: team.city,
      conference: team.conference,
      division: team.division,
    }));

    // Upsert to Supabase
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("teams")
      .upsert(teamsToUpsert, { onConflict: "id" })
      .select();

    if (error) {
      console.error("[SYNC/TEAMS] Supabase error:", error);
      return NextResponse.json(
        { success: false, count: 0, error: error.message },
        { status: 500 }
      );
    }

    console.log(`[SYNC/TEAMS] Upserted ${data?.length || 0} teams`);

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("[SYNC/TEAMS] Unexpected error:", error);
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
