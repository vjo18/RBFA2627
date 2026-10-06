"""Export basiselftal-heatmap uit player_matchdata.csv."""
from pathlib import Path
import json
import pandas as pd

PLAYER_INPUT = Path("data_raw/player_matchdata.csv")
CALENDAR = Path("data_raw/match_calendar.json")
OUTPUT = Path("public/data/team_lineup_heatmap.json")


def _bool(v):
    return str(v).strip().lower() in {"true", "1", "yes"}


def build_lineup_heatmap(player_path=PLAYER_INPUT, calendar_path=CALENDAR, output_path=OUTPUT):
    pm = pd.read_csv(player_path)
    calendar = json.loads(Path(calendar_path).read_text(encoding="utf-8"))

    for col in ["Starting Player", "Substituted In"]:
        pm[col] = pm[col].map(_bool) if col in pm.columns else False
    pm["Minutes Played"] = pd.to_numeric(pm.get("Minutes Played", 0), errors="coerce").fillna(0)

    match_meta = {}
    for i, m in enumerate(calendar, start=1):
        url = str(m.get("url") or "")
        if not url:
            continue
        match_meta[url] = {
            "order": i,
            "date": str(m.get("date") or ""),
            "home": str(m.get("homeTeam") or ""),
            "away": str(m.get("awayTeam") or ""),
            "played": m.get("homeScore") not in (None, "") and m.get("awayScore") not in (None, ""),
            "score": None if m.get("homeScore") in (None, "") or m.get("awayScore") in (None, "")
                     else f"{m.get('homeScore')}-{m.get('awayScore')}",
        }

    out = {}
    for team, tg in pm.groupby("Team"):
        team = str(team).strip()
        if not team:
            continue

        urls = []
        for url in tg["Match URL"].dropna().astype(str).unique():
            meta = match_meta.get(url)
            if meta and meta["played"]:
                urls.append(url)
        urls.sort(key=lambda u: match_meta[u]["order"])

        players = []
        for player, pg in tg.groupby("Player Name"):
            player = str(player).strip()
            if not player:
                continue
            cells = []
            total_starts = 0
            total_minutes = 0
            for round_no, url in enumerate(urls, start=1):
                rows = pg[pg["Match URL"].astype(str) == url]
                if rows.empty:
                    status = "not_selected"
                    minutes = 0
                else:
                    row = rows.iloc[0]
                    minutes = int(pd.to_numeric(row.get("Minutes Played"), errors="coerce") or 0)
                    if bool(row.get("Starting Player")):
                        status = "start"
                        total_starts += 1
                    elif bool(row.get("Substituted In")) or minutes > 0:
                        status = "sub"
                    else:
                        status = "bench"
                total_minutes += minutes
                cells.append({
                    "round": round_no,
                    "match": url,
                    "status": status,
                    "minutes": minutes,
                })
            players.append({
                "name": player,
                "starts": total_starts,
                "minutes": total_minutes,
                "cells": cells,
            })

        players.sort(key=lambda p: (-p["starts"], -p["minutes"], p["name"]))
        matches = []
        for round_no, url in enumerate(urls, start=1):
            meta = match_meta[url]
            is_home = meta["home"] == team
            matches.append({
                "round": round_no,
                "url": url,
                "date": meta["date"],
                "opponent": meta["away"] if is_home else meta["home"],
                "venue": "home" if is_home else "away",
                "score": meta["score"],
            })
        out[team] = {"matches": matches, "players": players}

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    print(f"Saved: {output_path} — {len(out)} teams")


if __name__ == "__main__":
    build_lineup_heatmap()
