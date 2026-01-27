"use client";

import { useState, useEffect, useMemo } from "react";
import { createBrowserClient } from "@supabase/ssr";

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

interface Game {
  id: number;
  date: string;
  home_team_id: number;
  visitor_team_id: number;
}

interface Projection {
  id: number;
  player_id: number;
  game_id: number;
  dk_proj: number;
  dk_floor: number;
  dk_ceiling: number;
  minutes_proj: number;
}

interface Salary {
  player_id: number;
  salary: number;
  roster_position: string;
}

interface PlayerRow {
  id: number;
  name: string;
  team: string;
  position: string;
  opponent: string;
  salary: number;
  proj: number;
  floor: number;
  ceiling: number;
  value: number;
  minutes: number;
  gameId: number;
}

type SortField = "name" | "salary" | "proj" | "floor" | "ceiling" | "value" | "minutes";
type SortDir = "asc" | "desc";

const POSITIONS = ["All", "PG", "SG", "SF", "PF", "C"];

export default function SlatePage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>("proj");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [positionFilter, setPositionFilter] = useState("All");
  const [teamFilter, setTeamFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [games, setGames] = useState<Game[]>([]);

  const today = new Date().toISOString().split("T")[0];

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData() {
    setLoading(true);

    try {
      // Fetch all required data in parallel
      const [teamsRes, gamesRes, projectionsRes, playersRes, salariesRes] =
        await Promise.all([
          supabase.from("dfs_teams").select("*"),
          supabase.from("dfs_games").select("*").eq("date", today),
          supabase.from("dfs_projections").select("*"),
          supabase.from("dfs_players").select("*").eq("is_active", true),
          supabase.from("dfs_dk_salaries").select("*"),
        ]);

      const teamsData = (teamsRes.data || []) as Team[];
      const gamesData = (gamesRes.data || []) as Game[];
      const projectionsData = (projectionsRes.data || []) as Projection[];
      const playersData = (playersRes.data || []) as Player[];
      const salariesData = (salariesRes.data || []) as Salary[];

      setTeams(teamsData);
      setGames(gamesData);

      // Create lookup maps
      const teamMap = new Map(teamsData.map((t) => [t.id, t]));
      const salaryMap = new Map(salariesData.map((s) => [s.player_id, s]));

      // Get team IDs playing today
      const playingTeamIds = new Set<number>();
      gamesData.forEach((g) => {
        playingTeamIds.add(g.home_team_id);
        playingTeamIds.add(g.visitor_team_id);
      });

      // Build player rows
      const rows: PlayerRow[] = [];

      for (const proj of projectionsData) {
        const player = playersData.find((p) => p.id === proj.player_id);
        if (!player) continue;

        const team = teamMap.get(player.team_id);
        if (!team) continue;

        // Find the game for this player
        const game = gamesData.find(
          (g) =>
            g.home_team_id === player.team_id ||
            g.visitor_team_id === player.team_id
        );

        // Get opponent
        let opponent = "-";
        if (game) {
          const oppTeamId =
            game.home_team_id === player.team_id
              ? game.visitor_team_id
              : game.home_team_id;
          const oppTeam = teamMap.get(oppTeamId);
          const isHome = game.home_team_id === player.team_id;
          opponent = oppTeam
            ? `${isHome ? "vs" : "@"} ${oppTeam.abbreviation}`
            : "-";
        }

        // Get salary (use placeholder if not available)
        const salaryData = salaryMap.get(player.id);
        const salary = salaryData?.salary || 5000; // Default salary

        // Calculate value (proj points per $1000)
        const value = salary > 0 ? (proj.dk_proj / salary) * 1000 : 0;

        rows.push({
          id: player.id,
          name: `${player.first_name} ${player.last_name}`,
          team: team.abbreviation,
          position: player.position || "N/A",
          opponent,
          salary,
          proj: proj.dk_proj,
          floor: proj.dk_floor,
          ceiling: proj.dk_ceiling,
          value: Math.round(value * 100) / 100,
          minutes: proj.minutes_proj,
          gameId: proj.game_id,
        });
      }

      setPlayers(rows);
    } catch (error) {
      console.error("Error fetching slate data:", error);
    }

    setLoading(false);
  }

  // Sorting and filtering
  const filteredAndSortedPlayers = useMemo(() => {
    let result = [...players];

    // Filter by position
    if (positionFilter !== "All") {
      result = result.filter((p) =>
        p.position.includes(positionFilter)
      );
    }

    // Filter by team
    if (teamFilter !== "All") {
      result = result.filter((p) => p.team === teamFilter);
    }

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((p) =>
        p.name.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });

    return result;
  }, [players, positionFilter, teamFilter, searchQuery, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="text-gray-600 ml-1">↕</span>;
    return (
      <span className="text-blue-400 ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
    );
  };

  // Get unique teams for filter
  const uniqueTeams = useMemo(() => {
    const teamSet = new Set(players.map((p) => p.team));
    return ["All", ...Array.from(teamSet).sort()];
  }, [players]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Slate</h1>
          <p className="text-gray-400 mt-1">
            {games.length} games · {players.length} players projected
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-gray-500">Date</p>
          <p className="text-lg font-semibold text-white">{today}</p>
        </div>
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

          {/* Position Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Position:</span>
            <div className="flex gap-1">
              {POSITIONS.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPositionFilter(pos)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    positionFilter === pos
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Team Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Team:</span>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
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

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">
            <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            Loading slate data...
          </div>
        ) : players.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <p className="text-xl mb-2">No projections available</p>
            <p className="text-sm">
              Sync data and generate projections from the dashboard
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th
                    onClick={() => handleSort("name")}
                    className="sticky left-0 bg-gray-800 z-10"
                  >
                    Player <SortIcon field="name" />
                  </th>
                  <th>Team</th>
                  <th>Pos</th>
                  <th>Opp</th>
                  <th onClick={() => handleSort("salary")}>
                    Salary <SortIcon field="salary" />
                  </th>
                  <th onClick={() => handleSort("proj")}>
                    Proj <SortIcon field="proj" />
                  </th>
                  <th onClick={() => handleSort("floor")}>
                    Floor <SortIcon field="floor" />
                  </th>
                  <th onClick={() => handleSort("ceiling")}>
                    Ceil <SortIcon field="ceiling" />
                  </th>
                  <th onClick={() => handleSort("value")}>
                    Value <SortIcon field="value" />
                  </th>
                  <th onClick={() => handleSort("minutes")}>
                    Min <SortIcon field="minutes" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedPlayers.map((player) => (
                  <tr key={player.id}>
                    <td className="sticky left-0 bg-gray-900 font-medium text-white">
                      {player.name}
                    </td>
                    <td>
                      <span className="badge badge-blue">{player.team}</span>
                    </td>
                    <td>
                      <span className="badge badge-gray">{player.position}</span>
                    </td>
                    <td className="text-gray-400">{player.opponent}</td>
                    <td className="font-mono">
                      ${player.salary.toLocaleString()}
                    </td>
                    <td className="font-semibold text-green-400">
                      {player.proj.toFixed(1)}
                    </td>
                    <td className="text-yellow-400">{player.floor.toFixed(1)}</td>
                    <td className="text-blue-400">{player.ceiling.toFixed(1)}</td>
                    <td
                      className={`font-semibold ${
                        player.value >= 5
                          ? "text-green-400"
                          : player.value >= 4
                          ? "text-yellow-400"
                          : "text-gray-400"
                      }`}
                    >
                      {player.value.toFixed(2)}x
                    </td>
                    <td className="text-gray-400">{player.minutes.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {!loading && players.length > 0 && (
          <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-800 text-sm text-gray-400">
            Showing {filteredAndSortedPlayers.length} of {players.length} players
          </div>
        )}
      </div>
    </div>
  );
}
