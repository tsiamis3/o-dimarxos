"""
Ρόλοι παικτών (unsupervised): ΣΧΗΜΑ του παίκτη, όχι πόσο καλός είναι.

1. Χαρακτηριστικά στυλ + σώματος ανά παίκτη-σεζόν (EuroLeague, EuroCup, NBA):
   usage, AST%, OREB%, DREB%, κλεψίματα/100, κοψίματα/100, FT rate (βολές/σουτ),
   μερίδιο σουτ ανά ζώνη (καλάθι, ρακέτα, μέση, γωνία 3π, κορυφή 3π), ύψος, βάρος.
   Χωρίς ποιότητα (TS%, RAPM, OVR) και χωρίς λάθη/φάουλ.
2. z-score μέσα σε κάθε λίγκα-σεζόν (ο ρόλος κρίνεται σε σχέση με τη λίγκα του), βάρος = λεπτά.
3. SVD -> 6 διανύσματα (~83% της διακύμανσης), varimax περιστροφή -> 6 ερμηνεύσιμοι άξονες.
4. Σχήμα = οι 6 αποκλίσεις από τον μέσο όρο της λίγκας (με πρόσημο), κανονικοποιημένες σε μήκος 1.
   Στο radar: μεσαίος κύκλος = μέσος όρος, έξω = πάνω από τον μέσο, μέσα = κάτω.
   (Με ποσοστημόρια 0–1 ο «παντού ψηλά» σταρ και ο «παντού μέτριος» έβγαιναν ίδιο σχήμα: 0.5 = μέσος όρος, όχι «μισό».)
   Ομοιότητα δύο παικτών = συνημίτονο της γωνίας ανάμεσα στα σχήματά τους.
5. Soft clustering στη σφαίρα (spherical k-means, K = 7 ρόλοι, βάρος = λεπτά) και πιθανότητα ρόλου
   p ∝ exp(κ · συνημίτονο) (κατανομή von Mises–Fisher). K από silhouette + σταθερότητα σε υποδείγματα.

    python scripts/roles.py            # -> site/data/roles_{E,U,NBA}.json
"""
import json
import math

import numpy as np
import pandas as pd
from scipy.optimize import linear_sum_assignment

from config import RAW_DIR, SITE_DATA
from dataset import CompetitionData

COMPS = ["E", "U", "NBA"]
MIN_MIN = 300.0                    # λεπτά για να μπει παίκτης-σεζόν στην εκπαίδευση (άξονες, ρόλοι)
MIN_SHOW = 120.0                   # λεπτά (φέτος ή φέτος + ιστορία) για να του υπολογιστεί σχήμα
MIN_LOAD = 20.0                    # λεπτά για να μπει μια σεζόν στο προφίλ καριέρας
# Λάθη και φάουλ έξω: μετρούν περισσότερο ποιότητα/θόρυβο παρά στυλ, και έβγαζαν έναν ασαφή «ρόλο».
STYLE = ["usg", "ast_pct", "orb_pct", "drb_pct", "stl100", "blk100", "ftr",
         "sh_rim", "sh_paint", "sh_mid", "sh_c3", "sh_a3"]
BODY = ["height", "weight"]
FEATS = STYLE + BODY
N_AXES = 6                         # SVD: 6 διανύσματα εξηγούν ~83% της διακύμανσης
AXIS_NAMES = ["Σώμα/ριμπάουντ", "Καλάθι/βολές", "Δημιουργία", "Ρακέτα", "Μέση απόσταση", "Κλεψίματα"]
ZONES = ["rim", "paint", "mid", "c3", "a3"]
K = 7                              # ρόλοι: καλύτερο silhouette (0.30) με σταθερότητα 0.90 στα K = 3..10
# ποια χαρακτηριστικά «ορίζουν» κάθε άξονα (για σταθερή σειρά/όνομα αξόνων από run σε run)
AXIS_FEATS = [["drb_pct", "height", "weight", "orb_pct", "blk100"], ["ftr", "sh_rim"], ["usg", "ast_pct"],
              ["sh_paint"], ["sh_mid"], ["stl100"]]
