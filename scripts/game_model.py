"""
Νευρωνικό δίκτυο πρόβλεψης ΑΓΩΝΩΝ (Keras), δίπλα στο Monte Carlo (GameSimulator / MatchSim), όχι στη θέση του.

Είσοδος (για κάθε ομάδα, μόνο από αγώνες ΠΡΙΝ από το ματς, μέσα στη σεζόν):
  ratings επίθεσης/άμυνας και ρυθμός (με "τράβηγμα" προς τον μέσο όρο, όπως το Monte Carlo),
  φόρμα 5 αγώνων (διαφορά, νίκες, ratings), four factors επίθεσης και άμυνας
  (eFG%, TOV%, OREB%, FT rate), ξεκούραση (ημέρες, back-to-back), έδρα (απόδοση εντός/εκτός).
  Διοργανώσεις χωρίς box scores (π.χ. Α2 γυναικών): μόνο ό,τι βγαίνει από το σκορ.

Έξοδος: πόντοι γηπεδούχου και φιλοξενούμενου ως διμεταβλητή κανονική κατανομή
  (μέσοι, τυπικές αποκλίσεις, συσχέτιση) -> Gaussian negative log-likelihood.
  Πιθανότητα νίκης γηπεδούχου = P(διαφορά > 0) = Φ((μ_h − μ_a) / σ_διαφοράς).

Εκπαίδευση: ένα μοντέλο ανά διοργάνωση, χρονικό split (τελευταίο 15% των αγώνων = test,
  τελευταίο 10% του train = validation για early stopping). Για τις προβλέψεις των επερχόμενων
  ξαναεκπαιδεύεται σε όλους τους αγώνες με τον ίδιο αριθμό εποχών.

Σύγκριση με το Monte Carlo στους ΙΔΙΟΥΣ αγώνες:
  - test: walk-forward backtest του GameSimulator (evaluate.py) πάνω στα ματς του test
  - ζωντανά: αρχείο προβλέψεων data/predictions/{C}_games_nn.csv απέναντι στο {C}_games.csv του Monte Carlo
  Μετρικές: σωστός νικητής, Brier, log loss, βαθμονόμηση, σφάλμα σκορ (γηπ./φιλοξ./διαφορά/σύνολο),
  κάλυψη διαστήματος 80%.

Έξοδοι: models/{C}_game_nn.keras, models/{C}_game_nn_scaler.npz, site/data/gamenn_{C}.json

Τρέχει μετά το evaluate.py (διαβάζει το αρχείο προβλέψεων του Monte Carlo) και πριν το build_site.py.

    python scripts/game_model.py                       # όλες οι διοργανώσεις
    python scripts/game_model.py --comp E --arch mlp_wide --epochs 300 --seeds 5
"""
import argparse
import json
import math
import os
import traceback
from datetime import datetime, timezone

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import pandas as pd

from config import COMPETITIONS, MODEL_DIR, PRED_DIR, RAW_DIR, SITE_DATA
from dataset import CompetitionData
from evaluate import TODAY, GameSimulator, _keep_pregame, _r

TEST_FRAC = 0.15
VAL_FRAC = 0.10
SHRINK = GameSimulator.SHRINK     # ίδια "εικονικά" ματς μέσου όρου με το Monte Carlo
MIN_GAMES = 120                   # λιγότεροι αγώνες -> δεν εκπαιδεύεται μοντέλο
UPCOMING_DAYS = 10                # ίδιο παράθυρο με το αρχείο προβλέψεων του Monte Carlo
Z80 = 1.2815516                   # διάστημα 80%


