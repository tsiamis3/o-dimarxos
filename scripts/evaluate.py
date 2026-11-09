"""
Βοηθητικά για την αξιολόγηση + το ΑΠΛΟ Monte Carlo (ratings μόνο της τρέχουσας σεζόν, σταθερή έδρα/σ).
Το απλό Monte Carlo κρατιέται ως baseline σύγκρισης· το Monte Carlo του site τρέχει πάνω στο μοντέλο
ratings + απουσίες (edge_model.py). Το παλιό μοντέλο παικτών και τα νευρωνικά αγώνων αφαιρέθηκαν.
"""
import json
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from dataset import CompetitionData

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _keep_pregame(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    """Κρατά μόνο προβλέψεις που έγιναν ως και την ημέρα του ματς, και από αυτές την τελευταία."""
    df = df[df["made_at"].astype(str) <= df["date"].astype(str)]
    return df.sort_values("made_at").drop_duplicates(keys, keep="last")


def _r(x, d=3):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), d)


# ----------------------------------------------------------------------------
# 1) Προβλέψεις παικτών
# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------
# 2) Προσομοίωση αγώνων (ίδιος τύπος με την MatchSim του site/app.js)
# ----------------------------------------------------------------------------
class GameSimulator:
    HCA, SD, SHRINK = 3.0, 10.0, 4

    def __init__(self, data: CompetitionData):
        self.data = data
        self.tg = self._team_games()

    def _team_games(self) -> pd.DataFrame:
        """Ένα row ανά (ματς, ομάδα): πόντοι υπέρ/κατά και κατοχές."""
        lg = self.data.logs
        if len(lg):
            t = (lg.groupby(["season", "gameCode", "date", "team", "opp", "home"], as_index=False)
                 [["PTS", "FG2A", "FG3A", "FTA", "OREB", "TOV"]].sum())
            t["POSS"] = t.FG2A + t.FG3A + 0.44 * t.FTA - t.OREB + t.TOV
            o = t[["season", "gameCode", "team", "PTS", "POSS"]].rename(
                columns={"team": "opp", "PTS": "OPP", "POSS": "OPOSS"})
            t = t.merge(o, on=["season", "gameCode", "opp"])
            t["POSS"] = (t.POSS + t.OPOSS) / 2
            return t[["season", "gameCode", "date", "team", "opp", "home", "PTS", "OPP", "POSS"]]
        g = self.data.games[self.data.games.played & self.data.games.homescore.notna()]
        h = g.assign(team=g.homecode, opp=g.awaycode, home=1, PTS=g.homescore, OPP=g.awayscore)
        a = g.assign(team=g.awaycode, opp=g.homecode, home=0, PTS=g.awayscore, OPP=g.homescore)
        t = pd.concat([h, a])[["season", "gameCode", "date", "team", "opp", "home", "PTS", "OPP"]]
        t["POSS"] = 100.0                      # χωρίς box scores: rating = πόντοι ανά ματς
        t["date"] = pd.to_datetime(t["date"])
        return t

    def _expect(self, st: pd.DataFrame | None, home: str, away: str) -> tuple[float, float]:
        if st is None or st.empty:
            lg, lp = 110.0, 75.0
            rh = ra = (lg, lg, lp)
        else:
            lg = 100 * st.PTS.sum() / st.POSS.sum()
            lp = st.POSS.sum() / st.GP.sum()

            def rating(team):
                if team not in st.index:
                    return lg, lg, lp
                a, k = st.loc[team], self.SHRINK
                sh = lambda v, ref: (a.GP * v + k * ref) / (a.GP + k)  # noqa: E731
                return sh(100 * a.PTS / a.POSS, lg), sh(100 * a.OPP / a.POSS, lg), sh(a.POSS / a.GP, lp)
            rh, ra = rating(home), rating(away)
        pace = (rh[2] + ra[2]) / 2
        mh = pace * (rh[0] + ra[1] - lg) / 100 + self.HCA / 2
        ma = pace * (ra[0] + rh[1] - lg) / 100 - self.HCA / 2
        return mh, ma

    def p_home(self, mh, ma) -> float:
        return 0.5 * (1 + math.erf((mh - ma) / (self.SD * math.sqrt(2)) / math.sqrt(2)))

    @staticmethod
    def _state(tg: pd.DataFrame) -> pd.DataFrame:
        return tg.groupby("team").agg(PTS=("PTS", "sum"), OPP=("OPP", "sum"), POSS=("POSS", "sum"),
                                      GP=("PTS", "size"))

    def backtest(self) -> pd.DataFrame:
        """Walk-forward: κάθε ματς προβλέπεται μόνο με ό,τι είχε παιχτεί πριν από την ημέρα του."""
        out = []
        games = self.data.games
        for season, tg in self.tg.groupby("season"):
            g = games[(games.season == season)].set_index("gameCode")
            for d in sorted(tg["date"].unique()):
                st = self._state(tg[tg["date"] < d])
                for gc in tg.loc[(tg["date"] == d) & (tg.home == 1), "gameCode"]:
                    if gc not in g.index:
                        continue
                    row = tg[(tg.gameCode == gc) & (tg.home == 1)].iloc[0]
                    mh, ma = self._expect(st, row.team, row.opp)
                    out.append(dict(season=season, gameCode=gc, date=pd.Timestamp(d).strftime("%Y-%m-%d"),
                                    home=row.team, away=row.opp, mh=mh, ma=ma, p=self.p_home(mh, ma),
                                    hs=row.PTS, as_=row.OPP, prior=int(st.GP.sum() / 2) if len(st) else 0))
        return pd.DataFrame(out)

    def upcoming(self, days=10) -> pd.DataFrame:
        cur = max(self.data.seasons)
        st = self._state(self.tg[self.tg.season == cur])
        up = self.data.upcoming(cur)
        up = up[pd.to_datetime(up["date"]) <= pd.Timestamp.now() + pd.Timedelta(days=days)]
        rows = []
        for g in up.itertuples():
            mh, ma = self._expect(st, g.homecode, g.awaycode)
            rows.append(dict(made_at=TODAY, season=cur, gameCode=int(g.gameCode), date=str(g.date)[:10], home=g.homecode,
                             away=g.awaycode, mh=round(mh, 1), ma=round(ma, 1), p=round(self.p_home(mh, ma), 4)))
        return pd.DataFrame(rows)

    @staticmethod
    def score(df: pd.DataFrame) -> dict:
        """Μετρικές πιθανότητας νίκης γηπεδούχου."""
        if df.empty:
            return {"n": 0}
        y = (df.hs > df.as_).astype(float)
        p = df.p.astype(float)
        acc = float(np.mean(np.where(p == 0.5, 0.5, (p > 0.5) == (y == 1))))
        calib = []
        for lo in np.arange(0, 1, 0.1):
            b = df[(p >= lo) & (p < lo + 0.1 + (1e-9 if lo >= 0.9 else 0))]
            if len(b):
                calib.append({"lo": round(lo, 1), "n": len(b), "pred": _r(b.p.mean()),
                              "obs": _r((b.hs > b.as_).mean())})
        return {"n": int(len(df)), "acc": _r(acc), "brier": _r(np.mean((p - y) ** 2), 4),
                "home_rate": _r(y.mean()), "brier_coin": 0.25,
                "mae_margin": _r(np.mean(np.abs((df.mh - df.ma) - (df.hs - df.as_))), 2),
                "mae_total": _r(np.mean(np.abs((df.mh + df.ma) - (df.hs + df.as_))), 2),
                "calibration": calib}
