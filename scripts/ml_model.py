"""
Μοντέλο «δεύτερου επιπέδου»: το Monte Carlo + ratings + πρόγραμμα + αγορά -> πιθανότητα νίκης, διαφορά, σύνολο.
Το ποσό του στοιχήματος ΔΕΝ μαθαίνεται: βγαίνει από το Kelly με την πιθανότητα του μοντέλου (κανόνες σελίδας «Αξία»).

Δεδομένα: data/ml/feat_<λίγκα><σεζόν>.csv (scripts/ml_features.js, Monte Carlo walk-forward ανά σεζόν)
          + data/raw/<λίγκα><σεζόν>_closing.csv (αποδόσεις κλεισίματος, betexplorer)
Χωρισμός στον χρόνο: εκπαίδευση 2023–2024 · επιλογή (early stopping, λ) 2025 · ΚΡΙΣΗ 2026 (φετινή, ανέγγιχτη).

Μοντέλα νίκης:  αγορά (χωρίς περιθώριο) · Monte Carlo (βαθμονομημένο) · λογιστική παλινδρόμηση (όλα + αγορά)
                · νευρωνικό δίκτυο (numpy: d → 16 → 8 → 1, ReLU, σιγμοειδής, L2, Adam, early stopping, 5 seeds)
                · νευρωνικό χωρίς την αγορά
Το κρίσιμο τεστ: όταν το μοντέλο ξέρει την αγορά, προσθέτει κάτι το Monte Carlo; (συντελεστής, log-loss στο 2026)

    python scripts/ml_model.py        # -> site/ml.json
"""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression, Ridge

ROOT = Path(__file__).resolve().parents[1]
ML = ROOT / "data" / "ml"
RAW = ROOT / "data" / "raw"
TRAIN, VALID, TEST = [2023, 2024], [2025], [2026]
LEAGUES = ["GBL", "E", "U"]
logit = lambda p: np.log(np.clip(p, 1e-4, 1 - 1e-4) / (1 - np.clip(p, 1e-4, 1 - 1e-4)))
sigm = lambda z: 1 / (1 + np.exp(-z))

# ---------------------------------------------------------------- δεδομένα
F = []
for f in sorted(ML.glob("feat_*.csv")):
    d = pd.read_csv(f)
    if not len(d):
        continue
    comp, season = d["comp"].iloc[0], int(d["season"].iloc[0])
    c = RAW / f"{comp}{season}_closing.csv"
    if c.exists():
        o = pd.read_csv(c)[["gameCode", "odds_home", "odds_away"]].rename(columns={"gameCode": "code"})
        d = d.merge(o, on="code", how="left")
    else:
        d["odds_home"] = np.nan; d["odds_away"] = np.nan
    F.append(d)
D = pd.concat(F, ignore_index=True)
D["split"] = np.where(D.season.isin(TRAIN), "train", np.where(D.season.isin(VALID), "valid", "test"))
q1, q2 = 1 / D.odds_home, 1 / D.odds_away
D["mkt_p"] = q1 / (q1 + q2)
D["has_odds"] = D.mkt_p.notna()
D["sim_logit"] = logit(D.sim_p)
D["mkt_logit"] = logit(D.mkt_p.fillna(0.5))
D["rest_diff"] = D.rest_home - D.rest_away
D["gp_min"] = np.minimum(D.gp_home, D.gp_away)
for L in LEAGUES:
    D[f"is_{L}"] = (D.comp == L).astype(float)

FEATS = [  # (στήλη, περιγραφή)
    ("sim_logit", "Monte Carlo: πιθανότητα νίκης γηπεδούχου (log-odds)"), ("sim_margin", "Monte Carlo: μέση διαφορά"),
    ("sim_margin_sd", "Monte Carlo: διασπορά διαφοράς"), ("sim_total", "Monte Carlo: μέσο σύνολο"), ("sim_total_sd", "Monte Carlo: διασπορά συνόλου"),
    ("r_margin", "Ratings: αναμενόμενη διαφορά"), ("r_total", "Ratings: αναμενόμενο σύνολο"), ("r_net_home", "Rating γηπεδούχου"), ("r_net_away", "Rating φιλοξενούμενου"),
    ("pace", "Ρυθμός (κατοχές)"), ("rest_diff", "Διαφορά ημερών ξεκούρασης"), ("g14_home", "Αγώνες γηπεδούχου τις 14 τελευταίες ημέρες"),
    ("g14_away", "Αγώνες φιλοξενούμενου τις 14 τελευταίες ημέρες"), ("gp_min", "Αγώνες στη σεζόν (ο μικρότερος των δύο)"),
    ("is_E", "EuroLeague"), ("is_U", "EuroCup"), ("is_GBL", "GBL"),
]
MKT = ("mkt_logit", "Αγορά: πιθανότητα από τις αποδόσεις κλεισίματος (log-odds, χωρίς περιθώριο)")
cols_all = [c for c, _ in FEATS] + [MKT[0]]
cols_nomkt = [c for c, _ in FEATS]
tr, va, te = (D.split == "train"), (D.split == "valid"), (D.split == "test")
mu = D.loc[tr, cols_all].mean(); sd = D.loc[tr, cols_all].std().replace(0, 1)
Z = lambda m, cols: ((D.loc[m, cols] - mu[cols]) / sd[cols]).to_numpy(float)
y = D.y.to_numpy(float)
odd = D.has_odds
print(f"αγώνες: εκπαίδευση {tr.sum()} ({(tr & odd).sum()} με αποδόσεις) · επιλογή {va.sum()} ({(va & odd).sum()}) · κρίση {te.sum()} ({(te & odd).sum()})")


