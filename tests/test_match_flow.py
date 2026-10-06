"""Regressietests voor het wedstrijdverloop. Run: python -m unittest discover -s tests -p 'test_match_flow.py'"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "processing"))
from match_flow import compute_match_flow, match_minute


def match(home_goals, away_goals):
    return [{
        "url": "https://www.rbfa.be/nl/wedstrijd/test",
        "date": "ZATERDAG, 3 OKTOBER 2026",
        "homeTeam": "Team A",
        "awayTeam": "Team B",
        "homeScore": str(home_goals),
        "awayScore": str(away_goals),
    }]


def event(minute, team, kind="Goal"):
    return {
        "matchurl": "https://www.rbfa.be/nl/wedstrijd/test",
        "minute": str(minute),
        "team": team,
        "event": kind,
        "player_name": "Tester",
    }


class MatchFlowTests(unittest.TestCase):
    def test_minute_parsing(self):
        self.assertEqual(match_minute("45+2"), 47)
        self.assertEqual(match_minute("90+4"), 90)
        self.assertIsNone(match_minute(""))

    def test_late_points_and_score_time(self):
        data = compute_match_flow(
            match(1, 2),
            [event(10, "Team A"), event(30, "Team B"), event(80, "Team B")],
        )
        self.assertEqual(data["quality"]["validatedMatches"], 1)
        self.assertEqual(data["teams"]["Team A"]["lateNet"], -1)
        self.assertEqual(data["teams"]["Team B"]["lateNet"], 2)
        self.assertEqual(
            data["teams"]["Team A"]["minutes"],
            {"leading": 20, "drawing": 60, "trailing": 10},
        )

    def test_own_goal_credited_to_benefiting_team(self):
        # RBFA registreert het team dat de goal krijgt bij een eigen doelpunt.
        data = compute_match_flow(match(0, 1), [event(75, "Team B", "Own Goal")])
        self.assertEqual(data["quality"]["validatedMatches"], 1)
        self.assertEqual(data["teams"]["Team B"]["lateNet"], 0)
        self.assertEqual(data["teams"]["Team B"]["minutes"]["leading"], 15)

    def test_incomplete_goal_events_not_counted(self):
        data = compute_match_flow(match(1, 2), [event(10, "Team A")])
        self.assertEqual(data["quality"]["validatedMatches"], 0)
        self.assertEqual(data["quality"]["excludedMatches"], 1)
        self.assertEqual(data["teams"]["Team A"]["validMatches"], 0)

    def test_zero_zero_without_goal_events_valid(self):
        data = compute_match_flow(match(0, 0), [])
        self.assertEqual(data["quality"]["validatedMatches"], 1)
        self.assertEqual(data["teams"]["Team A"]["minutes"]["drawing"], 90)

    def test_zero_matches_raises(self):
        with self.assertRaises(ValueError):
            compute_match_flow([], [])


if __name__ == "__main__":
    unittest.main()