ROLES = [   # όνομα, περιγραφή, κέντρο αναφοράς (Νοέμβριος 2026) για σταθερά ονόματα από run σε run
    ("Δημιουργός με την μπάλα", "Έχει την μπάλα στα χέρια: πολλές ασίστ και μεγάλο usage, μικρόσωμος.",
     [-0.543, 0.147, 0.782, -0.226, -0.133, 0.058]),
    ("Σουτέρ χωρίς μπάλα", "Spot-up: τρίποντα κυρίως από τη γωνία, λίγη δημιουργία και λίγα σουτ μέσα.",
     [-0.249, -0.253, -0.586, -0.545, -0.116, -0.469]),
    ("Ψηλός μακριά από το καλάθι", "Ψηλός με ριμπάουντ που παίζει έξω και μοιράζει: stretch / point-forward.",
     [0.753, -0.493, 0.291, -0.238, -0.172, -0.139]),
    ("3&D αμυντικός", "Κλεψίματα και τρίποντα, λίγη μπάλα στα χέρια.",
     [-0.096, -0.106, -0.339, -0.182, -0.129, 0.903]),
    ("Σκόρερ μέσης απόστασης", "Δημιουργεί δικό του σουτ από μέση απόσταση.",
     [0.032, -0.027, 0.042, 0.053, 0.991, -0.103]),
    ("Διεισδυτής στη ρακέτα", "Μπαίνει στη ρακέτα (floaters, κοντινά) και μοιράζει, μικρόσωμος.",
     [-0.524, -0.337, 0.052, 0.721, -0.203, -0.22]),
    ("Ψηλός του καλαθιού", "Τελειώνει στο καλάθι: επιθετικά ριμπάουντ, κοψίματα, βολές, καθόλου τρίποντα.",
     [0.467, 0.731, -0.127, 0.325, -0.32, -0.151]),
]
N_SIMILAR = 5
# Προφίλ καριέρας (όπως στα ratings): το σχήμα βγαίνει από τον σταθμισμένο μέσο όλων των σεζόν του παίκτη
# (z ανά λίγκα-σεζόν, άρα συγκρίσιμα ανάμεσα σε λίγκες), βάρος = λεπτά, × HIST_SCALE·HIST_DECAY^(σεζόν πίσω) για το παρελθόν.
HIST_DECAY, HIST_SCALE = 0.7, 1.5
SEED = 7


# ---------------------------------------------------------------------------
def load(min_min: float = MIN_MIN) -> pd.DataFrame:
    frames = []
    for c in COMPS:
        A = json.loads((SITE_DATA / f"analytics_{c}.json").read_text())
        logs = CompetitionData(c).logs
        logs = logs.assign(FGA=logs.FG2A + logs.FG3A)
        for s, v in A["seasons"].items():
            P = v.get("players")
            if not P:
                continue
            t = pd.DataFrame(P["rows"], columns=P["cols"])
            t["comp"], t["season"] = c, int(s)
            g = logs[logs.season == int(s)].groupby("pid")[["FTA", "FGA"]].sum()
            t["ftr"] = t.pid.map(g.FTA / g.FGA.replace(0, np.nan))
            f = SITE_DATA / f"shots_{c}{s}.json"
            if f.exists():
                Z = json.loads(f.read_text())["pzones"]
                att = pd.DataFrame({z: t.pid.map(lambda p, i=i: (Z.get(p) or [[np.nan, 0]] * 5)[i][0]) for i, z in enumerate(ZONES)})
                tot = att.sum(axis=1)
                for z in ZONES:
                    t["sh_" + z] = att[z] / tot.replace(0, np.nan)
            frames.append(t)
    P = pd.concat(frames, ignore_index=True)
    # βιομετρικά
    bios = [pd.read_csv(f) for f in sorted(RAW_DIR.glob("[EU]20*_bio.csv"))]
    if (RAW_DIR / "NBA_bio.csv").exists():
        bios.append(pd.read_csv(RAW_DIR / "NBA_bio.csv"))
    bio = pd.concat(bios).groupby("pid")[["height", "weight", "position", "headshot"]].last()
    for c in ["height", "weight", "position", "headshot"]:
        P[c] = P.pid.map(bio[c])
    P.loc[~P.height.between(160, 235), "height"] = np.nan
    P.loc[~P.weight.between(55, 160), "weight"] = np.nan
    P = P[(P.MIN >= min_min) & P.height.notna() & P.weight.notna()]
    # λίγα λεπτά (< MIN_SHOW): κενά στυλ (π.χ. χωρίς σουτ) -> μέσος όρος της λίγκας-σεζόν· μετράνε ελάχιστα στο προφίλ
    small = P.MIN < MIN_SHOW
    for c in STYLE:
        med = P.groupby(["comp", "season"])[c].transform("median")
        P.loc[small, c] = P.loc[small, c].fillna(med[small])
    P = P.dropna(subset=FEATS).reset_index(drop=True)
    if "uid" not in P:
        P["uid"] = P.pid
    return P


