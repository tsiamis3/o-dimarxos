"""
Ρόλοι παικτών (unsupervised): ΠΩΣ παίζει ο παίκτης, όχι πόσο καλός είναι.

Δύο ξεχωριστές δουλειές, με διαφορετικά εργαλεία:

A. Clustering (ρόλοι, ομοιότητα) — να είναι σταθερό και «δίκαιο» ανάμεσα στα μεγέθη
   1. 13 μεγέθη ανά παίκτη-σεζόν (EuroLeague, EuroCup, NBA): usage, AST%, OREB%, DREB%, κλεψίματα/100, κοψίματα/100,
      ύψος, βάρος, και τα σουτ ως ΡΥΘΜΟΙ ανά 36′: τρίποντα, σουτ στο καλάθι, άλλα δίποντα (ρακέτα + μέση), βολές,
      συν το μερίδιο των τριπόντων από τη γωνία. Χωρίς ποιότητα (TS%, RAPM, OVR), λάθη, φάουλ.
   2. z-score μέσα σε κάθε λίγκα-σεζόν (ο ρόλος κρίνεται σε σχέση με τη λίγκα του), βάρος = λεπτά.
   3. SVD -> 6 ανεξάρτητες κατευθύνσεις (~84% της διακύμανσης), «λευκασμένες» (ίδιο βάρος η καθεμιά): έτσι τα
      μεγέθη που λένε το ίδιο (ύψος, βάρος, ριμπάουντ) μετρούν μία φορά και όχι τέσσερις.
   4. Σχήμα = το διάνυσμα των 6 κατευθύνσεων σε μήκος 1. Ομοιότητα = συνημίτονο. Ρόλοι = spherical k-means (K = 8)
      με πιθανότητες von Mises–Fisher, p ∝ exp(κ · συνημίτονο).
   5. Όνομα ρόλου: από το «προφίλ» του, τον μέσο όρο των μελών του στα 13 μεγέθη (σε τυπικές αποκλίσεις).

B. Radar και ετικέτες — να διαβάζεται από άνθρωπο
   8 σταθεροί, ονομασμένοι άξονες, ο καθένας από συγκεκριμένα μεγέθη (RADAR). Τιμή = ποσοστημόριο στη λίγκα.
   Ετικέτα (π.χ. «Σουτέρ») όταν ο παίκτης είναι στο κορυφαίο 20% ενός άξονα: ένας παίκτης μπορεί να έχει πολλές.

Και τα δύο με το προφίλ καριέρας (σταθμισμένος μέσος όλων των σεζόν του ως τότε).

    python scripts/roles.py            # -> site/data/roles_{E,U,NBA,GBL}.json
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
# Σουτ ως ρυθμοί ανά 36′ (όχι μερίδια): ο «σουτέρ με την μπάλα» (πολλά τρίποντα ΚΑΙ πολλές βολές) φαίνεται και στα δύο.
# Με μερίδια που αθροίζουν σε 1, τα τρίποντα και οι βολές/σουτ μέσα αλληλοαναιρούνταν.
STYLE = ["usg", "ast_pct", "orb_pct", "drb_pct", "stl100", "blk100", "r3", "rrim", "rmid", "rfta", "cor3"]
BODY = ["height", "weight"]
FEATS = STYLE + BODY
EXTRA = ["rmid2"]                  # μόνο για το radar: σουτ μέσης απόστασης ανά 36′ (χωρίς τη ρακέτα)
FEAT_GR = {"usg": "usage", "ast_pct": "ασίστ", "orb_pct": "επιθ. ριμπάουντ", "drb_pct": "αμυντ. ριμπάουντ",
           "stl100": "κλεψίματα", "blk100": "κοψίματα", "r3": "τρίποντα", "rrim": "σουτ στο καλάθι",
           "rmid": "άλλα δίποντα", "rfta": "βολές", "cor3": "τρίποντα από γωνία", "height": "ύψος", "weight": "βάρος"}
N_AXES = 6                         # SVD για το clustering: 6 κατευθύνσεις, ~84% της διακύμανσης
K = 8                              # ρόλοι (K = 7..8: silhouette ~0.31, σταθερότητα ~0.90)
# Radar: (όνομα, σύντομο, ετικέτα για το κορυφαίο 20%, μεγέθη που τον ορίζουν)
RADAR = [
    ("Μέγεθος/ριμπάουντ", "Μέγεθος/ριμπ.", "Σωματώδης", ["height", "weight", "drb_pct", "orb_pct"]),
    ("Κοψίματα", "Κοψίματα", "Rim protector", ["blk100"]),
    ("Καλάθι/βολές", "Στο καλάθι", "Πάει στο καλάθι", ["rrim", "rfta"]),
    ("Μέση απόσταση", "Μέση απόστ.", "Mid-range", ["rmid2"]),
    ("Τρίποντα", "Τρίποντα", "Σουτέρ", ["r3"]),
    ("Όγκος επίθεσης", "Όγκος επίθ.", "Πρώτη επιλογή", ["usg"]),   # usage: % των φάσεων της ομάδας που τελειώνουν σε αυτόν
    ("Δημιουργία", "Δημιουργία", "Δημιουργός", ["ast_pct"]),
    ("Κλεψίματα", "Κλεψίματα", "Ενεργά χέρια", ["stl100"]),
]
TAG_MIN = 0.80
ROLES = [   # όνομα, περιγραφή, προφίλ αναφοράς (z στα 13 μεγέθη, Νοέμβριος 2026) για σταθερά ονόματα από run σε run
    ("Σουτέρ spot-up", "Τρίποντα χωρίς μπάλα: λίγο usage, λίγες ασίστ, σχεδόν καθόλου σουτ στο καλάθι και βολές.",
     {'usg': -0.6, 'ast_pct': -0.64, 'orb_pct': -0.45, 'drb_pct': -0.5, 'stl100': -0.72, 'blk100': -0.45, 'r3': 0.6, 'rrim': -0.92, 'rmid': -0.54, 'rfta': -0.79, 'cor3': 0.09, 'height': -0.08, 'weight': -0.14}),
    ("Σκόρερ γκαρντ", "Σκοράρει με την μπάλα, κυρίως από τα τρία: μεγάλο usage, πολλά τρίποντα και βολές, μικρόσωμος.",
     {'usg': 1.08, 'ast_pct': 0.42, 'orb_pct': -0.71, 'drb_pct': -0.7, 'stl100': -0.0, 'blk100': -0.35, 'r3': 1.02, 'rrim': 0.04, 'rmid': 0.39, 'rfta': 0.67, 'cor3': -0.47, 'height': -0.84, 'weight': -0.85}),
    ("Οργανωτής", "Πασέρ: πολλές ασίστ με μέτριο usage, μικρόσωμος.",
     {'usg': -0.07, 'ast_pct': 1.15, 'orb_pct': -0.65, 'drb_pct': -0.7, 'stl100': 0.05, 'blk100': -0.6, 'r3': -0.02, 'rrim': -0.43, 'rmid': 0.24, 'rfta': -0.27, 'cor3': -0.44, 'height': -1.06, 'weight': -0.83}),
    ("Φόργουορντ ρόλου", "Χαμηλό usage, λίγες ασίστ· τα λίγα τρίποντά του κυρίως από τη γωνία.",
     {'usg': -0.57, 'ast_pct': -0.68, 'orb_pct': 0.29, 'drb_pct': 0.02, 'stl100': 0.0, 'blk100': -0.0, 'r3': -0.48, 'rrim': 0.13, 'rmid': -0.4, 'rfta': -0.23, 'cor3': 1.52, 'height': 0.24, 'weight': 0.16}),
    ("Ψηλός με τρίποντο", "Stretch big: σώμα και αμυντικά ριμπάουντ, αλλά σουτάρει και τρίποντα.",
     {'usg': 0.39, 'ast_pct': -0.16, 'orb_pct': 0.05, 'drb_pct': 0.94, 'stl100': -0.07, 'blk100': 0.13, 'r3': 0.56, 'rrim': -0.07, 'rmid': 0.1, 'rfta': 0.07, 'cor3': -0.24, 'height': 0.76, 'weight': 0.81}),
    ("Σκόρερ με την μπάλα", "Πρωταγωνιστής: μεγάλο usage, ασίστ, πολλά δίποντα εκτός καλαθιού και πολλές βολές.",
     {'usg': 1.21, 'ast_pct': 0.93, 'orb_pct': -0.12, 'drb_pct': 0.37, 'stl100': -0.24, 'blk100': -0.17, 'r3': -0.3, 'rrim': 0.58, 'rmid': 1.55, 'rfta': 1.27, 'cor3': -0.67, 'height': 0.27, 'weight': 0.46}),
    ("Αμυντικός περιφέρειας", "Κλεψίματα, λίγη μπάλα στα χέρια, λίγα σουτ μέσα.",
     {'usg': -0.37, 'ast_pct': 0.22, 'orb_pct': -0.22, 'drb_pct': -0.21, 'stl100': 1.65, 'blk100': -0.2, 'r3': 0.11, 'rrim': -0.3, 'rmid': -0.47, 'rfta': -0.51, 'cor3': 0.14, 'height': -0.53, 'weight': -0.61}),
    ("Ψηλός του καλαθιού", "Τελειώνει στο καλάθι: επιθετικά ριμπάουντ, κοψίματα, καθόλου τρίποντα.",
     {'usg': -0.45, 'ast_pct': -0.7, 'orb_pct': 1.68, 'drb_pct': 1.01, 'stl100': -0.42, 'blk100': 1.61, 'r3': -1.38, 'rrim': 1.27, 'rmid': -0.37, 'rfta': 0.32, 'cor3': -0.45, 'height': 1.2, 'weight': 1.01}),
]
N_SIMILAR = 5
# Προφίλ καριέρας (όπως στα ratings): το σχήμα βγαίνει από τον σταθμισμένο μέσο όλων των σεζόν του παίκτη
# (z ανά λίγκα-σεζόν, άρα συγκρίσιμα ανάμεσα σε λίγκες), βάρος = λεπτά, × HIST_SCALE·HIST_DECAY^(σεζόν πίσω) για το παρελθόν.
HIST_DECAY, HIST_SCALE = 0.7, 1.5
ZONES = ["rim", "paint", "mid", "c3", "a3"]
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
        for s, v in A["seasons"].items():
            P = v.get("players")
            if not P:
                continue
            t = pd.DataFrame(P["rows"], columns=P["cols"])
            t["comp"], t["season"] = c, int(s)
            g = logs[logs.season == int(s)].groupby("pid")[["FTA", "FG3A"]].sum()
            per36 = 36.0 / t.MIN.replace(0, np.nan)
            t["r3"] = t.pid.map(g.FG3A) * per36                        # από τα box scores: και στην ελληνική λίγκα
            t["rfta"] = t.pid.map(g.FTA) * per36
            f = SITE_DATA / f"shots_{c}{s}.json"
            if f.exists():
                Z = json.loads(f.read_text())["pzones"]
                att = pd.DataFrame({z: t.pid.map(lambda p, i=i: (Z.get(p) or [[np.nan, 0]] * 5)[i][0]) for i, z in enumerate(ZONES)})
                t["rrim"] = att.rim * per36
                t["rmid"] = (att.paint + att.mid) * per36
                t["rmid2"] = att.mid * per36
                three = att.c3 + att.a3
                t["cor3"] = att.c3 / three.replace(0, np.nan)
                t["cor3"] = t.cor3.where(att.sum(axis=1).isna() | t.cor3.notna(), t.cor3.median())   # χωρίς τρίποντα: διάμεσος
            frames.append(t)
    P = pd.concat(frames, ignore_index=True)
    for c in ["rrim", "rmid", "rmid2", "cor3"]:
        if c not in P:
            P[c] = np.nan
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


def zscores(P: pd.DataFrame, cols=None) -> pd.DataFrame:
    """z ανά λίγκα-σεζόν (βάρος λεπτά). Μέσος/διασπορά από όσους έχουν ≥ MIN_SHOW (ώστε τα μικρά δείγματα να μη
    μετακινούν την κλίμακα), εφαρμογή σε όλους. Κενά μένουν κενά."""
    cols = cols or FEATS

    def z(df):
        ref = df[df.MIN >= MIN_SHOW]
        ref = ref if len(ref) >= 20 else df
        out = {}
        for c in cols:
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


def svd_space(X: np.ndarray, w: np.ndarray):
    """SVD -> N_AXES κατευθύνσεις, λευκασμένες (διασπορά 1 η καθεμιά). Επιστρέφει (scores, loadings, ev, transform).
    Η λεύκανση δίνει ίσο βάρος σε κάθε ανεξάρτητο παράγοντα: χωρίς αυτήν, το «σώμα» (ύψος, βάρος, 2 ριμπάουντ,
    συσχέτιση 0.6–0.8) θα μετρούσε σαν τέσσερα μεγέθη και θα καθόριζε μόνο του τους ρόλους."""
    Xw = X * np.sqrt(w / w.mean())[:, None]
    _, S, Vt = np.linalg.svd(Xw, full_matrices=False)
    ev = S ** 2 / np.sum(S ** 2)
    scale = S[:N_AXES] / math.sqrt(len(X))

    def transform(Xn):
        return Xn @ Vt[:N_AXES].T / scale
    return transform(X), Vt[:N_AXES].T * scale, ev, transform


def radar_raw(Xr: np.ndarray, cols: list[str]) -> np.ndarray:
    """Τιμή κάθε άξονα του radar = μέσος όρος των z των μεγεθών του (τα κενά δεν μετρούν)."""
    ix = {c: i for i, c in enumerate(cols)}
    out = []
    for _, _, _, fs in RADAR:
        V = Xr[:, [ix[f] for f in fs]]
        ok = ~np.isnan(V)
        out.append(np.where(ok.any(axis=1), np.where(ok, V, 0).sum(axis=1) / np.maximum(ok.sum(axis=1), 1), 0.0))
    return np.column_stack(out)


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
    """Διάνυσμα -> μήκος 1. Επιστρέφει (σχήμα, ένταση προφίλ = αρχικό μήκος)."""
    n = np.linalg.norm(scores, axis=1)
    return scores / np.maximum(n, 1e-9)[:, None], n


def percentiles(scores: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Ποσοστημόριο κάθε στήλης ως προς τους παίκτες με αρκετά λεπτά."""
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


