#!/usr/bin/env python3
"""Export missing birth years and import MacroDroid results. Standard library only."""
import argparse
import csv
import datetime
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data_raw"
PLAYERS = RAW / "player_matchdata.csv"
MAPPING = RAW / "team_club_mapping.csv"
DATABASE = RAW / "player_birthyears.csv"
EXPORT = RAW / "macrodroid_missing_birthyears.csv"
INBOX = RAW / "birthyear_import.csv"
UPLOADS = RAW / "macrodroid_uploads"

def read_csv(path, delimiter=","):
    if not path.exists() or path.stat().st_size == 0:
        return []
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file, delimiter=delimiter))

def write_csv(path, fields, rows, delimiter=";"):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, delimiter=delimiter, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)

def norm(s):
    return " ".join((s or "").strip().casefold().split())

def key(club, player):
    return (norm(club), norm(player))

def load_mapping():
    rows = read_csv(MAPPING, ";")
    return {norm(r.get("TeamRepo")): r.get("ClubRBFA", "").strip() for r in rows if r.get("ClubRBFA", "").strip()}

def load_database():
    return {key(r["ClubRBFA"], r["Naam"]): r for r in read_csv(DATABASE, ";") if r.get("ClubRBFA") and r.get("Naam") and r.get("Geboortejaar")}

def valid_year(value):
    value = (value or "").strip()
    if not re.fullmatch(r"(19|20)\d{2}", value):
        return False
    return 1900 <= int(value) <= datetime.date.today().year

def export_missing():
    mapping = load_mapping()
    known = load_database()
    players = read_csv(PLAYERS)
    if not players:
        raise SystemExit("Geen spelers in data_raw/player_matchdata.csv")
    missing_mapping = set()
    pending = {}
    total = set()
    for r in players:
        team = (r.get("Team") or "").strip()
        name = (r.get("Player Name") or "").strip()
        if not team or not name:
            continue
        club = mapping.get(norm(team))
        if not club:
            missing_mapping.add(team)
            continue
        identity = key(club, name)
        total.add(identity)
        if identity not in known:
            pending.setdefault(identity, {"Ploeg": club, "Naam": name})
    write_csv(EXPORT, ["Ploeg", "Naam"], sorted(pending.values(), key=lambda x: (norm(x["Ploeg"]), norm(x["Naam"]))))
    print(f"Spelers: {len(total)} | gekend: {len(total)-len(pending)} | te zoeken: {len(pending)}")
    if missing_mapping:
        print("Ontbrekende clubkoppelingen (spelers niet geëxporteerd):", file=sys.stderr)
        for team in sorted(missing_mapping):
            print(" - " + team, file=sys.stderr)
    return bool(missing_mapping)

def import_results(path):
    if not path.exists():
        raise SystemExit(f"Importbestand ontbreekt: {path}")
    with path.open(encoding="utf-8-sig", newline="") as source:
        header = source.readline()
    delimiter = ";" if header.count(";") >= header.count(",") else ","
    rows = read_csv(path, delimiter)
    if not rows:
        print("Geen resultaten om te importeren.")
        return
    required = {"Ploeg", "Naam", "Geboortejaar"}
    if not required.issubset(rows[0]):
        raise SystemExit("Vereiste kolommen: Ploeg;Naam;Geboortejaar;Gevonden")
    mapping = load_mapping()
    known = load_database()
    allowed = {key(mapping[norm(r.get("Team"))], r.get("Player Name")) for r in read_csv(PLAYERS) if norm(r.get("Team")) in mapping and r.get("Player Name")}
    added = skipped = conflicts = 0
    for r in rows:
        if norm(r.get("Gevonden")) in {"false", "onwaar", "nee", "no", "0", "niet gevonden"}:
            skipped += 1
            continue
        year = (r.get("Geboortejaar") or "").strip()
        if not valid_year(year):
            skipped += 1
            continue
        club = (r.get("Ploeg") or "").strip()
        club = mapping.get(norm(club), club)
        name = (r.get("Naam") or "").strip()
        identity = key(club, name)
        if identity not in allowed:
            print(f"Onbekende combinatie overgeslagen: {club} / {name}", file=sys.stderr)
            skipped += 1
            continue
        previous = known.get(identity)
        if previous and previous["Geboortejaar"] != year:
            print(f"CONFLICT {club} / {name}: bestaand {previous['Geboortejaar']} vs import {year}", file=sys.stderr)
            conflicts += 1
            continue
        if not previous:
            known[identity] = {"ClubRBFA": club, "Naam": name, "Geboortejaar": year}
            added += 1
    write_csv(DATABASE, ["ClubRBFA", "Naam", "Geboortejaar"], sorted(known.values(), key=lambda x: (norm(x["ClubRBFA"]), norm(x["Naam"]))))
    print(f"Toegevoegd: {added} | overgeslagen: {skipped} | conflicten: {conflicts}")
    if conflicts:
        raise SystemExit("Conflicten gedetecteerd; bestaande geboortejaren niet overschreven.")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["export", "import", "refresh"])
    parser.add_argument("--file", type=pathlib.Path, default=INBOX)
    args = parser.parse_args()
    if args.action in ("import", "refresh"):
        # Import every uploaded CSV; filenames are unrestricted.
        # Sorted order makes repeated workflow runs deterministic.
        files = sorted(UPLOADS.glob("*.csv")) if UPLOADS.exists() else []
        if args.file.exists() and args.file not in files:
            files.append(args.file)
        if args.action == "import" and not files:
            raise SystemExit("Geen importbestanden gevonden")
        for file in files:
            print(f"Importeer: {file}")
            import_results(file)
    incomplete = export_missing() if args.action in ("export", "refresh") else False
    if incomplete:
        print("WAARSCHUWING: vul eerst ontbrekende ClubRBFA-namen aan.", file=sys.stderr)

if __name__ == "__main__":
    main()
