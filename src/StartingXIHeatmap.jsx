import React from "react";

const STATUS = {
  start: { label: "Basis", cls: "bg-emerald-500 text-white" },
  sub: { label: "Invaller", cls: "bg-sky-400 text-white" },
  bench: { label: "Bank", cls: "bg-amber-200 text-amber-900" },
  not_selected: { label: "Niet geselecteerd", cls: "bg-gray-100 text-gray-400" },
};

export default function StartingXIHeatmap({ data, team }) {
  const rec = data?.[team];
  if (!rec?.matches?.length || !rec?.players?.length) return null;

  return (
    <section className="mb-10">
      <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-lg font-semibold">Basiselftal-heatmap — {team}</h3>
          <p className="text-xs text-gray-500 mt-1">
            Per speeldag zie je wie startte, inviel, op de bank zat of niet geselecteerd was.
            Spelers zijn gesorteerd op aantal basisplaatsen en vervolgens speelminuten.
          </p>
        </div>

        <div className="p-4">
          <div className="flex flex-wrap gap-4 text-xs text-gray-600 mb-4">
            {Object.entries(STATUS).map(([key, value]) => (
              <span key={key} className="inline-flex items-center gap-1.5">
                <span className={`inline-block w-3 h-3 rounded-sm ${value.cls}`} />
                {value.label}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="border-collapse text-xs min-w-max">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-white text-left px-2 py-2 min-w-52 border-b border-gray-200">
                    Speler
                  </th>
                  <th className="px-2 py-2 text-right border-b border-gray-200">Basis</th>
                  <th className="px-2 py-2 text-right border-b border-gray-200">Min.</th>
                  {rec.matches.map((match) => (
                    <th
                      key={match.url}
                      className="px-1.5 py-2 text-center border-b border-gray-200 min-w-16"
                      title={`${match.date} · ${match.venue === "home" ? "thuis" : "uit"} tegen ${match.opponent} · ${match.score || ""}`}
                    >
                      <div>SD {match.round}</div>
                      <div className="font-normal text-[10px] text-gray-400">
                        {match.venue === "home" ? "T" : "U"}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rec.players.map((player) => (
                  <tr key={player.name} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-2 py-1.5 border-b border-gray-100 font-medium whitespace-nowrap">
                      {player.name}
                    </td>
                    <td className="px-2 py-1.5 border-b border-gray-100 text-right tabular-nums">{player.starts}</td>
                    <td className="px-2 py-1.5 border-b border-gray-100 text-right tabular-nums">{player.minutes}</td>
                    {player.cells.map((cell) => {
                      const status = STATUS[cell.status] || STATUS.not_selected;
                      const match = rec.matches[cell.round - 1];
                      return (
                        <td key={cell.match} className="p-1 border-b border-gray-100 text-center">
                          <div
                            className={`h-7 min-w-12 px-1 rounded flex items-center justify-center font-semibold ${status.cls}`}
                            title={`${status.label} · ${cell.minutes} min · ${match?.opponent || ""}`}
                          >
                            {cell.status === "start" ? "B" : cell.status === "sub" ? "I" : cell.status === "bench" ? "R" : "—"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-gray-400">
            B = basis · I = ingevallen · R = reserve/bank · — = niet geselecteerd.
          </p>
        </div>
      </div>
    </section>
  );
}
