"""
Κοινή μηχανή ratings ομάδων (Python): τη χρησιμοποιούν το analytics.py (σελίδα «Ανάλυση»)
και το edge_model.py (μοντέλο στοιχήματος).

Μοντέλο (ανά διοργάνωση):
  πόντοι ανά 100 κατοχές ομάδας A απέναντι στη B
      = μέσος λίγκας + off[A] + def[B] ± έδρα/2
  κατοχές αγώνα = μέσος ρυθμός + pace[A] + pace[B]
Λύνεται με σταθμισμένη ridge regression: κάθε αγώνας ζυγίζει exp(-ηλικία/τ) (πρόσφατοι μετράνε
περισσότερο, οι αγώνες της προηγούμενης σεζόν σβήνουν σταδιακά) και η ποινή λ τραβά τις ομάδες με
λίγα ματς προς τον μέσο όρο. Η έδρα εκτιμάται από τα δεδομένα (δεν είναι σταθερή όπως στο Monte Carlo).
Έτσι τα ratings είναι προσαρμοσμένα στη δυσκολία του προγράμματος (opponent-adjusted).
"""
import numpy as np
import pandas as pd

from dataset import CompetitionData


def team_games(data: CompetitionData) -> pd.DataFrame:
    """Ένα row ανά (αγώνα, ομάδα) με πόντους, κατοχές και τα στοιχεία των four factors."""
    lg = data.logs
    if len(lg):
        t = (lg.groupby(["season", "gameCode", "date", "team", "opp", "home"], as_index=False)
             [["PTS", "FG2M", "FG2A", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "TOV", "AST", "STL", "BLK", "PF"]].sum())
        t["FGA"], t["FGM"] = t.FG2A + t.FG3A, t.FG2M + t.FG3M
        t["POSS_RAW"] = t.FGA + 0.44 * t.FTA - t.OREB + t.TOV
        o = t[["season", "gameCode", "team", "PTS", "POSS_RAW", "FGA", "FGM", "FG3M", "FG3A", "FTA", "FTM",
               "OREB", "DREB", "TOV"]].rename(columns=lambda c: c if c in ("season", "gameCode") else "o_" + c)
        o = o.rename(columns={"o_team": "opp"})
        t = t.merge(o, on=["season", "gameCode", "opp"])
        t["POSS"] = (t.POSS_RAW + t.o_POSS_RAW) / 2
        t["OPP"] = t["o_PTS"]
        t["box"] = True
    else:
        g = data.games[data.games.played & data.games.homescore.notna()]
        h = g.assign(team=g.homecode, opp=g.awaycode, home=1, PTS=g.homescore, OPP=g.awayscore)
        a = g.assign(team=g.awaycode, opp=g.homecode, home=0, PTS=g.awayscore, OPP=g.homescore)
        t = pd.concat([h, a])[["season", "gameCode", "date", "team", "opp", "home", "PTS", "OPP"]]
        t["date"] = pd.to_datetime(t["date"])
        t["POSS"] = 100.0                       # χωρίς box scores: ratings = πόντοι ανά αγώνα
        t["box"] = False
    t = t[t.POSS > 0].copy()
    t["ORTG"] = 100 * t.PTS / t.POSS
    t["DRTG"] = 100 * t.OPP / t.POSS
    t["MARGIN"] = t.PTS - t.OPP
    return t.sort_values(["date", "gameCode", "home"]).reset_index(drop=True)