# ----------------------------------------------------------------------------
# 1) Features (ένα row ανά αγώνα, μόνο από προηγούμενους αγώνες)
# ----------------------------------------------------------------------------
class GameFeatureBuilder:
    BOX = ["FGM", "FG3M", "FGA", "FTA", "OREB", "DREB", "TOV"]

    def __init__(self, data: CompetitionData):
        self.data = data
        self.has_box = data.has_box
        self.cur_season = max(data.seasons)
        self.feature_cols: list[str] = []

    # --- ένα row ανά (αγώνα, ομάδα): παιγμένοι + επερχόμενοι (με NaN) ---
    def _team_games(self) -> pd.DataFrame:
        g = self.data.games.copy()
        g["date"] = pd.to_datetime(g["date"], errors="coerce")
        g = g[g["date"].notna()]
        lg = self.data.logs
        if self.has_box:
            t = (lg.groupby(["season", "gameCode", "team"], as_index=False)
                 [["PTS", "FG2M", "FG2A", "FG3M", "FG3A", "FTA", "OREB", "DREB", "TOV"]].sum())
            t["FGM"], t["FGA"] = t.FG2M + t.FG3M, t.FG2A + t.FG3A
            t["POSS"] = t.FGA + 0.44 * t.FTA - t.OREB + t.TOV
            box = t.set_index(["season", "gameCode", "team"])
            done = set(zip(t.season, t.gameCode))
            played = g[[k in done for k in zip(g.season, g.gameCode)]]
            upcoming = g[[(k not in done) and (not p) for k, p in zip(zip(g.season, g.gameCode), g.played)]]
        else:
            ok = g.played & g.homescore.notna() & g.awayscore.notna()
            played, upcoming = g[ok], g[~g.played]
        upcoming = upcoming[upcoming.season == self.cur_season]

        rows = []
        for df, is_played in ((played, 1), (upcoming, 0)):
            for r in df.itertuples():
                for team, opp, home in ((r.homecode, r.awaycode, 1), (r.awaycode, r.homecode, 0)):
                    rows.append(dict(season=r.season, gameCode=int(r.gameCode), date=r.date,
                                     team=team, opp=opp, home=home, played=is_played,
                                     PTS=(r.homescore if home else r.awayscore) if is_played else np.nan))
        tg = pd.DataFrame(rows)
        if self.has_box:
            idx = list(zip(tg.season, tg.gameCode, tg.team))
            for c in ["PTS", "POSS", *self.BOX]:
                tg[c] = [box[c].get(k, np.nan) for k in idx]
        else:
            tg["POSS"] = np.where(tg.played == 1, 100.0, np.nan)
        tg.loc[tg.played == 0, "PTS"] = np.nan
        # στήλες του αντιπάλου στο ίδιο ματς
        oc = ["PTS", "POSS", *(self.BOX if self.has_box else [])]
        o = tg[["season", "gameCode", "team", *oc]].rename(columns={"team": "opp", **{c: "o_" + c for c in oc}})
        tg = tg.merge(o, on=["season", "gameCode", "opp"], how="left")
        tg["POSS"] = (tg.POSS + tg.o_POSS) / 2           # κοινές κατοχές, όπως το Monte Carlo
        tg["o_POSS"] = tg["POSS"]
        return tg.sort_values(["date", "gameCode", "home"]).reset_index(drop=True)

    # --- μέσοι όροι λίγκας ως την προηγούμενη ημέρα ---
    def _league(self, tg: pd.DataFrame, num: dict) -> pd.DataFrame:
        cols = sorted({c for pair in num.values() for c in pair} | {"PTS", "POSS"})
        x = tg[["season", "date", *cols]].copy()
        x[cols] = x[cols].fillna(0)
        x["GP"] = tg["played"]
        d = x.groupby(["season", "date"])[cols + ["GP"]].sum().sort_index()
        prev = d.groupby(level="season").cumsum() - d                  # μόνο πριν από την ημέρα
        out = pd.DataFrame(index=d.index)
        out["lg_ortg"] = 100 * prev.PTS / prev.POSS
        out["lg_pace"] = prev.POSS / prev.GP
        for k, (a, b) in num.items():
            out["lg_" + k] = prev[a] / prev[b]
        out = out.replace([np.inf, -np.inf], np.nan)
        # πρώτη ημέρα σεζόν: τελικοί μέσοι της προηγούμενης σεζόν
        final = (d.groupby(level="season").sum())
        fin = pd.DataFrame({"lg_ortg": 100 * final.PTS / final.POSS, "lg_pace": final.POSS / final.GP,
                            **{"lg_" + k: final[a] / final[b] for k, (a, b) in num.items()}})
        fin.index = fin.index + 1
        fill = fin.reindex(out.index.get_level_values("season")).set_axis(out.index)
        return out.fillna(fill).reset_index()

    def build(self) -> pd.DataFrame:
        tg = self._team_games()
        if self.has_box:
            # four factors: αριθμητής / παρονομαστής (επίθεση και άμυνα = ίδια μέτρα του αντιπάλου)
            tg["EFGN"], tg["o_EFGN"] = tg.FGM + 0.5 * tg.FG3M, tg.o_FGM + 0.5 * tg.o_FG3M
            tg["ORBD"], tg["o_ORBD"] = tg.OREB + tg.o_DREB, tg.o_OREB + tg.DREB
            num = {"efg": ("EFGN", "FGA"), "tov": ("TOV", "POSS"), "orb": ("OREB", "ORBD"), "ftr": ("FTA", "FGA"),
                   "oefg": ("o_EFGN", "o_FGA"), "otov": ("o_TOV", "o_POSS"), "oorb": ("o_OREB", "o_ORBD"),
                   "oftr": ("o_FTA", "o_FGA")}
        else:
            num = {}
        league = self._league(tg, num)
        tg = tg.merge(league, on=["season", "date"], how="left")

        gs = tg.groupby(["team", "season"], sort=False)
        gp = gs["played"].cumsum() - tg["played"]
        f = pd.DataFrame(index=tg.index)

        def prev_sum(col):
            x = tg[col].fillna(0)
            return x.groupby([tg.team, tg.season]).cumsum() - x

        def shrunk(v, ref):
            v = v.where(gp > 0, ref)
            return (gp * v + SHRINK * ref) / (gp + SHRINK)

        pts, opp, poss = prev_sum("PTS"), prev_sum("o_PTS"), prev_sum("POSS")
        f["ortg"] = shrunk(100 * pts / poss, tg.lg_ortg)
        f["drtg"] = shrunk(100 * opp / poss, tg.lg_ortg)
        f["pace"] = shrunk(poss / gp, tg.lg_pace)
        for k, (a, b) in num.items():
            f[k] = shrunk(prev_sum(a) / prev_sum(b), tg["lg_" + k])

        # φόρμα 5 αγώνων (μέσα στη σεζόν)
        tg["margin"] = tg.PTS - tg.o_PTS
        tg["win"] = np.where(tg.played == 1, (tg.margin > 0).astype(float), np.nan)
        tg["g_ortg"], tg["g_drtg"] = 100 * tg.PTS / tg.POSS, 100 * tg.o_PTS / tg.POSS

        def last5(col):
            return gs[col].transform(lambda s: s.shift(1).rolling(5, min_periods=1).mean())

        f["f5_margin"] = last5("margin").fillna(0)
        f["f5_win"] = last5("win").fillna(0.5)
        f["f5_ortg"] = last5("g_ortg").fillna(f["ortg"])
        f["f5_drtg"] = last5("g_drtg").fillna(f["drtg"])

        # ξεκούραση: ημέρες από τον προηγούμενο αγώνα της ομάδας (και από προηγούμενη σεζόν)
        rest = tg.groupby("team")["date"].diff().dt.days
        f["rest"] = rest.clip(0, 14).fillna(14) / 7
        f["b2b"] = (rest <= 1).astype(float)

        # έδρα: διαφορά της ομάδας στο συγκεκριμένο γήπεδο (εντός/εκτός) μείον τη συνολική της
        same = tg["home"]
        x = tg["margin"].fillna(0)
        n_v = (tg["played"] * 1.0).groupby([tg.team, tg.season, same]).cumsum() - tg["played"]
        s_v = x.groupby([tg.team, tg.season, same]).cumsum() - x
        m_all = (prev_sum("PTS") - prev_sum("o_PTS")) / gp.replace(0, np.nan)
        venue = (s_v / n_v.replace(0, np.nan) - m_all.fillna(0)).fillna(0)
        f["venue"] = n_v * venue / (n_v + SHRINK)
        f["log_gp"] = np.log1p(gp)

        tg = pd.concat([tg, f.add_prefix("t_")], axis=1)
        side_cols = list(f.columns)
        h = tg[tg.home == 1].set_index(["season", "gameCode"])
        a = tg[tg.home == 0].set_index(["season", "gameCode"])
        a = a.reindex(h.index)
        out = h[["date", "team", "opp", "played", "PTS", "o_PTS", "lg_ortg", "lg_pace"]].rename(
            columns={"team": "home", "opp": "away", "PTS": "hs", "o_PTS": "as_"})
        for c in side_cols:
            out["h_" + c] = h["t_" + c]
            out["a_" + c] = a["t_" + c]
        for k in num:                 # μέσοι λίγκας των four factors (όχι features εδώ· τα χρησιμοποιεί το master_model.py)
            out["ref_" + k] = h["lg_" + k]
        if not self.has_box:          # χωρίς box scores ο ρυθμός είναι σταθερός -> δεν είναι feature
            out = out.drop(columns=["h_pace", "a_pace", "lg_pace"])
        self.feature_cols = [c for c in out.columns if c.startswith(("h_", "a_", "lg_"))]
        out = out.reset_index()
        out = out[out[self.feature_cols].notna().all(axis=1)]    # 1η ημέρα της 1ης σεζόν: χωρίς ιστορικό λίγκας
        return out.sort_values(["date", "gameCode"]).reset_index(drop=True)


