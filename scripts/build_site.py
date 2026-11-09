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

from config import COMPETITIONS, RAW_DIR, SECTIONS, SITE_DATA
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
        self.bio = self._load_bio()
        self.manifest = {
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "demo": (RAW_DIR / ".demo").exists(),
            "competitions": [],
        }

    @staticmethod
    def _load_bio() -> dict:
        """Βιομετρικά ανά κωδικό παίκτη: EuroLeague/EuroCup (API EuroLeague), NBA (ESPN). Οι παίκτες της ελληνικής
        λίγκας τα παίρνουν μέσω του ενιαίου μητρώου (uid στα analytics). -> {pid: [ύψος, βάρος, γέννηση, χώρα, θέση, αριθμός, φωτο]}"""
        frames = [pd.read_csv(f) for f in sorted(RAW_DIR.glob("[EU]20*_bio.csv"))]
        if (RAW_DIR / "NBA_bio.csv").exists():
            frames.append(pd.read_csv(RAW_DIR / "NBA_bio.csv"))
        if not frames:
            return {}
        b = pd.concat(frames, ignore_index=True)
        for c in ["country", "dorsal"]:
            if c not in b:
                b[c] = None
        b.loc[~b.height.between(160, 235), "height"] = None
        b.loc[~b.weight.between(55, 160), "weight"] = None
        b = b.groupby("pid")[["height", "weight", "birth_date", "country", "position", "dorsal", "headshot"]].last()
        def val(k, v):
            if pd.isna(v):
                return None
            if k in ("height", "weight"):
                return round(float(v))
            if k == "dorsal":
                try:
                    return str(int(float(v)))
                except ValueError:
                    return str(v)
            return str(v)
        out = {pid: [val(k, v) for k, v in r.items()] for pid, r in b.iterrows()}
        # ελληνική λίγκα: μέσω uid (ενιαίο μητρώο)
        f = SITE_DATA / "analytics_GBL.json"
        if f.exists():
            A = json.loads(f.read_text())
            for v in A.get("seasons", {}).values():
                P = v.get("players")
                if not P or "uid" not in P["cols"]:
                    continue
                i, j = P["cols"].index("pid"), P["cols"].index("uid")
                for row in P["rows"]:
                    if row[j] in out:
                        out[str(row[i])] = out[row[j]]
        return out

    def collect_career(self, data: CompetitionData) -> None:
        """Σεζόν κάθε παίκτη σε αυτή τη διοργάνωση, με τον ενιαίο κωδικό (uid) από τα analytics."""
        lg = data.logs
        if lg.empty:
            return
        uid = {}
        f = SITE_DATA / f"analytics_{data.comp}.json"
        if f.exists():
            A = json.loads(f.read_text())
            for v in A.get("seasons", {}).values():
                P = v.get("players")
                if P and "uid" in P["cols"]:
                    i, j = P["cols"].index("pid"), P["cols"].index("uid")
                    uid.update({str(r[i]): str(r[j]) for r in P["rows"]})
        g = (lg.sort_values("date").groupby(["season", "pid"])
               .agg(team=("team", "last"), GP=("gameCode", "size"), MIN=("MIN", "sum"), PTS=("PTS", "sum"),
                    REB=("REB", "sum"), AST=("AST", "sum"), PIR=("PIR", "sum")).reset_index())
        names = data.team_names()
        careers = getattr(self, "careers", {})
        aliases = getattr(self, "career_uid", {})
        for r in g.itertuples():
            u = uid.get(str(r.pid), str(r.pid))
            careers.setdefault(u, []).append([data.comp, int(r.season), str(r.pid), names.get(r.team, r.team), int(r.GP),
                                              *[round(float(getattr(r, k)) / r.GP, 1) for k in ("MIN", "PTS", "REB", "AST", "PIR")]])
            if u != str(r.pid):
                aliases.setdefault(data.comp, {})[str(r.pid)] = u
        self.careers, self.career_uid = careers, aliases

    def write_careers(self) -> None:
        """site/data/careers.json: όλες οι σεζόν κάθε παίκτη σε όλες τις λίγκες (μόνο όσοι έχουν πάνω από μία)."""
        car = {u: sorted(v, key=lambda x: (x[1], x[0])) for u, v in getattr(self, "careers", {}).items() if len(v) > 1}
        out = {"cols": ["comp", "season", "pid", "team", "GP", "MIN", "PTS", "REB", "AST", "PIR"],
               "uid": getattr(self, "career_uid", {}), "careers": car}
        (SITE_DATA / "careers.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        print(f"  careers.json: {len(car)} players with more than one season/league")

    def build_season(self, data: CompetitionData, season: int) -> None:
        logs = data.logs[data.logs.season == season]
        games = data.games[(data.games.season == season)]

        if len(logs):
            # σκορ από τα box scores (πιο αξιόπιστο από το πρόγραμμα)
            pts = logs.groupby(["gameCode", "home"])["PTS"].sum().unstack("home")
            done = games.gameCode.isin(pts.index)
            played = games[done].copy()
            played["homescore"] = played.gameCode.map(pts.get(1))
            played["awayscore"] = played.gameCode.map(pts.get(0))
        else:
            # διοργάνωση χωρίς box scores: σκορ από το πρόγραμμα
            done = games.played & games.homescore.notna()
            played = games[done].copy()
        played = played.sort_values(["date", "gameCode"])
        upcoming = games[~done & ~games.played].sort_values(["date", "gameCode"])

        players = (logs.sort_values("date").drop_duplicates("pid", keep="last")
                       .set_index("pid")["player"].to_dict())
        teams = {k: v for k, v in data.team_names().items()
                 if k in set(logs.team) | set(games.homecode) | set(games.awaycode)}

        out = {
            "comp": data.comp, "season": season,
            "teams": teams,
            "players": players,
            "bio": {pid: self.bio[pid] for pid in players if pid in self.bio},
            "bio_cols": ["height", "weight", "birth", "country", "pos", "number", "photo"],
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
            except (FileNotFoundError, ValueError) as e:
                print(f"  ! {comp}: {e}")
                continue
            seasons = [s for s in data.seasons if (data.logs.season == s).any() or s == max(data.seasons)]
            for s in seasons:
                self.build_season(data, s)
            self.collect_career(data)
            self.manifest["competitions"].append({
                "code": comp, "name": name, "seasons": seasons, "hasBox": data.has_box,
                "section": next(k for k, (_, cs) in SECTIONS.items() if comp in cs),
                "analytics": (SITE_DATA / f"analytics_{comp}.json").exists(),  # σελίδα «Ανάλυση» (analytics.py)
                "edge": (SITE_DATA / f"edge_{comp}.json").exists(),            # σελίδα «Στοίχημα» (edge_model.py)
                "roles": (SITE_DATA / f"roles_{comp}.json").exists(),          # ρόλοι παικτών (roles.py)
            })
        have = {c["code"] for c in self.manifest["competitions"]}
        self.manifest["sections"] = [{"key": k, "name": n, "comps": [c for c in cs if c in have]}
                                     for k, (n, cs) in SECTIONS.items() if any(c in have for c in cs)]
        import team_meta                                         # σήματα ομάδων (συντομογραφία + χρώματα)
        team_meta.build()
        self.write_careers()
        self.manifest["careers"] = (SITE_DATA / "careers.json").exists()
        (SITE_DATA / "manifest.json").write_text(json.dumps(self.manifest, indent=1))
        print("  manifest.json written")


if __name__ == "__main__":
    SiteBuilder().run()