class RidgeRatings:
    """Ratings από σταθμισμένη ridge regression. fit() σε team-games, predict() για ζευγάρια."""

    def __init__(self, tau: float = 90.0, lam: float = 6.0, lam_pace: float = 6.0):
        self.tau, self.lam, self.lam_pace = tau, lam, lam_pace

    def fit(self, tg: pd.DataFrame, asof=None, weights=None):
        """tg: team-games ΠΡΙΝ από το asof (ο καλών φροντίζει να μην περάσει μέλλον)."""
        self.teams = sorted(set(tg.team) | set(tg.opp))
        ix = {t: i for i, t in enumerate(self.teams)}
        n, T = len(tg), len(self.teams)
        if weights is None:
            age = ((pd.Timestamp(asof) - tg["date"]).dt.days.to_numpy() if asof is not None
                   else np.zeros(n))
            w = np.exp(-np.maximum(age, 0) / self.tau)
        else:
            w = np.asarray(weights, float)
        poss = tg.POSS.to_numpy(float)
        ww = w * poss / poss.mean()                        # περισσότερες κατοχές -> πιο αξιόπιστο
        self.lg = float(np.sum(ww * tg.ORTG) / np.sum(ww))
        y = tg.ORTG.to_numpy(float) - self.lg
        X = np.zeros((n, 2 * T + 1))
        X[np.arange(n), [ix[t] for t in tg.team]] = 1                 # επίθεση ομάδας
        X[np.arange(n), [T + ix[t] for t in tg.opp]] = 1              # άμυνα αντιπάλου (πόντοι που επιτρέπει)
        X[:, -1] = np.where(tg.home.to_numpy() == 1, 0.5, -0.5)       # έδρα (διαφορά γηπεδούχου-φιλοξ. / 100 κατοχές)
        P = np.full(2 * T + 1, self.lam)
        P[-1] = 1e-3
        A = X.T @ (X * ww[:, None]) + np.diag(P)
        beta = np.linalg.solve(A, X.T @ (ww * y))
        self.off, self.dfn, self.hca = beta[:T], beta[T:2 * T], float(beta[-1])
        # ρυθμός: ένα row ανά αγώνα
        g = tg[tg.home == 1]
        wg = w[tg.home.to_numpy() == 1]
        self.lg_pace = float(np.sum(wg * g.POSS) / np.sum(wg)) if len(g) else 72.0
        Xp = np.zeros((len(g), T))
        Xp[np.arange(len(g)), [ix[t] for t in g.team]] = 1
        Xp[np.arange(len(g)), [ix[t] for t in g.opp]] += 1
        Ap = Xp.T @ (Xp * wg[:, None]) + np.diag(np.full(T, self.lam_pace))
        self.pace = np.linalg.solve(Ap, Xp.T @ (wg * (g.POSS.to_numpy(float) - self.lg_pace))) if len(g) else np.zeros(T)
        self.ix = ix
        # πόσα (σταθμισμένα) ματς στηρίζουν κάθε ομάδα
        self.n_eff = np.zeros(T)
        np.add.at(self.n_eff, [ix[t] for t in tg.team], w)
        return self

    def team(self, code):
        i = self.ix.get(code)
        if i is None:
            return 0.0, 0.0, 0.0
        return self.off[i], self.dfn[i], self.pace[i]

    def predict(self, home, away, neutral=False):
        """-> (πόντοι γηπεδούχου, πόντοι φιλοξενούμενου, κατοχές)."""
        oh, dh, ph = self.team(home)
        oa, da, pa = self.team(away)
        hc = 0 if neutral else self.hca / 2
        poss = self.lg_pace + ph + pa
        return (self.lg + oh + da + hc) * poss / 100, (self.lg + oa + dh - hc) * poss / 100, poss

    def table(self) -> pd.DataFrame:
        return pd.DataFrame({"team": self.teams, "adj_o": self.lg + self.off, "adj_d": self.lg + self.dfn,
                             "adj_net": self.off - self.dfn, "adj_pace": self.lg_pace + self.pace,
                             "n_eff": self.n_eff})


# ---------------------------------------------------------------------------
# Απουσίες βασικών παικτών (η μεγαλύτερη πληροφορία που έχει η αγορά και λείπει από τα ratings ομάδας)
# ---------------------------------------------------------------------------
REG_GAMES, REG_MIN, REPL_PIR_PER_MIN = 5, 18.0, 0.25


def regulars(logs: pd.DataFrame, team: str, season: int, before, last_n=10) -> pd.DataFrame:
    """Βασικοί παίκτες ομάδας πριν από μια ημερομηνία: ≥5 από τα 10 τελευταία ματς της, ≥18' μέσο όρο.
    value = μέσο PIR ανά αγώνα πάνω από επίπεδο αντικαταστάτη (0.25 PIR/λεπτό)."""
    pl = logs[(logs.team == team) & (logs.season == season) & (logs.date < before)]
    last = pl.drop_duplicates("gameCode").sort_values("date").gameCode.tail(last_n)
    pp = pl[pl.gameCode.isin(last)]
    st = pp.groupby("pid").agg(n=("MIN", "size"), mn=("MIN", "mean"), pir=("PIR", "mean"), player=("player", "last"))
    st = st[(st.n >= REG_GAMES) & (st.mn >= REG_MIN)]
    st["value"] = (st.pir - REPL_PIR_PER_MIN * st.mn).clip(lower=0)
    return st


def availability(data: CompetitionData) -> pd.DataFrame:
    """Για κάθε παιγμένο (αγώνα, ομάδα): αξία και λεπτά των βασικών που ΔΕΝ έπαιξαν (μόνο από προηγούμενα ματς)."""
    lg = data.logs
    if lg.empty:
        return pd.DataFrame(columns=["gameCode", "team", "miss_val", "miss_min"])
    lg = lg.sort_values(["date", "gameCode"])
    out = []
    for (team, season), pl in lg.groupby(["team", "season"]):
        games = pl.drop_duplicates("gameCode").sort_values("date")[["gameCode", "date"]].to_numpy()
        played = pl.groupby("gameCode").pid.apply(set).to_dict()
        for i, (gc, d) in enumerate(games):
            prev = games[max(0, i - 10):i, 0]
            if len(prev) < REG_GAMES:
                out.append((gc, team, 0.0, 0.0))
                continue
            pp = pl[pl.gameCode.isin(prev)]
            st = pp.groupby("pid").agg(n=("MIN", "size"), mn=("MIN", "mean"), pir=("PIR", "mean"))
            st = st[(st.n >= REG_GAMES) & (st.mn >= REG_MIN)]
            miss = st[~st.index.isin(played.get(gc, set()))]
            out.append((gc, team, float((miss.pir - REPL_PIR_PER_MIN * miss.mn).clip(lower=0).sum()), float(miss.mn.sum())))
    return pd.DataFrame(out, columns=["gameCode", "team", "miss_val", "miss_min"])
