"""
Play-by-play -> stints: διαστήματα αγώνα όπου οι ίδιοι 10 παίκτες είναι στο παρκέ.

Για κάθε stint: οι 5 του γηπεδούχου, οι 5 του φιλοξενούμενου, πόντοι και κατοχές κάθε ομάδας, δευτερόλεπτα.
  - βασικοί: από το box score (IsStarter)
  - αλλαγές: γεγονότα IN / OUT του play-by-play
  - πόντοι: από τα εύστοχα (2FGM/LAYUPMD/DUNK = 2, 3FGM = 3, FTM = 1)
  - κατοχές: σουτ + 0.44 × βολές + λάθη − επιθετικά ριμπάουντ (ίδιος τύπος με τα box scores)
  - ΚΑΙ μετρημένες κατοχές (cposs_*): κάθε φορά που η μπάλα αλλάζει ομάδα (σουτ, βολή, λάθος, ριμπάουντ,
    κλέψιμο)· οι βολές τεχνικής ποινής δεν αλλάζουν κατοχή. Νέα κατοχή και στην αρχή κάθε περιόδου.
  - επισκέψεις στη γραμμή (trip_*): κάθε σειρά βολών, εκτός από το and-one (βολή μετά από εύστοχο του ίδιου
    παίκτη στο ίδιο δευτερόλεπτο)· αμυντικά ριμπάουντ (drb_*) για τα ποσοστά ριμπάουντ.
Αν ένας παίκτης κάνει ενέργεια ενώ «δεν είναι» στο παρκέ (αλλαγή που δεν καταγράφηκε, συνήθως
στην αρχή περιόδου), τον βάζουμε στη θέση εκείνου που είναι περισσότερη ώρα μέσα χωρίς ενέργεια.

    python scripts/stints.py --comp E --season 2025     # αναφορά ποιότητας
"""
import argparse

import numpy as np
import pandas as pd

from config import RAW_DIR
from dataset import CompetitionData

FGA = {"2FGM", "2FGA", "3FGM", "3FGA", "LAYUPMD", "LAYUPATT", "DUNK"}
FGM = {"2FGM", "3FGM", "LAYUPMD", "DUNK"}
FT = {"FTM", "FTA"}
FOUL_TECH = {"CMT", "CMTI", "CMD", "C", "B"}          # τεχνικές / πάγκου: οι βολές τους δεν αλλάζουν κατοχή
BALL = FGA | FT | {"TO", "O", "D", "ST"}               # γεγονότα που δείχνουν ποια ομάδα έχει την μπάλα
PTS = {"2FGM": 2, "LAYUPMD": 2, "DUNK": 2, "3FGM": 3, "FTM": 1}
PERIOD_SEC = {1: 600, 2: 600, 3: 600, 4: 600}       # παράταση: 300


def _clock(period, mt) -> float:
    """Δευτερόλεπτα από την αρχή του αγώνα (το ρολόι μετρά ανάποδα)."""
    try:
        m, s = str(mt).split(":")
        left = int(m) * 60 + int(s)
    except ValueError:
        left = np.nan
    base = sum(PERIOD_SEC.get(p, 300) for p in range(1, int(period)))
    length = PERIOD_SEC.get(int(period), 300)
    return base + (length - left if left == left else 0)


