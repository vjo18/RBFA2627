"""Stop de publicatie bij dubbele wedstrijden/events of afwijkende doelpuntenstanden."""
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

GOALS = {"Goal", "Penalty", "Own Goal"}


def validate(calendar, events):
    problems = []
    urls = [str(m.get("url") or "") for m in calendar]
    duplicates = [url for url, count in Counter(urls).items() if count > 1]
    if duplicates:
        problems.append(f"Dubbele wedstrijd-URL's in kalender: {duplicates}")
    grouped = defaultdict(list)
    for row in events:
        grouped[row.get("matchurl", "")].append(row)
    for match in calendar:
        if match.get("homeScore") in (None, "") or match.get("awayScore") in (None, ""):
            continue
        url = match["url"]
        rows = grouped.get(url, [])
        # Een volledige dubbele CSV-rij is geen geldig afzonderlijk event.
        signatures = [tuple(sorted(row.items())) for row in rows]
        if len(signatures) != len(set(signatures)):
            problems.append(f"Dubbele eventregels: {url}")
        goals = Counter(row.get("team") for row in rows if row.get("event") in GOALS)
        expected = (int(match["homeScore"]), int(match["awayScore"]))
        actual = (goals[match["homeTeam"]], goals[match["awayTeam"]])
        if actual != expected:
            problems.append(f"Doelpunten {url}: events {actual}, uitslag {expected}")
    if problems:
        raise ValueError("\n".join(problems))
    return len({m["url"] for m in calendar if m.get("homeScore") not in (None, "") and m.get("awayScore") not in (None, "")})

def validate_players(calendar, players):
    """Elke speler mag maximaal één keer per wedstrijd/ploeg voorkomen."""
    duplicates = []
    seen = set()
    for row in players:
        key = (row.get("Match URL", ""), row.get("Team", ""), row.get("Player Name", ""))
        if key in seen:
            duplicates.append(key)
        seen.add(key)
    if duplicates:
        raise ValueError(f"Dubbele speler-wedstrijdrecords: {duplicates[:10]}")
    allowed_urls = {m["url"] for m in calendar if m.get("homeScore") not in (None, "") and m.get("awayScore") not in (None, "")}
    unknown = {row.get("Match URL") for row in players if row.get("Match URL") not in allowed_urls}
    if unknown:
        raise ValueError(f"Spelersgegevens voor wedstrijden buiten de kalender: {sorted(unknown)[:10]}")
    return len(players)


if __name__ == "__main__":
    calendar = json.loads(Path("data_raw/match_calendar.json").read_text(encoding="utf-8"))
    with Path("data_raw/match_events.csv").open(encoding="utf-8-sig", newline="") as stream:
        events = list(csv.DictReader(stream))
    total = validate(calendar, events)
    with Path("data_raw/player_matchdata.csv").open(encoding="utf-8-sig", newline="") as stream:
        players = list(csv.DictReader(stream))
    player_count = validate_players(calendar, players)
    print(f"✅ {total} unieke gespeelde wedstrijden; doelpuntenevents en {player_count} spelersrecords gecontroleerd")
