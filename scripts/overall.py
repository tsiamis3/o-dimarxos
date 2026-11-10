"""
Ratings v3: «πόσο καλός παίκτης είναι», πάνω στο radar και στους ρόλους.

Το radar λέει ΤΙ κάνει ο παίκτης (όγκος/στυλ). Εδώ προστίθεται το ΠΟΣΟ ΚΑΛΑ (ευστοχία) και ο ρόλος του:

1. Επιμέρους ratings: συνδυασμοί όγκου (ίδια μεγέθη με το radar) και ευστοχίας, σε τυπικές αποκλίσεις μέσα
   στη λίγκα-σεζόν, με το προφίλ καριέρας (όπως οι ρόλοι). Οι ευστοχίες συρρικνώνονται προς τον μέσο όρο
   της λίγκας ανάλογα με τις προσπάθειες (π.χ. +60 εικονικά τρίποντα).
2. OVR = σταθμισμένος συνδυασμός των επιμέρους, με βάρη ΑΝΑ ΡΟΛΟ: ridge που μαθαίνει ποιο προφίλ συνδέεται με
   τη διαφορά πόντων (RAPM, EuroLeague + EuroCup), με κοινά βάρη + διορθώσεις ανά ρόλο που «τραβιούνται» προς
   τα κοινά. Ο παίκτης παίρνει το μείγμα των ρόλων του (πιθανότητες). Η βαθμολογία βγαίνει από τα
   στατιστικά του, όχι από το +/− του: ο καλός παίκτης σε κακή ομάδα δεν τιμωρείται.
3. Το RAPM μένει χωριστά ως «Επιρροή» (imp, π./100) στην κάρτα και στο GNN.

Τρέχει μετά τα analytics.py και roles.py και ξαναγράφει ovr, r_*, pc_* στα site/data/analytics_*.json.

    python scripts/overall.py            # γράφει
    python scripts/overall.py --dry      # μόνο αναφορά (δεν γράφει)
"""
import argparse
import json
import math

import numpy as np
import pandas as pd

import roles as R
from analytics import LEAGUE_OFFSET, LEAGUE_SCALE, RATING_MID, RATING_SD
from config import SITE_DATA
from dataset import CompetitionData

COMPS = ["E", "U", "GBL", "NBA"]
FIT_COMPS = ["E", "U"]             # εκεί υπάρχει RAPM από play-by-play (ο στόχος του μοντέλου)
FIT_MIN = 300.0
# συρρίκνωση ευστοχιών: εικονικές προσπάθειες στον μέσο όρο της λίγκας-σεζόν
K_ATT = {"fg3p": 60.0, "ftp": 30.0, "rimp": 30.0, "midp": 40.0}
# επιμέρους ratings: (κλειδί, όνομα, {μέγεθος: βάρος}) — z μέσα στη λίγκα-σεζόν, προφίλ καριέρας
SUB = [
    ("r_sco", "Σκοράρισμα", {"pts100": 0.6, "ts_adj": 0.4}),
    ("r_sho", "Σουτ", {"r3": 0.4, "fg3p": 0.45, "ftp": 0.15}),
    ("r_fin", "Τελείωμα", {"rrim": 0.25, "rfta": 0.25, "rimp": 0.35, "ftp": 0.15}),
    ("r_mid", "Μέση απόσταση", {"rmid": 0.4, "midp": 0.6}),
    ("r_pla", "Δημιουργία", {"ast_pct": 0.45, "selfc": 0.25, "tov_pct": -0.3}),
    ("r_reb", "Ριμπάουντ", {"orb_pct": 0.5, "drb_pct": 0.5}),
    # χωρίς RAPM άμυνας: είναι κομμάτι του στόχου (impact) και θα «έκλεβε» την απάντηση
    ("r_def", "Άμυνα", {"stl100": 0.45, "blk100": 0.45, "pf100": -0.1}),
]
SUB_KEYS = [k for k, _, _ in SUB]
# Πλαφόν: στους ρόλους γκαρντ, Άμυνα και Ριμπάουντ δεν μπορούν να ζυγίζουν πάνω από CAP. Το μοντέλο (στόχος RAPM)
# δίνει μεγάλο βάρος σε κλεψίματα/κοψίματα/ριμπάουντ (γνωστή υπερεκτίμηση των box→RAPM μοντέλων) και «τιμωρούσε»
# γκαρντ-σκόρερ που δεν κλέβουν και δεν παίρνουν ριμπάουντ (π.χ. Matt Morgan 83 -> 63).
GUARD_ROLES = ["Σουτέρ spot-up", "Σκόρερ γκαρντ", "Οργανωτής", "Αμυντικός περιφέρειας"]
CAP_KEYS, CAP = ["r_def", "r_reb"], 0.25
ALPHA_G = [1, 3, 10, 30, 100]       # ποινή ridge στα κοινά βάρη
ALPHA_R = [10, 30, 100, 300, 1000]  # ποινή στις διορθώσεις ανά ρόλο (μεγάλη = ίδια βάρη για όλους)