def metrics(p, yy):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return {"n": int(len(yy)), "logloss": round(float(-np.mean(yy * np.log(p) + (1 - yy) * np.log(1 - p))), 4),
            "brier": round(float(np.mean((p - yy) ** 2)), 4), "acc": round(float(np.mean((p >= 0.5) == (yy == 1))), 4)}


def calib(p, yy, bins=8):
    e = np.linspace(0, 1, bins + 1); out = []
    for a, b in zip(e[:-1], e[1:]):
        m = (p >= a) & (p < b if b < 1 else p <= b)
        if m.sum() >= 3:
            out.append([round(float(p[m].mean()), 3), round(float(yy[m].mean()), 3), int(m.sum())])
    return out


# ---------------------------------------------------------------- νευρωνικό δίκτυο (numpy)
class MLP:
    """d → 16 → 8 → 1 · ReLU · σιγμοειδής · cross-entropy + L2 · Adam · early stopping στην επιλογή."""

    def __init__(self, sizes, seed, l2=1e-3, lr=0.01):
        r = np.random.default_rng(seed)
        self.W = [r.normal(0, math.sqrt(2 / a), (a, b)) for a, b in zip(sizes[:-1], sizes[1:])]
        self.b = [np.zeros(b) for b in sizes[1:]]
        self.l2, self.lr, self.sizes = l2, lr, sizes
        self.m = [np.zeros_like(w) for w in self.W + self.b]; self.v = [np.zeros_like(w) for w in self.W + self.b]; self.t = 0

    def forward(self, X):
        A = [X]
        for i, (W, b) in enumerate(zip(self.W, self.b)):
            z = A[-1] @ W + b
            A.append(np.maximum(z, 0) if i < len(self.W) - 1 else sigm(z))
        return A

    def loss(self, X, yy):
        p = np.clip(self.forward(X)[-1][:, 0], 1e-6, 1 - 1e-6)
        return float(-np.mean(yy * np.log(p) + (1 - yy) * np.log(1 - p)))

    def step(self, X, yy):
        A = self.forward(X); n = len(yy)
        d = (A[-1][:, 0] - yy)[:, None] / n
        gW, gb = [None] * len(self.W), [None] * len(self.b)
        for i in reversed(range(len(self.W))):
            gW[i] = A[i].T @ d + 2 * self.l2 * self.W[i]; gb[i] = d.sum(0)
            if i:
                d = (d @ self.W[i].T) * (A[i] > 0)
        self.t += 1
        for k, (p, g) in enumerate(zip(self.W + self.b, gW + gb)):
            self.m[k] = 0.9 * self.m[k] + 0.1 * g; self.v[k] = 0.999 * self.v[k] + 0.001 * g * g
            p -= self.lr * (self.m[k] / (1 - 0.9 ** self.t)) / (np.sqrt(self.v[k] / (1 - 0.999 ** self.t)) + 1e-8)

    def predict(self, X):
        return self.forward(X)[-1][:, 0]


def train_mlp(Xtr, ytr, Xva, yva, seeds=5, epochs=600, l2=1e-3):
    nets, curves = [], []
    for s in range(seeds):
        net = MLP([Xtr.shape[1], 16, 8, 1], seed=s, l2=l2)
        best, bestW, curve, wait = 9, None, [], 0
        for ep in range(epochs):
            net.step(Xtr, ytr)
            lt, lv = net.loss(Xtr, ytr), net.loss(Xva, yva)
            curve.append([round(lt, 4), round(lv, 4)])
            if lv < best - 1e-5:
                best, bestW, wait = lv, ([w.copy() for w in net.W], [b.copy() for b in net.b], ep), 0
            else:
                wait += 1
                if wait > 60:
                    break
        net.W, net.b = bestW[0], bestW[1]; net.best_epoch = bestW[2]
        nets.append(net); curves.append(curve)
    return nets, curves


