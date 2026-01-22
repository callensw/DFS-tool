"use client";

import { useState, useEffect } from "react";
import Card, { ActionButton } from "@/components/Card";
import { createBrowserClient } from "@supabase/ssr";

interface DashboardStats {
  gamesCount: number;
  injuriesCount: number;
  projectionsCount: number;
  playersCount: number;
  teamsCount: number;
}

interface SyncStatus {
  teams: "idle" | "loading" | "success" | "error";
  players: "idle" | "loading" | "success" | "error";
  games: "idle" | "loading" | "success" | "error";
  injuries: "idle" | "loading" | "success" | "error";
  projections: "idle" | "loading" | "success" | "error";
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    gamesCount: 0,
    injuriesCount: 0,
    projectionsCount: 0,
    playersCount: 0,
    teamsCount: 0,
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    teams: "idle",
    players: "idle",
    games: "idle",
    injuries: "idle",
    projections: "idle",
  });
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().split("T")[0];

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  async function fetchStats() {
    setLoading(true);
    try {
      const [gamesRes, injuriesRes, projectionsRes, playersRes, teamsRes] =
        await Promise.all([
          supabase
            .from("games")
            .select("id", { count: "exact", head: true })
            .eq("date", today),
          supabase
            .from("injuries")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase
            .from("projections")
            .select("id", { count: "exact", head: true }),
          supabase
            .from("players")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase.from("teams").select("id", { count: "exact", head: true }),
        ]);

      setStats({
        gamesCount: gamesRes.count || 0,
        injuriesCount: injuriesRes.count || 0,
        projectionsCount: projectionsRes.count || 0,
        playersCount: playersRes.count || 0,
        teamsCount: teamsRes.count || 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSync(endpoint: string, key: keyof SyncStatus) {
    setSyncStatus((prev) => ({ ...prev, [key]: "loading" }));
    try {
      const response = await fetch(endpoint);
      const data = await response.json();
      if (data.success || data.tier_required) {
        setSyncStatus((prev) => ({ ...prev, [key]: "success" }));
      } else {
        setSyncStatus((prev) => ({ ...prev, [key]: "error" }));
      }
    } catch {
      setSyncStatus((prev) => ({ ...prev, [key]: "error" }));
    }
    fetchStats();
  }

  async function runFullSync() {
    setSyncStatus({
      teams: "loading",
      players: "loading",
      games: "loading",
      injuries: "loading",
      projections: "loading",
    });

    try {
      const response = await fetch("/api/sync/all");
      const data = await response.json();

      setSyncStatus({
        teams: data.results?.teams?.success ? "success" : "error",
        players: data.results?.players?.success || data.results?.players?.tier_required ? "success" : "error",
        games: data.results?.games?.success ? "success" : "error",
        injuries: data.results?.injuries?.success || data.results?.injuries?.tier_required ? "success" : "error",
        projections: "idle",
      });

      setLastSync(new Date().toLocaleTimeString());
      fetchStats();
    } catch {
      setSyncStatus({
        teams: "error",
        players: "error",
        games: "error",
        injuries: "error",
        projections: "error",
      });
    }
  }

  async function generateProjections() {
    setSyncStatus((prev) => ({ ...prev, projections: "loading" }));
    try {
      const response = await fetch(`/api/projections/generate?date=${today}`);
      const data = await response.json();
      setSyncStatus((prev) => ({
        ...prev,
        projections: data.success ? "success" : "error",
      }));
      fetchStats();
    } catch {
      setSyncStatus((prev) => ({ ...prev, projections: "error" }));
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "loading":
        return "⏳";
      case "success":
        return "✓";
      case "error":
        return "✗";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          <p className="text-gray-400 mt-1">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSync && (
            <span className="text-sm text-gray-500">Last sync: {lastSync}</span>
          )}
          <ActionButton
            onClick={runFullSync}
            loading={Object.values(syncStatus).some((s) => s === "loading")}
          >
            🔄 Sync All Data
          </ActionButton>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card
          title="Games Today"
          value={loading ? "..." : stats.gamesCount}
          subtitle={`${today}`}
          icon="🏀"
          color="blue"
        />
        <Card
          title="Active Injuries"
          value={loading ? "..." : stats.injuriesCount}
          subtitle="Players affected"
          icon="🏥"
          color="red"
        />
        <Card
          title="Projections"
          value={loading ? "..." : stats.projectionsCount}
          subtitle="Players projected"
          icon="📈"
          color="green"
        />
        <Card
          title="Active Players"
          value={loading ? "..." : stats.playersCount}
          subtitle={`${stats.teamsCount} teams`}
          icon="👥"
          color="purple"
        />
      </div>

      {/* Sync Controls */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <h2 className="text-xl font-semibold text-white mb-4">Data Sync</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <SyncButton
            label="Teams"
            status={syncStatus.teams}
            onClick={() => runSync("/api/sync/teams", "teams")}
            icon={getStatusIcon(syncStatus.teams)}
          />
          <SyncButton
            label="Players"
            status={syncStatus.players}
            onClick={() => runSync("/api/sync/players", "players")}
            icon={getStatusIcon(syncStatus.players)}
            tier="ALL-STAR"
          />
          <SyncButton
            label="Games"
            status={syncStatus.games}
            onClick={() => runSync(`/api/sync/games?date=${today}`, "games")}
            icon={getStatusIcon(syncStatus.games)}
          />
          <SyncButton
            label="Injuries"
            status={syncStatus.injuries}
            onClick={() => runSync("/api/sync/injuries", "injuries")}
            icon={getStatusIcon(syncStatus.injuries)}
            tier="ALL-STAR"
          />
          <SyncButton
            label="Projections"
            status={syncStatus.projections}
            onClick={generateProjections}
            icon={getStatusIcon(syncStatus.projections)}
            variant="generate"
          />
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <a
          href="/slate"
          className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl p-6 hover:from-blue-500 hover:to-blue-700 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">View Slate</h3>
              <p className="text-blue-200 mt-1">
                See all projections and build lineups
              </p>
            </div>
            <span className="text-4xl group-hover:scale-110 transition-transform">
              →
            </span>
          </div>
        </a>
        <a
          href="/injuries"
          className="bg-gradient-to-br from-red-600 to-red-800 rounded-xl p-6 hover:from-red-500 hover:to-red-700 transition-all group"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">
                Injury Report
              </h3>
              <p className="text-red-200 mt-1">
                Check player availability status
              </p>
            </div>
            <span className="text-4xl group-hover:scale-110 transition-transform">
              →
            </span>
          </div>
        </a>
      </div>
    </div>
  );
}

function SyncButton({
  label,
  status,
  onClick,
  icon,
  tier,
  variant = "sync",
}: {
  label: string;
  status: string;
  onClick: () => void;
  icon: string;
  tier?: string;
  variant?: "sync" | "generate";
}) {
  const isLoading = status === "loading";
  const baseClasses =
    "w-full px-4 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 flex items-center justify-between";
  const variantClasses =
    variant === "generate"
      ? "bg-green-600 hover:bg-green-700 text-white"
      : "bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700";

  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={`${baseClasses} ${variantClasses}`}
    >
      <span className="flex items-center gap-2">
        {isLoading ? (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        ) : icon ? (
          <span
            className={
              status === "success"
                ? "text-green-400"
                : status === "error"
                ? "text-red-400"
                : ""
            }
          >
            {icon}
          </span>
        ) : null}
        {label}
      </span>
      {tier && <span className="text-xs text-gray-500">{tier}</span>}
    </button>
  );
}
