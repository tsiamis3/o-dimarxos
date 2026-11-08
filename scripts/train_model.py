"""
Πρόβλεψη απόδοσης παίκτη στο ΕΠΟΜΕΝΟ ματς με ένα απλό feed-forward δίκτυο (Keras).

Ιδέα (time series -> tabular):
  για κάθε (παίκτη, ματς t) φτιάχνουμε features ΜΟΝΟ από τα ματς < t
  (lag-1, κυλιόμενοι μέσοι 3/5/10, EWM, μέσος σεζόν μέχρι τότε, ξεκούραση,
   έδρα, δυναμικότητα αντιπάλου μέχρι τότε) και στόχος είναι τα stats του ματς t.

Split: χρονικό (τα τελευταία ~15% ματς = test) ώστε να μην "βλέπει το μέλλον".
Συγκρίνουμε με δύο απλά baselines: μέσος των 10 τελευταίων, μέσος σεζόν.

Έξοδοι:
  models/{C}_player_form.keras, models/{C}_scaler.npz
  site/data/predictions_{C}.json  (προβλέψεις επόμενου ματς + backtest + μετρικές)

    python scripts/train_model.py                 # όλοι οι διαγωνισμοί
    python scripts/train_model.py --comp E --arch ffn_wide --epochs 80
"""
import argparse
import json
import os
from datetime import datetime, timezone

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

import numpy as np
import pandas as pd

from config import COMPETITIONS, MODEL_DIR, RAW_DIR, SITE_DATA, TARGETS
from dataset import CompetitionData

FEAT_STATS = ["MIN", "PTS", "REB", "AST", "PIR", "FG2A", "FG3A", "FTA", "TOV", "STL", "OREB"]
TEST_FRAC = 0.15
MIN_PRIOR_GAMES = 3


