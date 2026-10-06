"""Robuuste spelersimpact voor RBFA-data.

RAPM:
- segmenten op goals, wissels en rode kaarten;
- pre-match ELO-verschil als expliciete control;
- ridge-alpha gekozen met GroupKFold per wedstrijd;
- onzekerheid via match-bootstrap (standaard 200 runs).

xPPM:
- blijft als veldnaam bestaan voor backwards compatibility;
- is inhoudelijk Expected Points Added (EPA) per 90;
- xPts = 3*P(winst) + P(gelijk), met een Poisson-model voor resterende goals;
- model gebruikt minuut, scoreverschil, thuis/uit, manpower en pre-match ELO.

Belangrijk: in de huidige RBFA event-export is bij Own Goal het veld team
de ploeg die het doelpunt KRIJGT. Daarom behandelen we Goal/Penalty/Own Goal
alle drie als een goal voor team.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold

DATA_TEAM_CSV = Path("data_raw/data_team.csv")
BOOTSTRAP_RUNS = int(os.environ.get("RBFA_BOOTSTRAP_RUNS", "200"))
BOOTSTRAP_SEED = 2627
RAPM_ALPHAS = (5.0, 10.0, 20.0, 40.0, 80.0, 160.0, 320.0, 640.0)
XPPM_ALPHAS = (10.0, 25.0, 50.0, 100.0, 200.0, 400.0, 800.0)


def player_key(team: str, player: str) -> str:
    return f"{str(team).strip()}|||{str(player).strip()}"


def _to_bool(value) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes"}


def _minute(value) -> int:
    try:
        return max(0, min(90, int(float(value))))
    except (TypeError, ValueError):
        return 0


def _match_context() -> dict[tuple[str, str], dict]:
    """Pre-match ELO en eindscore per unieke home/away-combinatie."""
    if not DATA_TEAM_CSV.exists():
        return {}
    dt = pd.read_csv(DATA_TEAM_CSV)
    if not {"homeTeam", "awayTeam"}.issubset(dt.columns):
        return {}

    out = {}
    for _, row in dt.iterrows():
        home = str(row.get("homeTeam", "")).strip()
        away = str(row.get("awayTeam", "")).strip()
        if not home or not away:
            continue
        out[(home, away)] = {
            "elo_home": pd.to_numeric(row.get("elo_home_before"), errors="coerce"),
            "elo_away": pd.to_numeric(row.get("elo_away_before"), errors="coerce"),
            "final_home": pd.to_numeric(row.get("homeScore"), errors="coerce"),
            "final_away": pd.to_numeric(row.get("awayScore"), errors="coerce"),
        }
    return out


def _normalise_inputs(player_match_df: pd.DataFrame, match_events_df: pd.DataFrame):
    pm = player_match_df.copy()
    me = match_events_df.copy()

    for col in ["Starting Player", "Substituted In", "Substituted Out"]:
        pm[col] = pm[col].map(_to_bool) if col in pm else False
    pm["Minutes Played"] = (
        pd.to_numeric(pm["Minutes Played"], errors="coerce").fillna(0)
        if "Minutes Played" in pm else 0
    )
    me["minute"] = me["minute"].map(_minute) if "minute" in me else 0
    return pm, me


def _goal_delta(events_at_minute: pd.DataFrame, home: str, away: str) -> tuple[int, int]:
    home_goals = away_goals = 0
    for _, row in events_at_minute.iterrows():
        kind = str(row.get("event", "")).strip().lower()
        if kind not in {"goal", "penalty", "own goal"}:
            continue
        beneficiary = str(row.get("team", "")).strip()
        if beneficiary == home:
            home_goals += 1
        elif beneficiary == away:
            away_goals += 1
    return home_goals, away_goals


def _is_boundary(events_at_minute: pd.DataFrame) -> bool:
    for _, row in events_at_minute.iterrows():
        kind = str(row.get("event", "")).strip().lower()
        if kind in {"goal", "penalty", "own goal", "red card", "yellow-red card", "yellow card - red card"}:
            return True
        if "substitute in" in kind or "substitute out" in kind:
            return True
    return False


def _apply_lineup_events(on_home: set[str], on_away: set[str], events, home: str, away: str):
    home_next, away_next = set(on_home), set(on_away)
    for _, row in events.iterrows():
        kind = str(row.get("event", "")).strip().lower()
        team = str(row.get("team", "")).strip()
        player = str(row.get("player_name", "")).strip()
        if not player:
            continue
        if "substitute in" in kind:
            if team == home:
                home_next.add(player)
            elif team == away:
                away_next.add(player)
        elif "substitute out" in kind or kind in {"red card", "yellow-red card", "yellow card - red card"}:
            if team == home:
                home_next.discard(player)
            elif team == away:
                away_next.discard(player)
    return home_next, away_next


def build_segments(player_match_df: pd.DataFrame, match_events_df: pd.DataFrame) -> pd.DataFrame:
    pm, me = _normalise_inputs(player_match_df, match_events_df)
    context = _match_context()
    segments: list[dict] = []

    match_urls = [u for u in pm.get("Match URL", pd.Series(dtype=str)).dropna().astype(str).unique() if u]
    for match_id in match_urls:
        pm_m = pm[pm["Match URL"].astype(str) == str(match_id)]
        if pm_m.empty:
            continue

        home = str(pm_m["Home Team"].iloc[0]).strip()
        away = str(pm_m["Away Team"].iloc[0]).strip()
        matchurl_series = me["matchurl"].astype(str) if "matchurl" in me else pd.Series("", index=me.index)
        ev = me[matchurl_series == str(match_id)].copy().sort_values("minute", kind="stable")

        home_on = set(pm_m[(pm_m["Team"] == home) & pm_m["Starting Player"]]["Player Name"].astype(str))
        away_on = set(pm_m[(pm_m["Team"] == away) & pm_m["Starting Player"]]["Player Name"].astype(str))
        if not home_on:
            home_on = set(pm_m[(pm_m["Team"] == home) & (pm_m["Minutes Played"] > 0)]["Player Name"].astype(str))
        if not away_on:
            away_on = set(pm_m[(pm_m["Team"] == away) & (pm_m["Minutes Played"] > 0)]["Player Name"].astype(str))
        if not home_on or not away_on:
            continue

        ctx = context.get((home, away), {})
        eh = float(ctx["elo_home"]) if pd.notna(ctx.get("elo_home")) else 1500.0
        ea = float(ctx["elo_away"]) if pd.notna(ctx.get("elo_away")) else 1500.0
        final_h = ctx.get("final_home")
        final_a = ctx.get("final_away")

        by_minute = {int(m): g for m, g in ev.groupby("minute")}
        boundaries = sorted(m for m, group in by_minute.items() if _is_boundary(group))
        last_minute = 0
        score_home = score_away = 0
        match_segments: list[dict] = []

        if not boundaries:
            match_segments.append({
                "match": str(match_id), "home": home, "away": away,
                "duration": 90.0, "gd_delta": 0.0, "gf": 0.0, "ga": 0.0,
                "home_players": list(home_on), "away_players": list(away_on),
                "t_start": 0.0, "t_end": 90.0, "gd_start": 0.0, "gd_end": 0.0,
                "man_diff_start": float(len(home_on) - len(away_on)),
                "man_diff_end": float(len(home_on) - len(away_on)),
                "elo_home_before": eh, "elo_away_before": ea,
            })
        else:
            for minute in boundaries:
                minute = max(last_minute, min(90, int(minute)))
                events_now = by_minute[minute]
                gf, ga = _goal_delta(events_now, home, away)
                home_next, away_next = _apply_lineup_events(home_on, away_on, events_now, home, away)

                duration = minute - last_minute
                if duration > 0 or gf or ga:
                    match_segments.append({
                        "match": str(match_id), "home": home, "away": away,
                        "duration": float(max(duration, 1 if (gf or ga) else 0)),
                        "gd_delta": float(gf - ga), "gf": float(gf), "ga": float(ga),
                        "home_players": list(home_on), "away_players": list(away_on),
                        "t_start": float(last_minute), "t_end": float(minute),
                        "gd_start": float(score_home - score_away),
                        "gd_end": float((score_home + gf) - (score_away + ga)),
                        "man_diff_start": float(len(home_on) - len(away_on)),
                        "man_diff_end": float(len(home_next) - len(away_next)),
                        "elo_home_before": eh, "elo_away_before": ea,
                    })

                score_home += gf
                score_away += ga
                home_on, away_on = home_next, away_next
                last_minute = minute

            if last_minute < 90:
                match_segments.append({
                    "match": str(match_id), "home": home, "away": away,
                    "duration": float(90 - last_minute),
                    "gd_delta": 0.0, "gf": 0.0, "ga": 0.0,
                    "home_players": list(home_on), "away_players": list(away_on),
                    "t_start": float(last_minute), "t_end": 90.0,
                    "gd_start": float(score_home - score_away),
                    "gd_end": float(score_home - score_away),
                    "man_diff_start": float(len(home_on) - len(away_on)),
                    "man_diff_end": float(len(home_on) - len(away_on)),
                    "elo_home_before": eh, "elo_away_before": ea,
                })

        if pd.notna(final_h) and pd.notna(final_a):
            reconstructed_h = int(sum(s["gf"] for s in match_segments))
            reconstructed_a = int(sum(s["ga"] for s in match_segments))
            if reconstructed_h != int(final_h) or reconstructed_a != int(final_a):
                print(
                    f"[WARN] impactmodel slaat {match_id} over: events {reconstructed_h}-{reconstructed_a} "
                    f"!= eindstand {int(final_h)}-{int(final_a)}"
                )
                continue

        segments.extend(match_segments)

    if not segments:
        return pd.DataFrame()

    result = pd.DataFrame(segments)
    result["home_players"] = result["home_players"].map(list)
    result["away_players"] = result["away_players"].map(list)
    return result


def _players_from_segments(seg_df: pd.DataFrame) -> list[str]:
    keys = set()
    for row in seg_df.itertuples(index=False):
        keys.update(player_key(row.home, p) for p in row.home_players)
        keys.update(player_key(row.away, p) for p in row.away_players)
    return sorted(keys)


def _base_design(seg_df: pd.DataFrame, mode: str):
    players = _players_from_segments(seg_df)
    index = {p: i for i, p in enumerate(players)}
    rows, targets, weights, groups = [], [], [], []

    for row in seg_df.itertuples(index=False):
        duration = max(float(row.duration), 1.0)
        elo_diff = (float(row.elo_home_before) - float(row.elo_away_before)) / 100.0

        if mode == "total":
            vector = np.zeros(len(players) + 1)
            for p in row.home_players:
                vector[index[player_key(row.home, p)]] += 1.0
            for p in row.away_players:
                vector[index[player_key(row.away, p)]] -= 1.0
            vector[-1] = elo_diff
            rows.append(vector)
            targets.append((float(row.gf) - float(row.ga)) / duration)
            weights.append(duration)
            groups.append(str(row.match))
        else:
            for is_home in (True, False):
                vector = np.zeros(len(players) + 1)
                own_team = row.home if is_home else row.away
                opp_team = row.away if is_home else row.home
                own = row.home_players if is_home else row.away_players
                opp = row.away_players if is_home else row.home_players
                for p in own:
                    vector[index[player_key(own_team, p)]] += 1.0
                for p in opp:
                    vector[index[player_key(opp_team, p)]] -= 1.0
                vector[-1] = elo_diff if is_home else -elo_diff
                goal_for = float(row.gf) if is_home else float(row.ga)
                goal_against = float(row.ga) if is_home else float(row.gf)
                rows.append(vector)
                targets.append((goal_for if mode == "off" else -goal_against) / duration)
                weights.append(duration)
                groups.append(str(row.match))

    return np.asarray(rows), np.asarray(targets), np.asarray(weights), np.asarray(groups), players


def _fit(alpha: float, X, y, weights):
    model = Ridge(alpha=float(alpha), fit_intercept=True, solver="lsqr", tol=1e-6)
    model.fit(X, y, sample_weight=weights)
    return model


def _choose_alpha(X, y, weights, groups, candidates, default):
    unique_groups = np.unique(groups)
    if len(unique_groups) < 4:
        return float(default)
    splitter = GroupKFold(n_splits=min(5, len(unique_groups)))
    scores = {}
    for alpha in candidates:
        fold_scores = []
        for train, test in splitter.split(X, y, groups):
            model = _fit(alpha, X[train], y[train], weights[train])
            pred = model.predict(X[test])
            fold_scores.append(float(np.average((y[test] - pred) ** 2, weights=weights[test])))
        scores[float(alpha)] = float(np.mean(fold_scores))
    return min(scores, key=scores.get)


def _bootstrap(X, y, weights, groups, alpha, n_players, runs=BOOTSTRAP_RUNS, seed=BOOTSTRAP_SEED):
    if runs <= 0:
        return np.empty((0, n_players))
    rng = np.random.default_rng(seed)
    unique = np.unique(groups)
    group_rows = {g: np.flatnonzero(groups == g) for g in unique}
    values = np.empty((runs, n_players), dtype=float)
    for b in range(runs):
        sampled = rng.choice(unique, size=len(unique), replace=True)
        idx = np.concatenate([group_rows[g] for g in sampled])
        model = _fit(alpha, X[idx], y[idx], weights[idx])
        values[b, :] = model.coef_[:n_players] * 90.0
    return values


def _uncertainty(coef, boot, players):
    if boot.size == 0:
        nan = pd.Series(np.nan, index=players)
        return nan, nan.copy(), nan.copy(), nan.copy(), nan.copy()
    se = np.std(boot, axis=0, ddof=1)
    low = np.percentile(boot, 2.5, axis=0)
    high = np.percentile(boot, 97.5, axis=0)
    z = np.divide(coef, se, out=np.zeros_like(coef), where=se > 0)
    same_sign = np.mean(np.sign(boot) == np.sign(coef), axis=0)
    return (
        pd.Series(se, index=players),
        pd.Series(low, index=players),
        pd.Series(high, index=players),
        pd.Series(z, index=players),
        pd.Series(same_sign, index=players),
    )


def compute_rapm_from_logs(
    player_match_df: pd.DataFrame,
    match_events_df: pd.DataFrame,
    alpha: float | None = None,
    return_segments: bool = False,
    split_off_def: bool = False,
    bootstrap_runs: int = BOOTSTRAP_RUNS,
):
    seg_df = build_segments(player_match_df, match_events_df)
    if seg_df.empty:
        empty = pd.Series(dtype=float)
        value = {"total": empty, "off": empty, "def": empty} if split_off_def else empty
        return (value, seg_df) if return_segments else value

    X, y, w, groups, players = _base_design(seg_df, "total")
    selected_alpha = float(alpha) if alpha is not None else _choose_alpha(X, y, w, groups, RAPM_ALPHAS, 80.0)
    model = _fit(selected_alpha, X, y, w)
    total_coef = model.coef_[:len(players)] * 90.0
    boot = _bootstrap(X, y, w, groups, selected_alpha, len(players), bootstrap_runs, BOOTSTRAP_SEED)
    se, ci_low, ci_high, z, sign_stability = _uncertainty(total_coef, boot, players)

    Xo, yo, wo, _, off_players = _base_design(seg_df, "off")
    Xd, yd, wd, _, def_players = _base_design(seg_df, "def")
    off_model = _fit(selected_alpha, Xo, yo, wo)
    def_model = _fit(selected_alpha, Xd, yd, wd)
    off = pd.Series(off_model.coef_[:len(off_players)] * 90.0, index=off_players)
    defensive = pd.Series(def_model.coef_[:len(def_players)] * 90.0, index=def_players)
    total = pd.Series(total_coef, index=players)

    print(f"RAPM: alpha={selected_alpha:g} via match-CV; bootstrap={bootstrap_runs}; matches={len(np.unique(groups))}")

    if split_off_def:
        result = {
            "total": total, "off": off, "def": defensive,
            "total_se": se, "total_ci_low": ci_low, "total_ci_high": ci_high,
            "total_z": z, "total_sign_stability": sign_stability,
            "alpha": selected_alpha, "bootstrap_runs": bootstrap_runs,
        }
    else:
        result = total
    return (result, seg_df) if return_segments else result


def _poisson_probs(lam: float):
    lam = max(0.0, float(lam))
    max_goals = max(10, int(math.ceil(lam + 8.0 * math.sqrt(max(lam, 0.01)))))
    probs = [math.exp(-lam)]
    for k in range(1, max_goals + 1):
        probs.append(probs[-1] * lam / k)
    total = sum(probs)
    return [p / total for p in probs]


def _xpts_state(minute, gd_home, man_diff_home, elo_diff, home_rate, away_rate):
    remaining = max(0.0, 90.0 - float(minute))
    if remaining <= 0:
        if gd_home > 0:
            return 3.0, 0.0
        if gd_home < 0:
            return 0.0, 3.0
        return 1.0, 1.0

    elo_diff = max(-500.0, min(500.0, float(elo_diff)))
    strength = math.exp(math.log(10.0) * elo_diff / 1600.0)
    manpower = 1.14 ** max(-3.0, min(3.0, float(man_diff_home)))
    lam_home = max(0.001, home_rate * remaining * strength * manpower)
    lam_away = max(0.001, away_rate * remaining / strength / manpower)
    ph = _poisson_probs(lam_home)
    pa = _poisson_probs(lam_away)

    p_home_win = p_draw = p_away_win = 0.0
    for h, p_h in enumerate(ph):
        for a, p_a in enumerate(pa):
            prob = p_h * p_a
            final_diff = float(gd_home) + h - a
            if final_diff > 0:
                p_home_win += prob
            elif final_diff < 0:
                p_away_win += prob
            else:
                p_draw += prob
    return 3.0 * p_home_win + p_draw, 3.0 * p_away_win + p_draw


def compute_xppm_from_segments(
    seg_df: pd.DataFrame,
    alpha: float | None = None,
    bootstrap_runs: int = BOOTSTRAP_RUNS,
):
    """Expected-points-added plus/minus per 90; xPPM-naam blijft voor compatibiliteit."""
    if seg_df is None or seg_df.empty:
        return {}, seg_df

    players = _players_from_segments(seg_df)
    idx = {p: i for i, p in enumerate(players)}
    match_totals = seg_df.groupby("match")[["gf", "ga"]].sum()
    match_count = max(len(match_totals), 1)
    home_rate = max(float(match_totals["gf"].sum()) / (90.0 * match_count), 0.005)
    away_rate = max(float(match_totals["ga"].sum()) / (90.0 * match_count), 0.005)

    X_rows, y_rows, weights, groups = [], [], [], []
    for row in seg_df.itertuples(index=False):
        duration = max(float(row.duration), 1.0)
        elo_diff = float(row.elo_home_before) - float(row.elo_away_before)
        home_start, away_start = _xpts_state(
            row.t_start, row.gd_start, row.man_diff_start, elo_diff, home_rate, away_rate
        )
        home_end, away_end = _xpts_state(
            row.t_end, row.gd_end, row.man_diff_end, elo_diff, home_rate, away_rate
        )

        for is_home, target in ((True, home_end - home_start), (False, away_end - away_start)):
            vector = np.zeros(len(players) + 1)
            own_team = row.home if is_home else row.away
            opp_team = row.away if is_home else row.home
            own_players = row.home_players if is_home else row.away_players
            opp_players = row.away_players if is_home else row.home_players
            for p in own_players:
                vector[idx[player_key(own_team, p)]] += 1.0
            for p in opp_players:
                vector[idx[player_key(opp_team, p)]] -= 1.0
            vector[-1] = (elo_diff if is_home else -elo_diff) / 100.0
            X_rows.append(vector)
            y_rows.append(float(target) / duration)
            weights.append(duration)
            groups.append(str(row.match))

    X = np.asarray(X_rows)
    y = np.asarray(y_rows)
    w = np.asarray(weights)
    groups = np.asarray(groups)
    selected_alpha = float(alpha) if alpha is not None else _choose_alpha(X, y, w, groups, XPPM_ALPHAS, 200.0)
    model = _fit(selected_alpha, X, y, w)
    coef = model.coef_[:len(players)] * 90.0
    boot = _bootstrap(X, y, w, groups, selected_alpha, len(players), bootstrap_runs, BOOTSTRAP_SEED + 1)
    se, ci_low, ci_high, z, sign_stability = _uncertainty(coef, boot, players)

    print(
        f"xPPM/EPA: alpha={selected_alpha:g} via match-CV; bootstrap={bootstrap_runs}; "
        f"league rates H/A={home_rate*90:.2f}/{away_rate*90:.2f} goals/90"
    )
    return {
        "xppm": pd.Series(coef, index=players),
        "se": se, "ci_low": ci_low, "ci_high": ci_high, "z": z,
        "sign_stability": sign_stability,
        "alpha": selected_alpha, "bootstrap_runs": bootstrap_runs,
        "model": "Poisson xPts EPA: minute + score + home/away + manpower + pre-match ELO",
    }, seg_df
