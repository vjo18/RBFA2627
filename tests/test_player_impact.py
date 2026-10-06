"""Regressietests voor de robuuste spelersimpact."""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "processing"))

from player_impact import build_segments, player_key, _xpts_state


class PlayerImpactTests(unittest.TestCase):
    def player_rows(self):
        return pd.DataFrame([
            {
                "Match URL": "m1", "Home Team": "A", "Away Team": "B",
                "Player Name": "Speler A", "Team": "A",
                "Starting Player": True, "Substituted In": False,
                "Substituted Out": False, "Minutes Played": 90,
            },
            {
                "Match URL": "m1", "Home Team": "A", "Away Team": "B",
                "Player Name": "Speler B", "Team": "B",
                "Starting Player": True, "Substituted In": False,
                "Substituted Out": False, "Minutes Played": 90,
            },
        ])

    def test_own_goal_is_goal_for_rbfa_team_field(self):
        events = pd.DataFrame([{
            "matchurl": "m1", "home_team": "A", "away_team": "B",
            "event": "Own Goal", "player_name": "Speler B",
            "team": "A", "team_against": "B", "minute": 30,
        }])
        seg = build_segments(self.player_rows(), events)
        self.assertFalse(seg.empty)
        self.assertEqual(int(seg["gf"].sum()), 1)
        self.assertEqual(int(seg["ga"].sum()), 0)

    def test_team_qualified_player_key(self):
        self.assertNotEqual(player_key("A", "Alex"), player_key("B", "Alex"))

    def test_elo_changes_expected_points_before_transition(self):
        # Gelijke stand na 60 minuten: een sterker thuisteam moet meer xPts hebben.
        strong, _ = _xpts_state(60, 0, 0, 200, 1.5 / 90, 1.3 / 90)
        weak, _ = _xpts_state(60, 0, 0, -200, 1.5 / 90, 1.3 / 90)
        self.assertGreater(strong, weak)

    def test_red_card_changes_expected_points(self):
        even, _ = _xpts_state(60, 0, 0, 0, 1.5 / 90, 1.3 / 90)
        man_up, _ = _xpts_state(60, 0, 1, 0, 1.5 / 90, 1.3 / 90)
        self.assertGreater(man_up, even)


if __name__ == "__main__":
    unittest.main()