# ----------------------------------------------------------------------------
# 1) Features
# ----------------------------------------------------------------------------
class FeatureBuilder:
    """Φτιάχνει τον πίνακα features. Προσθέτει και "ψεύτικες" γραμμές (is_next=1)
    για το επόμενο ματς κάθε ενεργού παίκτη, ώστε οι προβλέψεις να βγαίνουν
    με τον ίδιο ακριβώς κώδικα."""

    def __init__(self, data: CompetitionData):
        self.data = data
        self.cur_season = max(data.seasons)
        self.feature_cols: list[str] = []

    # --- επόμενο ματς κάθε ενεργού παίκτη ---
    def _next_rows(self, logs: pd.DataFrame) -> pd.DataFrame:
        up = self.data.upcoming(self.cur_season)
        up = up[up["date"].notna()]
        cur = logs[logs.season == self.cur_season]
        if cur.empty:
            return pd.DataFrame(columns=logs.columns)
        last = cur.sort_values("date").groupby("pid").tail(1)
        # παίκτες που έπαιξαν σε κάποιο από τα 3 τελευταία ματς της ομάδας τους
        team_last = cur.groupby("team")["date"].apply(lambda s: sorted(s.unique())[-3:][0])
        last = last[last["date"] >= last["team"].map(team_last)]

        nxt = []
        for t in last["team"].unique():
            g = up[(up.homecode == t) | (up.awaycode == t)].head(1)
            if g.empty:
                continue
            g = g.iloc[0]
            home = int(g.homecode == t)
            nxt.append(dict(team=t, gameCode=int(g.gameCode), date=pd.to_datetime(g.date),
                            Round=g.Round, home=home, opp=g.awaycode if home else g.homecode))
        if not nxt:
            return pd.DataFrame(columns=logs.columns)
        nxt = pd.DataFrame(nxt)
        rows = last[["pid", "player", "team"]].merge(nxt, on="team")
        rows["season"] = self.cur_season
        rows["is_next"] = 1
        return rows

    # --- προηγούμενη δυναμικότητα ομάδων (ανά σεζόν, μόνο από παλαιότερα ματς) ---
    @staticmethod
    def _team_priors(logs: pd.DataFrame) -> pd.DataFrame:
        tg = (logs[logs.is_next == 0]
              .groupby(["season", "gameCode", "date", "team", "opp"], as_index=False)
              [["PTS", "PIR", "FG2A", "FG3A", "FTA", "OREB", "TOV"]].sum())
        tg["POSS"] = tg.FG2A + tg.FG3A + 0.44 * tg.FTA - tg.OREB + tg.TOV
        allowed = tg[["season", "gameCode", "team", "PTS", "PIR"]].rename(
            columns={"team": "opp", "PTS": "PTS_allowed", "PIR": "PIR_allowed"})
        tg = tg.merge(allowed, on=["season", "gameCode", "opp"], how="left")

        # ψεύτικες γραμμές για το επόμενο ματς κάθε ομάδας (NaN stats)
        nxt = (logs[logs.is_next == 1][["season", "gameCode", "date", "team", "opp"]]
               .drop_duplicates())
        nxt_opp = nxt.rename(columns={"team": "opp", "opp": "team"})   # και ο αντίπαλος
        tg = pd.concat([tg, nxt, nxt_opp], ignore_index=True).drop_duplicates(
            ["season", "gameCode", "team"], keep="first")
        tg = tg.sort_values(["date", "gameCode"])

        cols = {"PTS": "team_ppg", "PTS_allowed": "def_ppg", "PIR_allowed": "def_pir", "POSS": "pace"}
        g = tg.groupby(["team", "season"])
        for src, dst in cols.items():
            tg[dst] = g[src].transform(lambda s: s.shift(1).expanding().mean())
            tg[dst] = tg[dst].fillna(tg[src].mean())     # 1ο ματς σεζόν -> μέσος όρος λίγκας
        return tg[["season", "gameCode", "team", *cols.values()]]

    def build(self) -> pd.DataFrame:
        logs = self.data.logs.copy()
        logs["is_next"] = 0
        df = pd.concat([logs, self._next_rows(logs)], ignore_index=True)
        df = df.sort_values(["date", "gameCode", "is_next"]).reset_index(drop=True)

        gp = df.groupby("pid", sort=False)
        gps = df.groupby(["pid", "season"], sort=False)
        feats = {}
        for s in FEAT_STATS:
            prev = gp[s].shift(1)
            feats[f"{s}_lag1"] = prev
            for w in (3, 5, 10):
                feats[f"{s}_r{w}"] = prev.groupby(df["pid"]).transform(
                    lambda x, w=w: x.rolling(w, min_periods=1).mean())
            feats[f"{s}_ewm"] = prev.groupby(df["pid"]).transform(lambda x: x.ewm(span=5).mean())
            feats[f"{s}_season"] = gps[s].transform(lambda x: x.shift(1).expanding().mean())
        f = pd.DataFrame(feats)

        f["n_prev"] = gp.cumcount()                       # ματς πριν από αυτό
        f["log_n_prev"] = np.log1p(f["n_prev"])
        f["log_n_season"] = np.log1p(gps.cumcount())
        f["starter_r5"] = gp["starter"].transform(lambda x: x.shift(1).rolling(5, min_periods=1).mean())
        rest = gp["date"].diff().dt.days
        f["rest"] = rest.clip(0, 21).fillna(10) / 7
        f["home"] = df["home"].astype(float)

        # νέα σεζόν -> ο μέσος σεζόν δεν υπάρχει ακόμα: γέμισε με r10
        for s in FEAT_STATS:
            f[f"{s}_season"] = f[f"{s}_season"].fillna(f[f"{s}_r10"])

        # δυναμικότητα αντιπάλου και δικής ομάδας
        pri = self._team_priors(df)
        df = df.merge(pri, on=["season", "gameCode", "team"], how="left")
        opp = pri.rename(columns={"team": "opp", "team_ppg": "opp_ppg", "def_ppg": "opp_def_ppg",
                                  "def_pir": "opp_def_pir", "pace": "opp_pace"})
        df = df.merge(opp, on=["season", "gameCode", "opp"], how="left")
        for c in ["team_ppg", "pace", "opp_def_ppg", "opp_def_pir", "opp_pace"]:
            f[c] = df[c].fillna(df[c].mean()).values

        self.feature_cols = list(f.columns.drop("n_prev"))
        out = pd.concat([df.reset_index(drop=True), f.reset_index(drop=True)], axis=1)
        out = out.loc[:, ~out.columns.duplicated()]
        return out[out["n_prev"] >= MIN_PRIOR_GAMES].reset_index(drop=True)