def load_all() -> pd.DataFrame:
    """Όλοι με ≥ MIN_LOAD λεπτά· σχήμα δείχνεται σε όσους έχουν ≥ MIN_SHOW φέτος ή αρκετή ιστορία."""
    return load(MIN_LOAD)


def zscores(P: pd.DataFrame) -> pd.DataFrame:
    def z(df):
        w = df.MIN.to_numpy()
        out = {}
        for c in FEATS:
            v = df[c].to_numpy(float)
            m = np.average(v, weights=w)
            sd = math.sqrt(np.average((v - m) ** 2, weights=w))
            out[c] = np.clip((v - m) / (sd + 1e-9), -4, 4)
        return pd.DataFrame(out, index=df.index)
    return pd.concat([z(g) for _, g in P.groupby(["comp", "season"])]).loc[P.index]


def varimax(L, iters=100, tol=1e-6):
    """Varimax περιστροφή (στήλες = άξονες)."""
    p, k = L.shape
    R = np.eye(k)
    d = 0
    for _ in range(iters):
        Lr = L @ R
        u, s, vt = np.linalg.svd(L.T @ (Lr ** 3 - Lr @ np.diag(np.sum(Lr ** 2, axis=0)) / p))
        R = u @ vt
        d_old, d = d, np.sum(s)
        if d_old != 0 and d / d_old < 1 + tol:
            break
    return L @ R, R


def axes(X: np.ndarray, w: np.ndarray):
    """SVD -> N_AXES -> varimax, σε σταθερή σειρά/φορά (AXIS_NAMES). Επιστρέφει (scores, loadings, ev, transform)."""
    Xw = X * np.sqrt(w / w.mean())[:, None]
    U, S, Vt = np.linalg.svd(Xw, full_matrices=False)
    ev = S ** 2 / np.sum(S ** 2)
    scale = S[:N_AXES] / math.sqrt(len(X))
    L = Vt[:N_AXES].T * scale                                     # loadings
    Lr, R = varimax(L)
    # αντιστοίχιση των περιστραμμένων αξόνων στους ονομασμένους (AXIS_FEATS), με θετική φορά
    fi = {f: i for i, f in enumerate(FEATS)}
    M = np.array([[abs(sum(Lr[fi[f], j] for f in fs if f in fi)) for j in range(N_AXES)] for fs in AXIS_FEATS])
    rows, cols = linear_sum_assignment(-M)
    order = cols[np.argsort(rows)]
    sign = np.array([np.sign(sum(Lr[fi[f], j] for f in fs if f in fi)) or 1.0 for fs, j in zip(AXIS_FEATS, order)])
    Rf = R[:, order] * sign

    def transform(Xn):
        return (Xn @ Vt[:N_AXES].T / scale) @ Rf
    return transform(X), Lr[:, order] * sign, ev, transform


