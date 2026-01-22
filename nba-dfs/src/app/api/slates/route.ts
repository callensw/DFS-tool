import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * Get available DraftKings slates.
 * Returns all slates for today or a specified date.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeOld = searchParams.get("includeOld") === "true";

  const supabase = createAdminClient();

  // Get slates, optionally filtering to only upcoming ones
  let query = supabase
    .from("dk_slates")
    .select("*")
    .eq("sport", "NBA")
    .order("start_time", { ascending: true });

  if (!includeOld) {
    // Only show slates that haven't started yet (or started within last 3 hours)
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    query = query.gte("start_time", threeHoursAgo);
  }

  const { data: slates, error } = await query;

  if (error) {
    return NextResponse.json({
      success: false,
      error: error.message,
    });
  }

  // Get player counts for each slate
  const slatesWithCounts = await Promise.all(
    (slates || []).map(async (slate) => {
      const { count } = await supabase
        .from("dk_salaries")
        .select("*", { count: "exact", head: true })
        .eq("slate_id", slate.id);

      return {
        id: slate.id,
        draftGroupId: slate.dk_draft_group_id,
        name: slate.name,
        gameCount: slate.game_count,
        startTime: slate.start_time,
        startTimeSuffix: slate.start_time_suffix,
        gameType: slate.game_type,
        playerCount: count || 0,
        games: slate.games,
        fetchedAt: slate.fetched_at,
      };
    })
  );

  return NextResponse.json({
    success: true,
    count: slatesWithCounts.length,
    slates: slatesWithCounts,
  });
}