# ----------------------------------------------------------------------------
# 2) Αρχιτεκτονικές (εύκολη εναλλαγή: --arch, πρόσθεσε εδώ νέες)
#    Όλες βγάζουν 5 τιμές: μ_h, μ_a, σ_h, σ_a (πριν το softplus), ρ (πριν το tanh)
# ----------------------------------------------------------------------------
def linear(n_in):
    from tensorflow import keras
    return keras.Sequential([keras.Input((n_in,)), keras.layers.Dense(5)])


def mlp_small(n_in):
    from tensorflow import keras
    reg = keras.regularizers.l2(1e-3)
    return keras.Sequential([
        keras.Input((n_in,)),
        keras.layers.Dense(32, activation="relu", kernel_regularizer=reg),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(16, activation="relu", kernel_regularizer=reg),
        keras.layers.Dense(5),
    ])


def mlp_wide(n_in):
    from tensorflow import keras
    reg = keras.regularizers.l2(1e-3)
    return keras.Sequential([
        keras.Input((n_in,)),
        keras.layers.Dense(128, activation="relu", kernel_regularizer=reg),
        keras.layers.BatchNormalization(),
        keras.layers.Dropout(0.3),
        keras.layers.Dense(64, activation="relu", kernel_regularizer=reg),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(32, activation="relu"),
        keras.layers.Dense(5),
    ])


