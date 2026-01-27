"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";

interface Injury {
  id: number;
  player_id: number;
  status: string;
  return_date: string | null;
  description: string | null;
  updated_at: string;
  is_active: boolean;
}

interface Player {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  team_id: number;
}

interface Team {
  id: number;
  abbreviation: string;
  name: string;
}

interface InjuryWithDetails extends Injury {
  playerName: string;
  teamAbbr: string;
  position: string;
}

const STATUS_COLORS: Record<string, string> = {
  Out: "badge-red",
  Doubtful: "badge-orange",
  Questionable: "badge-yellow",
  Probable: "badge-green",
  "Day-To-Day": "badge-yellow",
  GTD: "badge-yellow",
};

const STATUS_ORDER: Record<string, number> = {
  Out: 0,
  Doubtful: 1,
  Questionable: 2,
  "Day-To-Day": 3,
  GTD: 4,
  Probable: 5,
};

export default function InjuriesPage() {
  const [injuries, setInjuries] = useState<InjuryWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetchInjuries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchInjuries() {
    setLoading(true);

    try {
      const [injuriesRes, playersRes, teamsRes] = await Promise.all([
        supabase.from("dfs_injuries").select("*").eq("is_active", true),
        supabase.from("dfs_players").select("*"),
        supabase.from("dfs_teams").select("*"),
      ]);

      const injuriesData = (injuriesRes.data || []) as Injury[];
      const playersData = (playersRes.data || []) as Player[];
      const teamsData = (teamsRes.data || []) as Team[];

      const playerMap = new Map(playersData.map((p) => [p.id, p]));
      const teamMap = new Map(teamsData.map((t) => [t.id, t]));

      const enrichedInjuries: InjuryWithDetails[] = injuriesData.map((inj) => {
        const player = playerMap.get(inj.player_id);
        const team = player ? teamMap.get(player.team_id) : null;

        return {
          ...inj,
          playerName: player
            ? `${player.first_name} ${player.last_name}`
            : `Player ${inj.player_id}`,
          teamAbbr: team?.abbreviation || "N/A",
          position: player?.position || "N/A",
        };
      });

      // Sort by status severity
      enrichedInjuries.sort((a, b) => {
        const aOrder = STATUS_ORDER[a.status] ?? 99;
        const bOrder = STATUS_ORDER[b.status] ?? 99;
        return aOrder - bOrder;
      });

      setInjuries(enrichedInjuries);
    } catch (error) {
      console.error("Error fetching injuries:", error);
    }

    setLoading(false);
  }

  // Get unique statuses and teams for filters
  const uniqueStatuses = useMemo(() => {
    const statusSet = new Set(injuries.map((i) => i.status));
    return ["All", ...Array.from(statusSet)];
  }, [injuries]);

  const uniqueTeams = useMemo(() => {
    const teamSet = new Set(injuries.map((i) => i.teamAbbr));
    return ["All", ...Array.from(teamSet).sort()];
  }, [injuries]);

  // Filter injuries
  const filteredInjuries = useMemo(() => {
    let result = [...injuries];

    if (statusFilter !== "All") {
      result = result.filter((i) => i.status === statusFilter);
    }

    if (teamFilter !== "All") {
      result = result.filter((i) => i.teamAbbr === teamFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((i) =>
        i.playerName.toLowerCase().includes(query)
      );
    }

    return result;
  }, [injuries, statusFilter, teamFilter, searchQuery]);

  // Group injuries by status
  const injuriesByStatus = useMemo(() => {
    const groups: Record<string, InjuryWithDetails[]> = {};
    filteredInjuries.forEach((inj) => {
      if (!groups[inj.status]) {
        groups[inj.status] = [];
      }
      groups[inj.status].push(inj);
    });
    return groups;
  }, [filteredInjuries]);

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getStatusBadgeClass(status: string): string {
    return STATUS_COLORS[status] || "badge-gray";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Injury Report</h1>
          <p className="text-gray-400 mt-1">
            {injuries.length} active injuries
          </p>
        </div>
        <button
          onClick={fetchInjuries}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors border border-gray-700"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="Search players..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {uniqueStatuses.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          {/* Team Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Team:</span>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            >
              {uniqueTeams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Injury Cards */}
      {loading ? (
        <div className="p-12 text-center text-gray-500">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          Loading injuries...
        </div>
      ) : injuries.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-12 border border-gray-800 text-center">
          <p className="text-xl text-gray-400 mb-2">No injury data available</p>
          <p className="text-sm text-gray-500">
            Sync injuries from the dashboard to see injury reports
          </p>
        </div>
      ) : filteredInjuries.length === 0 ? (
        <div className="bg-gray-900 rounded-xl p-12 border border-gray-800 text-center">
          <p className="text-xl text-gray-400">No injuries match your filters</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(injuriesByStatus).map(([status, statusInjuries]) => (
            <div key={status}>
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <span className={`badge ${getStatusBadgeClass(status)}`}>
                  {status}
                </span>
                <span className="text-gray-500 text-sm font-normal">
                  ({statusInjuries.length} players)
                </span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {statusInjuries.map((injury) => (
                  <InjuryCard key={injury.id} injury={injury} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Summary Stats */}
      {!loading && injuries.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <div className="flex flex-wrap gap-6 justify-center">
            {Object.entries(
              injuries.reduce((acc, inj) => {
                acc[inj.status] = (acc[inj.status] || 0) + 1;
                return acc;
              }, {} as Record<string, number>)
            ).map(([status, count]) => (
              <div key={status} className="text-center">
                <span className={`badge ${getStatusBadgeClass(status)} text-lg`}>
                  {count}
                </span>
                <p className="text-xs text-gray-500 mt-1">{status}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InjuryCard({ injury }: { injury: InjuryWithDetails }) {
  const statusClass = STATUS_COLORS[injury.status] || "badge-gray";

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white">{injury.playerName}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="badge badge-blue">{injury.teamAbbr}</span>
            <span className="badge badge-gray">{injury.position}</span>
          </div>
        </div>
        <span className={`badge ${statusClass}`}>{injury.status}</span>
      </div>

      {injury.description && (
        <p className="text-sm text-gray-400 mb-3">{injury.description}</p>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500">
        {injury.return_date && (
          <span>Return: {injury.return_date}</span>
        )}
        <span>Updated: {formatDate(injury.updated_at)}</span>
      </div>
    </div>
  );
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
