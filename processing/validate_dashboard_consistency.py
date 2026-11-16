"""Controleer dat ladder, wedstrijdreeks en scoreverloop dezelfde gespeelde matchen gebruiken."""
import csv
import json
from collections import Counter
from pathlib import Path


def validate():
    calendar = json.loads(Path("data_raw/match_calendar.json").read_text(encoding="utf-8"))
    played = [m for m in calendar if m.get("homeScore") not in (None, "") and m.get("awayScore") not in (None, "")]
    urls = [m["url"] for m in played]
    if len(urls) != len(set(urls)):
        raise ValueError("Dubbele gespeelde wedstrijden in de kalender")
    expected = Counter()
    for m in played:
        expected[m["homeTeam"]] += 1
        expected[m["awayTeam"]] += 1

    with Path("data_raw/data_team.csv").open(newline="", encoding="utf-8") as stream:
        team_matches = list(csv.DictReader(stream))
    derived = [r for r in team_matches if r.get("homeScore") not in (None, "") and r.get("awayScore") not in (None, "")]
    if len(derived) != len(played):
        raise ValueError(f"data_team.csv: {len(derived)} gespeelde regels, kalender: {len(played)}")

    stats = json.loads(Path("public/data/team_stats.json").read_text(encoding="utf-8"))
    for row in stats:
        team = row["Team"]
        if int(row["Played"]) != expected[team]:
            raise ValueError(f"League ladder {team}: {row['Played']} i.p.v. {expected[team]}")

    flow = json.loads(Path("public/data/match_flow.json").read_text(encoding="utf-8"))
    if int(flow["quality"]["playedMatches"]) != len(played):
        raise ValueError("Wedstrijdverloop en kalender tellen niet evenveel wedstrijden")
    if int(flow["quality"]["validatedMatches"]) != len(played):
        raise ValueError("Niet alle wedstrijdverlopen zijn gevalideerd")
    for team, count in expected.items():
        if flow["teams"][team]["validMatches"] != count:
            raise ValueError(f"Wedstrijdverloop {team}: ongeldig aantal wedstrijden")
    print(f"✅ Ladder, match flow en kalender consistent: {len(played)} wedstrijden, {len(expected)} teams")


if __name__ == "__main__":
    validate()