GARCHS = {"linear": linear, "mlp_small": mlp_small, "mlp_wide": mlp_wide}


def _params(out):
    """Raw έξοδος -> (μ_h, μ_a, σ_h, σ_a, ρ) σε κανονικοποιημένες μονάδες."""
    from tensorflow import keras
    o = keras.ops
    sh = o.softplus(out[:, 2]) + 0.05
    sa = o.softplus(out[:, 3]) + 0.05
    rho = 0.9 * o.tanh(out[:, 4])
    return out[:, 0], out[:, 1], sh, sa, rho


def gaussian_nll(y_true, y_pred):
    """Αρνητική log-πιθανοφάνεια διμεταβλητής κανονικής (πόντοι γηπεδούχου, φιλοξενούμενου)."""
    from tensorflow import keras
    o = keras.ops
    mh, ma, sh, sa, rho = _params(y_pred)
    zh, za = (y_true[:, 0] - mh) / sh, (y_true[:, 1] - ma) / sa
    q = 1 - rho ** 2
    return o.mean(o.log(sh) + o.log(sa) + 0.5 * o.log(q) + (zh ** 2 - 2 * rho * zh * za + za ** 2) / (2 * q))


def _phi(x):
    return 0.5 * (1 + np.vectorize(math.erf)(np.asarray(x) / math.sqrt(2)))


