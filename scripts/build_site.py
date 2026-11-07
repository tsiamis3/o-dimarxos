"""
Χτίζει τη JSON "βάση" του site από τα raw CSV.

  site/data/manifest.json          -> διαθέσιμοι διαγωνισμοί/σεζόν, ημερομηνία ενημέρωσης
  site/data/{C}{season}.json       -> ματς, επερχόμενα, παίκτες, ομάδες, game logs (columnar)

Τα αρχεία είναι "συμπαγή" (λίστες αντί για dicts) ώστε να φορτώνουν γρήγορα·
όλο το filtering/aggregation γίνεται στον browser.

    python scripts/build_site.py
"""
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from config import COMPETITIONS, RAW_DIR, SITE_DATA
from dataset import STAT_COLS, CompetitionData

LOG_COLS = ["gameCode", "pid", "team", "opp", "home", "starter", *STAT_COLS]


def _clean(v):
    """numpy -> απλά python types, NaN -> None, floats με 1 δεκαδικό."""
    if isinstance(v, (float, np.floating)):
        return None if np.isnan(v) else (int(v) if float(v).is_integer() else round(float(v), 1))
    if isinstance(v, (np.integer,)):
        return int(v)
    return v


def _rows(df: pd.DataFrame) -> list[list]:
    return [[_clean(v) for v in r] for r in df.itertuples(index=False, name=None)]


class SiteBuilder:
    def __init__(self):
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        self.manifest = {
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "demo": (RAW_DIR / ".demo").exists(),
            "competitions": [],
        }

    def build_season(self, data: CompetitionData, season: int) -> None:
        logs = data.logs[data.logs.season == season]
        games = data.games[(data.games.season == season)]

        # σκορ από τα box scores (πιο αξιόπιστο από το πρόγραμμα)
        pts = logs.groupby(["gameCode", "home"])["PTS"].sum().unstack("home")
        played = games[games.gameCode.isin(pts.index)].copy()
        played["homescore"] = played.gameCode.map(pts.get(1))
        played["awayscore"] = played.gameCode.map(pts.get(0))
        played = played.sort_values(["date", "gameCode"])
        upcoming = games[~games.gameCode.isin(pts.index)].sort_values(["date", "gameCode"])

        players = (logs.sort_values("date").drop_duplicates("pid", keep="last")
                       .set_index("pid")["player"].to_dict())
        teams = {k: v for k, v in data.team_names().items()
                 if k in set(logs.team) | set(games.homecode) | set(games.awaycode)}

        out = {
            "comp": data.comp, "season": season,
            "teams": teams,
            "players": players,
            "games": {"cols": ["gameCode", "round", "date", "home", "away", "hs", "as"],
                      "rows": _rows(played[["gameCode", "Round", "date", "homecode", "awaycode",
                                            "homescore", "awayscore"]])},
            "upcoming": {"cols": ["gameCode", "round", "date", "time", "home", "away"],
                         "rows": _rows(upcoming[["gameCode", "Round", "date", "time",
                                                 "homecode", "awaycode"]].fillna(""))},
            "logs": {"cols": LOG_COLS, "rows": _rows(logs[LOG_COLS])},
        }
        path = SITE_DATA / f"{data.comp}{season}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        print(f"  {path.name}: {len(played)} games, {len(upcoming)} upcoming, "
              f"{len(logs)} log rows, {path.stat().st_size / 1e6:.2f} MB")

    def run(self) -> None:
        for comp, name in COMPETITIONS.items():
            try:
                data = CompetitionData(comp)
            except FileNotFoundError as e:
                print(f"  ! {e}")
                continue
            seasons = [s for s in data.seasons if (data.logs.season == s).any() or s == max(data.seasons)]
            for s in seasons:
                self.build_season(data, s)
            self.manifest["competitions"].append({
                "code": comp, "name": name, "seasons": seasons,
                "predictions": (SITE_DATA / f"predictions_{comp}.json").exists(),
            })
        (SITE_DATA / "manifest.json").write_text(json.dumps(self.manifest, indent=1))
        print("  manifest.json written")


if __name__ == "__main__":
    SiteBuilder().run()