def blend_history(P: pd.DataFrame, X: np.ndarray):
    """Για κάθε παίκτη-σεζόν: σταθμισμένος μέσος των z όλων των σεζόν του ως τότε (και άλλων λιγκών την ίδια σεζόν).
    Επιστρέφει (Xb, μερίδιο φετινής σεζόν, λεπτά παρελθόντος)."""
    Xb = X.copy()
    share = np.ones(len(P))
    pmin = np.zeros(len(P))
    uid, season, mins = P.uid.astype(str).to_numpy(), P.season.to_numpy(), P.MIN.to_numpy(float)
    by = pd.Series(np.arange(len(P))).groupby(uid).apply(list)
    for idx in by:
        if len(idx) < 2:
            continue
        for i in idx:
            js = [j for j in idx if j != i and season[j] <= season[i]]
            if not js:
                continue
            # ίδια σεζόν σε άλλη λίγκα: ισότιμα με τη φετινή· προηγούμενες: × HIST_SCALE · HIST_DECAY^Δ
            wj = np.array([mins[j] * (1.0 if season[j] == season[i] else HIST_SCALE * HIST_DECAY ** (season[i] - season[j]))
                           for j in js])
            wi = mins[i]
            Xb[i] = (wi * X[i] + wj @ X[js]) / (wi + wj.sum())
            share[i] = wi / (wi + wj.sum())
            pmin[i] = float(mins[js].sum())
    return Xb, share, pmin


