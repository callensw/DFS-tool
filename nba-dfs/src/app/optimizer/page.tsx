"use client";

import { useState } from "react";

interface LineupPlayer {
  id: number;
  name: string;
  position: string;
  team: string;
  salary: number;
  projection: number;
  rosterSlot: string;
}

interface Lineup {
  rank: number;
  totalSalary: number;
  totalProjection: number;
  salaryCap: number;
  salaryRemaining: number;
  players: LineupPlayer[];
}

const ROSTER_SLOT_ORDER = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];

export default function OptimizerPage() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [lineupCount, setLineupCount] = useState(20);
  const [lineups, setLineups] = useState<Lineup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLineups, setSelectedLineups] = useState<Set<number>>(
    new Set()
  );

  async function generateLineups() {
    setLoading(true);
    setError(null);
    setLineups([]);
    setSelectedLineups(new Set());

    try {
      const response = await fetch(
        `/api/optimizer/generate?date=${date}&count=${lineupCount}`
      );
      const data = await response.json();

      if (data.success) {
        setLineups(data.lineups);
      } else {
        setError(data.error || "Failed to generate lineups");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }

    setLoading(false);
  }

  function toggleLineupSelection(rank: number) {
    const newSelected = new Set(selectedLineups);
    if (newSelected.has(rank)) {
      newSelected.delete(rank);
    } else {
      newSelected.add(rank);
    }
    setSelectedLineups(newSelected);
  }

  function selectAll() {
    setSelectedLineups(new Set(lineups.map((l) => l.rank)));
  }

  function selectNone() {
    setSelectedLineups(new Set());
  }

  function exportToCSV() {
    const lineupsToExport =
      selectedLineups.size > 0
        ? lineups.filter((l) => selectedLineups.has(l.rank))
        : lineups;

    if (lineupsToExport.length === 0) return;

    // DraftKings CSV format
    const headers = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
    const rows = lineupsToExport.map((lineup) => {
      // Sort players by roster slot order
      const sortedPlayers = [...lineup.players].sort(
        (a, b) =>
          ROSTER_SLOT_ORDER.indexOf(a.rosterSlot) -
          ROSTER_SLOT_ORDER.indexOf(b.rosterSlot)
      );

      // Format as "Name (ID)" for each position
      return sortedPlayers.map((p) => `${p.name} (${p.id})`);
    });

    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    // Download CSV
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dk_lineups_${date}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Calculate exposure stats
  const exposureStats = lineups.length > 0 ? calculateExposure(lineups) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Lineup Optimizer</h1>
        <p className="text-gray-400 mt-1">
          Generate optimal DraftKings lineups
        </p>
      </div>

      {/* Controls */}
      <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
        <div className="flex flex-wrap items-end gap-6">
          {/* Date Input */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Lineup Count */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Number of Lineups
            </label>
            <input
              type="number"
              min={1}
              max={150}
              value={lineupCount}
              onChange={(e) =>
                setLineupCount(Math.min(150, Math.max(1, parseInt(e.target.value) || 1)))
              }
              className="w-24 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Generate Button */}
          <button
            onClick={generateLineups}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
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
                Generating...
              </>
            ) : (
              <>🎯 Generate Lineups</>
            )}
          </button>

          {/* Export Button */}
          {lineups.length > 0 && (
            <button
              onClick={exportToCSV}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
            >
              📥 Export CSV{" "}
              {selectedLineups.size > 0 && `(${selectedLineups.size})`}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Results */}
      {lineups.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Lineups Generated"
              value={lineups.length}
              color="blue"
            />
            <StatCard
              label="Avg Projection"
              value={
                (
                  lineups.reduce((sum, l) => sum + l.totalProjection, 0) /
                  lineups.length
                ).toFixed(1)
              }
              color="green"
            />
            <StatCard
              label="Top Projection"
              value={lineups[0]?.totalProjection.toFixed(1) || "-"}
              color="purple"
            />
            <StatCard
              label="Avg Salary Used"
              value={`$${Math.round(
                lineups.reduce((sum, l) => sum + l.totalSalary, 0) /
                  lineups.length
              ).toLocaleString()}`}
              color="yellow"
            />
          </div>

          {/* Selection Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-gray-400">
                {selectedLineups.size} of {lineups.length} selected
              </span>
              <button
                onClick={selectAll}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Select All
              </button>
              <button
                onClick={selectNone}
                className="text-sm text-gray-400 hover:text-gray-300"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Lineup Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {lineups.map((lineup) => (
              <LineupCard
                key={lineup.rank}
                lineup={lineup}
                isSelected={selectedLineups.has(lineup.rank)}
                onToggle={() => toggleLineupSelection(lineup.rank)}
              />
            ))}
          </div>

          {/* Exposure Analysis */}
          {exposureStats.length > 0 && (
            <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
              <h2 className="text-xl font-semibold text-white mb-4">
                Player Exposure
              </h2>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Team</th>
                      <th>Salary</th>
                      <th>Proj</th>
                      <th>Lineups</th>
                      <th>Exposure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exposureStats.slice(0, 20).map((stat) => (
                      <tr key={stat.id}>
                        <td className="font-medium text-white">{stat.name}</td>
                        <td>
                          <span className="badge badge-blue">{stat.team}</span>
                        </td>
                        <td className="font-mono">
                          ${stat.salary.toLocaleString()}
                        </td>
                        <td className="text-green-400">
                          {stat.projection.toFixed(1)}
                        </td>
                        <td>{stat.count}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-20 bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-blue-500 h-2 rounded-full"
                                style={{ width: `${stat.exposure}%` }}
                              />
                            </div>
                            <span className="text-sm">
                              {stat.exposure.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && lineups.length === 0 && (
        <div className="bg-gray-900 rounded-xl p-12 border border-gray-800 text-center">
          <div className="text-6xl mb-4">🎯</div>
          <h2 className="text-xl font-semibold text-white mb-2">
            Ready to Optimize
          </h2>
          <p className="text-gray-400 max-w-md mx-auto">
            Select a date and number of lineups, then click Generate to create
            optimal DraftKings lineups based on your projections.
          </p>
        </div>
      )}
    </div>
  );
}

function LineupCard({
  lineup,
  isSelected,
  onToggle,
}: {
  lineup: Lineup;
  isSelected: boolean;
  onToggle: () => void;
}) {
  // Sort players by roster slot order
  const sortedPlayers = [...lineup.players].sort(
    (a, b) =>
      ROSTER_SLOT_ORDER.indexOf(a.rosterSlot) -
      ROSTER_SLOT_ORDER.indexOf(b.rosterSlot)
  );

  const salaryPercent = (lineup.totalSalary / lineup.salaryCap) * 100;

  return (
    <div
      className={`bg-gray-900 rounded-xl border transition-colors cursor-pointer ${
        isSelected
          ? "border-blue-500 ring-1 ring-blue-500"
          : "border-gray-800 hover:border-gray-700"
      }`}
      onClick={onToggle}
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
          />
          <span className="text-lg font-semibold text-white">
            Lineup #{lineup.rank}
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-green-400">
            {lineup.totalProjection.toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">Projected</div>
        </div>
      </div>

      {/* Players */}
      <div className="p-4">
        <table className="w-full text-sm">
          <tbody>
            {sortedPlayers.map((player, idx) => (
              <tr
                key={idx}
                className="border-b border-gray-800 last:border-b-0"
              >
                <td className="py-2 w-12">
                  <span className="badge badge-gray text-xs">
                    {player.rosterSlot}
                  </span>
                </td>
                <td className="py-2 font-medium text-white">{player.name}</td>
                <td className="py-2">
                  <span className="badge badge-blue text-xs">{player.team}</span>
                </td>
                <td className="py-2 text-right font-mono text-gray-400">
                  ${player.salary.toLocaleString()}
                </td>
                <td className="py-2 text-right text-green-400 w-16">
                  {player.projection.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-gray-500 text-xs">Salary</span>
            <div className="font-mono text-white">
              ${lineup.totalSalary.toLocaleString()}
            </div>
          </div>
          <div>
            <span className="text-gray-500 text-xs">Remaining</span>
            <div className="font-mono text-yellow-400">
              ${lineup.salaryRemaining.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="w-32">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-500">Cap Used</span>
            <span className="text-gray-400">{salaryPercent.toFixed(1)}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                salaryPercent >= 98
                  ? "bg-green-500"
                  : salaryPercent >= 95
                  ? "bg-yellow-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${salaryPercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: "blue" | "green" | "purple" | "yellow";
}) {
  const colors = {
    blue: "from-blue-600 to-blue-700",
    green: "from-green-600 to-green-700",
    purple: "from-purple-600 to-purple-700",
    yellow: "from-yellow-600 to-yellow-700",
  };

  return (
    <div
      className={`bg-gradient-to-br ${colors[color]} rounded-xl p-4 text-white`}
    >
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm opacity-80">{label}</div>
    </div>
  );
}

function calculateExposure(lineups: Lineup[]) {
  const playerCounts = new Map<
    number,
    { name: string; team: string; salary: number; projection: number; count: number }
  >();

  for (const lineup of lineups) {
    for (const player of lineup.players) {
      const existing = playerCounts.get(player.id);
      if (existing) {
        existing.count++;
      } else {
        playerCounts.set(player.id, {
          name: player.name,
          team: player.team,
          salary: player.salary,
          projection: player.projection,
          count: 1,
        });
      }
    }
  }

  const stats = Array.from(playerCounts.entries()).map(([id, data]) => ({
    id,
    ...data,
    exposure: (data.count / lineups.length) * 100,
  }));

  // Sort by exposure descending
  stats.sort((a, b) => b.exposure - a.exposure);

  return stats;
}