class GameNNModel:
    """Κανονικοποίηση + ensemble από Keras δίκτυα (διαφορετικά seeds) με Gaussian έξοδο."""

    def __init__(self, feature_cols, arch="mlp_small", seeds=3):
        self.feature_cols, self.arch, self.seeds = feature_cols, arch, seeds
        self.models, self.histories, self.best_epochs = [], [], []

    def _X(self, df):
        return ((df[self.feature_cols].to_numpy("float32") - self.x_mu) / self.x_sd).astype("float32")

    def _Y(self, df):
        return ((df[["hs", "as_"]].to_numpy("float32") - self.y_mu) / self.y_sd).astype("float32")

    def fit(self, train: pd.DataFrame, epochs=300, val_frac=VAL_FRAC, fixed_epochs=None):
        import tensorflow as tf
        from tensorflow import keras
        X = train[self.feature_cols].to_numpy("float32")
        Y = train[["hs", "as_"]].to_numpy("float32")
        sd = X.std(0)
        self.x_mu, self.x_sd = X.mean(0), np.where(sd < 1e-6, 1.0, sd)   # σταθερά features -> 0
        self.y_mu, self.y_sd = Y.mean(), Y.std() + 1e-6       # κοινή κλίμακα για τα δύο σκορ
        Xs, Ys = self._X(train), self._Y(train)
        n_val = int(val_frac * len(Xs)) if fixed_epochs is None else 0
        self.models, self.histories, self.best_epochs = [], [], []
        for s in range(self.seeds):
            tf.keras.utils.set_random_seed(s)
            m = GARCHS[self.arch](Xs.shape[1])
            m.compile(optimizer=keras.optimizers.Adam(1e-3), loss=gaussian_nll)
            if fixed_epochs is None:
                h = m.fit(Xs[:-n_val], Ys[:-n_val], validation_data=(Xs[-n_val:], Ys[-n_val:]),
                          epochs=epochs, batch_size=64, verbose=0,
                          callbacks=[keras.callbacks.EarlyStopping(patience=25, restore_best_weights=True),
                                     keras.callbacks.ReduceLROnPlateau(patience=10, factor=0.5)])
                self.best_epochs.append(int(np.argmin(h.history["val_loss"])) + 1)
            else:
                h = m.fit(Xs, Ys, epochs=fixed_epochs[s], batch_size=64, verbose=0)
            self.models.append(m)
            self.histories.append(h.history)
        return self

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """Μέσοι/αποκλίσεις σε πόντους + πιθανότητα νίκης (μέσος όρος του ensemble)."""
        X = self._X(df)
        mhs, mas, shs, sas, rhos, ps = [], [], [], [], [], []
        for m in self.models:
            mh, ma, sh, sa, rho = (np.asarray(v) for v in _params(m.predict(X, verbose=0)))
            mh, ma = mh * self.y_sd + self.y_mu, ma * self.y_sd + self.y_mu
            sh, sa = sh * self.y_sd, sa * self.y_sd
            sd_m = np.sqrt(np.maximum(sh ** 2 + sa ** 2 - 2 * rho * sh * sa, 1e-6))
            mhs.append(mh); mas.append(ma); shs.append(sh); sas.append(sa); rhos.append(rho)
            ps.append(_phi((mh - ma) / sd_m))
        mh, ma = np.mean(mhs, 0), np.mean(mas, 0)
        # αβεβαιότητα του μείγματος = μέση διασπορά + διασπορά των μέσων
        sh = np.sqrt(np.mean(np.square(shs), 0) + np.var(mhs, 0))
        sa = np.sqrt(np.mean(np.square(sas), 0) + np.var(mas, 0))
        return pd.DataFrame({"mh": mh, "ma": ma, "sh": sh, "sa": sa, "rho": np.mean(rhos, 0),
                             "p": np.mean(ps, 0)}, index=df.index)

    def save(self, comp):
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        self.models[0].save(MODEL_DIR / f"{comp}_game_nn.keras")
        np.savez(MODEL_DIR / f"{comp}_game_nn_scaler.npz", x_mu=self.x_mu, x_sd=self.x_sd,
                 y_mu=self.y_mu, y_sd=self.y_sd, features=np.array(self.feature_cols))


# ----------------------------------------------------------------------------
# 3) Μετρικές (ίδιες για Monte Carlo και νευρωνικό)
# ----------------------------------------------------------------------------
def score(df: pd.DataFrame) -> dict:
    """df: mh, ma, p, hs, as_ και προαιρετικά sh, sa (αλλιώς σ του Monte Carlo)."""
    if df.empty:
        return {"n": 0}
    s = GameSimulator.score(df)
    y = (df.hs > df.as_).astype(float)
    p = df.p.astype(float).clip(1e-4, 1 - 1e-4)
    sh = df["sh"] if "sh" in df else GameSimulator.SD
    sa = df["sa"] if "sa" in df else GameSimulator.SD
    cover = ((np.abs(df.hs - df.mh) <= Z80 * sh).mean() + (np.abs(df.as_ - df.ma) <= Z80 * sa).mean()) / 2
    s.update({"logloss": _r(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)), 4),
              "mae_home": _r(np.mean(np.abs(df.mh - df.hs)), 2),
              "mae_away": _r(np.mean(np.abs(df.ma - df.as_)), 2),
              "cover80": _r(cover),
              "sd": _r(np.mean((np.asarray(sh) + np.asarray(sa)) / 2) if "sh" in df else GameSimulator.SD, 2)})
    return s


