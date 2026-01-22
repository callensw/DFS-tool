import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  fetchFromBallDontLie,
  BallDontLieResponse,
  ApiOdds,
  getTodayDateString,
} from "@/lib/balldontlie";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  console.log("[SYNC/ODDS] Starting odds sync...");

  // Allow date override via query param
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || getTodayDateString();

  console.log(`[SYNC/ODDS] Syncing odds for date: ${date}`);

  try {
    // Fetch odds from BALLDONTLIE API (v2 endpoint)
    const result = await fetchFromBallDontLie<BallDontLieResponse<ApiOdds>>(
      "/v2/nba/odds",
      { "dates[]": date }
    );

    if (result.error) {
      // Handle 401 gracefully - this endpoint requires GOAT tier
      if (result.error.includes("Unauthorized") || result.error.includes("401")) {
        console.warn("[SYNC/ODDS] API tier insufficient for odds endpoint");
        return NextResponse.json(
          {
            success: false,
            count: 0,
            error: "This endpoint requires BALLDONTLIE GOAT tier subscription",
            tier_required: "GOAT",
          },
          { status: 401 }
        );
      }

      console.error("[SYNC/ODDS] API error:", result.error);
      return NextResponse.json(
        { success: false, count: 0, error: result.error },
        { status: result.status }
      );
    }

    const oddsData = result.data?.data || [];
    console.log(`[SYNC/ODDS] Fetched odds for ${oddsData.length} games`);

    if (oddsData.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: `No odds found for ${date}`,
        date,
      });
    }

    // Transform to our schema - we INSERT (not upsert) to keep history
    const oddsToInsert: Array<{
      game_id: number;
      vendor: string;
      spread_home: number | null;
      total: number | null;
      moneyline_home: number | null;
      moneyline_away: number | null;
      captured_at: string;
    }> = [];

    const capturedAt = new Date().toISOString();

    for (const odds of oddsData) {
      for (const bookmaker of odds.bookmakers || []) {
        let spreadHome: number | null = null;
        let total: number | null = null;
        let moneylineHome: number | null = null;
        let moneylineAway: number | null = null;

        for (const market of bookmaker.markets || []) {
          if (market.key === "spreads") {
            const homeOutcome = market.outcomes.find(
              (o) => o.name === odds.game.home_team.full_name
            );
            if (homeOutcome?.point !== undefined) {
              spreadHome = homeOutcome.point;
            }
          }

          if (market.key === "totals") {
            const overOutcome = market.outcomes.find((o) => o.name === "Over");
            if (overOutcome?.point !== undefined) {
              total = overOutcome.point;
            }
          }

          if (market.key === "h2h") {
            const homeOutcome = market.outcomes.find(
              (o) => o.name === odds.game.home_team.full_name
            );
            const awayOutcome = market.outcomes.find(
              (o) => o.name === odds.game.visitor_team.full_name
            );
            if (homeOutcome) moneylineHome = homeOutcome.price;
            if (awayOutcome) moneylineAway = awayOutcome.price;
          }
        }

        oddsToInsert.push({
          game_id: odds.game.id,
          vendor: bookmaker.name,
          spread_home: spreadHome,
          total,
          moneyline_home: moneylineHome,
          moneyline_away: moneylineAway,
          captured_at: capturedAt,
        });
      }
    }

    if (oddsToInsert.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "No odds data to insert",
        date,
      });
    }

    // Insert to Supabase (not upsert - we want history)
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("game_odds")
      .insert(oddsToInsert)
      .select();

    if (error) {
      console.error("[SYNC/ODDS] Supabase error:", error);
      return NextResponse.json(
        { success: false, count: 0, error: error.message },
        { status: 500 }
      );
    }

    console.log(`[SYNC/ODDS] Inserted ${data?.length || 0} odds records`);

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      date,
    });
  } catch (error) {
    console.error("[SYNC/ODDS] Unexpected error:", error);
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
