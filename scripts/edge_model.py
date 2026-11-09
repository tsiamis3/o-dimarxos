"""
Μοντέλο στοιχήματος: υπάρχει edge απέναντι στην αγορά;

1. Πρόβλεψη (για κάθε αγώνα, μόνο με ό,τι ήταν γνωστό πριν από την ημέρα του, walk-forward):
   - ratings ομάδων προσαρμοσμένα στον αντίπαλο με χρονική απόσβεση (ratings.py), τ/λ ανά λίγκα
     επιλεγμένα σε προηγούμενες σεζόν
   - διόρθωση για απουσίες βασικών (στα παιγμένα: ποιοι δεν έπαιξαν· στα επερχόμενα NBA: τραυματίες ESPN)
   - online βαθμονόμηση: διαφορά ~ a + b·μοντέλο + c·απουσίες, σύνολο ~ a + b·μοντέλο, σ από τα κατάλοιπα
   -> πιθανότητα νίκης, κάλυψης handicap, over/under, «δίκαιες» αποδόσεις
2. Αξιολόγηση απέναντι στην αγορά (όπου υπάρχουν αποδόσεις, π.χ. NBA από ESPN):
   - μοντέλο vs αγορά (Brier, log loss, σφάλμα διαφοράς/συνόλου)
   - έχει το μοντέλο πληροφορία ΠΕΡΑ από την αγορά; αποτέλεσμα ~ αγορά + μοντέλο (συντελεστής γ, τυπικό σφάλμα)
   - backtest στοιχήματος με online συνδυασμό αγοράς+μοντέλου: ROI ανά κατώφλι αναμενόμενης αξίας, 90% bootstrap
   - ετυμηγορία ανά αγορά (νικητής, handicap, σύνολο): edge μόνο αν γ>0 στατιστικά ΚΑΙ ROI>0 στατιστικά
3. Επερχόμενα: δίκαιες αποδόσεις, αναμενόμενη αξία (EV) απέναντι στις τρέχουσες αποδόσεις, και σύσταση
   (¼ Kelly, έως 2% του κεφαλαίου) ΜΟΝΟ για αγορές με αποδεδειγμένο edge.
4. Αρχείο προβλέψεων (data/predictions/{C}_edge.csv): ζωντανή αξιολόγηση και CLV (κίνηση της γραμμής
   μέχρι το κλείσιμο προς τη μεριά του μοντέλου).

Έξοδος: site/data/edge_{C}.json

    python scripts/edge_model.py
"""
import json
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from config import COMPETITIONS, PRED_DIR, RAW_DIR, SITE_DATA
from dataset import CompetitionData
from evaluate import TODAY, GameSimulator, _keep_pregame, _r
from ratings import RidgeRatings, availability, regulars, team_games

COMPS = ["E", "U", "GBL", "NBA", "WBL2"]
Z80 = 1.2815516
GRID = [(120, 1.0), (365, 2.0), (730, 4.0)]
MIN_PAST = 150                 # team-games πριν αρχίσουν οι προβλέψεις (πρώτη σεζόν)
MIN_CALIB = 200                # αγώνες πριν την online βαθμονόμηση
MIN_BLEND = 300                # αγώνες με αποδόσεις πριν τον συνδυασμό αγοράς+μοντέλου
EV_MIN = 0.03
THRESHOLDS = [0.0, 0.02, 0.03, 0.05, 0.08]
KELLY_FRAC, STAKE_CAP = 0.25, 0.02
UPCOMING_DAYS = 14
RNG = np.random.default_rng(0)


def score(df: pd.DataFrame) -> dict:
    """Μετρικές ενός μοντέλου αγώνων: df με mh, ma, p, hs, as_ και προαιρετικά sh, sa (σ ανά ομάδα)."""
    if df.empty:
        return {"n": 0}
    s = GameSimulator.score(df)
    y = (df.hs > df.as_).astype(float)
    p = df.p.astype(float).clip(1e-4, 1 - 1e-4)
    sh = df["sh"] if "sh" in df else GameSimulator.SD
    sa = df["sa"] if "sa" in df else GameSimulator.SD
    cover = ((np.abs(df.hs - df.mh) <= Z80 * sh).mean() + (np.abs(df.as_ - df.ma) <= Z80 * sa).mean()) / 2
    s.update({"logloss": _r(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)), 4),
              "mae_home": _r(np.mean(np.abs(df.mh - df.hs)), 2), "mae_away": _r(np.mean(np.abs(df.ma - df.as_)), 2),
              "cover80": _r(cover)})
    return s


