"""
Αξιολόγηση μοντέλων: τρέχει μετά το train_model.py και πριν το build_site.py.

Τρία πράγματα, για κάθε διοργάνωση:
  1. Αρχείο προβλέψεων παικτών (data/predictions/{C}_players.csv.gz)
     Κρατά την τελευταία πρόβλεψη ΠΡΙΝ από κάθε ματς και, όταν παιχτεί το ματς,
     τη συγκρίνει με το πραγματικό (ζωντανή αξιολόγηση, όχι backtest).
  2. Προσομοίωση αγώνων (ίδιο μοντέλο ratings με το site)
     - backtest walk-forward: για κάθε ματς, ratings μόνο από τα προηγούμενα ματς της σεζόν
     - αρχείο προβλέψεων αγώνων (data/predictions/{C}_games.csv) + ζωντανή αξιολόγηση
  3. Ιστορικό εκπαιδεύσεων (data/predictions/{C}_history.csv): MAE κάθε εκπαίδευσης.

Έξοδος για το site: site/data/eval_{C}.json

    python scripts/evaluate.py
"""
import json
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from config import COMPETITIONS, PRED_DIR, SITE_DATA, TARGETS
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
class PlayerPredictionLog:
    def __init__(self, comp: str, data: CompetitionData):
        self.comp, self.data = comp, data
        self.path = PRED_DIR / f"{comp}_players.csv.gz"

    def update(self) -> pd.DataFrame:
        old = pd.read_csv(self.path) if self.path.exists() else pd.DataFrame()
        pf = SITE_DATA / f"predictions_{self.comp}.json"
        if pf.exists():
            p = json.loads(pf.read_text())
            new = pd.DataFrame(p["next"]["rows"], columns=p["next"]["cols"])
            new.insert(0, "made_at", TODAY)
            new.insert(1, "season", max(self.data.seasons))     # οι κωδικοί αγώνων επαναλαμβάνονται ανά σεζόν
            log = pd.concat([old, new], ignore_index=True) if len(old) else new
        else:
            log = old
        if len(log):
            log = _keep_pregame(log, ["season", "gameCode", "pid"])
            PRED_DIR.mkdir(parents=True, exist_ok=True)
            log.to_csv(self.path, index=False, compression="gzip")
        return log

    def evaluate(self, log: pd.DataFrame) -> dict | None:
        if log.empty or self.data.logs.empty:
            return None
        act = self.data.logs[["season", "gameCode", "pid", "player", *TARGETS]]
        m = log.merge(act, on=["season", "gameCode", "pid"], suffixes=("_p", ""))
        if m.empty:
            return {"n": 0, "metrics": {}, "by_date": [], "recent": {"cols": [], "rows": []}}
        metrics = {}
        for t in TARGETS:
            e = (m[f"{t}_p"] - m[t]).abs()
            b = (m[f"b_{t}"] - m[t]).abs() if f"b_{t}" in m else pd.Series(np.nan, index=m.index)
            metrics[t] = {"model": _r(e.mean()), "base": _r(b.mean()), "bias": _r((m[f"{t}_p"] - m[t]).mean())}
        # MAE ανά ημέρα αγώνων (για γράφημα)
        by_date = []
        for d, g in m.groupby("date"):
            row = {"date": d, "n": len(g)}
            for t in TARGETS:
                row[t] = _r((g[f"{t}_p"] - g[t]).abs().mean(), 2)
                if f"b_{t}" in g:
                    row[f"b_{t}"] = _r((g[f"b_{t}"] - g[t]).abs().mean(), 2)
            by_date.append(row)
        recent = m[m["date"] >= sorted(m["date"].unique())[-min(3, m["date"].nunique())]]
        cols = ["date", "pid", "player", "team", "opp", "home"] + [c for t in TARGETS for c in (f"{t}_p", t)]
        rows = [[_r(v, 1) if isinstance(v, float) else (int(v) if isinstance(v, (np.integer,)) else v)
                 for v in r] for r in recent[cols].itertuples(index=False, name=None)]
        return {"n": int(len(m)), "games": int(m["gameCode"].nunique()), "metrics": metrics,
                "by_date": by_date, "recent": {"cols": cols, "rows": rows}}


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


