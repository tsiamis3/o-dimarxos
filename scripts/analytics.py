"""
Αναλυτικά στατιστικά για τη σελίδα «Ανάλυση»: μόνο μεγέθη που λένε κάτι, με διόρθωση για αντίπαλο,
ρυθμό και μέγεθος δείγματος (αντί για ακατέργαστους μέσους όρους ανά αγώνα).

Ομάδες
  - προσαρμοσμένα ratings επίθεσης/άμυνας/net ανά 100 κατοχές (ridge, ratings.py) και δυσκολία προγράμματος
  - αναμενόμενες νίκες από τη διαφορά πόντων και «τύχη» (νίκες − αναμενόμενες), ρεκόρ σε κλειστά ματς
  - four factors: πόσους πόντους ανά 100 κατοχές εξηγεί καθένας για κάθε ομάδα (παλινδρόμηση σε επίπεδο αγώνα)
  - πλεονέκτημα έδρας λίγκας με διάστημα εμπιστοσύνης
  - φόρμα: προσαρμοσμένο net των τελευταίων 8 αγώνων vs σεζόν, με z-score (θόρυβος ή πραγματική αλλαγή;)
Παίκτες (όπου υπάρχουν box scores)
  - παραγωγή ανά 100 κατοχές, usage %, TS% με εμπειρική Bayes συρρίκνωση, AST%, OREB%/DREB%, TOV%
  - on/off (διαφορά πόντων ανά 100 κατοχές με τον παίκτη μέσα vs έξω) με συρρίκνωση για μικρά δείγματα
  - σημαντικές μεταβολές: τελευταίοι 5 αγώνες vs σεζόν, μόνο όταν |z| ≥ 2

Έξοδος: site/data/analytics_{C}.json

    python scripts/analytics.py
"""
import json
import math

import numpy as np
import pandas as pd

from config import COMPETITIONS, SITE_DATA
from dataset import CompetitionData
from ratings import RidgeRatings, team_games

GAME_MIN = 40.0          # NBA: 48 (διορθώνεται παρακάτω)
TS_PRIOR = 60.0          # εικονικές προσπάθειες σουτ προς τον μέσο όρο (TS%)
ONOFF_PRIOR = 600.0      # εικονικά λεπτά προς το 0 (on/off)
FORM_N = 8


def _r(v, d=2):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), d)


def _rows(df: pd.DataFrame, d=2):
    out = []
    for r in df.itertuples(index=False, name=None):
        out.append([_r(v, d) if isinstance(v, (float, np.floating)) else (int(v) if isinstance(v, (np.integer, bool, np.bool_)) else v)
                    for v in r])
    return {"cols": list(df.columns), "rows": out}


def _phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bh_qvalues(z) -> np.ndarray:
    """Benjamini–Hochberg q-τιμές από z-scores (δίπλευρος έλεγχος): πόσο πιθανό είναι
    να είναι θόρυβος, λαμβάνοντας υπόψη ότι ελέγχουμε πολλούς παίκτες/ομάδες ταυτόχρονα."""
    z = np.asarray(z, float)
    p = np.array([2 * (1 - _phi(abs(v))) if np.isfinite(v) else 1.0 for v in z])
    n = len(p)
    if n == 0:
        return p
    order = np.argsort(p)
    q = np.empty(n)
    prev = 1.0
    for rank, i in reversed(list(enumerate(order, 1))):
        prev = min(prev, p[i] * n / rank)
        q[i] = prev
    return q


