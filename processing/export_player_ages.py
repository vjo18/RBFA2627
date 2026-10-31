#!/usr/bin/env python3
"""Build public age statistics from match appearances and verified birth years."""
import csv
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data_raw"
OUT = ROOT / "public" / "data" / "player_ages.json"
SEASON_YEAR = 2026

def rows(name, delimiter):
    with (RAW / name).open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh, delimiter=delimiter))

def norm(value):
    return " ".join((value or "").strip().casefold().split())

def truth(value):
    return norm(value) in ("true", "1", "yes", "waar")

def main():
    mapping = {norm(r["TeamRepo"]): r["ClubRBFA"] for r in rows("team_club_mapping.csv", ";")}
    years = {(norm(r["ClubRBFA"]), norm(r["Naam"])): int(r["Geboortejaar"])
             for r in rows("player_birthyears.csv", ";") if r.get("Geboortejaar", "").isdigit()}
    groups = defaultdict(lambda: {"starters": [], "substitutes": [], "players": {}})
    missing = defaultdict(set)
    all_players = defaultdict(set)
    for r in rows("player_matchdata.csv", ","):
        team, player = r.get("Team", "").strip(), r.get("Player Name", "").strip()
        club = mapping.get(norm(team))
        if team and player:
            all_players[team].add(norm(player))
        year = years.get((norm(club), norm(player))) if club else None
        if team and player and not year:
            missing[team].add(norm(player))
        if not year or not 1900 <= year <= SEASON_YEAR:
            continue
        age = SEASON_YEAR - year
        group = groups[team]
        if truth(r.get("Starting Player")):
            group["starters"].append(age)
        elif truth(r.get("Substituted In")):
            group["substitutes"].append(age)
        key = norm(player)
        record = group["players"].setdefault(key, {"name": player, "age": age, "minutes": 0})
        try:
            record["minutes"] += max(0, int(float(r.get("Minutes Played") or 0)))
        except ValueError:
            pass
    output = {}
    for team in sorted(set(groups) | set(all_players)): 
        group = groups[team]
        starters, subs = group["starters"], group["substitutes"]
        output[team] = {
            "averageStarterAge": round(sum(starters) / len(starters), 1) if starters else None,
            "averageSubstituteAge": round(sum(subs) / len(subs), 1) if subs else None,
            "starterAppearances": len(starters),
            "starterAges": starters,
            "missingBirthyears": len(missing[team]),
            "totalPlayers": len(all_players[team]),
            "substituteAppearances": len(subs),
            "players": sorted(group["players"].values(), key=lambda p: p["name"]),
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"seasonYear": SEASON_YEAR, "missingBirthyears": sum(len(names) for names in missing.values()), "totalPlayers": sum(len(names) for names in all_players.values()), "teams": output}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Leeftijdsstatistieken voor {len(output)} ploegen naar {OUT}")

if __name__ == "__main__":
    main()
