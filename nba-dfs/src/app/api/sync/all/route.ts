import { NextResponse } from "next/server";

interface SyncResult {
  success: boolean;
  count: number;
  error?: string;
  tier_required?: string;
  date?: string;
  message?: string;
}

async function callSyncEndpoint(
  baseUrl: string,
  endpoint: string
): Promise<SyncResult> {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      cache: "no-store",
    });
    return await response.json();
  } catch (error) {
    return {
      success: false,
      count: 0,
      error: error instanceof Error ? error.message : "Failed to call endpoint",
    };
  }
}

export async function GET(request: Request) {
  console.log("[SYNC/ALL] Starting full sync...");

  const startTime = Date.now();

  // Get the base URL from the request
  const { origin } = new URL(request.url);

  const results: Record<string, SyncResult> = {};

  // 1. Sync teams first (no dependencies)
  console.log("[SYNC/ALL] Syncing teams...");
  results.teams = await callSyncEndpoint(origin, "/api/sync/teams");

  // 2. Sync players (depends on teams for team_id FK)
  console.log("[SYNC/ALL] Syncing players...");
  results.players = await callSyncEndpoint(origin, "/api/sync/players");

  // 3. Sync games (depends on teams for team_id FKs)
  console.log("[SYNC/ALL] Syncing games...");
  results.games = await callSyncEndpoint(origin, "/api/sync/games");

  // 4. Sync injuries (depends on players for player_id FK)
  console.log("[SYNC/ALL] Syncing injuries...");
  results.injuries = await callSyncEndpoint(origin, "/api/sync/injuries");

  // 5. Sync odds (depends on games for game_id FK)
  console.log("[SYNC/ALL] Syncing odds...");
  results.odds = await callSyncEndpoint(origin, "/api/sync/odds");

  const endTime = Date.now();
  const duration = endTime - startTime;

  // Calculate summary
  const summary = {
    total_synced: Object.values(results).reduce((sum, r) => sum + r.count, 0),
    successful_endpoints: Object.values(results).filter((r) => r.success).length,
    failed_endpoints: Object.values(results).filter((r) => !r.success).length,
    tier_limited_endpoints: Object.values(results).filter(
      (r) => r.tier_required
    ).length,
    duration_ms: duration,
  };

  console.log("[SYNC/ALL] Sync complete:", summary);

  // Determine overall success (consider tier-limited as partial success)
  const hasRealErrors = Object.values(results).some(
    (r) => !r.success && !r.tier_required
  );

  return NextResponse.json({
    success: !hasRealErrors,
    results,
    summary,
  });
}