def to_shape(scores: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Αποκλίσεις από τον μέσο όρο (με πρόσημο) -> μήκος 1. Επιστρέφει (σχήμα, ένταση προφίλ = αρχικό μήκος)."""
    n = np.linalg.norm(scores, axis=1)
    return scores / np.maximum(n, 1e-9)[:, None], n


def percentiles(scores: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Ποσοστημόριο κάθε άξονα ως προς τους παίκτες με αρκετά λεπτά (για εμφάνιση)."""
    return np.column_stack([np.searchsorted(np.sort(ref[:, j]), scores[:, j], side="right") / len(ref)
                            for j in range(scores.shape[1])])


def spherical_kmeans(X: np.ndarray, k: int, w: np.ndarray | None = None, n_init=20, seed=SEED):
    """k-means με απόσταση τη γωνία (σημεία και κέντρα πάνω στη μοναδιαία σφαίρα), βάρος w."""
    rng = np.random.default_rng(seed)
    w = np.ones(len(X)) if w is None else w
    best = None
    for _ in range(n_init):
        C = X[rng.choice(len(X), k, replace=False)]
        for _ in range(200):
            lab = np.argmax(X @ C.T, axis=1)
            Cn = np.array([(X[lab == j] * w[lab == j, None]).sum(0) if (lab == j).any() else C[j] for j in range(k)])
            Cn /= np.linalg.norm(Cn, axis=1, keepdims=True)
            if np.allclose(Cn, C):
                break
            C = Cn
        obj = float(np.sum(w * np.max(X @ C.T, axis=1)))
        if best is None or obj > best[0]:
            best = (obj, C, lab)
    return best[1], best[2]


def vmf_kappa(X: np.ndarray, lab: np.ndarray, k: int) -> float:
    """Συγκέντρωση κ της von Mises–Fisher από το μέσο μήκος του μέσου διανύσματος κάθε ρόλου (Banerjee et al.)."""
    d = X.shape[1]
    rbar = float(np.mean([np.linalg.norm(X[lab == j].mean(0)) for j in range(k) if (lab == j).any()]))
    return rbar * (d - rbar ** 2) / (1 - rbar ** 2)


def role_probs(shape: np.ndarray, C: np.ndarray, kappa: float) -> np.ndarray:
    z = kappa * (shape @ C.T)
    z -= z.max(axis=1, keepdims=True)
    p = np.exp(z)
    return p / p.sum(axis=1, keepdims=True)


def name_roles(C: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Σειρά των κέντρων ώστε το i να αντιστοιχεί στο ROLES[i] (μέγιστη ομοιότητα με τα κέντρα αναφοράς)."""
    ref = np.array([r[2] for r in ROLES])
    ref = ref / np.linalg.norm(ref, axis=1, keepdims=True)
    M = C @ ref.T
    r, c = linear_sum_assignment(-M)
    order = np.empty(len(ref), dtype=int)
    order[c] = r
    return order, M[r, c][np.argsort(c)]


def _r(v, d=3):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), d)


def main():
    P = load_all()
    Z = zscores(P)
    fit = (P.MIN >= MIN_MIN).to_numpy()
    X = Z[FEATS].to_numpy()
    w = P.MIN.to_numpy()
    sc_fit, L, ev, tf = axes(X[fit], w[fit])          # άξονες και ρόλοι: από «καθαρές» σεζόν (≥ MIN_MIN)
    Xb, cur_share, prior_min = blend_history(P, X)       # το σχήμα κάθε παίκτη-σεζόν: με την ιστορία του
    sc = tf(Xb)
    shape, inten = to_shape(sc)
    pct = percentiles(sc, sc_fit)
    C, lab = spherical_kmeans(shape[fit], K, w[fit])
    kappa = vmf_kappa(shape[fit], lab, K)
    order, match = name_roles(C)
    C = C[order]
    Pr = role_probs(shape, C, kappa)
    inten_pct = np.searchsorted(np.sort(inten[fit]), inten, side="right") / fit.sum()
    # πιο όμοιοι (συνημίτονο σχημάτων), ανάμεσα σε όσους έχουν αρκετά λεπτά, άλλος παίκτης
    Sf, idx_fit, uid = shape[fit], np.flatnonzero(fit), P.uid.astype(str).to_numpy()
    out_players = {}
    for i in range(len(P)):
        if P.MIN.iloc[i] < MIN_SHOW and prior_min[i] < MIN_SHOW:
            continue                                   # λίγα λεπτά και χωρίς ιστορία: όχι σχήμα
        sims = Sf @ shape[i]
        best, seen = [], {uid[i]}
        for j in np.argsort(-sims):
            g = idx_fit[j]
            if uid[g] in seen:
                continue
            seen.add(uid[g])
            best.append((g, sims[j]))
            if len(best) == N_SIMILAR:
                break
        r = P.iloc[i]
        out_players.setdefault(r.comp, {}).setdefault(str(r.season), []).append([
            r.pid, [_r(v) for v in shape[i]], [_r(v, 2) for v in pct[i]], [_r(v, 2) for v in Pr[i]], int(fit[i]),
            _r(inten_pct[i], 2), _r(cur_share[i], 2), _r(prior_min[i], 0),
            [[P.pid.iloc[g], P.player.iloc[g], P.comp.iloc[g], int(P.season.iloc[g]), _r(s_)] for g, s_ in best]])
    out = {
        "axes": AXIS_NAMES, "n_fit": int(fit.sum()), "min_fit": MIN_MIN, "min_show": MIN_SHOW,
        "explained": _r(float(ev[:N_AXES].sum())), "kappa": _r(kappa, 2),
        "loadings": {"feats": FEATS, "rows": [[_r(v, 2) for v in row] for row in L]},
        "roles": [{"name": n, "desc": d, "center": [_r(v) for v in C[k]], "n": int(np.sum(np.argmax(Pr[fit], 1) == k)),
                   "match": _r(float(match[k]))} for k, (n, d, _) in enumerate(ROLES)],
        "cols": ["pid", "shape", "pct", "probs", "fit", "intensity", "cur_share", "prior_min", "similar"],
        "players": out_players,
    }
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    for c, by_season in out_players.items():            # ένα αρχείο ανά διοργάνωση (φορτώνεται μόνο αυτό που χρειάζεται)
        (SITE_DATA / f"roles_{c}.json").write_text(json.dumps({**out, "comp": c, "players": by_season},
                                                               ensure_ascii=False, separators=(",", ":")))
    print(f"roles: {len(P)} player-seasons ({int(fit.sum())} fit), axes explain {ev[:N_AXES].sum():.1%}, "
          f"kappa {kappa:.2f}, match to reference roles {np.round(match, 3).tolist()}")


if __name__ == "__main__":
    main()