# ----------------------------------------------------------------------------
# 2) Μοντέλο
# ----------------------------------------------------------------------------
def ffn_small(n_in, n_out):
    from tensorflow import keras
    return keras.Sequential([
        keras.Input((n_in,)),
        keras.layers.Dense(64, activation="relu"),
        keras.layers.Dropout(0.1),
        keras.layers.Dense(32, activation="relu"),
        keras.layers.Dense(n_out),
    ])


def ffn_wide(n_in, n_out):
    from tensorflow import keras
    return keras.Sequential([
        keras.Input((n_in,)),
        keras.layers.Dense(256, activation="relu"),
        keras.layers.BatchNormalization(),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(128, activation="relu"),
        keras.layers.Dropout(0.2),
        keras.layers.Dense(64, activation="relu"),
        keras.layers.Dense(n_out),
    ])


ARCHS = {"ffn_small": ffn_small, "ffn_wide": ffn_wide}   # πρόσθεσε εδώ νέες αρχιτεκτονικές


class PlayerFormModel:
    """Κανονικοποίηση + Keras FFN με πολλαπλές εξόδους (ένα output ανά στατιστικό)."""

    def __init__(self, feature_cols, targets=TARGETS, arch="ffn_small"):
        self.feature_cols, self.targets, self.arch = feature_cols, targets, arch
        self.model = None
        self.history = None

    def _fit_scalers(self, X, Y):
        self.x_mu, self.x_sd = X.mean(0), X.std(0) + 1e-6
        self.y_mu, self.y_sd = Y.mean(0), Y.std(0) + 1e-6

    def fit(self, train: pd.DataFrame, epochs=60, batch_size=256, seed=0):
        import tensorflow as tf
        from tensorflow import keras
        tf.keras.utils.set_random_seed(seed)

        X = train[self.feature_cols].to_numpy("float32")
        Y = train[self.targets].to_numpy("float32")
        self._fit_scalers(X, Y)
        self.model = ARCHS[self.arch](X.shape[1], Y.shape[1])
        self.model.compile(optimizer=keras.optimizers.Adam(1e-3), loss="huber")
        # validation = τα τελευταία 10% (χρονικά) του train -> early stopping
        n_val = int(0.1 * len(X))
        Xs, Ys = (X - self.x_mu) / self.x_sd, (Y - self.y_mu) / self.y_sd
        self.history = self.model.fit(
            Xs[:-n_val], Ys[:-n_val], validation_data=(Xs[-n_val:], Ys[-n_val:]),
            epochs=epochs, batch_size=batch_size, verbose=0,
            callbacks=[keras.callbacks.EarlyStopping(patience=8, restore_best_weights=True),
                       keras.callbacks.ReduceLROnPlateau(patience=4, factor=0.5)])
        return self

    def predict(self, df: pd.DataFrame) -> np.ndarray:
        X = (df[self.feature_cols].to_numpy("float32") - self.x_mu) / self.x_sd
        P = self.model.predict(X, verbose=0) * self.y_sd + self.y_mu
        P[:, [i for i, t in enumerate(self.targets) if t in ("PTS", "REB", "AST", "MIN")]] = np.clip(
            P[:, [i for i, t in enumerate(self.targets) if t in ("PTS", "REB", "AST", "MIN")]], 0, None)
        return P

    def save(self, prefix):
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        self.model.save(MODEL_DIR / f"{prefix}_player_form.keras")
        np.savez(MODEL_DIR / f"{prefix}_scaler.npz", x_mu=self.x_mu, x_sd=self.x_sd,
                 y_mu=self.y_mu, y_sd=self.y_sd, features=np.array(self.feature_cols),
                 targets=np.array(self.targets))