class GamePredictionLog:
    def __init__(self, comp: str, sim: GameSimulator):
        self.comp, self.sim = comp, sim
        self.path = PRED_DIR / f"{comp}_games.csv"

    def update(self) -> pd.DataFrame:
        old = pd.read_csv(self.path) if self.path.exists() else pd.DataFrame()
        new = self.sim.upcoming()
        log = pd.concat([old, new], ignore_index=True) if len(old) else new
        if len(log):
            log = _keep_pregame(log, ["season", "gameCode"])
            PRED_DIR.mkdir(parents=True, exist_ok=True)
            log.to_csv(self.path, index=False)
        return log

    def evaluate(self, log: pd.DataFrame) -> tuple[dict, list]:
        g = self.sim.data.games
        done = g[g.played & g.homescore.notna()][["season", "gameCode", "homescore", "awayscore"]]
        if len(self.sim.data.logs):           # σκορ από τα box scores όπου υπάρχουν
            pts = self.sim.data.logs.groupby(["season", "gameCode", "home"]).PTS.sum().unstack()
            done = pd.DataFrame({"homescore": pts.get(1), "awayscore": pts.get(0)}).reset_index()
        m = log.merge(done, on=["season", "gameCode"]).rename(columns={"homescore": "hs", "awayscore": "as_"}) \
            if len(log) else pd.DataFrame()
        recent = []
        if len(m):
            for r in m.sort_values("date", ascending=False).head(40).itertuples():
                recent.append([r.date, r.home, r.away, _r(r.p, 3), _r(r.mh, 1), _r(r.ma, 1), int(r.hs), int(r.as_)])
        return GameSimulator.score(m), recent


# ----------------------------------------------------------------------------
# 3) Ιστορικό εκπαιδεύσεων
# ----------------------------------------------------------------------------
class TrainHistory:
    def __init__(self, comp: str):
        self.comp = comp
        self.path = PRED_DIR / f"{comp}_history.csv"

    def update(self) -> pd.DataFrame:
        old = pd.read_csv(self.path) if self.path.exists() else pd.DataFrame()
        pf = SITE_DATA / f"predictions_{self.comp}.json"
        if not pf.exists():
            return old
        p = json.loads(pf.read_text())
        if len(old) and p["trained"] in set(old["trained"]):
            return old
        row = {"trained": p["trained"], "arch": p.get("arch"), "n_train": p["n_train"], "n_test": p["n_test"]}
        for t, m in p["metrics"].items():
            row[f"{t}_model"], row[f"{t}_last10"] = m["model"], m["last10"]
        hist = pd.concat([old, pd.DataFrame([row])], ignore_index=True)
        PRED_DIR.mkdir(parents=True, exist_ok=True)
        hist.to_csv(self.path, index=False)
        return hist


# ----------------------------------------------------------------------------
class Evaluator:
    def __init__(self, comp: str):
        self.comp = comp
        self.data = CompetitionData(comp)

    def run(self):
        print(f"== {COMPETITIONS[self.comp]}")
        out = {"comp": self.comp, "updated": TODAY}

        # παίκτες
        pl = PlayerPredictionLog(self.comp, self.data)
        plog = pl.update()
        out["players"] = pl.evaluate(plog)
        if out["players"]:
            print(f"   players: {len(plog)} archived, {out['players']['n']} evaluated")

        # αγώνες
        sim = GameSimulator(self.data)
        bt = sim.backtest()
        cur = max(self.data.seasons)
        out["sim"] = {"backtest": GameSimulator.score(bt),
                      "backtest_current": GameSimulator.score(bt[bt.season == cur]) if len(bt) else {"n": 0},
                      "params": {"hca": sim.HCA, "sd": sim.SD, "shrink": sim.SHRINK}}
        glog = GamePredictionLog(self.comp, sim)
        live, recent = glog.evaluate(glog.update())
        out["sim"]["live"], out["sim"]["recent"] = live, recent
        b = out["sim"]["backtest"]
        if b.get("n"):
            print(f"   sim backtest: {b['n']} games, acc {b['acc']:.3f}, brier {b['brier']:.4f} "
                  f"(home wins {b['home_rate']:.3f})  | live {live.get('n', 0)} games")

        # ιστορικό
        hist = TrainHistory(self.comp).update()
        out["history"] = {"cols": list(hist.columns), "rows": hist.astype(object).where(hist.notna(), None)
                          .values.tolist()} if len(hist) else None

        SITE_DATA.mkdir(parents=True, exist_ok=True)
        (SITE_DATA / f"eval_{self.comp}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


def main():
    for c in COMPETITIONS:
        try:
            Evaluator(c).run()
        except (FileNotFoundError, ValueError) as e:
            print(f"  ! {c}: {e}")


if __name__ == "__main__":
    main()
