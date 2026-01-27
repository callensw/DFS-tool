import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// DraftKings API endpoints
const DK_CONTESTS_URL = "https://www.draftkings.com/lobby/getcontests?sport=NBA";
const DK_DRAFTABLES_URL = "https://api.draftkings.com/draftgroups/v1/draftgroups";

interface DKContest {
  id: number;
  n: string; // name
  dg: number; // draft group id
  sd: string; // start date
  m: number; // max entries
  a: number; // entry fee
  po: number; // prize pool
  gameType: string;
}

interface DKContestsResponse {
  Contests: DKContest[];
  DraftGroups: DKDraftGroup[];
}

interface DKDraftGroup {
  DraftGroupId: number;
  ContestTypeId: number;
  StartDate: string;
  StartDateEst: string;
  GameCount: number;
  ContestStartTimeSuffix: string;
  ContestStartTimeType: number;
  Games: DKGame[];
  Sport: string;
  GameType: string;
}

interface DKGame {
  GameId: number;
  AwayTeamId: number;
  HomeTeamId: number;
  AwayTeamName: string;
  HomeTeamName: string;
  StartDate: string;
  Status: string;
}

interface DKDraftable {
  draftableId: number;
  playerId: number;
  displayName: string;
  firstName: string;
  lastName: string;
  position: string;
  rosterSlotId: number;
  salary: number;
  isDisabled: boolean;
  isSwappable: boolean;
  teamId: number;
  teamAbbreviation: string;
  status: string;
}

interface DKDraftablesResponse {
  draftables: DKDraftable[];
}

/**
 * Sync DraftKings salaries from their unofficial API.
 * Fetches all available NBA slates and their player salaries.
 */