def name_roles(prof: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Σειρά των ρόλων ώστε ο i να αντιστοιχεί στο ROLES[i] (ομοιότητα προφίλ στα 13 μεγέθη με τα προφίλ αναφοράς).
    Χωρίς ROLES (ή με λιγότερους): η σειρά μένει όπως βγήκε."""
    if len(ROLES) != len(prof):
        return np.arange(len(prof)), np.full(len(prof), np.nan)
    ref = np.array([[r[2][f] for f in FEATS] for r in ROLES])
    a = prof / np.linalg.norm(prof, axis=1, keepdims=True)
    b = ref / np.linalg.norm(ref, axis=1, keepdims=True)
    M = a @ b.T
    r, c = linear_sum_assignment(-M)
    order = np.empty(len(ref), dtype=int)
    order[c] = r
    return order, M[r, c][np.argsort(c)]


def _r(v, d=3):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), d)


def main():
    P = load_all()
    cols = FEATS + EXTRA
    Zall = zscores(P, cols)
    Xall = Zall[cols].to_numpy()
    X = Xall[:, :len(FEATS)]
    fit = ((P.MIN >= MIN_MIN) & P.comp.isin(COMPS)).to_numpy() & ~np.isnan(X).any(axis=1)
    w = P.MIN.to_numpy()
    # A. clustering: χώρος SVD από «καθαρές» σεζόν (≥ MIN_MIN), εφαρμογή στο προφίλ καριέρας κάθε παίκτη-σεζόν
    sc_fit, L, ev, tf = svd_space(X[fit], w[fit])
    Xb_all, cur_share, prior_min = blend_history(P, Xall)
    Xb = Xb_all[:, :len(FEATS)]
    sc = tf(Xb)
    shape, inten = to_shape(sc)
    C, lab = spherical_kmeans(shape[fit], K, w[fit])
    kappa = vmf_kappa(shape[fit], lab, K)
    Pr0 = role_probs(shape, C, kappa)
    lab_fit = np.argmax(Pr0[fit], axis=1)
    Xf, wf = X[fit], w[fit]
    prof = np.array([np.average(Xf[lab_fit == k], axis=0, weights=wf[lab_fit == k]) if (lab_fit == k).any()
                     else np.zeros(len(FEATS)) for k in range(K)])
    order, match = name_roles(prof)
    C, prof = C[order], prof[order]
    Pr = role_probs(shape, C, kappa)
    lab_fit = np.argmax(Pr[fit], axis=1)
    # B. radar: σταθεροί άξονες, ποσοστημόρια ως προς τις «καθαρές» σεζόν
    rad_fit = radar_raw(Xall[fit], cols)
    rad = radar_raw(Xb_all, cols)
    pct = percentiles(rad, rad_fit)
    center_pct = [percentiles(np.average(rad_fit[lab_fit == k], axis=0, weights=wf[lab_fit == k])[None, :], rad_fit)[0]
                  if (lab_fit == k).any() else np.full(len(RADAR), 0.5) for k in range(K)]
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
    names = ROLES if len(ROLES) == K else [(f"Ρόλος {k + 1}", "", None) for k in range(K)]
    out = {
        "axes": [a[0] for a in RADAR], "axes_short": [a[1] for a in RADAR], "tags": [a[2] for a in RADAR],
        "axes_feats": [[FEAT_GR[f] if f in FEAT_GR else "μέση απόσταση" for f in a[3]] for a in RADAR], "tag_min": TAG_MIN,
        "n_fit": int(fit.sum()), "min_fit": MIN_MIN, "min_show": MIN_SHOW,
        "explained": _r(float(ev[:N_AXES].sum())), "kappa": _r(kappa, 2), "n_feats": len(FEATS),
        "feats": [FEAT_GR[f] for f in FEATS],
        "roles": [{"name": n, "desc": d, "center_pct": [_r(v, 2) for v in center_pct[k]],
                   "profile": [_r(v, 2) for v in prof[k]], "n": int(np.sum(lab_fit == k)), "match": _r(float(match[k]))}
                  for k, (n, d, _) in enumerate(names)],
        "cols": ["pid", "shape", "pct", "probs", "fit", "intensity", "cur_share", "prior_min", "similar"],
    }
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    for c, by_season in out_players.items():            # ένα αρχείο ανά διοργάνωση (φορτώνεται μόνο αυτό που χρειάζεται)
        (SITE_DATA / f"roles_{c}.json").write_text(json.dumps({**out, "comp": c, "no_zones": c in HIST_COMPS, "players": by_season},
                                                               ensure_ascii=False, separators=(",", ":")))
    print(f"roles: {len(P)} player-seasons ({int(fit.sum())} fit), SVD explains {ev[:N_AXES].sum():.1%}, "
          f"kappa {kappa:.2f}, match to reference roles {np.round(match, 3).tolist()}")
    return P, X, fit, prof, lab_fit


if __name__ == "__main__":
    main()
