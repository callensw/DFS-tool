import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { fetchAllPages, ApiPlayer } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[SYNC/PLAYERS] Starting players sync...");

  try {
    // Fetch all active players with pagination
    const result = await fetchAllPages<ApiPlayer>(
      "/v1/nba/players/active",
      undefined,
      100
    );

    if (result.error) {
      // Handle 401 gracefully - this endpoint requires ALL-STAR tier
      if (result.error.includes("Unauthorized") || result.error.includes("401")) {
        console.warn("[SYNC/PLAYERS] API tier insufficient for active players endpoint");
        return NextResponse.json(
          {
            success: false,
            count: 0,
            error: "This endpoint requires BALLDONTLIE ALL-STAR tier subscription",
            tier_required: "ALL-STAR",
          },
          { status: 401 }
        );
      }

      console.error("[SYNC/PLAYERS] API error:", result.error);
      return NextResponse.json(
        { success: false, count: 0, error: result.error },
        { status: 500 }
      );
    }

    const players = result.data;
    console.log(`[SYNC/PLAYERS] Fetched ${players.length} players from API`);

    if (players.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "No players returned from API",
      });
    }

    // Transform to our schema
    const playersToUpsert = players.map((player) => ({
      id: player.id,
      first_name: player.first_name,
      last_name: player.last_name,
      position: player.position || null,
      height: player.height || null,
      weight: player.weight || null,
      jersey_number: player.jersey_number || null,
      team_id: player.team?.id || null,
      is_active: true,
    }));

    // Upsert to Supabase in batches to avoid payload limits
    const supabase = createAdminClient();
    const batchSize = 500;
    let totalUpserted = 0;

    for (let i = 0; i < playersToUpsert.length; i += batchSize) {
      const batch = playersToUpsert.slice(i, i + batchSize);
      const { data, error } = await supabase
        .from("players")
        .upsert(batch, { onConflict: "id" })
        .select();

      if (error) {
        console.error("[SYNC/PLAYERS] Supabase error:", error);
        return NextResponse.json(
          {
            success: false,
            count: totalUpserted,
            error: error.message,
          },
          { status: 500 }
        );
      }

      totalUpserted += data?.length || 0;
      console.log(`[SYNC/PLAYERS] Batch ${Math.floor(i / batchSize) + 1}: upserted ${data?.length || 0} players`);
    }

    console.log(`[SYNC/PLAYERS] Total upserted: ${totalUpserted} players`);

    return NextResponse.json({
      success: true,
      count: totalUpserted,
    });
  } catch (error) {
    console.error("[SYNC/PLAYERS] Unexpected error:", error);
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