# ---------------------------------------------------------------------------
def load() -> pd.DataFrame:
    """Παίκτες-σεζόν (όλες οι λίγκες) με τα μεγέθη των ρόλων + ευστοχίες + πιθανότητες ρόλου."""
    P = R.load_all()
    extra = []
    for c in COMPS:
        f = SITE_DATA / f"analytics_{c}.json"
        if not f.exists():
            continue
        logs = CompetitionData(c).logs
        A = json.loads(f.read_text())
        rj = SITE_DATA / f"roles_{c}.json"
        RJ = json.loads(rj.read_text()) if rj.exists() else None
        for s in A["seasons"]:
            g = logs[logs.season == int(s)].groupby("pid")[["FG3M", "FG3A", "FTM", "FTA"]].sum()
            t = g.reset_index().assign(comp=c, season=int(s))
            fz = SITE_DATA / f"shots_{c}{s}.json"
            if fz.exists():
                Z = json.loads(fz.read_text())["pzones"]
                zz = pd.DataFrame([(p, v[0][0], v[0][1], v[1][0] + v[2][0], v[1][1] + v[2][1]) for p, v in Z.items()],
                                  columns=["pid", "rim_a", "rim_m", "mid_a", "mid_m"])
                t = t.merge(zz, on="pid", how="left")
            if RJ and str(s) in RJ["players"]:
                ci, cp = RJ["cols"].index("pid"), RJ["cols"].index("probs")
                pr = pd.DataFrame([[r[ci], *r[cp]] for r in RJ["players"][str(s)]],
                                  columns=["pid"] + [f"role_{k}" for k in range(R.K)])
                t = t.merge(pr, on="pid", how="left")
            extra.append(t)
    E = pd.concat(extra, ignore_index=True)
    P = P.merge(E, on=["comp", "season", "pid"], how="left")
    for c in ["rim_a", "rim_m", "mid_a", "mid_m"] + [f"role_{k}" for k in range(R.K)]:
        if c not in P:
            P[c] = np.nan

    # ευστοχίες με συρρίκνωση προς τον μέσο όρο της λίγκας-σεζόν
    def shrunk(made, att, key):
        lg = P.groupby(["comp", "season"]).apply(lambda d: made[d.index].sum() / max(att[d.index].sum(), 1))
        mean = pd.Series(list(zip(P.comp, P.season))).map(lg).to_numpy()
        v = (made + K_ATT[key] * mean) / (att + K_ATT[key])
        return v.where(att.notna())
    P["fg3p"] = shrunk(P.FG3M, P.FG3A, "fg3p")
    P["ftp"] = shrunk(P.FTM, P.FTA, "ftp")
    P["rimp"] = shrunk(P.rim_m, P.rim_a, "rimp")
    P["midp"] = shrunk(P.mid_m, P.mid_a, "midp")
    return P


def sub_ratings(P: pd.DataFrame):
    """z ανά λίγκα-σεζόν -> προφίλ καριέρας -> επιμέρους ratings (σε τυπικές αποκλίσεις)."""
    cols = sorted({f for _, _, w in SUB for f in w})
    Z = R.zscores(P, cols)
    Xb, cur_share, prior_min = R.blend_history(P, Z[cols].to_numpy())
    B = pd.DataFrame(Xb, columns=cols, index=P.index)
    out = pd.DataFrame(index=P.index)
    for k, _, w in SUB:
        out[k] = sum(v * B[f] for f, v in w.items()) / sum(abs(v) for v in w.values())
    return out, cur_share, prior_min


def design(S: pd.DataFrame, probs: np.ndarray):
    """Κοινά βάρη (7) + διορθώσεις ανά ρόλο (8 × 7) + μέσο επίπεδο ρόλου (8)."""
    G = S[SUB_KEYS].to_numpy()
    inter = np.concatenate([probs[:, [k]] * G for k in range(R.K)], axis=1)
    return G, np.concatenate([inter, probs], axis=1)


