import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { fetchAllPages, ApiInjury } from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

export async function GET() {
  console.log("[SYNC/INJURIES] Starting injuries sync...");

  try {
    // Fetch all injuries with pagination
    const result = await fetchAllPages<ApiInjury>(
      "/v1/player_injuries",
      undefined,
      100
    );

    if (result.error) {
      // Handle 401 gracefully - this endpoint requires ALL-STAR tier
      if (result.error.includes("Unauthorized") || result.error.includes("401")) {
        console.warn("[SYNC/INJURIES] API tier insufficient for injuries endpoint");
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

      console.error("[SYNC/INJURIES] API error:", result.error);
      return NextResponse.json(
        { success: false, count: 0, error: result.error },
        { status: 500 }
      );
    }

    const injuries = result.data;
    console.log(`[SYNC/INJURIES] Fetched ${injuries.length} injuries from API`);

    const supabase = createAdminClient();

    // First, mark all existing injuries as inactive
    const { error: updateError } = await supabase
      .from("injuries")
      .update({ is_active: false })
      .eq("is_active", true);

    if (updateError) {
      console.error("[SYNC/INJURIES] Error marking old injuries inactive:", updateError);
    }

    if (injuries.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "No active injuries returned from API",
      });
    }

    // Transform to our schema - use player_id as a composite key approach
    // Since we don't have a unique injury ID, we'll upsert based on player
    const injuriesToUpsert = injuries.map((injury) => ({
      player_id: injury.player.id,
      status: injury.status,
      return_date: injury.return_date || null,
      description: injury.description || null,
      updated_at: new Date().toISOString(),
      is_active: true,
    }));

    // For injuries, we want to insert new records for each sync
    // But first delete existing active injuries for these players
    const playerIds = injuries.map((i) => i.player.id);

    // Delete existing active injuries for these players
    await supabase
      .from("injuries")
      .delete()
      .in("player_id", playerIds)
      .eq("is_active", true);

    // Insert new injury records
    const { data, error } = await supabase
      .from("injuries")
      .insert(injuriesToUpsert)
      .select();

    if (error) {
      console.error("[SYNC/INJURIES] Supabase error:", error);
      return NextResponse.json(
        { success: false, count: 0, error: error.message },
        { status: 500 }
      );
    }

    console.log(`[SYNC/INJURIES] Inserted ${data?.length || 0} injuries`);

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
    });
  } catch (error) {
    console.error("[SYNC/INJURIES] Unexpected error:", error);
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
