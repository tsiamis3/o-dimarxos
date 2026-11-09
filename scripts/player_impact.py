"""
Επιρροή παίκτη σε πόντους ανά 100 κατοχές (επίθεση O, άμυνα D, NET = O − D), όπως τη μετρά το RAPM.

1. RAPM ανά σεζόν (EuroLeague, EuroCup) από τα stints, με ΜΕΤΡΗΜΕΝΕΣ κατοχές.
2. «Box → RAPM» (ιδέα τύπου BPM, προσαρμοσμένη στις λίγκες μας): ridge παλινδρόμηση που μαθαίνει ποια
   στατιστικά του box score προβλέπουν το RAPM. Τα στατιστικά μπαίνουν ως τυπικές αποκλίσεις μέσα στη
   λίγκα-σεζόν, άρα το μοντέλο εφαρμόζεται και σε λίγκες χωρίς play-by-play (ελληνική, NBA).
   Τα βάρη τα βρίσκουν τα δεδομένα, όχι εμείς. Αξιολόγηση: εκτός δείγματος, αφήνοντας έξω μία σεζόν κάθε φορά.
3. Τελική επιρροή: RAPM με prior το box-μοντέλο (όπου υπάρχουν stints), αλλιώς μόνο το box-μοντέλο.
"""
import numpy as np
import pandas as pd

from rapm import RAPM
from stints import build as build_stints

FEATS = ["pts100", "usg", "ts_adj", "fg3_rate", "fg3_adj", "ft_adj", "ast_pct", "tov_pct", "orb_pct", "drb_pct",
         "stl100", "blk100", "pf100"]
RAPM_LAM = 8000.0                  # ποινή ridge του RAPM (κατοχές)
RAPM_TAU = 365                     # None: ίσα βάρη μέσα στη σεζόν· αλλιώς ημέρες (εκθετική απόσβεση)
RAPM_PREV = True                   # True: και τα stints της προηγούμενης σεζόν (με απόσβεση RAPM_TAU)
TRAIN_MIN = 200.0                  # λεπτά για να μπει παίκτης-σεζόν στην εκπαίδευση
ALPHAS = [1, 3, 10, 30, 100, 300]  # ποινή ridge (σε μονάδες βάρους· επιλογή με cross-validation)


def season_stints(comp: str, season: int, data) -> pd.DataFrame:
    st = build_stints(comp, season, data)
    if st.empty:
        return st
    st = st.copy()
    st["poss_h"], st["poss_a"] = st.cposs_h.astype(float), st.cposs_a.astype(float)   # μετρημένες
    g = data.games[data.games.season == season].set_index("gameCode").date
    st["date"] = pd.to_datetime(st.gameCode.map(g))
    return st[st.date.notna()]


def rapm_table(st: pd.DataFrame, prior_o=None, prior_d=None, lam=RAPM_LAM, tau=RAPM_TAU) -> pd.DataFrame:
    asof = st.date.max() if tau else None
    m = RAPM(lam=lam, tau=tau or 1e9).fit(st, asof=asof, prior_o=prior_o, prior_d=prior_d)
    return m.table().set_index("pid")


def zfeat(p: pd.DataFrame, qual: pd.Series) -> pd.DataFrame:
    """Στατιστικά -> τυπικές αποκλίσεις μέσα στους παίκτες με ρόλο της ίδιας λίγκας-σεζόν (+ αλληλεπίδραση όγκου × ευστοχίας)."""
    X = pd.DataFrame(index=p.index)
    for c in FEATS:
        v = p[c].astype(float)
        q = v[qual]
        X[c] = ((v - q.mean()) / (q.std() + 1e-9)).fillna(0).clip(-4, 4)
    X["usg_x_ts"] = X.usg * X.ts_adj
    return X


class BoxImpact:
    """Ridge: z-στατιστικά -> RAPM O και D (βάρος = κατοχές στο RAPM)."""

    def fit(self, X: pd.DataFrame, yo, yd, w, groups):
        self.cols = list(X.columns)
        X, yo, yd, w, groups = X.to_numpy(float), np.asarray(yo, float), np.asarray(yd, float), np.asarray(w, float), np.asarray(groups)
        self.cv = {}
        best = None
        for a in ALPHAS:                                  # leave-one-season-out
            err, base = 0.0, 0.0
            for g in np.unique(groups):
                tr, te = groups != g, groups == g
                bo, bd = self._solve(X[tr], yo[tr], w[tr], a), self._solve(X[tr], yd[tr], w[tr], a)
                po, pd_ = self._pred(X[te], bo), self._pred(X[te], bd)
                yt = yo[te] - yd[te]
                err += np.sum(w[te] * ((po - pd_) - yt) ** 2)
                base += np.sum(w[te] * (yt - np.average(yo[tr] - yd[tr], weights=w[tr])) ** 2)
            r2 = 1 - err / base
            self.cv[a] = round(float(r2), 3)
            if best is None or r2 > best[1]:
                best = (a, r2)
        self.alpha, self.r2_cv = best
        self.bo, self.bd = self._solve(X, yo, w, self.alpha), self._solve(X, yd, w, self.alpha)
        return self

    @staticmethod
    def _solve(X, y, w, a):
        Xa = np.c_[np.ones(len(X)), X]
        P = np.eye(Xa.shape[1]) * a
        P[0, 0] = 1e-6
        A = Xa.T @ (Xa * w[:, None]) / w.mean() + P
        return np.linalg.solve(A, Xa.T @ (w * y) / w.mean())

    @staticmethod
    def _pred(X, b):
        return b[0] + X @ b[1:]

    def predict(self, X: pd.DataFrame):
        X = X[self.cols].to_numpy(float)
        return self._pred(X, self.bo), self._pred(X, self.bd)

    def weights(self) -> dict:
        """Συντελεστές της NET επιρροής (O − D) ανά στατιστικό: πόντοι/100 ανά τυπική απόκλιση."""
        return {c: round(float(o - d), 2) for c, o, d in zip(self.cols, self.bo[1:], self.bd[1:])}