def ridge(G, Rr, y, w, ag, ar):
    X = np.c_[np.ones(len(G)), G, Rr]
    pen = np.r_[1e-6, np.full(G.shape[1], ag), np.full(Rr.shape[1], ar)]
    A = X.T @ (X * w[:, None]) / w.mean() + np.diag(pen)
    return np.linalg.solve(A, X.T @ (w * y) / w.mean())


def predict(G, Rr, b):
    return np.c_[np.ones(len(G)), G, Rr] @ b


def role_weights(b):
    """Από τους συντελεστές του ridge -> (σταθερά, επίπεδο ρόλου c[k], βάρη ρόλου W[k, j] = κοινό + διόρθωση),
    με το πλαφόν στους ρόλους γκαρντ."""
    n = len(SUB_KEYS)
    g = b[1:1 + n]
    W = np.array([[g[j] + b[1 + n + k * n + j] for j in range(n)] for k in range(R.K)])
    c = b[1 + n + R.K * n:]
    for k, (name, _, _) in enumerate(R.ROLES):
        if name in GUARD_ROLES:
            for key in CAP_KEYS:
                j = SUB_KEYS.index(key)
                W[k, j] = min(W[k, j], CAP)
    return b[0], c, W


def predict_capped(S, probs, b):
    """OVR (ακατέργαστο) = σταθερά + Σ_k p_k · (c_k + Σ_j W[k, j] · επιμέρους_j)."""
    b0, c, W = role_weights(b)
    G = S[SUB_KEYS].to_numpy()
    return b0 + probs @ c + np.einsum("ik,kj,ij->i", probs, W, G)


def fit_model(P, S, probs):
    fit = (P.comp.isin(FIT_COMPS) & (P.MIN >= FIT_MIN) & (P.imp_src == "rapm") & P.imp.notna()).to_numpy() \
        & ~np.isnan(probs).any(axis=1)
    G, Rr = design(S, np.nan_to_num(probs, nan=1.0 / R.K))
    y, w, grp = P.imp.to_numpy(float), P.MIN.to_numpy(float), (P.comp + P.season.astype(str)).to_numpy()
    best, table = None, {}
    for ag in ALPHA_G:
        for ar in ALPHA_R:
            err = base = 0.0
            for g in np.unique(grp[fit]):
                tr, te = fit & (grp != g), fit & (grp == g)
                b = ridge(G[tr], Rr[tr], y[tr], w[tr], ag, ar)
                e = predict(G[te], Rr[te], b) - y[te]
                err += np.sum(w[te] * e ** 2)
                base += np.sum(w[te] * (y[te] - np.average(y[tr], weights=w[tr])) ** 2)
            table[(ag, ar)] = 1 - err / base
            if best is None or table[(ag, ar)] > best[2]:
                best = (ag, ar, table[(ag, ar)])
    ag, ar, r2 = best
    b = ridge(G[fit], Rr[fit], y[fit], w[fit], ag, ar)
    # το ίδιο CV με το πλαφόν (για να φαίνεται το κόστος του σε ακρίβεια)
    pr_ = np.nan_to_num(probs, nan=1.0 / R.K)
    errc = basec = 0.0
    for g_ in np.unique(grp[fit]):
        tr, te = fit & (grp != g_), fit & (grp == g_)
        bb = ridge(G[tr], Rr[tr], y[tr], w[tr], ag, ar)
        e = predict_capped(S[te], pr_[te], bb) - y[te]
        errc += np.sum(w[te] * e ** 2)
        basec += np.sum(w[te] * (y[te] - np.average(y[tr], weights=w[tr])) ** 2)
    # χωρίς ρόλους (για σύγκριση): ίδια κοινά βάρη, άπειρη ποινή στις διορθώσεις
    err0 = base0 = 0.0
    for g in np.unique(grp[fit]):
        tr, te = fit & (grp != g), fit & (grp == g)
        b0 = ridge(G[tr], Rr[tr], y[tr], w[tr], ag, 1e9)
        err0 += np.sum(w[te] * (predict(G[te], Rr[te], b0) - y[te]) ** 2)
        base0 += np.sum(w[te] * (y[te] - np.average(y[tr], weights=w[tr])) ** 2)
    info = {"alpha_global": ag, "alpha_role": ar, "r2_cv": round(float(r2), 3), "r2_cv_capped": round(float(1 - errc / basec), 3),
            "r2_cv_no_roles": round(float(1 - err0 / base0), 3), "n_fit": int(fit.sum()), "cap": CAP}
    return predict_capped(S, pr_, b), b, info


