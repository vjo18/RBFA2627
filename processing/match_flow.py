"""Wedstrijdverloop en veerkracht uit RBFA kalender + match-events.

Geen externe packages nodig. Alleen volledige, met de eindstand overeenkomende
doelpuntenreeksen tellen mee voor tijd-op-score en late puntenwissels.
"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path

CALENDAR = Path("data_raw/match_calendar.json")
EVENTS = Path("data_raw/match_events.csv")
OUTPUT = Path("public/data/match_flow.json")
GOALS = {"Goal", "Penalty", "Own Goal"}
TIMELINE_EVENTS = GOALS | {"Red Card", "Yellow-Red Card"}


def read_inputs(calendar_path=CALENDAR, events_path=EVENTS):
    with open(calendar_path, encoding="utf-8") as handle:
        calendar = json.load(handle)
    with open(events_path, newline="", encoding="utf-8-sig") as handle:
        events = list(csv.DictReader(handle))
    return calendar, events


def match_minute(value):
    """Normaliseer wedstrijdminuten (ook 45+2) naar de reguliere 0-90 minuten."""
    found = re.match(r"^\s*(\d+)(?:\s*\+\s*(\d+))?", str(value or ""))
    if not found:
        return None
    minute = int(found.group(1)) + int(found.group(2) or 0)
    return max(0, min(90, minute))


def points(for_goals, against_goals):
    return 3 if for_goals > against_goals else 1 if for_goals == against_goals else 0


def score_state(home_goals, away_goals):
    if home_goals > away_goals:
        return "leading"
    if home_goals < away_goals:
        return "trailing"
    return "drawing"


def compute_match_flow(calendar, raw_events):
    """Bouw alle benodigde cijfers voor React, met kwaliteitscontrole per match."""
    if not isinstance(calendar, list) or not calendar:
        raise ValueError("Lege of ongeldige kalender: geen wedstrijdverloop exporteren")

    grouped = defaultdict(list)
    for index, event in enumerate(raw_events):
        url = str(event.get("matchurl") or "").strip()
        if url:
            minute = match_minute(event.get("minute"))
            grouped[url].append((minute, index, event))

    for url in grouped:
        grouped[url].sort(key=lambda item: (item[0] is None, item[0] if item[0] is not None else 999, item[1]))

    all_teams = sorted({
        name
        for match in calendar
        for name in (match.get("homeTeam"), match.get("awayTeam"))
        if name
    })
    teams = {
        name: {
            "validMatches": 0,
            "lateGained": 0,
            "lateLost": 0,
            "lateNet": 0,
            "minutes": {"leading": 0, "drawing": 0, "trailing": 0},
        }
        for name in all_teams
    }
    matches = []
    rejected = []
    seen = set()
    played = 0

    for order, match in enumerate(calendar):
        url = str(match.get("url") or "")
        home, away = match.get("homeTeam"), match.get("awayTeam")
        if not url or not home or not away or url in seen:
            continue
        seen.add(url)
        if match.get("homeScore") in (None, "") or match.get("awayScore") in (None, ""):
            continue
        played += 1
        try:
            final_home, final_away = int(match["homeScore"]), int(match["awayScore"])
        except (ValueError, TypeError):
            continue

        score_home = score_away = 0
        score_75_home = score_75_away = 0
        previous = 0
        home_minutes = {"leading": 0, "drawing": 0, "trailing": 0}
        chart = [{"minute": 0, "home": 0, "away": 0}]
        timeline = []
        invalid_event = False

        for minute, _, event in grouped.get(url, []):
            kind = str(event.get("event") or "").strip()
            if kind not in TIMELINE_EVENTS:
                continue

            side = str(event.get("team") or "").strip()
            if kind in GOALS:
                if minute is None or side not in (home, away):
                    invalid_event = True
                    continue

                step = max(0, minute - previous)
                home_minutes[score_state(score_home, score_away)] += step
                previous = minute
                if side == home:
                    score_home += 1
                    if minute <= 75:
                        score_75_home += 1
                else:
                    score_away += 1
                    if minute <= 75:
                        score_75_away += 1

                if chart[-1]["minute"] == minute:
                    chart[-1]["home"] = score_home
                    chart[-1]["away"] = score_away
                else:
                    chart.append({"minute": minute, "home": score_home, "away": score_away})

            timeline.append({
                "minute": minute,
                "type": kind,
                "team": side,
                "player": str(event.get("player_name") or "").strip(),
                "home": score_home,
                "away": score_away,
            })

        home_minutes[score_state(score_home, score_away)] += max(0, 90 - previous)

        if chart[-1]["minute"] < 90:
            chart.append({"minute": 90, "home": score_home, "away": score_away})

        valid = (
            not invalid_event
            and score_home == final_home
            and score_away == final_away
            and sum(home_minutes.values()) == 90
        )
        result = {
            "url": url,
            "order": order,
            "date": match.get("date") or "",
            "home": home,
            "away": away,
            "final": {"home": final_home, "away": final_away},
            "valid": valid,
            "scoreAt75": {"home": score_75_home, "away": score_75_away} if valid else None,
            "chart": chart,
            "timeline": timeline,
        }

        if not valid:
            rejected.append(url)
            matches.append(result)
            continue

        minutes_away = {
            "leading": home_minutes["trailing"],
            "drawing": home_minutes["drawing"],
            "trailing": home_minutes["leading"],
        }
        for name, current, opponent, final_goals, final_against, at75, at75_against, mins in (
            (home, "home", "away", final_home, final_away, score_75_home, score_75_away, home_minutes),
            (away, "away", "home", final_away, final_home, score_75_away, score_75_home, minutes_away),
        ):
            before = points(at75, at75_against)
            after = points(final_goals, final_against)
            swing = after - before
            record = teams[name]
            record["validMatches"] += 1
            record["lateGained"] += max(swing, 0)
            record["lateLost"] += max(-swing, 0)
            record["lateNet"] += swing
            for state in mins:
                record["minutes"][state] += mins[state]

        result["minutesHome"] = home_minutes
        result["minutesAway"] = minutes_away
        matches.append(result)

    if played == 0:
        raise ValueError("Geen gespeelde wedstrijden: match_flow.json niet overschrijven")

    return {
        "quality": {
            "playedMatches": played,
            "validatedMatches": sum(1 for match in matches if match["valid"]),
            "excludedMatches": len(rejected),
            "excludedUrls": rejected,
        },
        "teams": teams,
        "matches": matches,
    }


def build_match_flow(calendar_path=CALENDAR, events_path=EVENTS, output_path=OUTPUT):
    calendar, events = read_inputs(calendar_path, events_path)
    payload = compute_match_flow(calendar, events)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    quality = payload["quality"]
    print(
        f"Saved: {output_path} — {quality['validatedMatches']}/"
        f"{quality['playedMatches']} wedstrijden gevalideerd"
    )
    if quality["excludedMatches"]:
        print(
            f"⚠️ {quality['excludedMatches']} wedstrijd(en) uitgesloten wegens "
            "onvolledige of afwijkende doelpuntenregistratie"
        )


if __name__ == "__main__":
    build_match_flow()