ens = lambda nets, X: np.mean([n.predict(X) for n in nets], axis=0)

# ---------------------------------------------------------------- μοντέλα νίκης (αγώνες με αποδόσεις)
m_tr, m_va, m_te = tr & odd, va & odd, te & odd
ytr, yva, yte = y[m_tr], y[m_va], y[m_te]
res = {}
res["market"] = D.loc[m_te, "mkt_p"].to_numpy()
cal = LogisticRegression(C=1e6).fit(D.loc[m_tr | m_va, ["sim_logit"]], y[m_tr | m_va])     # Monte Carlo με βαθμονόμηση κλίμακας
res["sim"] = cal.predict_proba(D.loc[m_te, ["sim_logit"]])[:, 1]
res["sim_raw"] = D.loc[m_te, "sim_p"].to_numpy()
# λογιστική: λ από την επιλογή
best = None
for C in [0.01, 0.03, 0.1, 0.3, 1, 3]:
    lr = LogisticRegression(C=C, max_iter=2000).fit(Z(m_tr, cols_all), ytr)
    ll = metrics(lr.predict_proba(Z(m_va, cols_all))[:, 1], yva)["logloss"]
    if not best or ll < best[0]:
        best = (ll, C)
LR = LogisticRegression(C=best[1], max_iter=2000).fit(np.vstack([Z(m_tr, cols_all), Z(m_va, cols_all)]), np.r_[ytr, yva])
res["logistic"] = LR.predict_proba(Z(m_te, cols_all))[:, 1]
# συντελεστές με bootstrap (εκπαίδευση + επιλογή)
Xb, yb = np.vstack([Z(m_tr, cols_all), Z(m_va, cols_all)]), np.r_[ytr, yva]
rng = np.random.default_rng(0); boots = []
for _ in range(300):
    i = rng.integers(0, len(yb), len(yb))
    boots.append(LogisticRegression(C=best[1], max_iter=2000).fit(Xb[i], yb[i]).coef_[0])
boots = np.array(boots)
coef = [{"feat": c, "label": dict(FEATS + [MKT])[c], "coef": round(float(LR.coef_[0][k]), 4), "lo": round(float(np.percentile(boots[:, k], 2.5)), 4),
         "hi": round(float(np.percentile(boots[:, k], 97.5)), 4)} for k, c in enumerate(cols_all)]
# το κρίσιμο τεστ: αγορά + Monte Carlo μόνο (δύο συντελεστές)
two = LogisticRegression(C=1e6).fit(D.loc[m_tr | m_va, ["mkt_logit", "sim_logit"]], y[m_tr | m_va])
bt = []
X2, y2 = D.loc[m_tr | m_va, ["mkt_logit", "sim_logit"]].to_numpy(), y[m_tr | m_va]
for _ in range(500):
    i = rng.integers(0, len(y2), len(y2)); bt.append(LogisticRegression(C=1e6).fit(X2[i], y2[i]).coef_[0])
bt = np.array(bt)
res["market+sim"] = two.predict_proba(D.loc[m_te, ["mkt_logit", "sim_logit"]])[:, 1]
two_test = {"coef_market": round(float(two.coef_[0][0]), 3), "coef_sim": round(float(two.coef_[0][1]), 3),
            "sim_ci": [round(float(np.percentile(bt[:, 1], 2.5)), 3), round(float(np.percentile(bt[:, 1], 97.5)), 3)],
            "market_ci": [round(float(np.percentile(bt[:, 0], 2.5)), 3), round(float(np.percentile(bt[:, 0], 97.5)), 3)]}
print("αγορά + Monte Carlo:", two_test)
# νευρωνικά
nets, curves = train_mlp(Z(m_tr, cols_all), ytr, Z(m_va, cols_all), yva)
res["mlp"] = ens(nets, Z(m_te, cols_all))
nets0, curves0 = train_mlp(Z(m_tr, cols_nomkt), ytr, Z(m_va, cols_nomkt), yva)
res["mlp_nomkt"] = ens(nets0, Z(m_te, cols_nomkt))

NAMES = {"market": "Αγορά (αποδόσεις κλεισίματος)", "sim_raw": "Monte Carlo (όπως είναι)", "sim": "Monte Carlo (βαθμονομημένο)",
         "market+sim": "Αγορά + Monte Carlo (2 συντελεστές)", "logistic": "Λογιστική παλινδρόμηση (όλα + αγορά)",
         "mlp": "Νευρωνικό δίκτυο (όλα + αγορά)", "mlp_nomkt": "Νευρωνικό δίκτυο (χωρίς αγορά)"}
