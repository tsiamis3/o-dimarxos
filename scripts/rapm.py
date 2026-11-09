"""
RAPM (Regularized Adjusted Plus-Minus) από stints.

Για κάθε stint δύο παρατηρήσεις (επίθεση γηπεδούχου, επίθεση φιλοξενούμενου):
    100 × πόντοι / κατοχές = μέσος + Σ O[5 επιτιθέμενων] + Σ D[5 αμυνόμενων] ± έδρα/2
βάρος = κατοχές × e^(−ηλικία/τ). Ridge: κάθε O, D τραβιέται προς το prior του (0 ή box-score prior)
με ποινή λ. Αποτέλεσμα ανά παίκτη: O (πόντοι που προσθέτει στην επίθεση /100), D (πόντοι που
επιτρέπει /100· αρνητικό = καλή άμυνα), NET = O − D.
"""
import numpy as np
import pandas as pd

H = [f"h{i}" for i in range(5)]
A = [f"a{i}" for i in range(5)]


class RAPM:
    def __init__(self, lam=2000.0, tau=365.0):
        self.lam, self.tau = lam, tau

    def fit(self, st: pd.DataFrame, asof=None, prior_o=None, prior_d=None):
        """st: stints με στήλες h0..h4, a0..a4, pts_h, pts_a, poss_h, poss_a, date."""
        st = st[(st.poss_h + st.poss_a) > 0.5]
        players = pd.unique(st[H + A].to_numpy().ravel())
        ix = {p: i for i, p in enumerate(players)}
        P, n = len(players), len(st)
        age = ((pd.Timestamp(asof) - st.date).dt.days.to_numpy() if asof is not None else np.zeros(n))
        w0 = np.exp(-np.maximum(age, 0) / self.tau)
        poss = ((st.poss_h + st.poss_a) / 2).to_numpy()
        hi = np.vectorize(ix.get)(st[H].to_numpy())
        ai = np.vectorize(ix.get)(st[A].to_numpy())
        # δύο παρατηρήσεις ανά stint
        y = np.r_[100 * st.pts_h.to_numpy() / np.maximum(poss, 0.5), 100 * st.pts_a.to_numpy() / np.maximum(poss, 0.5)]
        w = np.r_[w0 * poss, w0 * poss]
        self.lg = float(np.sum(w * y) / np.sum(w))
        rows = np.arange(2 * n)
        # παράμετροι: O[0..P), D[P..2P), έδρα
        from scipy.sparse import csr_matrix
        r, c = [], []
        for k in range(5):
            r += [rows[:n], rows[n:]]                         # επίθεση: home στις πρώτες n, away στις επόμενες
            c += [hi[:, k], ai[:, k]]
            r += [rows[:n], rows[n:]]                         # άμυνα αντιπάλου
            c += [P + ai[:, k], P + hi[:, k]]
        r, c = np.concatenate(r), np.concatenate(c)
        X = csr_matrix((np.ones(len(r)), (r, c)), shape=(2 * n, 2 * P + 1)).tolil()
        X[:n, 2 * P] = 0.5
        X[n:, 2 * P] = -0.5
        X = X.tocsr()
        pri = np.zeros(2 * P + 1)
        if prior_o is not None:
            pri[:P] = pd.Series(players).map(prior_o).fillna(0).to_numpy()
        if prior_d is not None:
            pri[P:2 * P] = pd.Series(players).map(prior_d).fillna(0).to_numpy()
        yr = y - self.lg - X @ pri                            # ridge γύρω από το prior
        Xw = X.multiply(w[:, None]).tocsr()
        Atx = (X.T @ Xw).toarray()
        pen = np.full(2 * P + 1, self.lam)
        pen[-1] = 1.0
        beta = np.linalg.solve(Atx + np.diag(pen), X.T @ (w * yr)) + pri
        self.players = players
        self.O, self.D, self.hca = beta[:P], beta[P:2 * P], float(beta[-1])
        expo = np.zeros(P)
        np.add.at(expo, hi.ravel(), np.repeat(w0 * poss, 5))
        np.add.at(expo, ai.ravel(), np.repeat(w0 * poss, 5))
        self.poss = expo
        self.o = dict(zip(players, self.O))
        self.d = dict(zip(players, self.D))
        return self

    def table(self) -> pd.DataFrame:
        return pd.DataFrame({"pid": self.players, "O": self.O, "D": self.D, "NET": self.O - self.D, "poss": self.poss})

    def team_net(self, minutes: dict, game_min=40.0) -> float:
        """minutes: {pid: λεπτά}. Net /100 της ομάδας = Σ (λεπτά/λεπτά αγώνα) × (O − D)."""
        return sum(m / game_min * (self.o.get(p, 0.0) - self.d.get(p, 0.0)) for p, m in minutes.items())