# ----------------------------------------------------------------------------
# 3) Training + αξιολόγηση + export για το site
# ----------------------------------------------------------------------------
class Trainer:
    def __init__(self, comp: str, arch: str, epochs: int):
        self.comp, self.arch, self.epochs = comp, arch, epochs

    @staticmethod
    def _mae(a, b):
        m = ~np.isnan(b)
        return float(np.mean(np.abs(a[m] - b[m])))

    def run(self):
        print(f"== {COMPETITIONS[self.comp]}: features")
        data = CompetitionData(self.comp)
        if not data.has_box:
            print("   ! no box scores for this competition -> skip")
            return
        fb = FeatureBuilder(data)
        df = fb.build()
        hist = df[df.is_next == 0]
        nxt = df[df.is_next == 1]

        # χρονικό split
        cut = hist["date"].quantile(1 - TEST_FRAC)
        train, test = hist[hist.date < cut], hist[hist.date >= cut]
        print(f"   train {len(train)}  test {len(test)}  next {len(nxt)}  features {len(fb.feature_cols)}")

        model = PlayerFormModel(fb.feature_cols, arch=self.arch).fit(train, epochs=self.epochs)
        P = model.predict(test)

        metrics = {}
        for i, t in enumerate(TARGETS):
            y = test[t].to_numpy()
            metrics[t] = {"model": self._mae(y, P[:, i]),
                          "last10": self._mae(y, test[f"{t}_r10"].to_numpy()),
                          "season": self._mae(y, test[f"{t}_season"].to_numpy())}
            print(f"   MAE {t:>4}: model {metrics[t]['model']:.2f} | last10 {metrics[t]['last10']:.2f}"
                  f" | season avg {metrics[t]['season']:.2f}")

        model.save(self.comp)
        self._export(data, model, test, P, nxt, metrics, len(train))

    def _export(self, data, model, test, P, nxt, metrics, n_train):
        r = lambda a: [round(float(v), 1) for v in a]   # noqa: E731
        next_rows = []
        if len(nxt):
            Pn = model.predict(nxt)
            for (_, row), p in zip(nxt.iterrows(), Pn):
                next_rows.append([row.pid, row.team, row.opp, int(row.home), int(row.gameCode),
                                  row.date.strftime("%Y-%m-%d"), *r(p),
                                  *r([row[f"{t}_r10"] for t in TARGETS])])   # baseline: μέσος 10 αγώνων

        bt = test.assign(**{f"p_{t}": P[:, i] for i, t in enumerate(TARGETS)})
        bt = bt[bt.season == bt.season.max()]
        backtest = [[row.pid, int(row.season), int(row.gameCode), row.date.strftime("%Y-%m-%d"), row.opp,
                     *r([row[t] for t in TARGETS]), *r([row[f"p_{t}"] for t in TARGETS])]
                    for _, row in bt.iterrows()]

        h = model.history.history
        out = {
            "comp": self.comp, "trained": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "demo": (RAW_DIR / ".demo").exists(), "arch": self.arch,
            "targets": TARGETS, "n_train": n_train, "n_test": len(test),
            "n_features": len(model.feature_cols), "metrics": metrics,
            "loss": {"train": [round(float(v), 4) for v in h["loss"]],
                     "val": [round(float(v), 4) for v in h["val_loss"]]} if h else None,
            "next": {"cols": ["pid", "team", "opp", "home", "gameCode", "date", *TARGETS,
                              *[f"b_{t}" for t in TARGETS]],
                     "rows": next_rows},
            "backtest": {"cols": ["pid", "season", "gameCode", "date", "opp",
                                  *TARGETS, *[f"p_{t}" for t in TARGETS]],
                         "rows": backtest},
        }
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        path = SITE_DATA / f"predictions_{self.comp}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        print(f"   -> {path.name} ({len(next_rows)} next-game predictions)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", choices=list(COMPETITIONS), nargs="*", default=list(COMPETITIONS))
    ap.add_argument("--arch", choices=list(ARCHS), default="ffn_small")
    ap.add_argument("--epochs", type=int, default=60)
    args = ap.parse_args()
    for c in args.comp:
        try:
            Trainer(c, args.arch, args.epochs).run()
        except (FileNotFoundError, ValueError) as e:
            print(f"  ! {c}: {e}")


if __name__ == "__main__":
    main()