table = {k: {"name": NAMES[k], **metrics(v, yte), "calib": calib(v, yte)} for k, v in res.items()}
by_league = {k: {L: metrics(v[(D.loc[m_te, "comp"] == L).to_numpy()], yte[(D.loc[m_te, "comp"] == L).to_numpy()]) for L in LEAGUES} for k, v in res.items()}
for k, v in table.items():
    print(f"  {v['name']:42s} log-loss {v['logloss']:.4f} Brier {v['brier']:.4f} σωστά {v['acc']:.3f}")

# ---------------------------------------------------------------- στοιχήματα στο 2026 (κανόνες «Αξίας», χωρίς ρύθμιση)
T = D.loc[m_te].reset_index(drop=True)


def betting(p, min_ev=0.05, frac=0.25, cap=0.03, max_odds=5, gap=0.15):
    bank, peak, dd, n, w, st_sum, pr_sum, curve, blist = 100.0, 100.0, 0.0, 0, 0, 0.0, 0.0, [], []
    for d in sorted(T.date.unique()):
        start = bank
        for i in T.index[T.date == d]:
            g = T.loc[i]
            for pp, o, mp, won in [(p[i], g.odds_home, g.mkt_p, g.y == 1), (1 - p[i], g.odds_away, 1 - g.mkt_p, g.y == 0)]:
                ev = pp * o - 1
                if ev < min_ev or o > max_odds or abs(pp - mp) > gap:
                    continue
                b = o - 1; f = max(0.0, (b * pp - (1 - pp)) / b); st = start * min(cap, frac * f)
                if st <= 0:
                    continue
                prof = st * b if won else -st
                bank += prof; n += 1; w += int(won); st_sum += st; pr_sum += prof; blist.append((st, prof))
        peak = max(peak, bank); dd = max(dd, (peak - bank) / peak); curve.append([d, round(bank, 2)])
    ci = None
    if blist:
        a = np.array(blist); r = np.random.default_rng(1)
        bs = [(lambda i: a[i, 1].sum() / a[i, 0].sum())(r.integers(0, len(a), len(a))) for _ in range(2000)]
        ci = [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)]
        p_pos = round(float(np.mean(np.array(bs) > 0)), 3)
    return {"n": n, "wins": w, "roi": round(pr_sum / st_sum, 4) if st_sum else None, "roi_ci": ci, "p_roi_pos": p_pos if blist else None,
            "final": round(bank, 2), "max_dd": round(dd, 4), "curve": curve}


bets = {k: betting(v) for k, v in res.items() if k != "market"}
# πόσο σίγουρη είναι η διαφορά από την αγορά (bootstrap σε αγώνες, ζευγαρωτά)
llv = lambda p_, yy: -(yy * np.log(np.clip(p_, 1e-4, 1)) + (1 - yy) * np.log(np.clip(1 - p_, 1e-4, 1)))
r_ = np.random.default_rng(3); vs_market = {}
for k in ["sim", "logistic", "market+sim", "mlp"]:
    dlt = llv(res[k], yte) - llv(res["market"], yte)
    bs = [dlt[r_.integers(0, len(dlt), len(dlt))].mean() for _ in range(2000)]
    vs_market[k] = {"diff": round(float(dlt.mean()), 4), "ci": [round(float(np.percentile(bs, 2.5)), 4), round(float(np.percentile(bs, 97.5)), 4)],
                    "p_better": round(float(np.mean(np.array(bs) < 0)), 3)}
print("  log-loss μοντέλο − αγορά (2026):", vs_market)
for k, v in bets.items():
    print(f"  στοιχήματα {NAMES[k]:42s} n={v['n']:3d} ROI {v['roi']} κεφάλαιο {v['final']}")