class SeasonAnalytics:
    def __init__(self, data: CompetitionData, tg_all: pd.DataFrame, season: int):
        self.data, self.season = data, season
        self.tg = tg_all[tg_all.season == season].copy()
        self.box = bool(self.tg["box"].iloc[0]) if len(self.tg) else False
        self.gmin = 48.0 if data.comp == "NBA" else GAME_MIN

    # ------------------------------------------------------------------ λίγκα
    def league(self, rat: RidgeRatings) -> dict:
        tg = self.tg
        h = tg[tg.home == 1]
        m = (h.PTS - h.OPP).to_numpy(float)
        hca_pts = rat.hca * rat.lg_pace / 100
        se = m.std(ddof=1) / math.sqrt(len(m)) if len(m) > 1 else float("nan")
        out = {"games": int(len(h)), "home_win": _r((m > 0).mean(), 3), "home_margin": _r(m.mean(), 2),
               "home_margin_ci": [_r(m.mean() - 1.96 * se, 2), _r(m.mean() + 1.96 * se, 2)],
               "hca_adj": _r(hca_pts, 2), "ppg": _r(tg.PTS.mean(), 1), "sd_margin": _r(m.std(ddof=1), 2)}
        if self.box:
            out.update(pace=_r(tg.POSS.mean(), 1), ortg=_r(100 * tg.PTS.sum() / tg.POSS.sum(), 1),
                       efg=_r((tg.FGM + 0.5 * tg.FG3M).sum() / tg.FGA.sum(), 3),
                       tov=_r(tg.TOV.sum() / tg.POSS.sum(), 3),
                       orb=_r(tg.OREB.sum() / (tg.OREB + tg.o_DREB).sum(), 3),
                       ftr=_r(tg.FTM.sum() / tg.FGA.sum(), 3), three_rate=_r(tg.FG3A.sum() / tg.FGA.sum(), 3))
        return out

    # ------------------------------------------------------------------ ομάδες
    def teams(self, rat: RidgeRatings, sd_game: float) -> pd.DataFrame:
        tg = self.tg
        tab = rat.table().set_index("team")
        g = tg.groupby("team")
        out = pd.DataFrame({"GP": g.size(), "W": g.apply(lambda x: int((x.MARGIN > 0).sum()))})
        out["L"] = out.GP - out.W
        out["margin"] = g.MARGIN.mean()
        out["net"] = g.apply(lambda x: 100 * (x.PTS.sum() - x.OPP.sum()) / x.POSS.sum())
        out = out.join(tab[["adj_o", "adj_d", "adj_net", "adj_pace"]])
        # δυσκολία προγράμματος: μέσο προσαρμοσμένο net των αντιπάλων
        opp_net = tg.opp.map(tab.adj_net)
        out["sos"] = opp_net.groupby(tg.team).mean()
        # αναμενόμενες νίκες: κάθε αγώνας με πιθανότητα Φ(διαφορά ομάδας ανά αγώνα / σ)
        out["exp_w"] = [row.GP * _phi(row.margin / sd_game) for row in out.itertuples()]
        out["luck"] = out.W - out.exp_w
        close = tg[tg.MARGIN.abs() <= 5]
        cg = close.groupby("team")
        out["close_w"] = cg.apply(lambda x: int((x.MARGIN > 0).sum())).reindex(out.index).fillna(0)
        out["close_l"] = cg.size().reindex(out.index).fillna(0) - out.close_w
        # φόρμα: προσαρμοσμένο net ανά αγώνα = net αγώνα − (άμυνα αντιπάλου − επίθεση αντιπάλου) − έδρα
        game_net = 100 * tg.MARGIN / tg.POSS
        opp_adj = tg.opp.map(tab.adj_net).fillna(0)
        adj_game = game_net + opp_adj - np.where(tg.home == 1, rat.hca / 2, -rat.hca / 2)
        tg = tg.assign(adj_game=adj_game)
        sd_g = float(tg.adj_game.std())
        out["consistency"] = tg.groupby("team").adj_game.std()
        recent = tg.sort_values("date").groupby("team").tail(FORM_N).groupby("team").adj_game.agg(["mean", "size"])
        season_mean = tg.groupby("team").adj_game.mean()
        out["form"] = recent["mean"]
        n = recent["size"]
        # z: διαφορά τελευταίων Ν από τον μέσο των υπόλοιπων αγώνων
        rest_n = out.GP - n
        rest_mean = (season_mean * out.GP - recent["mean"] * n) / rest_n.replace(0, np.nan)
        out["form_z"] = (recent["mean"] - rest_mean) / (sd_g * np.sqrt(1 / n + 1 / rest_n.replace(0, np.nan)))
        out["form_q"] = bh_qvalues(out["form_z"].to_numpy())
        # έδρα ομάδας: net εντός − εκτός (ακατέργαστο, με συρρίκνωση προς το HCA λίγκας)
        hn = tg[tg.home == 1].groupby("team").apply(lambda x: 100 * x.MARGIN.sum() / x.POSS.sum())
        an = tg[tg.home == 0].groupby("team").apply(lambda x: 100 * x.MARGIN.sum() / x.POSS.sum())
        nh = tg.groupby("team").home.sum()
        split = (hn - an).reindex(out.index)
        k = 10.0
        out["home_split"] = (split * nh + k * 2 * rat.hca / 2) / (nh + k)
        out["adj_rank"] = out.adj_net.rank(ascending=False, method="min")
        out["raw_rank"] = out.net.rank(ascending=False, method="min")
        out = out.reset_index().rename(columns={"index": "team"})
        cols = ["team", "GP", "W", "L", "net", "adj_o", "adj_d", "adj_net", "adj_rank", "raw_rank", "adj_pace", "sos",
                "exp_w", "luck", "close_w", "close_l", "form", "form_z", "form_q", "consistency", "home_split"]
        return out[cols].sort_values("adj_net", ascending=False)

    # ------------------------------------------------------------------ four factors
    def four_factors(self, tg_all: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
        """ORTG αγώνα = β0 + β·(eFG, TOV%, OREB%, FTr) -> συνεισφορά κάθε παράγοντα σε πόντους/100 κατοχές
        για επίθεση (δικά της) και άμυνα (των αντιπάλων), σε σχέση με τον μέσο όρο της λίγκας."""
        def fac(df, p=""):
            return pd.DataFrame({
                "efg": (df[p + "FGM"] + 0.5 * df[p + "FG3M"]) / df[p + "FGA"],
                "tov": df[p + "TOV"] / df["POSS"],
                "orb": df[p + "OREB"] / (df[p + "OREB"] + df[("" if p else "o_") + "DREB"]),
                "ftr": df[p + "FTM"] / df[p + "FGA"]})
        allf = fac(tg_all)
        ok = allf.notna().all(axis=1)
        X = np.c_[np.ones(ok.sum()), allf[ok].to_numpy()]
        beta, *_ = np.linalg.lstsq(X, tg_all.loc[ok, "ORTG"].to_numpy(), rcond=None)
        w = dict(zip(["efg", "tov", "orb", "ftr"], beta[1:]))
        tg = self.tg
        f_off, f_def = fac(tg), fac(tg, "o_")
        lg = fac(pd.DataFrame({c: [tg[c].sum()] for c in ["FGM", "FG3M", "FGA", "TOV", "POSS", "OREB", "o_DREB", "FTM"]}))
        lg = lg.iloc[0]
        rows = []
        for t, idx in tg.groupby("team").groups.items():
            d = tg.loc[idx]
            so = fac(pd.DataFrame({c: [d[c].sum()] for c in ["FGM", "FG3M", "FGA", "TOV", "POSS", "OREB", "o_DREB", "FTM"]})).iloc[0]
            sd = fac(pd.DataFrame({c: [d[c].sum()] for c in ["o_FGM", "o_FG3M", "o_FGA", "o_TOV", "POSS", "o_OREB", "DREB", "o_FTM"]}), "o_").iloc[0]
            r = {"team": t}
            for k in w:
                r[f"o_{k}"] = so[k]
                r[f"d_{k}"] = sd[k]
                r[f"o_{k}_pts"] = w[k] * (so[k] - lg[k])            # + = βοηθά την επίθεση
                r[f"d_{k}_pts"] = -w[k] * (sd[k] - lg[k])           # + = βοηθά την άμυνα
            rows.append(r)
        del f_off, f_def
        return pd.DataFrame(rows), {"weights": {k: _r(v, 1) for k, v in w.items()},
                                    "league": {k: _r(lg[k], 3) for k in w}}

    # ------------------------------------------------------------------ παίκτες
    def players(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        lg = self.data.logs
        lg = lg[lg.season == self.season].copy()
        tg = self.tg.set_index(["gameCode", "team"])
        key = list(zip(lg.gameCode, lg.team))
        for c, src in [("T_POSS", "POSS"), ("T_FGA", "FGA"), ("T_FTA", "FTA"), ("T_TOV", "TOV"), ("T_FGM", "FGM"),
                       ("T_OREB", "OREB"), ("T_DREB", "DREB"), ("O_OREB", "o_OREB"), ("O_DREB", "o_DREB"),
                       ("T_MARGIN", "MARGIN"), ("O_FGA", "o_FGA")]:
            lg[c] = [tg[src].get(k, np.nan) for k in key]
        lg = lg[lg.T_POSS.notna()]
        lg["FGA"] = lg.FG2A + lg.FG3A
        lg["FGM"] = lg.FG2M + lg.FG3M
        share = (lg.MIN / self.gmin).clip(0, 1)                       # ποσοστό του αγώνα στο παρκέ
        lg["on_poss"] = share * lg.T_POSS
        g = lg.groupby("pid")
        S = lambda c: g[c].sum()  # noqa: E731
        p = pd.DataFrame({"player": g.player.last(), "team": g.team.last(), "GP": g.size(), "MIN": S("MIN")})
        onp = S("on_poss")
        p["mpg"] = p.MIN / p.GP
        p["pts100"] = 100 * S("PTS") / onp
        p["ast100"] = 100 * S("AST") / onp
        p["reb100"] = 100 * S("REB") / onp
        p["pir100"] = 100 * S("PIR") / onp
        use = S("FGA") + 0.44 * S("FTA") + S("TOV")
        t_use_on = (share * (lg.T_FGA + 0.44 * lg.T_FTA + lg.T_TOV)).groupby(lg.pid).sum()
        p["usg"] = use / t_use_on
        tsa = S("FGA") + 0.44 * S("FTA")
        lg_ts = lg.PTS.sum() / (2 * (lg.FGA.sum() + 0.44 * lg.FTA.sum()))
        p["ts"] = S("PTS") / (2 * tsa.replace(0, np.nan))
        p["ts_adj"] = (S("PTS") + 2 * TS_PRIOR * lg_ts) / (2 * (tsa + TS_PRIOR))     # εμπειρική Bayes
        p["tsa"] = tsa
        p["ast_pct"] = S("AST") / ((share * lg.T_FGM).groupby(lg.pid).sum() - S("FGM")).replace(0, np.nan)
        p["orb_pct"] = S("OREB") / (share * (lg.T_OREB + lg.O_DREB)).groupby(lg.pid).sum()
        p["drb_pct"] = S("DREB") / (share * (lg.T_DREB + lg.O_OREB)).groupby(lg.pid).sum()
        p["tov_pct"] = S("TOV") / use.replace(0, np.nan)
        # on/off από το plus/minus ανά αγώνα (όπου υπάρχει)
        has_pm = lg.PM.notna().mean() > 0.8 and (lg.PM != 0).mean() > 0.3
        if has_pm:
            on_m = S("PM")
            off_m = (lg.T_MARGIN - lg.PM).groupby(lg.pid).sum()
            off_p = ((1 - share) * lg.T_POSS).groupby(lg.pid).sum()
            on100, off100 = 100 * on_m / onp, 100 * off_m / off_p.replace(0, np.nan)
            p["on100"], p["off100"] = on100, off100
            raw = on100 - off100
            p["onoff"] = raw * p.MIN / (p.MIN + ONOFF_PRIOR)                   # συρρίκνωση προς 0
        else:
            p["on100"] = p["off100"] = p["onoff"] = np.nan
        p = p.reset_index()

        # σημαντικές μεταβολές: τελευταίοι 5 αγώνες vs υπόλοιπη σεζόν (PIR ανά 100 κατοχές)
        lg = lg.sort_values("date")
        lg["pir100g"] = 100 * lg.PIR / lg.on_poss.replace(0, np.nan)
        rows = []
        for pid, d in lg.groupby("pid"):
            if len(d) < 10 or d.MIN.mean() < 12:
                continue
            last, rest = d.tail(5), d.iloc[:-5]
            wl, wr = last.on_poss, rest.on_poss
            ml = 100 * last.PIR.sum() / wl.sum()
            mr = 100 * rest.PIR.sum() / wr.sum()
            sd = d.pir100g.std()
            z = (ml - mr) / (sd * math.sqrt(1 / 5 + 1 / len(rest)))
            mins_l, mins_r = last.MIN.mean(), rest.MIN.mean()
            rows.append(dict(pid=pid, player=d.player.iloc[-1], team=d.team.iloc[-1], last=ml, season=mr, z=z,
                             min_last=mins_l, min_season=mins_r,
                             pts_last=last.PTS.mean(), pts_season=rest.PTS.mean()))
        trend = pd.DataFrame(rows, columns=["pid", "player", "team", "last", "season", "z", "min_last", "min_season",
                                            "pts_last", "pts_season"])
        trend["q"] = bh_qvalues(trend.z.to_numpy()) if len(trend) else []
        self.n_trend_tested = len(trend)
        # στο site: όσοι έχουν |z| ≥ 2 (με q-τιμή, ώστε να φαίνεται αν είναι θόρυβος)
        trend = trend[trend.z.abs() >= 2].sort_values("z", ascending=False)
        cols = ["pid", "player", "team", "GP", "MIN", "mpg", "usg", "ts", "ts_adj", "tsa", "pts100", "ast100", "reb100",
                "pir100", "ast_pct", "orb_pct", "drb_pct", "tov_pct", "on100", "off100", "onoff"]
        return p[cols], trend


class Analytics:
    def __init__(self, comp):
        self.comp = comp
        self.data = CompetitionData(comp)

    def run(self):
        tg_all = team_games(self.data)
        if tg_all.empty:
            return
        box = bool(tg_all["box"].iloc[0])
        out = {"comp": self.comp, "box": box, "seasons": {}}
        # σ διαφοράς ανά αγώνα (για αναμενόμενες νίκες): από όλα τα δεδομένα της διοργάνωσης
        h = tg_all[tg_all.home == 1]
        sd_game = float((h.PTS - h.OPP).std())
        history = []
        for s in sorted(tg_all.season.unique()):
            sa = SeasonAnalytics(self.data, tg_all, s)
            if len(sa.tg) < 20:
                continue
            # ratings όλης της σεζόν (ίσα βάρη, μέτρια ποινή)
            rat = RidgeRatings(lam=3.0, lam_pace=3.0).fit(sa.tg, weights=np.ones(len(sa.tg)))
            league = sa.league(rat)
            res = {"league": league, "teams": _rows(sa.teams(rat, sd_game))}
            if box:
                ff, meta = sa.four_factors(tg_all)
                res["four_factors"] = _rows(ff, 3)
                res["ff_meta"] = meta
                pl, trend = sa.players()
                res["players"] = _rows(pl, 3)
                res["trend"] = _rows(trend, 3)
                res["trend_tested"] = sa.n_trend_tested
            out["seasons"][str(s)] = res
            history.append({"season": int(s), **league})
            print(f"   {self.comp}{s}: {league['games']} games, HCA {league['hca_adj']} pts"
                  f"{'' if not box else f', {len(res['players']['rows'])} players, {len(res['trend']['rows'])} trends'}")
        out["history"] = history
        out["sd_game"] = _r(sd_game, 2)
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        (SITE_DATA / f"analytics_{self.comp}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


def main():
    for c in COMPETITIONS:
        print(f"== {COMPETITIONS[c]}")
        try:
            Analytics(c).run()
        except (FileNotFoundError, ValueError) as e:
            print(f"  ! {c}: {e}")


if __name__ == "__main__":
    main()
