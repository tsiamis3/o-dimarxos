"""
Ρόλοι παικτών (unsupervised): ΣΧΗΜΑ του παίκτη, όχι πόσο καλός είναι.

1. Χαρακτηριστικά στυλ + σώματος ανά παίκτη-σεζόν (EuroLeague, EuroCup, NBA):
   usage, AST%, OREB%, DREB%, κλεψίματα/100, κοψίματα/100, FT rate (βολές/σουτ),
   σουτ σε επίπεδα (τρίποντα/σουτ, καλάθι και μέση/δίποντα, γωνία/τρίποντα), ύψος, βάρος.
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

COMPS = ["E", "U", "NBA"]          # ρόλοι ορίζονται και δείχνονται εδώ (υπάρχουν ζώνες σουτ)
HIST_COMPS = ["GBL"]               # μόνο ως ιστορία (χωρίς ζώνες σουτ): μετρούν τα υπόλοιπα χαρακτηριστικά
MIN_MIN = 300.0                    # λεπτά για να μπει παίκτης-σεζόν στην εκπαίδευση (άξονες, ρόλοι)
MIN_SHOW = 120.0                   # φετινά λεπτά για σχήμα όταν δεν υπάρχει ιστορία (με ιστορία: πάντα)
MIN_LOAD = 1.0                     # κάθε σεζόν με λεπτά μπαίνει στο προφίλ καριέρας (λίγα λεπτά = λίγο βάρος)
# Λάθη και φάουλ έξω: μετρούν περισσότερο ποιότητα/θόρυβο παρά στυλ, και έβγαζαν έναν ασαφή «ρόλο».
# Σουτ σε επίπεδα (όχι 5 μερίδια που αθροίζουν σε 1, όπου «λίγα τρίποντα» φούσκωνε αυτόματα κάθε ζώνη μέσα):
#   sh3 = τρίποντα / όλα τα σουτ · rim2, mid2 = καλάθι, μέση / δίποντα (ρακέτα = το υπόλοιπο) · cor3 = γωνία / τρίποντα
STYLE = ["usg", "ast_pct", "orb_pct", "drb_pct", "stl100", "blk100", "ftr", "sh3", "rim2", "mid2", "cor3"]
NESTED = ["sh3", "rim2", "mid2", "cor3"]
BODY = ["height", "weight"]
FEATS = STYLE + BODY
N_AXES = 6                         # SVD: 6 διανύσματα εξηγούν ~83% της διακύμανσης
AXIS_NAMES = ["Σώμα/ριμπάουντ", "Κοψίματα", "Βολές/διείσδυση", "Δημιουργία", "Κλεψίματα", "Μέση απόσταση"]
ZONES = ["rim", "paint", "mid", "c3", "a3"]
K = 7                              # ρόλοι: καλύτερο silhouette (0.32) με σταθερότητα 0.97 στα K = 5..9
# ποια χαρακτηριστικά «ορίζουν» κάθε άξονα (για σταθερή σειρά/όνομα αξόνων από run σε run)
AXIS_FEATS = [["drb_pct", "height", "weight", "orb_pct"], ["blk100"], ["ftr"], ["usg", "ast_pct"],
              ["stl100"], ["mid2"]]
ROLES = [   # όνομα, περιγραφή, κέντρο αναφοράς (Νοέμβριος 2026, σουτ σε επίπεδα) για σταθερά ονόματα από run σε run
    ("Δημιουργός με την μπάλα", "Έχει την μπάλα στα χέρια: πολλές ασίστ και μεγάλο usage, μικρόσωμος.",
     [-0.633, -0.353, 0.274, 0.631, 0.024, -0.036]),
    ("Σουτέρ τριπόντων", "Spot-up: τα περισσότερα σουτ του είναι τρίποντα, λίγες βολές, λίγη δημιουργία.",
     [-0.051, -0.188, -0.708, -0.086, -0.493, -0.458]),
    ("Ψηλός μακριά από το καλάθι", "Ψηλός με ριμπάουντ που παίζει έξω και μοιράζει: stretch / point-forward, λίγα κοψίματα.",
     [0.794, -0.487, -0.049, 0.323, 0.031, 0.156]),
    ("3&D αμυντικός", "Κλεψίματα και τρίποντα, λίγη μπάλα στα χέρια.",
     [-0.285, 0.131, -0.338, -0.066, 0.859, -0.212]),
    ("Σκόρερ μέσης απόστασης", "Δημιουργεί δικό του σουτ: από τα δίποντά του, πολλά από μέση απόσταση.",
     [-0.25, 0.217, -0.207, -0.094, -0.22, 0.889]),
    ("Φόργουορντ ρόλου", "Χαμηλό usage, λίγες ασίστ, τρίποντα κυρίως από τη γωνία· κινείται χωρίς μπάλα και βρίσκει βολές.",
     [0.071, -0.367, 0.311, -0.858, -0.056, -0.153]),
    ("Ψηλός του καλαθιού", "Τελειώνει στο καλάθι: κοψίματα, επιθετικά ριμπάουντ, βολές, καθόλου τρίποντα.",
     [0.421, 0.754, 0.335, 0.174, -0.159, -0.295]),
]
N_SIMILAR = 5
# Προφίλ καριέρας (όπως στα ratings): το σχήμα βγαίνει από τον σταθμισμένο μέσο όλων των σεζόν του παίκτη
# (z ανά λίγκα-σεζόν, άρα συγκρίσιμα ανάμεσα σε λίγκες), βάρος = λεπτά, × HIST_SCALE·HIST_DECAY^(σεζόν πίσω) για το παρελθόν.
HIST_DECAY, HIST_SCALE = 0.7, 1.5
SEED = 7


# ---------------------------------------------------------------------------
def load(min_min: float = MIN_MIN) -> pd.DataFrame:
    frames = []
    for c in COMPS + HIST_COMPS:
        f = SITE_DATA / f"analytics_{c}.json"
        if not f.exists():
            continue
        A = json.loads(f.read_text())
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
                    t["za_" + z] = att[z]                              # προσπάθειες
                two, three = att.rim + att.paint + att.mid, att.c3 + att.a3
                t["sh3"] = three / tot.replace(0, np.nan)
                t["rim2"] = att.rim / two.replace(0, np.nan)
                t["mid2"] = att.mid / two.replace(0, np.nan)
                t["cor3"] = att.c3 / three.replace(0, np.nan)
                for f_ in NESTED:                                      # π.χ. κανένα τρίποντο: γωνία = διάμεσος της λίγκας
                    t[f_] = t[f_].where(tot.isna() | (tot == 0) | t[f_].notna(), t[f_].median())
            frames.append(t)
    P = pd.concat(frames, ignore_index=True)
    # βιομετρικά
    bios = [pd.read_csv(f) for f in sorted(RAW_DIR.glob("[EU]20*_bio.csv"))]
    if (RAW_DIR / "NBA_bio.csv").exists():
        bios.append(pd.read_csv(RAW_DIR / "NBA_bio.csv"))
    bio = pd.concat(bios)
    # λάθη της πηγής: ίντσες/λίβρες, βάρος = ύψος, αδύνατες τιμές (ίδιος κανόνας με το GNN)
    imp = bio.height.between(60, 95) & (bio.weight > 140)
    bio.loc[imp, "height"], bio.loc[imp, "weight"] = bio.height[imp] * 2.54, bio.weight[imp] * 0.4536
    bio.loc[bio.weight == bio.height, "weight"] = np.nan
    bio.loc[~bio.height.between(160, 235), "height"] = np.nan
    bio.loc[~bio.weight.between(55, 160), "weight"] = np.nan
    bio = bio.groupby("pid")[["height", "weight", "position", "headshot"]].last()
    if "uid" not in P:
        P["uid"] = P.pid
    key = P.uid.where(P.uid.astype(str).str.startswith(("P", "ESPN")), P.pid).astype(str)   # ελληνική λίγκα: μέσω uid
    for c in ["height", "weight", "position", "headshot"]:
        P[c] = key.map(bio[c])
    # χωρίς βιομετρικά: διάμεσος της θέσης στη λίγκα (θέση από την πηγή, αλλιώς από το προφίλ στατιστικών)
    pos = P.position.fillna(P.get("pos", pd.Series("", index=P.index)).map({"PG": "Guard", "SG": "Guard", "SF": "Forward",
                                                                          "PF": "Forward", "C": "Center"}))
    for c in ["height", "weight"]:
        P[c] = P[c].fillna(P.groupby([P.comp, pos])[c].transform("median")).fillna(P[c].median())
    P = P[P.MIN >= min_min].reset_index(drop=True)
    return P


def load_all() -> pd.DataFrame:
    """Όλοι με ≥ MIN_LOAD λεπτά· σχήμα δείχνεται σε όσους έχουν ≥ MIN_SHOW φέτος ή αρκετή ιστορία."""
    return load(MIN_LOAD)


def zscores(P: pd.DataFrame) -> pd.DataFrame:
    """z ανά λίγκα-σεζόν (βάρος λεπτά). Μέσος/διασπορά από όσους έχουν ≥ MIN_SHOW (ώστε τα μικρά δείγματα να μη
    μετακινούν την κλίμακα), εφαρμογή σε όλους. Κενά μένουν κενά."""
    def z(df):
        ref = df[df.MIN >= MIN_SHOW]
        ref = ref if len(ref) >= 20 else df
        out = {}
        for c in FEATS:
            v = df[c].to_numpy(float)
            rv, rw = ref[c].to_numpy(float), ref.MIN.to_numpy(float)
            ok = ~np.isnan(rv)
            if ok.sum() < 5:
                out[c] = np.full(len(df), np.nan)
                continue
            m = np.average(rv[ok], weights=rw[ok])
            sd = math.sqrt(np.average((rv[ok] - m) ** 2, weights=rw[ok]))
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
    """Για κάθε παίκτη-σεζόν: σταθμισμένος μέσος των z όλων των σεζόν του ως τότε (και άλλων λιγκών την ίδια σεζόν),
    ανά χαρακτηριστικό (τα κενά, π.χ. ζώνες σουτ στην ελληνική λίγκα, δεν μετρούν· ό,τι μείνει κενό = μέσος όρος, 0).
    Επιστρέφει (Xb, μερίδιο φετινής σεζόν, λεπτά παρελθόντος)."""
    uid, season, mins = P.uid.astype(str).to_numpy(), P.season.to_numpy(), P.MIN.to_numpy(float)
    Xb = np.zeros_like(X)
    share = np.ones(len(P))
    pmin = np.zeros(len(P))
    by = pd.Series(np.arange(len(P))).groupby(uid).apply(list)
    for idx in by:
        for i in idx:
            js = [j for j in idx if j != i and season[j] <= season[i]]
            # ίδια σεζόν σε άλλη λίγκα: ισότιμα με τη φετινή· προηγούμενες: × HIST_SCALE · HIST_DECAY^Δ
            w = np.array([mins[i]] + [mins[j] * (1.0 if season[j] == season[i] else HIST_SCALE * HIST_DECAY ** (season[i] - season[j]))
                                      for j in js])
            V = X[[i] + js]
            ok = ~np.isnan(V)
            num = np.where(ok, V, 0.0).T @ w
            den = ok.T.astype(float) @ w
            Xb[i] = np.where(den > 0, num / np.maximum(den, 1e-9), 0.0)
            share[i] = w[0] / w.sum()
            pmin[i] = float(mins[js].sum()) if js else 0.0
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
    X = Z[FEATS].to_numpy()
    fit = ((P.MIN >= MIN_MIN) & P.comp.isin(COMPS)).to_numpy() & ~np.isnan(X).any(axis=1)
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
    # για το γράφημα (χωρίς κανονικοποίηση): κέντρο κάθε ρόλου στο τυπικό επίπεδο των παικτών του, σε ποσοστημόρια
    lab_fit = np.argmax(Pr[fit], axis=1)
    inten_fit = inten[fit]
    center_pct = [percentiles((C[k] * float(np.median(inten_fit[lab_fit == k])))[None, :], sc_fit)[0]
                  if (lab_fit == k).any() else np.full(N_AXES, 0.5) for k in range(K)]
    inten_pct = np.searchsorted(np.sort(inten[fit]), inten, side="right") / fit.sum()
    # πιο όμοιοι (συνημίτονο σχημάτων), ανάμεσα σε όσους έχουν αρκετά λεπτά, άλλος παίκτης
    Sf, idx_fit, uid = shape[fit], np.flatnonzero(fit), P.uid.astype(str).to_numpy()
    out_players = {}
    for i in range(len(P)):
        if P.MIN.iloc[i] < MIN_SHOW and prior_min[i] <= 0:
            continue                                   # καινούργιος παίκτης (χωρίς ιστορία) με λίγα λεπτά: όχι σχήμα
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
        "roles": [{"name": n, "desc": d, "center": [_r(v) for v in C[k]], "center_pct": [_r(v, 2) for v in center_pct[k]], "n": int(np.sum(np.argmax(Pr[fit], 1) == k)),
                   "match": _r(float(match[k]))} for k, (n, d, _) in enumerate(ROLES)],
        "cols": ["pid", "shape", "pct", "probs", "fit", "intensity", "cur_share", "prior_min", "similar"],
        "players": out_players,
    }
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    for c, by_season in out_players.items():            # ένα αρχείο ανά διοργάνωση (φορτώνεται μόνο αυτό που χρειάζεται)
        (SITE_DATA / f"roles_{c}.json").write_text(json.dumps({**out, "comp": c, "no_zones": c in HIST_COMPS, "players": by_season},
                                                               ensure_ascii=False, separators=(",", ":")))
    print(f"roles: {len(P)} player-seasons ({int(fit.sum())} fit), axes explain {ev[:N_AXES].sum():.1%}, "
          f"kappa {kappa:.2f}, match to reference roles {np.round(match, 3).tolist()}")


if __name__ == "__main__":
    main()