def _phi(x):
    x = np.asarray(x, float)
    return 0.5 * (1 + np.vectorize(math.erf, otypes=[float])(x / math.sqrt(2)))


def _phinv(p):
    # Acklam / απλή προσέγγιση μέσω bisection (αρκεί για p σε [0.001, 0.999])
    p = np.clip(np.asarray(p, float), 1e-4, 1 - 1e-4)
    lo, hi = np.full(p.shape, -8.0), np.full(p.shape, 8.0)
    for _ in range(60):
        mid = (lo + hi) / 2
        m = _phi(mid) < p
        lo, hi = np.where(m, mid, lo), np.where(m, hi, mid)
    return (lo + hi) / 2


def devig(a, b):
    ia, ib = 1 / np.asarray(a, float), 1 / np.asarray(b, float)
    return ia / (ia + ib)


def ols(X, y):
    X, y = np.asarray(X, float), np.asarray(y, float)
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    r = y - X @ b
    dof = max(1, len(y) - X.shape[1])
    cov = np.linalg.pinv(X.T @ X) * (r @ r / dof)
    return b, np.sqrt(np.diag(cov)), float(np.sqrt(r @ r / dof))


def logit(p):
    p = np.clip(np.asarray(p, float), 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def sigm(z):
    return 1 / (1 + np.exp(-np.asarray(z, float)))


def logit_fit(X, y, iters=30, ridge=1e-4):
    """Λογιστική παλινδρόμηση (IRLS)."""
    X, y = np.asarray(X, float), np.asarray(y, float)
    b = np.zeros(X.shape[1])
    for _ in range(iters):
        p = sigm(X @ b)
        W = p * (1 - p) + 1e-9
        H = X.T @ (X * W[:, None]) + ridge * np.eye(len(b))
        step = np.linalg.solve(H, X.T @ (y - p) - ridge * b)
        b += step
        if np.abs(step).max() < 1e-7:
            break
    return b


def bootstrap_ci(pnl, n=2000, q=(5, 95)):
    pnl = np.asarray(pnl, float)
    if len(pnl) < 10:
        return None, None
    idx = RNG.integers(0, len(pnl), (n, len(pnl)))
    m = pnl[idx].mean(1)
    return float(np.percentile(m, q[0])), float(np.percentile(m, q[1]))


# ---------------------------------------------------------------------------
class EdgeModel:
    def __init__(self, comp):
        self.comp = comp
        self.data = CompetitionData(comp)
        self.tg = team_games(self.data)
        self.cur = max(self.data.seasons)
        self.box = bool(self.tg["box"].iloc[0]) if len(self.tg) else False

    # ---------------- 1. walk-forward ratings ----------------
    def upcoming_games(self) -> pd.DataFrame:
        g = self.data.games
        g = g[(g.season == self.cur) & ~g.played].copy()
        g["date"] = pd.to_datetime(g["date"], errors="coerce")
        done = set(zip(self.tg.season, self.tg.gameCode))
        g = g[[(s, c) not in done for s, c in zip(g.season, g.gameCode)]]
        today = pd.Timestamp(TODAY)
        return g[(g.date >= today - pd.Timedelta(days=1)) & (g.date <= today + pd.Timedelta(days=UPCOMING_DAYS))]

    def walk(self, tau, lam, with_upcoming=True) -> pd.DataFrame:
        tg = self.tg
        games = tg[tg.home == 1]
        rows = []
        days = sorted(games.date.unique())
        up = self.upcoming_games() if with_upcoming else pd.DataFrame()
        all_days = sorted(set(days) | set(up.date.unique() if len(up) else []))
        for d in all_days:
            past = tg[tg.date < d]
            if len(past) < min(MIN_PAST, 6 * tg.team.nunique()):
                continue
            m = RidgeRatings(tau, lam).fit(past, asof=d)
            for r in games[games.date == d].itertuples():
                h, a, poss = m.predict(r.team, r.opp)
                rows.append((r.season, r.gameCode, d, r.team, r.opp, 1, h, a, poss, r.PTS, r.OPP))
            if len(up):
                for r in up[up.date == d].itertuples():
                    h, a, poss = m.predict(r.homecode, r.awaycode)
                    rows.append((r.season, int(r.gameCode), d, r.homecode, r.awaycode, 0, h, a, poss, np.nan, np.nan))
        return pd.DataFrame(rows, columns=["season", "gameCode", "date", "home", "away", "played",
                                           "mh", "ma", "poss", "hs", "as_"])

    def tune(self):
        """τ, λ με το καλύτερο Brier στις ΠΡΟΗΓΟΥΜΕΝΕΣ σεζόν (η τρέχουσα δεν χρησιμοποιείται)."""
        best, best_b, res = None, 9, {}
        for tau, lam in GRID:
            w = self.walk(tau, lam, with_upcoming=False)
            w = w[w.season < self.cur]
            if len(w) < 100:
                continue
            mu, act = w.mh - w.ma, w.hs - w.as_
            sd = np.std(act - mu)
            b = float(np.mean((_phi(mu / sd) - (act > 0)) ** 2))
            res[f"{tau}/{lam}"] = round(b, 4)
            if b < best_b:
                best, best_b = (tau, lam), b
        return best or (365, 2.0), res

    # ---------------- απουσίες ----------------
    def absences(self, w: pd.DataFrame) -> pd.DataFrame:
        if not self.box:
            return w.assign(mv_h=0.0, mv_a=0.0, avail_known=False)
        av = availability(self.data)
        av = av.drop_duplicates(["gameCode", "team"])
        w = w.merge(av.rename(columns={"team": "home", "miss_val": "mv_h"})[["gameCode", "home", "mv_h"]],
                    on=["gameCode", "home"], how="left")
        w = w.merge(av.rename(columns={"team": "away", "miss_val": "mv_a"})[["gameCode", "away", "mv_a"]],
                    on=["gameCode", "away"], how="left")
        w["avail_known"] = w.played == 1
        # επερχόμενα: τραυματίες (μόνο NBA από ESPN)
        inj_path = RAW_DIR / f"{self.comp}_injuries.csv"
        self.injuries = []
        if inj_path.exists():
            inj = pd.read_csv(inj_path)
            wgt = dict(zip(inj.pid, inj.weight))
            logs = self.data.logs
            for i, r in w[w.played == 0].iterrows():
                for side, team in (("mv_h", r.home), ("mv_a", r.away)):
                    reg = regulars(logs, team, self.cur, r.date)
                    hit = reg[reg.index.isin(wgt)]
                    w.loc[i, side] = float(sum(hit.value * hit.index.map(wgt)))
                    for pid, x in hit.iterrows():
                        self.injuries.append(dict(gameCode=int(r.gameCode), team=team, player=x.player,
                                                  status=inj.loc[inj.pid == pid, "status"].iloc[0], value=round(x.value, 1)))
                w.loc[i, "avail_known"] = True
        return w.fillna({"mv_h": 0.0, "mv_a": 0.0})

    # ---------------- online βαθμονόμηση ----------------
    def calibrate(self, w: pd.DataFrame) -> pd.DataFrame:
        w = w.sort_values(["date", "gameCode"]).reset_index(drop=True)
        w["mu"], w["mt"] = w.mh - w.ma, w.mh + w.ma
        w["dmiss"] = w.mv_a - w.mv_h
        out = {k: np.full(len(w), np.nan) for k in ["mu_c", "tot_c", "sd_m", "sd_t"]}
        played = w.played == 1
        act, tot = (w.hs - w.as_).to_numpy(), (w.hs + w.as_).to_numpy()
        self.coef = None
        for d in w.date.unique():
            tr = played & (w.date < d)
            idx = np.where(w.date == d)[0]
            n = tr.sum()
            if n >= MIN_CALIB:
                b, se, sd_m = ols(np.c_[np.ones(n), w.mu[tr], w.dmiss[tr]], act[tr])
                bt, _, sd_t = ols(np.c_[np.ones(n), w.mt[tr]], tot[tr])
                self.coef = dict(a=b[0], b=b[1], c=b[2], c_se=se[2], sd_m=sd_m, at=bt[0], bt=bt[1], sd_t=sd_t, n=int(n))
            else:
                sd_m = float(np.std(act[tr] - w.mu[tr])) if n >= 30 else 12.0
                sd_t = float(np.std(tot[tr] - w.mt[tr])) if n >= 30 else 16.0
                b, bt = np.array([0.0, 1.0, 0.2]), np.array([0.0, 1.0])
            out["mu_c"][idx] = b[0] + b[1] * w.mu.iloc[idx] + b[2] * w.dmiss.iloc[idx]
            out["tot_c"][idx] = bt[0] + bt[1] * w.mt.iloc[idx]
            out["sd_m"][idx], out["sd_t"][idx] = sd_m, sd_t
        for k, v in out.items():
            w[k] = v
        # πιθανότητα νίκης: λογιστική βαθμονόμηση πάνω στο z = μ/σ (οι ουρές της κανονικής υπερεκτιμούν τα αουτσάιντερ)
        z = (w.mu_c / w.sd_m).to_numpy()
        y = (act > 0).astype(float)
        p = _phi(z)
        for d in w.date.unique():
            tr = (played & (w.date < d)).to_numpy()
            if tr.sum() >= MIN_CALIB:
                idx = np.where(w.date == d)[0]
                bl = logit_fit(np.c_[np.ones(tr.sum()), z[tr]], y[tr])
                p[idx] = sigm(bl[0] + bl[1] * z[idx])
                self.logit_coef = bl
        w["p_home"] = p
        return w

    # ---------------- αποδόσεις ----------------
    def odds(self) -> pd.DataFrame:
        frames = []
        for s in self.data.seasons:
            p = RAW_DIR / f"{self.comp}{s}_odds.csv"
            if p.exists():
                o = pd.read_csv(p)
                o["season"] = s
                frames.append(o)
        if not frames:
            return pd.DataFrame()
        o = pd.concat(frames, ignore_index=True)
        # ανά (αγώνα, πάροχο): κλείσιμο αν υπάρχει, αλλιώς το πιο πρόσφατο στιγμιότυπο
        o["rank"] = (o.kind == "close").astype(int)
        o = o.sort_values(["rank", "fetched_at"]).drop_duplicates(["season", "gameCode", "provider"], keep="last")
        g = o.groupby(["season", "gameCode"])
        p_ml = devig(o.ml_home, o.ml_away)
        o["p_mkt_ml"] = p_ml
        agg = pd.DataFrame({
            "n_books": g.size(),
            "kind": g.kind.agg(lambda k: "close" if (k == "close").any() else "current"),
            "p_mkt": g.p_mkt_ml.mean(),                           # συναίνεση (χωρίς γκανιότα)
            "ml_home": g.ml_home.max(), "ml_away": g.ml_away.max(),  # καλύτερη τιμή
            "spread": g.spread.median(), "total": g.total.median(),
            "spread_home_odds": g.spread_home_odds.max(), "spread_away_odds": g.spread_away_odds.max(),
            "over_odds": g.over_odds.max(), "under_odds": g.under_odds.max(),
            "fetched_at": g.fetched_at.max(),
        }).reset_index()
        return agg

    # ---------------- 2. αξιολόγηση απέναντι στην αγορά ----------------
    def market_eval(self, w: pd.DataFrame, od: pd.DataFrame):
        x = w[w.played == 1].merge(od, on=["season", "gameCode"])
        x = x[x.p_mkt.notna()].sort_values(["date", "gameCode"]).reset_index(drop=True)
        if len(x) < 50:
            return None, x
        act, tot = (x.hs - x.as_).to_numpy(), (x.hs + x.as_).to_numpy()
        y = (act > 0).astype(float)
        # περιθώριο της αγοράς: -handicap, αλλιώς από την πιθανότητα moneyline
        x["m_mkt"] = np.where(x.spread.notna(), -x.spread, x.sd_m * _phinv(x.p_mkt))
        has_tot = x.total.notna().to_numpy()
        # συντελεστής «πληροφορία πέρα από την αγορά» (όλο το δείγμα)
        b, se, _ = ols(np.c_[np.ones(len(x)), x.m_mkt, x.mu_c], act)
        info = {"margin": {"gamma": _r(b[2], 3), "se": _r(se[2], 3), "beta_mkt": _r(b[1], 3), "n": int(len(x))}}
        if has_tot.sum() >= 50:
            bt, set_, _ = ols(np.c_[np.ones(has_tot.sum()), x.total[has_tot], x.tot_c[has_tot]], tot[has_tot])
            info["total"] = {"gamma": _r(bt[2], 3), "se": _r(set_[2], 3), "beta_mkt": _r(bt[1], 3), "n": int(has_tot.sum())}
        # online συνδυασμός αγοράς + μοντέλου (μόνο με προηγούμενους αγώνες)
        mb, sb, tb, stb = (np.full(len(x), np.nan) for _ in range(4))
        for d in x.date.unique():
            tr = (x.date < d).to_numpy()
            idx = np.where(x.date == d)[0]
            if tr.sum() >= MIN_BLEND:
                b2, _, s2 = ols(np.c_[np.ones(tr.sum()), x.m_mkt[tr], x.mu_c[tr]], act[tr])
                mb[idx] = b2[0] + b2[1] * x.m_mkt.iloc[idx] + b2[2] * x.mu_c.iloc[idx]
                sb[idx] = s2
                tt = tr & has_tot
                if tt.sum() >= MIN_BLEND:
                    b3, _, s3 = ols(np.c_[np.ones(tt.sum()), x.total[tt], x.tot_c[tt]], tot[tt])
                    tb[idx] = b3[0] + b3[1] * x.total.iloc[idx] + b3[2] * x.tot_c.iloc[idx]
                    stb[idx] = s3
        x["mu_b"], x["sd_b"], x["tot_b"], x["sd_tb"] = mb, sb, tb, stb
        # νικητής: λογιστικός συνδυασμός logit(αγορά) + logit(μοντέλο), online
        pb = np.full(len(x), np.nan)
        lm, lmod = logit(x.p_mkt), logit(x.p_home)
        for d in x.date.unique():
            tr = (x.date < d).to_numpy()
            if tr.sum() >= MIN_BLEND:
                idx = np.where(x.date == d)[0]
                bl = logit_fit(np.c_[np.ones(tr.sum()), lm[tr], lmod[tr]], y[tr])
                pb[idx] = sigm(bl[0] + bl[1] * lm[idx] + bl[2] * lmod[idx])
        bl_all = logit_fit(np.c_[np.ones(len(x)), lm, lmod], y)
        self.ml_blend = bl_all
        # τυπικό σφάλμα του συντελεστή του μοντέλου (λογιστική, από τον πίνακα πληροφορίας)
        Xl = np.c_[np.ones(len(x)), lm, lmod]
        pp = sigm(Xl @ bl_all)
        cov = np.linalg.inv(Xl.T @ (Xl * (pp * (1 - pp))[:, None]))
        info["ml"] = {"gamma": _r(bl_all[2], 3), "se": _r(math.sqrt(cov[2, 2]), 3), "beta_mkt": _r(bl_all[1], 3), "n": int(len(x))}

        # σύγκριση πιθανοτήτων νίκης
        ll = lambda p, yy: float(-np.mean(yy * np.log(np.clip(p, 1e-4, 1 - 1e-4)) + (1 - yy) * np.log(np.clip(1 - p, 1e-4, 1 - 1e-4))))  # noqa: E731
        ok = ~np.isnan(pb)
        cmp = {"n": int(len(x)),
               "model": {"brier": _r(np.mean((x.p_home - y) ** 2), 4), "logloss": _r(ll(x.p_home, y), 4),
                         "mae_margin": _r(np.mean(np.abs(act - x.mu_c)), 2)},
               "market": {"brier": _r(np.mean((x.p_mkt - y) ** 2), 4), "logloss": _r(ll(x.p_mkt, y), 4),
                          "mae_margin": _r(np.mean(np.abs(act - x.m_mkt)), 2)},
               "blend": {"n": int(ok.sum()), "brier": _r(np.mean((pb[ok] - y[ok]) ** 2), 4) if ok.any() else None,
                         "market_brier_same": _r(np.mean((x.p_mkt[ok] - y[ok]) ** 2), 4) if ok.any() else None}}
        if has_tot.any():
            cmp["model"]["mae_total"] = _r(np.mean(np.abs(tot[has_tot] - x.tot_c[has_tot])), 2)
            cmp["market"]["mae_total"] = _r(np.mean(np.abs(tot[has_tot] - x.total[has_tot])), 2)
        # βαθμονόμηση αγοράς
        calib = []
        for lo in np.arange(0, 1, 0.1):
            m = (x.p_mkt >= lo) & (x.p_mkt < lo + 0.1 + (1e-9 if lo >= 0.9 else 0))
            if m.sum():
                calib.append({"lo": _r(lo, 1), "n": int(m.sum()), "pred": _r(x.p_mkt[m].mean(), 3), "obs": _r(y[m].mean(), 3)})
        cmp["market_calibration"] = calib

        # backtest στοιχήματος
        bets = self._bets(x, pb, x.mu_b, x.sd_b, x.tot_b, x.sd_tb)
        naive = self._bets(x, x.p_home, x.mu_c, x.sd_m, x.tot_c, x.sd_t)       # μόνο μοντέλο, χωρίς την αγορά
        roi = []
        for market in ["ml", "spread", "total"]:
            for thr in THRESHOLDS:
                for name, B in (("blend", bets), ("model", naive)):
                    b_ = B[(B.market == market) & (B.ev >= thr)]
                    lo, hi = bootstrap_ci(b_.pnl)
                    roi.append({"src": name, "market": market, "thr": thr, "n": int(len(b_)),
                                "roi": _r(b_.pnl.mean(), 4) if len(b_) else None, "lo": _r(lo, 4), "hi": _r(hi, 4),
                                "hit": _r((b_.pnl > 0).mean(), 3) if len(b_) else None})
        # ετυμηγορία ανά αγορά
        verdict = {}
        for market in ["ml", "spread", "total"]:
            key = {"ml": "ml", "spread": "margin", "total": "total"}[market]
            g = info.get(key, {})
            gamma_sig = g.get("gamma") is not None and g["gamma"] - 1.96 * g["se"] > 0
            r = next((q for q in roi if q["src"] == "blend" and q["market"] == market and q["thr"] == EV_MIN), {})
            roi_sig = r.get("n", 0) >= 100 and r.get("lo") is not None and r["lo"] > 0
            verdict[market] = {"edge": bool(gamma_sig and roi_sig), "gamma_sig": bool(gamma_sig), "roi_sig": bool(roi_sig),
                               "n": r.get("n", 0), "roi": r.get("roi")}
        self.blend_ready = bool(np.isfinite(mb).any())
        return {"info": info, "compare": cmp, "roi": roi, "verdict": verdict,
                "seasons": sorted(int(s) for s in x.season.unique())}, x

    @staticmethod
    def _sides(p_home, mu, sd, tot, sd_t, row):
        """Πιθανότητες για κάθε πλευρά κάθε αγοράς + αποδόσεις."""
        out = []
        if pd.notna(row.ml_home) and pd.notna(p_home):
            out += [("ml", "home", p_home, row.ml_home), ("ml", "away", 1 - p_home, row.ml_away)]
        if pd.notna(row.spread) and pd.notna(mu) and pd.notna(sd):
            pc = float(_phi((mu + row.spread) / sd))
            out += [("spread", "home", pc, row.spread_home_odds), ("spread", "away", 1 - pc, row.spread_away_odds)]
        if pd.notna(row.total) and pd.notna(tot) and pd.notna(sd_t):
            po = float(1 - _phi((row.total - tot) / sd_t))
            out += [("total", "over", po, row.over_odds), ("total", "under", 1 - po, row.under_odds)]
        return out

    def _bets(self, x, p_home, mu, sd, tot, sd_t) -> pd.DataFrame:
        rows = []
        p_home, mu, sd, tot, sd_t = (np.asarray(v, float) for v in (p_home, mu, sd, tot, sd_t))
        for i, r in enumerate(x.itertuples()):
            if np.isnan(p_home[i]):
                continue
            sides = self._sides(p_home[i], mu[i], sd[i], tot[i], sd_t[i], r)
            act, total = r.hs - r.as_, r.hs + r.as_
            for market in ("ml", "spread", "total"):
                cand = [s for s in sides if s[0] == market and pd.notna(s[3]) and pd.notna(s[2])]
                if not cand:
                    continue
                m, side, p, odds = max(cand, key=lambda s: s[2] * s[3])
                ev = p * odds - 1
                if market == "ml":
                    won = (act > 0) if side == "home" else (act < 0)
                    push = False
                elif market == "spread":
                    c = act + r.spread
                    won, push = ((c > 0) if side == "home" else (c < 0)), c == 0
                else:
                    won, push = ((total > r.total) if side == "over" else (total < r.total)), total == r.total
                pnl = 0.0 if push else (odds - 1 if won else -1.0)
                rows.append((r.gameCode, market, side, p, odds, ev, pnl))
        return pd.DataFrame(rows, columns=["gameCode", "market", "side", "p", "odds", "ev", "pnl"])

    # ---------------- 3. επερχόμενα ----------------
    def upcoming(self, w, od, mkt, x_hist):
        up = w[w.played == 0].copy()
        if up.empty:
            return []
        if len(od):
            up = up.merge(od, on=["season", "gameCode"], how="left")
        for c in ["ml_home", "ml_away", "spread", "total", "spread_home_odds", "spread_away_odds", "over_odds",
                  "under_odds", "p_mkt", "n_books"]:
            if c not in up:
                up[c] = np.nan
        # συνδυασμός με την αγορά όπου έχει εκπαιδευτεί (ίδιοι συντελεστές με το backtest, όλο το ιστορικό)
        blend = None
        if mkt is not None and len(x_hist) >= MIN_BLEND:
            act = (x_hist.hs - x_hist.as_).to_numpy()
            b, _, s = ols(np.c_[np.ones(len(x_hist)), x_hist.m_mkt, x_hist.mu_c], act)
            ht = x_hist.total.notna().to_numpy()
            bt, _, st = ols(np.c_[np.ones(ht.sum()), x_hist.total[ht], x_hist.tot_c[ht]], (x_hist.hs + x_hist.as_)[ht]) \
                if ht.sum() >= MIN_BLEND else (None, None, None)
            blend = (b, s, bt, st)
        verdict = (mkt or {}).get("verdict", {})
        rows = []
        for r in up.sort_values(["date", "gameCode"]).itertuples():
            mu, sd, tot, sdt, p = r.mu_c, r.sd_m, r.tot_c, r.sd_t, r.p_home
            src = "model"
            if blend is not None and pd.notna(r.p_mkt):
                m_mkt = -r.spread if pd.notna(r.spread) else sd * float(_phinv(r.p_mkt))
                b, s, bt, st = blend
                mu, sd, src = b[0] + b[1] * m_mkt + b[2] * r.mu_c, s, "blend"
                bl = self.ml_blend
                p = float(sigm(bl[0] + bl[1] * logit(r.p_mkt) + bl[2] * logit(r.p_home)))
                if bt is not None and pd.notna(r.total):
                    tot, sdt = bt[0] + bt[1] * r.total + bt[2] * r.tot_c, st
            sides = self._sides(p, mu, sd, tot, sdt, r)
            best = {}
            for market in ("ml", "spread", "total"):
                cand = [s_ for s_ in sides if s_[0] == market and pd.notna(s_[3])]
                if cand:
                    m_, side, pp, odds = max(cand, key=lambda s_: s_[2] * s_[3])
                    ev = pp * odds - 1
                    rec = bool(verdict.get(market, {}).get("edge")) and ev >= EV_MIN
                    kelly = max(0.0, (pp * odds - 1) / (odds - 1)) if odds > 1 else 0.0
                    best[market] = {"side": side, "p": _r(pp, 3), "odds": _r(odds, 2), "ev": _r(ev, 3), "rec": rec,
                                    "stake": _r(min(STAKE_CAP, KELLY_FRAC * kelly), 4) if rec else 0}
            rows.append({
                "gameCode": int(r.gameCode), "date": pd.Timestamp(r.date).strftime("%Y-%m-%d"), "home": r.home, "away": r.away,
                "src": src, "p_home": _r(p, 3), "fair_home": _r(1 / max(p, 1e-3), 2), "fair_away": _r(1 / max(1 - p, 1e-3), 2),
                "line": _r(-mu, 1), "total": _r(tot, 1), "sd_m": _r(sd, 1), "sd_t": _r(sdt, 1),
                "mv_h": _r(r.mv_h, 1), "mv_a": _r(r.mv_a, 1),
                "mkt": None if pd.isna(r.p_mkt) else {"p": _r(r.p_mkt, 3), "ml_home": _r(r.ml_home, 2), "ml_away": _r(r.ml_away, 2),
                                                      "spread": _r(r.spread, 1), "total": _r(r.total, 1),
                                                      "books": int(r.n_books) if pd.notna(r.n_books) else None},
                "best": best,
            })
        return rows

    # ---------------- 4. αρχείο + ζωντανή αξιολόγηση ----------------
    def archive(self, rows, od):
        path = PRED_DIR / f"{self.comp}_edge.csv"
        old = pd.read_csv(path) if path.exists() else pd.DataFrame()
        new = pd.DataFrame([{
            "made_at": TODAY, "season": self.cur, "gameCode": r["gameCode"], "date": r["date"], "home": r["home"],
            "away": r["away"], "p_home": r["p_home"], "line": r["line"], "total": r["total"], "src": r["src"],
            "mkt_p": (r["mkt"] or {}).get("p"), "mkt_spread": (r["mkt"] or {}).get("spread"),
            "mkt_total": (r["mkt"] or {}).get("total"),
            **{f"{m}_{k}": (r["best"].get(m) or {}).get(k) for m in ("ml", "spread", "total") for k in ("side", "odds", "ev", "rec")},
        } for r in rows])
        log = pd.concat([old, new], ignore_index=True) if len(old) else new
        if not len(log):
            return {"n": 0}
        log = _keep_pregame(log, ["season", "gameCode"])
        PRED_DIR.mkdir(parents=True, exist_ok=True)
        log.to_csv(path, index=False)
        # αποτελέσματα
        res = self.tg[self.tg.home == 1][["season", "gameCode", "PTS", "OPP"]].rename(columns={"PTS": "hs", "OPP": "as_"})
        m = log.merge(res, on=["season", "gameCode"])
        if m.empty:
            return {"n": 0, "archived": int(len(log))}
        y = (m.hs > m.as_).astype(float)
        out = {"n": int(len(m)), "archived": int(len(log)),
               "brier_model": _r(np.mean((m.p_home - y) ** 2), 4)}
        mm = m[m.mkt_p.notna()]
        if len(mm):
            yy = (mm.hs > mm.as_).astype(float)
            out.update(n_mkt=int(len(mm)), brier_model_same=_r(np.mean((mm.p_home - yy) ** 2), 4),
                       brier_market=_r(np.mean((mm.mkt_p - yy) ** 2), 4))
        # CLV: κίνηση του handicap από τη στιγμή της πρόβλεψης ως το κλείσιμο, προς τη μεριά του μοντέλου
        if len(od) and "mkt_spread" in m:
            cl = od[od.kind == "close"][["season", "gameCode", "spread"]].rename(columns={"spread": "close_spread"})
            c = m.merge(cl, on=["season", "gameCode"])
            c = c[c.mkt_spread.notna() & c.close_spread.notna()]
            if len(c):
                lean = np.sign(-c.line - (-c.mkt_spread))          # >0: μοντέλο πιο θετικό για γηπεδούχο
                clv = lean * (c.mkt_spread - c.close_spread)       # η γραμμή κινήθηκε προς τον γηπεδούχο -> spread μικραίνει
                out.update(clv_n=int(len(c)), clv_mean=_r(clv.mean(), 3), clv_pos=_r((clv > 0).mean(), 3))
        # ROI των συστάσεων
        for mk in ("ml", "spread", "total"):
            col = f"{mk}_rec"
            if col in m:
                rec = m[m[col].astype(str).str.lower() == "true"]
                out[f"rec_{mk}"] = int(len(rec))
        return out

    # ---------------- run ----------------
    def run(self):
        print(f"== {COMPETITIONS[self.comp]}")
        (tau, lam), grid = self.tune()
        w = self.walk(tau, lam)
        w = self.absences(w)
        w = self.calibrate(w)
        print(f"   tau {tau} lam {lam} | games {int((w.played == 1).sum())} | upcoming {int((w.played == 0).sum())}"
              f" | calib {self.coef and {k: round(float(v), 3) for k, v in self.coef.items()}}")

        # μοντέλο vs Monte Carlo (ίδια ματς, τρέχουσα και όλες οι σεζόν)
        mc = GameSimulator(self.data).backtest()[["season", "gameCode", "mh", "ma", "p"]].rename(
            columns={"mh": "mh_mc", "ma": "ma_mc", "p": "p_mc"})
        pl = w[w.played == 1]
        both = pl.merge(mc, on=["season", "gameCode"])
        sh = np.sqrt(both.sd_t ** 2 + both.sd_m ** 2) / 2

        def sc(df, mh, ma, p, s=None):
            d = pd.DataFrame({"mh": mh, "ma": ma, "p": p, "hs": df.hs, "as_": df.as_})
            if s is not None:
                d["sh"], d["sa"] = s, s
            return score(d)
        model_eval = {}
        for name, sub in (("all", both), ("current", both[both.season == self.cur])):
            if len(sub):
                s_ = sh.loc[sub.index]
                mh_c = (sub.tot_c + sub.mu_c) / 2
                ma_c = (sub.tot_c - sub.mu_c) / 2
                model_eval[name] = {"ratings": sc(sub, mh_c, ma_c, sub.p_home, s_),
                                    "mc": sc(sub, sub.mh_mc, sub.ma_mc, sub.p_mc)}
        if "all" in model_eval:
            print(f"   ratings vs MC (all {model_eval['all']['ratings']['n']}): brier "
                  f"{model_eval['all']['ratings']['brier']} vs {model_eval['all']['mc']['brier']}")

        od = self.odds()
        mkt, x_hist = (None, pd.DataFrame())
        if len(od):
            mkt, x_hist = self.market_eval(w, od)
            if mkt:
                c = mkt["compare"]
                print(f"   vs market ({c['n']}): brier model {c['model']['brier']} market {c['market']['brier']}"
                      f" | gamma margin {mkt['info']['margin']} | verdict "
                      f"{ {k: v['edge'] for k, v in mkt['verdict'].items()} }")
        up = self.upcoming(w, od, mkt, x_hist)
        live = self.archive(up, od)

        out = {
            "comp": self.comp, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "params": {"tau": tau, "lam": lam, "grid": grid, "ev_min": EV_MIN, "kelly": KELLY_FRAC, "cap": STAKE_CAP,
                       "calib": self.coef and {k: _r(v, 3) for k, v in self.coef.items()}},
            "has_injuries": (RAW_DIR / f"{self.comp}_injuries.csv").exists(),
            "injuries": getattr(self, "injuries", []),
            "model_eval": model_eval, "market": mkt, "upcoming": up, "live": live,
        }
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        (SITE_DATA / f"edge_{self.comp}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=str))
        print(f"   -> edge_{self.comp}.json ({len(up)} upcoming, odds for {sum(1 for r in up if r['mkt'])})")


def main():
    for c in COMPS:
        try:
            EdgeModel(c).run()
        except (FileNotFoundError, ValueError) as e:
            print(f"  ! {c}: {e}")


if __name__ == "__main__":
    main()
