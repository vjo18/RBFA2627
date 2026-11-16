"""Regressiecontrole tegen dubbele kalenderregels en eventgegevens."""
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "processing"))
from validate_match_data import validate, validate_players


def match():
    return {"url": "match-1", "homeTeam": "A", "awayTeam": "B", "homeScore": "1", "awayScore": "0"}


def goal():
    return {"matchurl": "match-1", "event": "Goal", "team": "A", "minute": "14", "player_name": "X"}


class ValidationTests(unittest.TestCase):
    def test_valid_data(self):
        self.assertEqual(validate([match()], [goal()]), 1)

    def test_duplicate_calendar_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Dubbele wedstrijd"):
            validate([match(), match()], [goal()])

    def test_duplicate_goals_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Dubbele eventregels"):
            validate([match()], [goal(), goal()])

    def test_duplicate_player_match_rejected(self):
        row = {"Match URL": "match-1", "Team": "A", "Player Name": "Tester"}
        with self.assertRaisesRegex(ValueError, "Dubbele speler"):
            validate_players([match()], [row, row])

    def test_single_player_match_accepted(self):
        row = {"Match URL": "match-1", "Team": "A", "Player Name": "Tester"}
        self.assertEqual(validate_players([match()], [row]), 1)

    def test_missing_goal_rejected(self):
        with self.assertRaisesRegex(ValueError, "Doelpunten"):
            validate([match()], [])


if __name__ == "__main__":
    unittest.main()