# ---------------------------------------------------------------- δεύτερη ανεξάρτητη δοκιμή: εκπαίδευση 2023, επιλογή 2024, κρίση 2025
a_tr, a_va, a_te = (D.season == 2023) & odd, (D.season == 2024) & odd, (D.season == 2025) & odd
mu2 = D.loc[D.season == 2023, cols_all].mean(); sd2 = D.loc[D.season == 2023, cols_all].std().replace(0, 1)
Z2 = lambda m, cols: ((D.loc[m, cols] - mu2[cols]) / sd2[cols]).to_numpy(float)
y_tr2, y_va2, y_te2 = y[a_tr], y[a_va], y[a_te]
best2 = min([(metrics(LogisticRegression(C=C, max_iter=2000).fit(Z2(a_tr, cols_all), y_tr2).predict_proba(Z2(a_va, cols_all))[:, 1], y_va2)["logloss"], C) for C in [0.01, 0.03, 0.1, 0.3, 1, 3]])[1]
LR2 = LogisticRegression(C=best2, max_iter=2000).fit(np.vstack([Z2(a_tr, cols_all), Z2(a_va, cols_all)]), np.r_[y_tr2, y_va2])
two2 = LogisticRegression(C=1e6).fit(D.loc[a_tr | a_va, ["mkt_logit", "sim_logit"]], y[a_tr | a_va])
nets2, _ = train_mlp(Z2(a_tr, cols_all), y_tr2, Z2(a_va, cols_all), y_va2)
res2 = {"market": D.loc[a_te, "mkt_p"].to_numpy(), "logistic": LR2.predict_proba(Z2(a_te, cols_all))[:, 1],
        "market+sim": two2.predict_proba(D.loc[a_te, ["mkt_logit", "sim_logit"]])[:, 1], "mlp": ens(nets2, Z2(a_te, cols_all))}
T_keep = T; T = D.loc[a_te].reset_index(drop=True)
second = {k: {**metrics(v, y_te2), **({"bets": {kk: vv for kk, vv in betting(v).items() if kk != "curve"}} if k != "market" else {})} for k, v in res2.items()}
T = T_keep
for k, v in second.items():
    print(f"  2025 · {NAMES[k]:42s} log-loss {v['logloss']:.4f}", (f"στοιχ. n={v['bets']['n']} ROI {v['bets']['roi']}" if "bets" in v else ""))

# ---------------------------------------------------------------- διαφορά και σύνολο (όλοι οι αγώνες, χωρίς αγορά)
reg = {}
for target, simc, rc in [("margin", "sim_margin", "r_margin"), ("total", "sim_total", "r_total")]:
    yt = D[target].to_numpy(float)
    mae = lambda pr, m: round(float(np.mean(np.abs(pr - yt[m.to_numpy()]))), 3)
    bestA = min([(mae(Ridge(alpha=a).fit(Z(tr, cols_nomkt), yt[tr]).predict(Z(va, cols_nomkt)), va), a) for a in [0.1, 1, 10, 100]])[1]
    rg = Ridge(alpha=bestA).fit(np.vstack([Z(tr, cols_nomkt), Z(va, cols_nomkt)]), np.r_[yt[tr], yt[va]])
    reg[target] = {"sim": mae(D.loc[te, simc].to_numpy(), te), "ratings": mae(D.loc[te, rc].to_numpy(), te), "ridge": mae(rg.predict(Z(te, cols_nomkt)), te),
                   "mean": mae(np.full(te.sum(), yt[tr | va].mean()), te), "n": int(te.sum())}
print("  διαφορά/σύνολο (μέσο απόλυτο σφάλμα, 2026):", reg)

# ---------------------------------------------------------------- έξοδος για το σάιτ
net0 = nets[0]
out = {
    "sizes": {s: {"games": int((D.split == s).sum()), "with_odds": int(((D.split == s) & odd).sum()),
                  "seasons": {"train": TRAIN, "valid": VALID, "test": TEST}[s]} for s in ["train", "valid", "test"]},
    "by_league_season": D.groupby(["comp", "season"]).agg(games=("code", "size"), odds=("has_odds", "sum")).reset_index().to_dict("records"),
    "features": [{"col": c, "label": l, "mean": round(float(mu[c]), 3), "sd": round(float(sd[c]), 3)} for c, l in FEATS + [MKT]],
    "logistic": {"C": best[1], "coef": coef, "intercept": round(float(LR.intercept_[0]), 4)},
    "two": two_test,
    "mlp": {"layers": net0.sizes, "activation": ["ReLU", "ReLU", "σιγμοειδής"], "l2": net0.l2, "lr": net0.lr, "seeds": len(nets),
            "best_epochs": [int(n.best_epoch) for n in nets], "curve": curves[0], "curve_nomkt": curves0[0],
            "W": [np.round(w, 3).tolist() for w in net0.W], "params": int(sum(w.size for w in net0.W) + sum(b.size for b in net0.b))},
    "test": table, "test_by_league": by_league, "bets": bets, "regression": reg, "vs_market": vs_market, "second": {"seasons": "εκπαίδευση 2023 · επιλογή 2024 · κρίση 2025", **second},
}
for k in out["test"]:
    out["test"][k]["key"] = k
(ROOT / "site" / "ml.json").write_text(json.dumps(out, ensure_ascii=False, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
print("-> site/ml.json")
