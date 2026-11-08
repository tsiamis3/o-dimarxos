"""
Σουτ με συντεταγμένες (για τα shot charts / heatmaps της σελίδας «Παίκτες»).

  EuroLeague / EuroCup : live.euroleague.net/api/Points (μέσω euroleague_api.ShotData)
  NBA                  : ESPN summary -> plays (shootingPlay, coordinate)
  GBL / Α2             : δεν υπάρχουν συντεταγμένες (το site δείχνει ζώνες από τα box scores)

Όλα κανονικοποιούνται σε κοινό σύστημα: μέτρα, καλάθι στο (0, 0),
x = πλάγια απόσταση (+ δεξιά όπως κοιτάς το καλάθι από το κέντρο), y = προς το κέντρο του γηπέδου.
Μόνο σουτ εντός παιδιάς (όχι βολές).

Έξοδος: data/raw/{C}{season}_shots.csv.gz
  gameCode, pid, team, x, y, made, pts, zone, fastbreak, second_chance

    python scripts/scrapers/shots.py                  # E, U, NBA, όλες οι σεζόν (incremental)
    python scripts/scrapers/shots.py --comp NBA --probe 3
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import Http  # noqa: E402
from config import RAW_DIR, SEASONS  # noqa: E402

COLS = ["gameCode", "pid", "team", "x", "y", "made", "pts", "zone", "fastbreak", "second_chance", "rx", "ry"]
# rx, ry: ακατέργαστες συντεταγμένες της πηγής (για επανυπολογισμό αν αλλάξει η κανονικοποίηση)
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
# ESPN: πόδια, x = 0..50 κατά πλάτος, y = απόσταση από την τελική γραμμή. Καλάθι 5.25 πόδια από την τελική.
NBA_BASKET_X, NBA_BASKET_Y, FT = 25.0, 5.25, 0.3048


def _played(comp, season):
    p = RAW_DIR / f"{comp}{season}_games.csv"
    if not p.exists():
        return []
    g = pd.read_csv(p)
    return [int(c) for c in g.loc[g.played.astype(str).str.lower().isin(["true", "1"]), "gameCode"]]


class Store:
    def __init__(self, comp, season):
        self.path = RAW_DIR / f"{comp}{season}_shots.csv.gz"

    def load(self):
        return pd.read_csv(self.path) if self.path.exists() else pd.DataFrame(columns=COLS)

    def cached(self):
        d = self.load()
        return set(d.gameCode.astype(int)) if len(d) else set()

    def append(self, rows):
        if not rows:
            return
        new = pd.DataFrame(rows, columns=COLS)
        old = self.load()
        out = pd.concat([old, new], ignore_index=True) if len(old) else new
        out.to_csv(self.path, index=False, compression="gzip")
        print(f"  {self.path.name}: +{len(new)} shots ({len(out)} total)")


# ---------------------------------------------------------------------------
# EuroLeague / EuroCup
# ---------------------------------------------------------------------------
def euro_rows(df: pd.DataFrame, gc: int) -> list[dict]:
    rows = []
    for r in df.itertuples():
        act = str(r.ID_ACTION).strip().upper()
        if act.startswith("FT") or pd.isna(r.COORD_X) or pd.isna(r.COORD_Y):
            continue
        three = act.startswith("3")
        made = act in ("2FGM", "3FGM", "LAYUPMD", "DUNK")
        rows.append(dict(gameCode=gc, pid=str(r.ID_PLAYER).strip(), team=str(r.TEAM).strip(),
                         x=round(float(r.COORD_X) / 100, 2), y=round(float(r.COORD_Y) / 100, 2),
                         made=int(made), pts=3 if three else 2, zone=str(getattr(r, "ZONE", "") or "").strip(),
                         fastbreak=int(str(getattr(r, "FASTBREAK", "0")).strip() == "1"),
                         second_chance=int(str(getattr(r, "SECOND_CHANCE", "0")).strip() == "1"),
                         rx=float(r.COORD_X), ry=float(r.COORD_Y)))
    return rows


def run_euro(comp, seasons, probe=0):
    from euroleague_api.shot_data import ShotData
    api = ShotData(comp)
    for s in seasons:
        st = Store(comp, s)
        have = st.cached()
        todo = [gc for gc in _played(comp, s) if gc not in have]
        if probe:
            todo = todo[:probe]
        print(f"== {comp}{s} shots: {len(have)} games cached, {len(todo)} to download")
        rows = []
        for i, gc in enumerate(todo, 1):
            try:
                df = api.get_game_shot_data(s, gc)
            except Exception as e:  # noqa: BLE001
                print(f"    ! {gc}: {e}")
                continue
            if probe:
                print(df.head(3).to_string())
                print(df.columns.tolist())
            rows += euro_rows(df, gc)
            if i % 50 == 0:
                print(f"    {i}/{len(todo)}")
                if not probe:
                    st.append(rows)
                    rows = []
            time.sleep(0.1)
        if probe:
            report(pd.DataFrame(rows, columns=COLS), f"{comp}{s}")
        else:
            st.append(rows)


# ---------------------------------------------------------------------------
# NBA (ESPN)
# ---------------------------------------------------------------------------
def nba_rows(j: dict, gc: int) -> list[dict]:
    teams = {}
    for t in (j.get("boxscore", {}) or {}).get("teams", []) or []:
        tm = t.get("team", {})
        teams[str(tm.get("id"))] = tm.get("abbreviation")
    rows = []
    for p in j.get("plays", []) or []:
        if not p.get("shootingPlay"):
            continue
        typ = ((p.get("type") or {}).get("text") or "").lower()
        text = (p.get("text") or "").lower()
        if "free throw" in typ or "free throw" in text:
            continue
        c = p.get("coordinate") or {}
        x, y = c.get("x"), c.get("y")
        if x is None or y is None or not (-5 <= x <= 55) or not (-5 <= y <= 100):
            continue
        parts = p.get("participants") or []
        aid = ((parts[0] if parts else {}).get("athlete") or {}).get("id")
        if not aid:
            continue
        pts = p.get("pointsAttempted") or (3 if "three point" in text or "3-pt" in text else 2)
        # x: πλάγια (κέντρο = 25), y: από την τελική γραμμή -> μέτρα από το καλάθι
        xm = (float(x) - NBA_BASKET_X) * FT
        ym = (float(y) - NBA_BASKET_Y) * FT
        rows.append(dict(gameCode=gc, pid=f"ESPN{aid}", team=teams.get(str((p.get("team") or {}).get("id")), ""),
                         x=round(xm, 2), y=round(ym, 2), made=int(bool(p.get("scoringPlay"))), pts=int(pts),
                         zone=(p.get("type") or {}).get("text", ""), fastbreak=0, second_chance=0,
                         rx=float(x), ry=float(y)))
    return rows


def run_nba(seasons, probe=0):
    http = Http(sleep=0.12)
    for s in seasons:
        st = Store("NBA", s)
        have = st.cached()
        todo = [gc for gc in _played("NBA", s) if gc not in have]
        if probe:
            todo = todo[:probe]
        print(f"== NBA{s} shots: {len(have)} games cached, {len(todo)} to download")
        rows = []
        for i, gc in enumerate(todo, 1):
            j = http.json(f"{ESPN}/summary", params={"event": gc})
            if not j:
                continue
            if probe:
                sp = [p for p in j.get("plays", []) if p.get("shootingPlay")][:4]
                print(json.dumps(sp, ensure_ascii=False)[:2500])
            rows += nba_rows(j, gc)
            if i % 100 == 0:
                print(f"    {i}/{len(todo)}")
                if not probe:
                    st.append(rows)
                    rows = []
        if probe:
            report(pd.DataFrame(rows, columns=COLS), f"NBA{s}")
        else:
            st.append(rows)


def report(d: pd.DataFrame, tag: str):
    """Έλεγχος του συστήματος συντεταγμένων: τα τρίποντα πρέπει να είναι πέρα από ~6.6–7.2 μ."""
    if d.empty:
        print(f"{tag}: no rows")
        return
    d = d.assign(dist=[math.hypot(a, b) for a, b in zip(d.x, d.y)])
    print(f"--- {tag}: {len(d)} shots")
    print(d.describe().T[["mean", "min", "25%", "50%", "75%", "max"]].round(2).to_string())
    for p, g in d.groupby("pts"):
        print(f"   {p}PT: n {len(g)}, dist pct 5/50/95 = {g.dist.quantile([.05, .5, .95]).round(2).tolist()},"
              f" made {g.made.mean():.3f}, y<0 share {(g.y < 0).mean():.2f}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", nargs="*", default=["E", "U", "NBA"])
    ap.add_argument("--probe", type=int, default=0)
    a = ap.parse_args()
    for c in a.comp:
        seasons = SEASONS if c in ("E", "U") else [s for s in SEASONS if (RAW_DIR / f"{c}{s}_games.csv").exists()]
        if a.probe:
            seasons = seasons[-1:]
        if c == "NBA":
            run_nba(seasons, a.probe)
        else:
            run_euro(c, seasons, a.probe)
