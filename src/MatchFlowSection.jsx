import React, { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const scorePoints = (forGoals, againstGoals) =>
  forGoals > againstGoals ? 3 : forGoals === againstGoals ? 1 : 0;

const minuteLabel = (minute) =>
  Number.isFinite(Number(minute)) ? `${minute}′` : "—";

const scoreValue = (value) => {
  const number = Number(value) || 0;
  return number > 0 ? `+${number}` : String(number);
};

function Panel({ title, children, description }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="font-semibold text-lg">{title}</h3>
        {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function LatePointsRanking({ rows, selectedTeam }) {
  if (!rows.length) return <p className="text-sm text-gray-500">Nog geen gevalideerde wedstrijden.</p>;
  const maximum = Math.max(1, ...rows.map((r) => Math.abs(r.lateNet)));
  return (
    <div className="space-y-2">
      {rows.map((record, index) => (
        <div
          key={record.team}
          className={`grid grid-cols-[minmax(110px,1fr)_minmax(110px,1.2fr)_45px] items-center gap-3 rounded-lg px-2 py-1.5 text-sm ${record.team === selectedTeam ? "bg-amber-50" : ""}`}
        >
          <div className="min-w-0 truncate" title={record.team}>
            <span className="text-gray-400 mr-2">{index + 1}.</span>{record.team}
          </div>
          <div className="grid grid-cols-2 items-center h-4">
            <div className="flex justify-end border-r border-gray-300 h-full items-center">
              {record.lateNet < 0 && (
                <div
                  className="h-3 bg-rose-500 rounded-l"
                  style={{ width: `${(Math.abs(record.lateNet) / maximum) * 100}%` }}
                />
              )}
            </div>
            <div className="flex justify-start h-full items-center">
              {record.lateNet > 0 && (
                <div
                  className="h-3 bg-emerald-500 rounded-r"
                  style={{ width: `${(record.lateNet / maximum) * 100}%` }}
                />
              )}
            </div>
          </div>
          <span className={`text-right font-semibold tabular-nums ${record.lateNet > 0 ? "text-emerald-700" : record.lateNet < 0 ? "text-rose-700" : "text-gray-500"}`}>
            {scoreValue(record.lateNet)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScoreStateBars({ rows, selectedTeam }) {
  if (!rows.length) return <p className="text-sm text-gray-500">Nog geen gevalideerde wedstrijden.</p>;
  return (
    <div className="space-y-3">
      {rows.map((record) => {
        const { leading, drawing, trailing } = record.minutes;
        const total = leading + drawing + trailing;
        const pct = (v) => total ? (100 * v) / total : 0;
        return (
          <div key={record.team} className={`rounded-lg px-2 py-1 ${selectedTeam === record.team ? "bg-amber-50" : ""}`}>
            <div className="flex justify-between gap-2 text-xs mb-1">
              <span className="truncate font-medium" title={record.team}>{record.team}</span>
              <span className="shrink-0 text-gray-500 tabular-nums">{record.validMatches} wedstrijden</span>
            </div>
            <div
              className="flex h-3 w-full rounded overflow-hidden bg-gray-100"
              title={`Voor: ${pct(leading).toFixed(1)}% · Gelijk: ${pct(drawing).toFixed(1)}% · Achter: ${pct(trailing).toFixed(1)}%`}
              role="img"
              aria-label={`${record.team}: ${pct(leading).toFixed(1)} procent voor, ${pct(drawing).toFixed(1)} procent gelijk en ${pct(trailing).toFixed(1)} procent achter`}
            >
              <div className="bg-emerald-500" style={{ width: `${pct(leading)}%` }} />
              <div className="bg-slate-400" style={{ width: `${pct(drawing)}%` }} />
              <div className="bg-rose-400" style={{ width: `${pct(trailing)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MatchScoreTimeline({ match, team }) {
  if (!match) return <p className="text-gray-500 text-sm">Geen gevalideerde wedstrijd beschikbaar.</p>;

  const home = match.home === team;
  const own75 = home ? match.scoreAt75.home : match.scoreAt75.away;
  const opp75 = home ? match.scoreAt75.away : match.scoreAt75.home;
  const ownFinal = home ? match.final.home : match.final.away;
  const oppFinal = home ? match.final.away : match.final.home;
  const swing = scorePoints(ownFinal, oppFinal) - scorePoints(own75, opp75);
  const chartData = (match.chart || []).map((point) => ({
    ...point,
    own: home ? point.home : point.away,
    opponent: home ? point.away : point.home,
  }));
  const playerEvents = (match.timeline || []).filter((row) =>
    ["Goal", "Penalty", "Own Goal", "Red Card", "Yellow-Red Card"].includes(row.type)
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="font-semibold">{match.home} {match.final.home}–{match.final.away} {match.away}</p>
          <p className="text-xs text-gray-500">{match.date}</p>
        </div>
        <div className={`text-sm font-semibold rounded-lg px-3 py-2 ${swing > 0 ? "bg-emerald-50 text-emerald-700" : swing < 0 ? "bg-rose-50 text-rose-700" : "bg-gray-100 text-gray-600"}`}>
          {swing === 0 ? "Geen puntenverschil na 75′" : `${scoreValue(swing)} punt${Math.abs(swing) === 1 ? "" : "en"} na 75′`}
        </div>
      </div>
      <div className="mb-2 text-xs text-gray-600">
        Stand op 75′: {match.scoreAt75.home}–{match.scoreAt75.away} · Eindstand: {match.final.home}–{match.final.away}
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="minute" domain={[0, 90]} ticks={[0, 15, 30, 45, 60, 75, 90]} tickFormatter={minuteLabel} />
            <YAxis allowDecimals={false} domain={[0, "dataMax + 1"]} />
            <Tooltip
              labelFormatter={(minute) => `${minute}′`}
              formatter={(value, key) => [value, key]}
            />
            <ReferenceLine x={75} stroke="#c28a36" strokeDasharray="4 4" label={{ value: "75′", position: "insideTopRight", fontSize: 11 }} />
            <Line type="stepAfter" dataKey="own" name={team} stroke="#059669" strokeWidth={3} dot={{ r: 3 }} isAnimationActive={false} />
            <Line type="stepAfter" dataKey="opponent" name={home ? match.away : match.home} stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-gray-600 mt-2">
        <span><span className="inline-block w-3 h-0.5 bg-emerald-600 align-middle mr-1" />{team}</span>
        <span><span className="inline-block w-3 h-0.5 bg-slate-500 align-middle mr-1" />{home ? match.away : match.home}</span>
      </div>
      {playerEvents.length > 0 && (
        <div className="mt-5">
          <h4 className="text-sm font-semibold mb-2">Doelpunten en uitsluitingen</h4>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-100">
            {playerEvents.map((event, index) => (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs" key={`${event.minute}-${index}`}>
                <span className="w-9 font-semibold tabular-nums">{minuteLabel(event.minute)}</span>
                <span className={`font-medium ${event.team === team ? "text-emerald-700" : "text-slate-600"}`}>{event.team}</span>
                <span className="text-gray-500">{event.player || "—"}</span>
                <span className="ml-auto text-gray-500">
                  {event.type === "Goal" ? "Goal" : event.type === "Penalty" ? "Penaltygoal" : event.type === "Own Goal" ? "Eigen doelpunt" : "Rode kaart"}
                  {["Goal", "Penalty", "Own Goal"].includes(event.type) ? ` · ${event.home}–${event.away}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
        Scoreverloop is gebaseerd op doelpuntenevents, niet op balbezit of winstkansen.
        Wedstrijdminuten boven 90 worden op 90′ weergegeven.
      </p>
    </>
  );
}

export default function MatchFlowSection({ data, selectedTeam }) {
  const [selectedUrl, setSelectedUrl] = useState("");
  const teams = data?.teams || {};
  const records = useMemo(
    () => Object.entries(teams)
      .filter(([, record]) => record.validMatches > 0)
      .map(([team, record]) => ({ team, ...record })),
    [teams]
  );
  const ranking = useMemo(
    () => [...records].sort((a, b) => b.lateNet - a.lateNet || b.lateGained - a.lateGained || a.team.localeCompare(b.team)),
    [records]
  );
  const sortedState = useMemo(
    () => [...records].sort((a, b) =>
      (b.minutes.leading / (b.validMatches * 90)) - (a.minutes.leading / (a.validMatches * 90)) ||
      a.team.localeCompare(b.team)
    ),
    [records]
  );
  const teamMatches = useMemo(
    () => (data?.matches || []).filter((match) =>
      match.valid && (match.home === selectedTeam || match.away === selectedTeam)
    ).sort((a, b) => b.order - a.order),
    [data, selectedTeam]
  );

  useEffect(() => {
    if (!teamMatches.some((match) => match.url === selectedUrl)) {
      setSelectedUrl(teamMatches[0]?.url || "");
    }
  }, [teamMatches, selectedUrl]);

  if (!data) return null;

  const selectedMatch = teamMatches.find((match) => match.url === selectedUrl) || teamMatches[0];
  const record = teams[selectedTeam];
  const total = record ? Object.values(record.minutes).reduce((a, b) => a + b, 0) : 0;
  const percentage = (name) => total ? (100 * record.minutes[name] / total).toFixed(1) : "0.0";

  return (
    <section className="mb-10" aria-label="Wedstrijdverloop en veerkracht">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Wedstrijdverloop & veerkracht</h2>
          <p className="text-sm text-gray-500">Hoe ploegen tijdens wedstrijden punten winnen, verliezen en de score controleren.</p>
        </div>
        <span className="text-xs text-gray-500">
          {data.quality?.validatedMatches || 0}/{data.quality?.playedMatches || 0} wedstrijden gevalideerd
        </span>
      </div>
      {data.quality?.excludedMatches > 0 && (
        <p className="text-xs text-amber-700 mb-3">
          {data.quality.excludedMatches} wedstrijden met onvolledige of afwijkende doelpuntenevents zijn uitgesloten.
        </p>
      )}
      {record?.validMatches > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl bg-white ring-1 ring-black/5 shadow-sm px-4 py-3">
            <div className="text-xs text-gray-500">Puntensaldo na 75′ · {selectedTeam}</div>
            <div className={`text-2xl font-bold mt-1 ${record.lateNet >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{scoreValue(record.lateNet)}</div>
            <div className="text-xs text-gray-500">{record.lateGained} gewonnen · {record.lateLost} verloren</div>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-black/5 shadow-sm px-4 py-3">
            <div className="text-xs text-gray-500">Minuten op voorsprong</div>
            <div className="text-2xl font-bold mt-1">{percentage("leading")}%</div>
            <div className="text-xs text-gray-500">{record.minutes.leading} van {total} nominale minuten</div>
          </div>
          <div className="rounded-xl bg-white ring-1 ring-black/5 shadow-sm px-4 py-3">
            <div className="text-xs text-gray-500">Gelijk / achterstand</div>
            <div className="text-2xl font-bold mt-1">{percentage("drawing")}% / {percentage("trailing")}%</div>
            <div className="text-xs text-gray-500">Verdeling over {record.validMatches} wedstrijden</div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        <Panel
          title="Ranglijst — punten na minuut 75"
          description="Virtuele puntenstand op 75′ vergeleken met de eindstand; + is gewonnen, − is verloren."
        >
          <LatePointsRanking rows={ranking} selectedTeam={selectedTeam} />
        </Panel>
        <Panel
          title="Tijd op voorsprong, gelijk en achter"
          description="Percentage van de reguliere 90 minuten; gesorteerd op tijd op voorsprong."
        >
          <div className="flex flex-wrap gap-3 text-xs text-gray-600 mb-4">
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500 mr-1" />Voorsprong</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-slate-400 mr-1" />Gelijk</span>
            <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-400 mr-1" />Achter</span>
          </div>
          <ScoreStateBars rows={sortedState} selectedTeam={selectedTeam} />
        </Panel>
      </div>
      <Panel
        title="Scoreverloop per wedstrijd"
        description="Selecteer een gespeelde wedstrijd van je ploeg. De grafiek toont het scoreverschil tijdens de wedstrijd, niet het spelbeeld."
      >
        <label className="block text-sm text-gray-600 mb-2" htmlFor="match-flow-select">Wedstrijd</label>
        <select
          id="match-flow-select"
          className="w-full rounded-xl border border-gray-200 p-2.5 text-sm mb-5 bg-white"
          value={selectedMatch?.url || ""}
          onChange={(event) => setSelectedUrl(event.target.value)}
          disabled={teamMatches.length === 0}
        >
          {teamMatches.map((match) => (
            <option value={match.url} key={match.url}>
              {match.date} · {match.home} {match.final.home}–{match.final.away} {match.away}
            </option>
          ))}
        </select>
        <MatchScoreTimeline match={selectedMatch} team={selectedTeam} />
      </Panel>
      <p className="mt-2 text-xs text-gray-400">
        Puntensaldo na 75′ = eindpunten minus punten op 75′, per wedstrijd opgeteld.
        Een doelpunt exact op 75′ telt bij de stand op 75′.
        Scoreminuten zijn benaderd met officiële doelpuntminuten; blessuretijd wordt samengevoegd met minuut 90.
      </p>
    </section>
  );
}