def ft_flags(ev: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Για γεγονότα ενός αγώνα (ταξινομημένα): (αρχή νέας επίσκεψης στη γραμμή, βολή τεχνικής ποινής)."""
    ev = ev.reset_index(drop=True)
    clock = ev.period.astype(str) + "|" + ev.mt.astype(str)
    key = ev.pid.astype(str) + "|" + clock
    pt = ev.pt.astype(str)
    isft = pt.isin(FT)
    prev_ft = key.where(isft).ffill().shift(1)                 # η προηγούμενη βολή (παίκτης|χρόνος)
    last_fgm = key.where(pt.isin(FGM)).ffill()                 # το τελευταίο εύστοχο σουτ πριν
    isfoul = pt.str.startswith("CM") | pt.isin(["C", "B"])
    lf_pt, lf_clock = pt.where(isfoul).ffill(), clock.where(isfoul).ffill()
    tech = isft & lf_pt.isin(FOUL_TECH) & (lf_clock == clock)
    trip = isft & (prev_ft != key) & (last_fgm != key)
    return trip.to_numpy(), tech.to_numpy()


def game_stints(ev: pd.DataFrame, starters: dict, home: str, away: str) -> tuple[list, dict]:
    on = {home: list(starters.get(home, [])), away: list(starters.get(away, []))}
    last_seen = {}                                   # pid -> τελευταία ενέργεια (δευτερόλεπτα)
    stints, cur, fixes = [], None, 0

    def key():
        return tuple(sorted(on[home])), tuple(sorted(on[away]))

    def open_stint(t):
        return {"h": key()[0], "a": key()[1], "t0": t, "t1": t, "pts_h": 0, "pts_a": 0,
                "fga_h": 0, "fga_a": 0, "fta_h": 0, "fta_a": 0, "tov_h": 0, "tov_a": 0, "orb_h": 0, "orb_a": 0,
                "drb_h": 0, "drb_a": 0, "trip_h": 0, "trip_a": 0, "cposs_h": 0, "cposs_a": 0}

    t = 0.0
    cur = open_stint(t)
    trip_f, tech_f = ft_flags(ev)
    trips, ball = {}, None
    for k, r in enumerate(ev.itertuples()):
        t = _clock(r.period, r.mt) if isinstance(r.mt, str) and ":" in r.mt else t
        team, pid, pt = r.team, r.pid, r.pt
        if pt == "BP":                                   # αρχή περιόδου: νέα κατοχή για όποιον πάρει την μπάλα
            ball = None
        if team not in on or not isinstance(pid, str) or not pid:
            # γεγονός ομάδας (timeout, αρχή/τέλος περιόδου): απλώς προχωρά ο χρόνος
            cur["t1"] = t
            continue
        if pt in ("IN", "OUT"):
            cur["t1"] = t
            if pt == "OUT" and pid in on[team]:
                on[team].remove(pid)
            elif pt == "IN" and pid not in on[team]:
                on[team].append(pid)
            if len(on[home]) == 5 and len(on[away]) == 5 and key() != (cur["h"], cur["a"]):
                stints.append(cur)
                cur = open_stint(t)
            continue
        # ενέργεια παίκτη που «δεν είναι» μέσα: αλλαγή που δεν καταγράφηκε
        if pid not in on[team] and len(on[team]) == 5:
            out = min(on[team], key=lambda p: last_seen.get(p, -1))
            on[team][on[team].index(out)] = pid
            fixes += 1
            stints.append(cur)
            cur = open_stint(t)
        last_seen[pid] = t
        side = "h" if team == home else "a"
        cur["t1"] = t
        if pt in BALL and not tech_f[k] and team != ball:  # η μπάλα άλλαξε ομάδα: νέα (μετρημένη) κατοχή
            cur["cposs_" + side] += 1
            ball = team
        if trip_f[k]:
            cur["trip_" + side] += 1
            trips[pid] = trips.get(pid, 0) + 1
        if pt in PTS:
            cur["pts_" + side] += PTS[pt]
        if pt in FGA:
            cur["fga_" + side] += 1
        elif pt in ("FTM", "FTA"):
            cur["fta_" + side] += 1
        elif pt == "TO":
            cur["tov_" + side] += 1
        elif pt == "O":
            cur["orb_" + side] += 1
        elif pt == "D":
            cur["drb_" + side] += 1
    stints.append(cur)
    out = []
    for s in stints:
        if len(s["h"]) != 5 or len(s["a"]) != 5:
            continue
        ph = s["fga_h"] + 0.44 * s["fta_h"] + s["tov_h"] - s["orb_h"]
        pa = s["fga_a"] + 0.44 * s["fta_a"] + s["tov_a"] - s["orb_a"]
        if ph <= 0 and pa <= 0 and s["pts_h"] == 0 and s["pts_a"] == 0:
            continue
        out.append({**{f"h{i}": p for i, p in enumerate(s["h"])}, **{f"a{i}": p for i, p in enumerate(s["a"])},
                    "secs": max(0.0, s["t1"] - s["t0"]), "pts_h": s["pts_h"], "pts_a": s["pts_a"],
                    "poss_h": max(ph, 0.0), "poss_a": max(pa, 0.0),
                    **{f"{c}_{x}": s[f"{c}_{x}"] for c in ("fga", "fta", "trip", "tov", "orb", "drb", "cposs") for x in "ha"}})
    return out, {"fixes": fixes, "trips": trips}


def build(comp: str, season: int, data: CompetitionData | None = None, with_report=False, trips_out: list | None = None):
    """trips_out: αν δοθεί λίστα, προστίθενται γραμμές (season, gameCode, pid, trips) ανά παίκτη και αγώνα."""
    p = RAW_DIR / f"{comp}{season}_pbp.csv.gz"
    if not p.exists():
        return (pd.DataFrame(), pd.DataFrame()) if with_report else pd.DataFrame()
    pbp = pd.read_csv(p, dtype={"pid": str, "team": str, "pt": str, "mt": str})
    for c in ("pid", "team", "pt"):
        pbp[c] = pbp[c].fillna("").str.strip()
    data = data or CompetitionData(comp)
    if getattr(data, "pid_alias", None):
        pbp["pid"] = pbp.pid.replace(data.pid_alias)          # διπλοί κωδικοί του ίδιου παίκτη
    games = data.games[data.games.season == season].set_index("gameCode")
    logs = data.logs[data.logs.season == season]
    st = logs[logs.starter == 1].groupby(["gameCode", "team"]).pid.apply(list)
    final = logs.groupby(["gameCode", "home"]).PTS.sum().unstack()
    rows, rep = [], []
    for gc, ev in pbp.groupby("gameCode"):
        if gc not in games.index:
            continue
        g = games.loc[gc]
        home, away = g.homecode, g.awaycode
        starters = {home: st.get((gc, home), []), away: st.get((gc, away), [])}
        if len(starters[home]) != 5 or len(starters[away]) != 5:
            rep.append({"gameCode": gc, "ok": False, "why": "starters"})
            continue
        s, info = game_stints(ev.sort_values("n"), starters, home, away)
        for x in s:
            x.update(season=season, gameCode=int(gc))
        rows += s
        if trips_out is not None:
            trips_out += [{"season": season, "gameCode": int(gc), "pid": p, "trips": n} for p, n in info["trips"].items()]
        th, ta = sum(x["pts_h"] for x in s), sum(x["pts_a"] for x in s)
        fh, fa = (final.loc[gc, 1], final.loc[gc, 0]) if gc in final.index else (np.nan, np.nan)
        rep.append({"gameCode": gc, "ok": True, "fixes": info["fixes"], "stints": len(s),
                    "pts_h": th, "pts_a": ta, "final_h": fh, "final_a": fa})
    df = pd.DataFrame(rows)
    return (df, pd.DataFrame(rep)) if with_report else df


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", default="E")
    ap.add_argument("--season", type=int, default=2025)
    a = ap.parse_args()
    df, r = build(a.comp, a.season, with_report=True)
    if df.empty:
        print("no pbp")
    else:
        ok = r[r.ok]
        print(f"{a.comp}{a.season}: {len(ok)}/{len(r)} games, {len(df)} stints, "
              f"{df.secs.sum() / 60 / max(1, len(ok)):.1f} min/game covered, fixes/game {ok.fixes.mean():.2f}")
        print("points match final:", ((ok.pts_h == ok.final_h) & (ok.pts_a == ok.final_a)).mean().round(3),
              "| mean abs diff", ((ok.pts_h - ok.final_h).abs() + (ok.pts_a - ok.final_a).abs()).mean().round(2))
        print("poss per game (estimated)", ((df.poss_h + df.poss_a) / 2).groupby(df.gameCode).sum().mean().round(1),
              "| counted", ((df.cposs_h + df.cposs_a) / 2).groupby(df.gameCode).sum().mean().round(1))
        print("FT trips per FTA", ((df.trip_h + df.trip_a).sum() / (df.fta_h + df.fta_a).sum()).round(3))