export async function GET() {
  console.log("[DK-SYNC] Starting DraftKings salary sync...");

  const supabase = createAdminClient();

  try {
    // 1. Fetch contests from DraftKings
    console.log("[DK-SYNC] Fetching DK contests...");
    const contestsResponse = await fetch(DK_CONTESTS_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!contestsResponse.ok) {
      throw new Error(`DK contests API returned ${contestsResponse.status}`);
    }

    const contestsData: DKContestsResponse = await contestsResponse.json();
    console.log(`[DK-SYNC] Found ${contestsData.DraftGroups?.length || 0} draft groups`);

    if (!contestsData.DraftGroups || contestsData.DraftGroups.length === 0) {
      return NextResponse.json({
        success: false,
        error: "No NBA draft groups found. Games may not be available yet.",
      });
    }

    // 2. Filter for Classic game type only (not Showdown)
    const classicDraftGroups = contestsData.DraftGroups.filter(
      (dg) => dg.GameType === "Classic" || !dg.GameType
    );

    console.log(`[DK-SYNC] Found ${classicDraftGroups.length} Classic draft groups`);

    const results = {
      slatesProcessed: 0,
      playersProcessed: 0,
      errors: [] as string[],
      slates: [] as { id: number; name: string; startTime: string; players: number }[],
      debug: [] as { draftGroupId: number; responseKeys: string[]; playerCount: number; samplePlayer?: Record<string, unknown> }[],
    };

    // 3. Process each draft group
    for (const draftGroup of classicDraftGroups) {
      try {
        console.log(`[DK-SYNC] Processing draft group ${draftGroup.DraftGroupId}...`);

        // Fetch draftables (players + salaries) for this draft group
        const draftablesUrl = `${DK_DRAFTABLES_URL}/${draftGroup.DraftGroupId}/draftables`;
        const draftablesResponse = await fetch(draftablesUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "application/json",
          },
        });

        if (!draftablesResponse.ok) {
          const errorText = await draftablesResponse.text();
          console.log(`[DK-SYNC] Draftables API error for group ${draftGroup.DraftGroupId}: ${draftablesResponse.status}`);
          console.log(`[DK-SYNC] Error response body: ${errorText.slice(0, 500)}`);
          results.errors.push(
            `Failed to fetch draftables for group ${draftGroup.DraftGroupId}: ${draftablesResponse.status} - ${errorText.slice(0, 200)}`
          );
          continue;
        }

        // Debug: Get raw response text first
        const rawText = await draftablesResponse.text();
        console.log(`[DK-SYNC] Draftables raw response length: ${rawText.length} chars`);
        console.log(`[DK-SYNC] Draftables raw response preview: ${rawText.slice(0, 500)}`);

        let draftablesData: Record<string, unknown>;
        try {
          draftablesData = JSON.parse(rawText);
        } catch (parseErr) {
          console.error(`[DK-SYNC] Failed to parse draftables JSON for group ${draftGroup.DraftGroupId}:`, parseErr);
          results.errors.push(`JSON parse error for group ${draftGroup.DraftGroupId}: ${rawText.slice(0, 100)}`);
          continue;
        }

        // Debug: Log all top-level keys in the response
        const responseKeys = Object.keys(draftablesData);
        console.log(`[DK-SYNC] Draftables response keys: ${responseKeys.join(', ')}`);

        // Add debug info to response
        const debugEntry: { draftGroupId: number; responseKeys: string[]; playerCount: number; samplePlayer?: Record<string, unknown> } = {
          draftGroupId: draftGroup.DraftGroupId,
          responseKeys,
          playerCount: 0,
        };

        // Try both 'draftables' and 'Draftables' (API might use PascalCase)
        const players = (draftablesData.draftables || draftablesData.Draftables || []) as DKDraftable[];
        console.log(`[DK-SYNC] Players array type: ${typeof players}, isArray: ${Array.isArray(players)}, length: ${Array.isArray(players) ? players.length : 'N/A'}`);

        // Debug: Log first player object to see actual structure
        if (Array.isArray(players) && players.length > 0) {
          console.log(`[DK-SYNC] First player object sample:`, JSON.stringify(players[0], null, 2).slice(0, 1000));
          debugEntry.samplePlayer = players[0] as unknown as Record<string, unknown>;
        }
        debugEntry.playerCount = Array.isArray(players) ? players.length : 0;
        results.debug.push(debugEntry);

        if (players.length === 0) {
          console.log(`[DK-SYNC] No players found for draft group ${draftGroup.DraftGroupId}`);
          // Log what keys ARE available in the response
          console.log(`[DK-SYNC] Available response data:`, JSON.stringify(draftablesData, null, 2).slice(0, 1500));
          continue;
        }

        console.log(`[DK-SYNC] Found ${players.length} players for draft group ${draftGroup.DraftGroupId}`);

        // 4. Upsert slate info
        const slateData = {
          dk_draft_group_id: draftGroup.DraftGroupId,
          name: `NBA ${draftGroup.ContestStartTimeSuffix || "Main"}`,
          game_count: draftGroup.GameCount,
          start_time: draftGroup.StartDate,
          start_time_suffix: draftGroup.ContestStartTimeSuffix || "Main",
          game_type: draftGroup.GameType || "Classic",
          sport: "NBA",
          games: draftGroup.Games,
          fetched_at: new Date().toISOString(),
        };

        const { data: slate, error: slateError } = await supabase
          .from("dk_slates")
          .upsert(slateData, {
            onConflict: "dk_draft_group_id",
          })
          .select()
          .single();

        if (slateError) {
          results.errors.push(`Failed to upsert slate ${draftGroup.DraftGroupId}: ${slateError.message}`);
          continue;
        }

        // 5. Upsert player salaries
        // Debug: Check player data structure - API might use different field names
        const firstPlayer = players[0] as unknown as Record<string, unknown>;
        const playerKeys = Object.keys(firstPlayer);
        console.log(`[DK-SYNC] Player object keys: ${playerKeys.join(', ')}`);

        // Handle both camelCase and other casing variants
        const getPlayerField = (p: Record<string, unknown>, ...keys: string[]): unknown => {
          for (const key of keys) {
            if (p[key] !== undefined) return p[key];
          }
          return undefined;
        };

        const salaryRecords = players
          .filter((p) => {
            const player = p as unknown as Record<string, unknown>;
            const isDisabled = getPlayerField(player, 'isDisabled', 'IsDisabled', 'disabled', 'Disabled');
            const salary = getPlayerField(player, 'salary', 'Salary');
            return !isDisabled && Number(salary) > 0;
          })
          .map((p) => {
            const player = p as unknown as Record<string, unknown>;
            return {
              slate_id: slate.id,
              dk_player_id: getPlayerField(player, 'playerId', 'PlayerId', 'playerDkId', 'PlayerDkId') as number,
              name_id: (getPlayerField(player, 'displayName', 'DisplayName', 'name', 'Name') ||
                       `${getPlayerField(player, 'firstName', 'FirstName') || ''} ${getPlayerField(player, 'lastName', 'LastName') || ''}`.trim()) as string,
              salary: Number(getPlayerField(player, 'salary', 'Salary')),
              roster_position: getPlayerField(player, 'position', 'Position', 'rosterPosition', 'RosterPosition') as string,
              team: getPlayerField(player, 'teamAbbreviation', 'TeamAbbreviation', 'team', 'Team') as string,
            };
          });

        console.log(`[DK-SYNC] Filtered from ${players.length} to ${salaryRecords.length} salary records`);

        if (salaryRecords.length > 0) {
          // Delete old salaries for this slate first
          await supabase.from("dk_salaries").delete().eq("slate_id", slate.id);

          // Insert new salaries
          const { error: salaryError } = await supabase.from("dk_salaries").insert(salaryRecords);

          if (salaryError) {
            results.errors.push(`Failed to insert salaries for slate ${slate.id}: ${salaryError.message}`);
          } else {
            results.playersProcessed += salaryRecords.length;
          }
        }

        results.slatesProcessed++;
        results.slates.push({
          id: slate.id,
          name: slateData.name,
          startTime: draftGroup.ContestStartTimeSuffix || "",
          players: salaryRecords.length,
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : "Unknown error";
        results.errors.push(`Error processing draft group ${draftGroup.DraftGroupId}: ${error}`);
      }
    }

    console.log(`[DK-SYNC] Completed. Processed ${results.slatesProcessed} slates, ${results.playersProcessed} players`);

    // Limit debug output to first 3 entries to avoid huge response
    const limitedDebug = results.debug.slice(0, 3);

    return NextResponse.json({
      success: true,
      ...results,
      debug: limitedDebug,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Unknown error";
    console.error("[DK-SYNC] Error:", error);
    return NextResponse.json({
      success: false,
      error,
    });
  }
}