def weights_by_role(b):
    """Τελικά βάρη κάθε επιμέρους για έναν «καθαρό» παίκτη κάθε ρόλου (κοινά + διόρθωση, με το πλαφόν)."""
    _, _, W = role_weights(b)
    return {R.ROLES[k][0]: {SUB_KEYS[j]: round(float(W[k, j]), 3) for j in range(len(SUB_KEYS))} for k in range(R.K)}


def to_scale(v: pd.Series, qual: pd.Series, comp: str) -> tuple[pd.Series, pd.Series]:
    """Τιμή -> κλίμακα 40–99 (72 + 8·z, με κλίμακα/επίπεδο λίγκας) και ποσοστημόριο, μέσα στη λίγκα-σεζόν."""
    off, scale = LEAGUE_OFFSET.get(comp, 0.0), LEAGUE_SCALE.get(comp, 1.0)
    q = v[qual]
    zz = (v - q.mean()) / (q.std() + 1e-9)
    rating = np.round(np.clip(RATING_MID + RATING_SD * (scale * zz + off), 40, 99))
    qs = np.sort(q.to_numpy(float))
    pc = np.round(100 * np.searchsorted(qs, v.to_numpy(float), side="right") / max(len(qs), 1))
    return rating, pc


def main(dry: bool = False):
    P = load()
    S, cur_share, prior_min = sub_ratings(P)
    probs = P[[f"role_{k}" for k in range(R.K)]].to_numpy(float)
    raw, b, info = fit_model(P, S, probs)
    P["ovr_raw"] = raw
    for k in SUB_KEYS:
        P[k + "_raw"] = S[k]
    P["qual"] = P.qual.fillna(0).astype(int) if "qual" in P else 1
    out = []
    for (c, s), d in P.groupby(["comp", "season"]):
        q = d.qual == 1
        if q.sum() < 10:
            continue
        r = pd.DataFrame(index=d.index)
        r["ovr_new"], r["pc_ovr_new"] = to_scale(d.ovr_raw, q, c)
        for k in SUB_KEYS:
            r[k + "_new"], r["pc_" + k + "_new"] = to_scale(d[k + "_raw"], q, c)
        out.append(r)
    P = P.join(pd.concat(out))
    W = weights_by_role(b)
    print(f"ratings v3: {info}")
    for role, ws in W.items():
        print(f"  {role:24s} " + " ".join(f"{k[2:]}{v:+.2f}" for k, v in ws.items()))
    if not dry:
        write(P, info, W)
    return P, info, W


def write(P: pd.DataFrame, info: dict, W: dict):
    keys = ["ovr"] + SUB_KEYS
    for c in COMPS:
        f = SITE_DATA / f"analytics_{c}.json"
        if not f.exists():
            continue
        A = json.loads(f.read_text())
        d = P[P.comp == c].set_index(["season", "pid"])
        for s, v in A["seasons"].items():
            T = v.get("players")
            if not T:
                continue
            cols = T["cols"]
            for k in keys:
                for kk in (k, "pc_" + k):
                    if kk not in cols:
                        cols.append(kk)
                        for row in T["rows"]:
                            row.append(None)
            ix = {k: i for i, k in enumerate(cols)}
            for row in T["rows"]:
                key = (int(s), row[ix["pid"]])
                if key not in d.index:
                    continue
                x = d.loc[key]
                if isinstance(x, pd.DataFrame):
                    x = x.iloc[0]
                for k in keys:
                    val, pc = x.get(k + "_new"), x.get("pc_" + k + "_new")
                    row[ix[k]] = None if val is None or (isinstance(val, float) and math.isnan(val)) else int(val)
                    row[ix["pc_" + k]] = None if pc is None or (isinstance(pc, float) and math.isnan(pc)) else int(pc)
        A["ratings_v3"] = {**info, "subs": [[k, n] for k, n, _ in SUB], "weights": W}
        f.write_text(json.dumps(A, ensure_ascii=False, separators=(",", ":")))
    print("-> analytics_*.json: ovr, r_*, pc_* (v3)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    main(ap.parse_args().dry)
