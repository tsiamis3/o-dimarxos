"""
Ρόλοι παικτών (unsupervised): ΣΧΗΜΑ του παίκτη, όχι πόσο καλός είναι.

1. Χαρακτηριστικά στυλ + σώματος ανά παίκτη-σεζόν (EuroLeague, EuroCup, NBA, ≥ MIN_MIN λεπτά):
   usage, AST%, OREB%, DREB%, κλεψίματα/100, κοψίματα/100, FT rate (βολές/σουτ),
   μερίδιο σουτ ανά ζώνη (καλάθι, ρακέτα, μέση, γωνία 3π, κορυφή 3π), ύψος, βάρος.
   Χωρίς ποιότητα (TS%, RAPM, OVR): δύο κακοί playmakers και δύο καλοί πρέπει να έχουν το ίδιο σχήμα.
2. z-score μέσα σε κάθε λίγκα-σεζόν (ο ρόλος κρίνεται σε σχέση με τη λίγκα του), βάρος = λεπτά.
3. SVD -> N_AXES διανύσματα, varimax περιστροφή -> ερμηνεύσιμοι άξονες (ίδια πληροφορία, «καθαρότεροι» άξονες).
4. Radar: κάθε άξονας σε ποσοστημόριο 0–1, και το διάνυσμα κανονικοποιείται σε μήκος 1 -> μένει μόνο το σχήμα.
   Ομοιότητα δύο παικτών = συνημίτονο της γωνίας ανάμεσα στα σχήματά τους.
5. Archetypal analysis στα σχήματα: K «καθαροί» ρόλοι (ακραία σχήματα) και κάθε παίκτης = μίξη τους (βάρη που
   αθροίζουν σε 1). Cluster = κυρίαρχο αρχέτυπο.

    python scripts/roles.py            # -> site/data/roles.json
"""
import json
import math

import numpy as np
import pandas as pd
from scipy.optimize import nnls

from config import RAW_DIR, SITE_DATA
from dataset import CompetitionData

COMPS = ["E", "U", "NBA"]
MIN_MIN = 300.0
# Λάθη και φάουλ έξω: μετρούν περισσότερο ποιότητα/θόρυβο παρά στυλ, και έβγαζαν έναν ασαφή «ρόλο».
STYLE = ["usg", "ast_pct", "orb_pct", "drb_pct", "stl100", "blk100", "ftr",
         "sh_rim", "sh_paint", "sh_mid", "sh_c3", "sh_a3"]
BODY = ["height", "weight"]
FEATS = STYLE + BODY
N_AXES = 6                         # SVD: 6 διανύσματα εξηγούν ~83% της διακύμανσης
AXIS_NAMES = ["Σώμα/ριμπάουντ", "Καλάθι/βολές", "Δημιουργία", "Ρακέτα", "Μέση απόσταση", "Κλεψίματα"]
K = 6                              # αρχέτυπα: ανεξήγητο 28%, σταθερότητα 0.83 (καλύτερη ισορροπία για K = 4..9)
ZONES = ["rim", "paint", "mid", "c3", "a3"]
SEED = 7


# ---------------------------------------------------------------------------
def load() -> pd.DataFrame:
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
    P = P[(P.MIN >= MIN_MIN)].dropna(subset=FEATS).reset_index(drop=True)
    return P


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
    """SVD -> N_AXES -> varimax. Επιστρέφει scores (n × N_AXES), loadings (feats × N_AXES), εξηγούμενη διακύμανση."""
    Xw = X * np.sqrt(w / w.mean())[:, None]
    U, S, Vt = np.linalg.svd(Xw, full_matrices=False)
    ev = S ** 2 / np.sum(S ** 2)
    L = Vt[:N_AXES].T * S[:N_AXES] / math.sqrt(len(X))          # loadings
    Lr, R = varimax(L)
    # κάθε άξονας με θετική φορά προς το μεγαλύτερο |loading|
    sign = np.sign(Lr[np.abs(Lr).argmax(axis=0), np.arange(N_AXES)])
    Lr, R = Lr * sign, R * sign
    scores = (X @ Vt[:N_AXES].T / (S[:N_AXES] / math.sqrt(len(X)))) @ R
    # σειρά αξόνων: από τον πιο «φορτωμένο»
    order = np.argsort(-np.sum(Lr ** 2, axis=0))
    return scores[:, order], Lr[:, order], ev


def to_shape(scores: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Ποσοστημόρια 0–1 ανά άξονα -> κανονικοποίηση σε μήκος 1."""
    pct = np.column_stack([(pd.Series(scores[:, j]).rank(pct=True)).to_numpy() for j in range(scores.shape[1])])
    shape = pct / np.linalg.norm(pct, axis=1, keepdims=True)
    return pct, shape


# ---------------------------------------------------------------------------
def _simplex_ls(A: np.ndarray, b: np.ndarray, big=200.0) -> np.ndarray:
    """min ||A x − b||, x ≥ 0, Σx = 1 (nnls με επαυξημένη γραμμή)."""
    Aa = np.vstack([A, big * np.ones(A.shape[1])])
    ba = np.r_[b, big]
    x, _ = nnls(Aa, ba)
    s = x.sum()
    return x / s if s > 0 else np.full(len(x), 1 / len(x))


def archetypes(X: np.ndarray, k: int, iters=60, seed=SEED):
    """Archetypal analysis (Cutler & Breiman): X ≈ S·Z, Z = C·X, γραμμές των S, C στο simplex.
    Επιστρέφει Z (k × d), S (n × k), σφάλμα ανακατασκευής (RSS / συνολική διακύμανση)."""
    rng = np.random.default_rng(seed)
    n = len(X)
    # αρχικοποίηση: furthest-first από το κέντρο
    idx = [int(np.argmax(np.linalg.norm(X - X.mean(0), axis=1)))]
    while len(idx) < k:
        d = np.min([np.linalg.norm(X - X[i], axis=1) for i in idx], axis=0)
        idx.append(int(np.argmax(d * (0.9 + 0.2 * rng.random(n)))))
    Z = X[idx].copy()
    prev = np.inf
    for _ in range(iters):
        S = np.array([_simplex_ls(Z.T, x) for x in X])
        # Z: ελάχιστα τετράγωνα, μετά προβολή κάθε αρχετύπου στην κυρτή θήκη των δεδομένων (μέσω C)
        Zls, *_ = np.linalg.lstsq(S, X, rcond=None)
        Z = np.array([_simplex_ls(X.T, z) @ X for z in Zls])
        rss = float(np.sum((X - S @ Z) ** 2))
        if prev - rss < 1e-6 * prev:
            break
        prev = rss
    S = np.array([_simplex_ls(Z.T, x) for x in X])
    rss = float(np.sum((X - S @ Z) ** 2))
    return Z, S, rss / float(np.sum((X - X.mean(0)) ** 2))