# ----------------------------------------------------------------------------
# 4) Εκπαίδευση + σύγκριση + αρχείο προβλέψεων + export
# ----------------------------------------------------------------------------
class GameNNTrainer:
    def __init__(self, comp: str, arch: str, epochs: int, seeds: int):
        self.comp, self.arch, self.epochs, self.seeds = comp, arch, epochs, seeds
        self.log_path = PRED_DIR / f"{comp}_games_nn.csv"

    def run(self):
        print(f"== {COMPETITIONS[self.comp]}: game NN ({self.arch})")
        data = CompetitionData(self.comp)
        fb = GameFeatureBuilder(data)
        df = fb.build()
        hist, nxt = df[df.played == 1], df[df.played == 0]
        if len(hist) < MIN_GAMES:
            print(f"   ! only {len(hist)} games (< {MIN_GAMES}) -> skip")
            return

        # χρονικό split
        cut = hist["date"].quantile(1 - TEST_FRAC)
        train, test = hist[hist.date < cut], hist[hist.date >= cut]
        print(f"   train {len(train)}  test {len(test)}  upcoming {len(nxt)}  features {len(fb.feature_cols)}")
        model = GameNNModel(fb.feature_cols, self.arch, self.seeds).fit(train, epochs=self.epochs)
        pt = model.predict(test)
        nn_test = pd.concat([test[["season", "gameCode", "date", "home", "away", "hs", "as_"]], pt], axis=1)

        # Monte Carlo στους ίδιους αγώνες (walk-forward backtest του evaluate.py)
        mc = GameSimulator(data).backtest()
        mc = mc[["season", "gameCode", "mh", "ma", "p"]] if len(mc) else pd.DataFrame(
            columns=["season", "gameCode", "mh", "ma", "p"])
        both = nn_test.merge(mc, on=["season", "gameCode"], suffixes=("", "_mc"))
        nn_s = score(both[["mh", "ma", "sh", "sa", "p", "hs", "as_"]])
        mc_s = score(both[["mh_mc", "ma_mc", "p_mc", "hs", "as_"]].set_axis(["mh", "ma", "p", "hs", "as_"], axis=1))
        print(f"   test {nn_s.get('n', 0)} games | NN acc {nn_s.get('acc')} brier {nn_s.get('brier')}"
              f" | MC acc {mc_s.get('acc')} brier {mc_s.get('brier')}")

        # τελικό μοντέλο σε όλους τους αγώνες -> επερχόμενα
        final = GameNNModel(fb.feature_cols, self.arch, self.seeds).fit(hist, fixed_epochs=model.best_epochs)
        final.save(self.comp)
        up = nxt.copy()
        if len(up):
            up = pd.concat([up[["season", "gameCode", "date", "home", "away"]], final.predict(up)], axis=1)
        live, recent = self._live(data, up)

        self._export(data, fb, model, train, test, nn_s, mc_s, up, live, recent)

    # --- αρχείο προβλέψεων + ζωντανή σύγκριση με το αρχείο του Monte Carlo ---
    def _live(self, data, up: pd.DataFrame):
        old = pd.read_csv(self.log_path) if self.log_path.exists() else pd.DataFrame()
        new = up[up.date <= pd.Timestamp.now() + pd.Timedelta(days=UPCOMING_DAYS)].copy()
        if len(new):
            new["date"] = new["date"].dt.strftime("%Y-%m-%d")
            new.insert(0, "made_at", TODAY)
            new = new.round({"mh": 1, "ma": 1, "sh": 2, "sa": 2, "rho": 3, "p": 4})
        log = pd.concat([old, new], ignore_index=True) if len(old) else new
        if len(log):
            log = _keep_pregame(log, ["season", "gameCode"])
            PRED_DIR.mkdir(parents=True, exist_ok=True)
            log.to_csv(self.log_path, index=False)
        if not len(log):
            return {"n": 0}, []

        # πραγματικά σκορ (όπως στο GamePredictionLog.evaluate)
        g = data.games
        done = g[g.played & g.homescore.notna()][["season", "gameCode", "homescore", "awayscore"]]
        if len(data.logs):
            pts = data.logs.groupby(["season", "gameCode", "home"]).PTS.sum().unstack()
            done = pd.DataFrame({"homescore": pts.get(1), "awayscore": pts.get(0)}).reset_index()
        done = done.rename(columns={"homescore": "hs", "awayscore": "as_"})
        nn = log.merge(done, on=["season", "gameCode"])
        mc_path = PRED_DIR / f"{self.comp}_games.csv"
        mc = pd.read_csv(mc_path)[["season", "gameCode", "mh", "ma", "p"]] if mc_path.exists() else \
            pd.DataFrame(columns=["season", "gameCode", "mh", "ma", "p"])
        both = nn.merge(mc, on=["season", "gameCode"], suffixes=("", "_mc"))
        out = {"n": int(len(both)), "n_nn": int(len(nn)),
               "nn": score(both[["mh", "ma", "sh", "sa", "p", "hs", "as_"]]),
               "mc": score(both[["mh_mc", "ma_mc", "p_mc", "hs", "as_"]].set_axis(["mh", "ma", "p", "hs", "as_"], axis=1))}
        recent = [[r.date, r.home, r.away, _r(r.p_mc, 3), _r(r.mh_mc, 1), _r(r.ma_mc, 1),
                   _r(r.p, 3), _r(r.mh, 1), _r(r.ma, 1), int(r.hs), int(r.as_)]
                  for r in both.sort_values("date", ascending=False).head(40).itertuples()]
        print(f"   live: {len(log)} archived, {len(both)} evaluated against Monte Carlo")
        return out, recent

    def _export(self, data, fb, model, train, test, nn_s, mc_s, up, live, recent):
        h = model.histories[0]
        nxt = [[int(r.gameCode), r.date.strftime("%Y-%m-%d"), r.home, r.away, _r(r.mh, 1), _r(r.ma, 1),
                _r(r.sh, 1), _r(r.sa, 1), _r(r.rho, 3), _r(r.p, 4)] for r in up.itertuples()] if len(up) else []
        out = {
            "comp": self.comp, "trained": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "demo": (RAW_DIR / ".demo").exists(), "arch": self.arch, "archs": list(GARCHS),
            "seeds": self.seeds, "epochs": model.best_epochs, "has_box": fb.has_box,
            "features": fb.feature_cols, "n_train": int(len(train)), "n_test": int(len(test)),
            "test_from": test.date.min().strftime("%Y-%m-%d"), "test_to": test.date.max().strftime("%Y-%m-%d"),
            "loss": {"train": [round(float(v), 4) for v in h["loss"]],
                     "val": [round(float(v), 4) for v in h["val_loss"]]},
            "test": {"nn": nn_s, "mc": mc_s},
            "live": live,
            "recent": {"cols": ["date", "home", "away", "p_mc", "mh_mc", "ma_mc", "p", "mh", "ma", "hs", "as"],
                       "rows": recent},
            "next": {"cols": ["gameCode", "date", "home", "away", "mh", "ma", "sh", "sa", "rho", "p"], "rows": nxt},
        }
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        path = SITE_DATA / f"gamenn_{self.comp}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        print(f"   -> {path.name} ({len(nxt)} upcoming games)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", choices=list(COMPETITIONS), nargs="*", default=list(COMPETITIONS))
    ap.add_argument("--arch", choices=list(GARCHS), default="mlp_small")
    ap.add_argument("--epochs", type=int, default=300, help="μέγιστες εποχές (early stopping)")
    ap.add_argument("--seeds", type=int, default=3, help="μέγεθος ensemble")
    args = ap.parse_args()
    for c in args.comp:
        try:
            GameNNTrainer(c, args.arch, args.epochs, args.seeds).run()
        except (FileNotFoundError, ValueError) as e:
            print(f"  ! {c}: {e}")
        except Exception:                 # ένα σφάλμα σε μία διοργάνωση δεν σταματά τις υπόλοιπες
            traceback.print_exc()


if __name__ == "__main__":
    main()
