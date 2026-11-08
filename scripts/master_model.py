"""
MASTER νευρωνικό αγώνων: ΕΝΑ δίκτυο για όλες τις διοργανώσεις με box scores
(EuroLeague, EuroCup, GBL, NBA· η Α2 γυναικών δεν μπαίνει), ώστε να εκπαιδεύεται σε περισσότερους αγώνες.

Ίδια features με το game_model.py (μόνο από προηγούμενα ματς), αλλά εκφρασμένα σε σχέση με
τη λίγκα ως εκείνη την ημέρα, ώστε το NBA (~115 π.) και η Ευρώπη (~80 π.) να μιλούν την ίδια γλώσσα:
  ratings / φόρμα  -> πόντοι ανά 100 κατοχές πάνω από τον μέσο όρο της λίγκας
  ρυθμός           -> λόγος προς τον ρυθμό της λίγκας
  four factors     -> διαφορά από τον μέσο όρο της λίγκας
  διαφορά / έδρα   -> ανά 100 κατοχές
  + one-hot διοργάνωσης + επίπεδο σκοραρίσματος και ρυθμός της λίγκας
Στόχος: πόντοι / αναμενόμενοι πόντοι λίγκας (διμεταβλητή κανονική, Gaussian NLL, όπως στο game_model.py).

Split: εκπαίδευση σε ΟΛΕΣ τις προηγούμενες σεζόν όλων των διοργανώσεων,
test = τα φετινά (τρέχουσα σεζόν) παιγμένα ματς κάθε λίγκας.
Στα ίδια φετινά ματς συγκρίνονται:
  - master δίκτυο
  - δίκτυο μόνο της λίγκας με το ΙΔΙΟ split (για να φανεί αν βοηθά το pooling)
  - Monte Carlo (walk-forward backtest του evaluate.py)
Μετά ξαναεκπαιδεύεται σε όλους τους αγώνες και προβλέπει τα επερχόμενα φετινά ματς κάθε λίγκας.
Ζωντανή αξιολόγηση: data/predictions/{C}_games_master.csv απέναντι στα αρχεία του Monte Carlo
και του νευρωνικού λίγκας, στους ίδιους αγώνες.

Έξοδοι: models/master_game_nn.keras, models/master_game_nn_scaler.npz, site/data/master.json
Τρέχει μετά το game_model.py.

    python scripts/master_model.py
    python scripts/master_model.py --arch mlp_wide --seeds 5
"""
import argparse
import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from config import COMPETITIONS, MODEL_DIR, PRED_DIR, RAW_DIR, SITE_DATA
from dataset import CompetitionData
from evaluate import TODAY, GameSimulator, _keep_pregame, _r
from game_model import GARCHS, UPCOMING_DAYS, GameFeatureBuilder, GameNNModel, score

EXCLUDE = {"WBL2"}                     # Α2 γυναικών: χωρίς box scores, λίγοι αγώνες
FACTORS = ["efg", "tov", "orb", "ftr", "oefg", "otov", "oorb", "oftr"]
RATINGS = ["ortg", "drtg", "f5_ortg", "f5_drtg"]
PER100 = ["f5_margin", "venue"]
RAW = ["f5_win", "rest", "b2b", "log_gp"]
SCORE_COLS = ["mh", "ma", "sh", "sa", "p", "hs", "as_"]


def _mc_cols(df, suffix):
    """Στήλες ενός μοντέλου (mh_x, ma_x, p_x, ...) -> mh, ma, p, ... για το score()."""
    cols = [c for c in ["mh", "ma", "sh", "sa", "p"] if c + suffix in df]
    return df[[c + suffix for c in cols] + ["hs", "as_"]].set_axis(cols + ["hs", "as_"], axis=1)


class MasterData:
    """Features κάθε διοργάνωσης -> κοινή, σχετική με τη λίγκα κλίμακα."""

    def __init__(self, comps):
        self.comps = comps
        self.datas, self.local, frames = {}, {}, []
        for c in comps:
            data = CompetitionData(c)
            fb = GameFeatureBuilder(data)
            df = fb.build()
            self.datas[c] = data
            self.local[c] = (fb, df)                     # για το δίκτυο της λίγκας με το ίδιο split
            frames.append(self._relative(df, c, fb.cur_season))
        self.df = pd.concat(frames, ignore_index=True).sort_values(["date", "comp", "gameCode"]).reset_index(drop=True)
        self.feature_cols = [c for c in self.df.columns if c.startswith(("x_", "comp_"))]

    def _relative(self, df, comp, cur):
        out = df[["season", "gameCode", "date", "home", "away", "played", "hs", "as_"]].copy()
        out["comp"], out["cur"] = comp, cur
        p100 = df["lg_pace"] / 100
        for s in ("h", "a"):
            for k in RATINGS:
                out[f"x_{s}_{k}"] = df[f"{s}_{k}"] - df["lg_ortg"]
            out[f"x_{s}_pace"] = df[f"{s}_pace"] / df["lg_pace"]
            for k in FACTORS:
                out[f"x_{s}_{k}"] = df[f"{s}_{k}"] - df["ref_" + k]
            for k in PER100:
                out[f"x_{s}_{k}"] = df[f"{s}_{k}"] / p100
            for k in RAW:
                out[f"x_{s}_{k}"] = df[f"{s}_{k}"]
        out["x_lg_ortg"], out["x_lg_pace"] = df["lg_ortg"], df["lg_pace"]
        for c in self.comps:
            out["comp_" + c] = float(c == comp)
        out["base"] = df["lg_ortg"] * df["lg_pace"] / 100        # αναμενόμενοι πόντοι ομάδας στη λίγκα
        out["hs_pts"], out["as_pts"] = out["hs"], out["as_"]
        out["hs"], out["as_"] = out["hs_pts"] / out["base"], out["as_pts"] / out["base"]   # στόχος: λόγος
        x = [c for c in out.columns if c.startswith("x_")]
        return out[out[x].notna().all(axis=1)]


def to_points(df, pred):
    """Πρόβλεψη σε κλίμακα λόγου -> πόντοι."""
    b = df["base"].to_numpy()
    return pred.assign(mh=pred.mh * b, ma=pred.ma * b, sh=pred.sh * b, sa=pred.sa * b)


class MasterTrainer:
    def __init__(self, arch, epochs, seeds):
        self.arch, self.epochs, self.seeds = arch, epochs, seeds
        self.comps = [c for c in COMPETITIONS if c not in EXCLUDE]

    def run(self):
        md = MasterData(self.comps)
        df = md.df
        hist = df[df.played == 1]
        train = hist[hist.season < hist.cur]
        test = hist[hist.season == hist.cur]
        print(f"== MASTER ({self.arch}): train {len(train)} games from {', '.join(self.comps)} | "
              f"test (current seasons) {len(test)} | features {len(md.feature_cols)}")
        model = GameNNModel(md.feature_cols, self.arch, self.seeds).fit(train, epochs=self.epochs)
        pm = to_points(test, model.predict(test))

        out_comps = {}
        for c in self.comps:
            t = test[test.comp == c]
            if t.empty:
                print(f"   {c}: no current-season games yet")
                out_comps[c] = {"test": {}, "n_train": int((train.comp == c).sum())}
                continue
            res = t[["season", "gameCode", "date", "home", "away"]].assign(hs=t.hs_pts, as_=t.as_pts)
            res = pd.concat([res, pm.loc[t.index]], axis=1)

            # δίκτυο μόνο της λίγκας, ίδιο split
            fb, ldf = md.local[c]
            lh = ldf[ldf.played == 1]
            ltr, lte = lh[lh.season < fb.cur_season], lh[lh.season == fb.cur_season]
            single = GameNNModel(fb.feature_cols, self.arch, self.seeds).fit(ltr, epochs=self.epochs)
            ps = single.predict(lte)
            res = res.merge(pd.concat([lte[["season", "gameCode"]], ps.add_suffix("_one")], axis=1),
                            on=["season", "gameCode"], how="inner")

            # Monte Carlo
            mc = GameSimulator(md.datas[c]).backtest()
            mc = mc[mc.season == fb.cur_season][["season", "gameCode", "mh", "ma", "p"]].add_suffix("_mc") \
                .rename(columns={"season_mc": "season", "gameCode_mc": "gameCode"})
            res = res.merge(mc, on=["season", "gameCode"], how="inner")

            sc = {"master": score(res[SCORE_COLS]), "single": score(_mc_cols(res, "_one")), "mc": score(_mc_cols(res, "_mc"))}
            print(f"   {c}: {sc['master'].get('n')} games | acc/brier  master {sc['master'].get('acc')}/{sc['master'].get('brier')}"
                  f"  league-only {sc['single'].get('acc')}/{sc['single'].get('brier')}"
                  f"  MC {sc['mc'].get('acc')}/{sc['mc'].get('brier')}")
            out_comps[c] = {"test": sc, "n_train": int((train.comp == c).sum()), "n_train_single": int(len(ltr)),
                            "test_from": t.date.min().strftime("%Y-%m-%d"), "test_to": t.date.max().strftime("%Y-%m-%d")}

        # τελικό: όλοι οι αγώνες -> επερχόμενα φετινά
        final = GameNNModel(md.feature_cols, self.arch, self.seeds).fit(hist, fixed_epochs=model.best_epochs)
        self._save(final)
        up = df[df.played == 0]
        up = pd.concat([up[["comp", "season", "gameCode", "date", "home", "away"]], to_points(up, final.predict(up))], axis=1) \
            if len(up) else pd.DataFrame()
        for c in self.comps:
            u = up[up.comp == c] if len(up) else pd.DataFrame()
            live, recent = self._live(c, md.datas[c], u)
            out_comps[c].update(live=live, recent={"cols": ["date", "home", "away", "p_mc", "p_one", "p", "mh", "ma", "hs", "as"],
                                                   "rows": recent},
                                next={"cols": ["gameCode", "date", "home", "away", "mh", "ma", "sh", "sa", "rho", "p"],
                                      "rows": [[int(r.gameCode), r.date.strftime("%Y-%m-%d"), r.home, r.away, _r(r.mh, 1),
                                                _r(r.ma, 1), _r(r.sh, 1), _r(r.sa, 1), _r(r.rho, 3), _r(r.p, 4)]
                                               for r in u.itertuples()]})
        self._export(md, model, train, test, out_comps)

    def _save(self, m):
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        m.models[0].save(MODEL_DIR / "master_game_nn.keras")
        np.savez(MODEL_DIR / "master_game_nn_scaler.npz", x_mu=m.x_mu, x_sd=m.x_sd, y_mu=m.y_mu, y_sd=m.y_sd,
                 features=np.array(m.feature_cols))

    def _live(self, comp, data, up):
        path = PRED_DIR / f"{comp}_games_master.csv"
        old = pd.read_csv(path) if path.exists() else pd.DataFrame()
        new = up[up.date <= pd.Timestamp.now() + pd.Timedelta(days=UPCOMING_DAYS)].copy() if len(up) else pd.DataFrame()
        if len(new):
            new = new.drop(columns="comp")
            new["date"] = new["date"].dt.strftime("%Y-%m-%d")
            new.insert(0, "made_at", TODAY)
            new = new.round({"mh": 1, "ma": 1, "sh": 2, "sa": 2, "rho": 3, "p": 4})
        log = pd.concat([old, new], ignore_index=True) if len(old) else new
        if not len(log):
            return {"n": 0}, []
        log = _keep_pregame(log, ["season", "gameCode"])
        PRED_DIR.mkdir(parents=True, exist_ok=True)
        log.to_csv(path, index=False)

        pts = data.logs.groupby(["season", "gameCode", "home"]).PTS.sum().unstack()
        done = pd.DataFrame({"hs": pts.get(1), "as_": pts.get(0)}).reset_index()
        m = log.merge(done, on=["season", "gameCode"])
        # ίδια ματς: master ∩ Monte Carlo ∩ νευρωνικό λίγκας (όσα αρχεία υπάρχουν)
        others = {"_mc": PRED_DIR / f"{comp}_games.csv", "_one": PRED_DIR / f"{comp}_games_nn.csv"}
        for suf, p in others.items():
            o = pd.read_csv(p) if p.exists() else pd.DataFrame(columns=["season", "gameCode", "mh", "ma", "p"])
            keep = [c for c in ["mh", "ma", "sh", "sa", "p"] if c in o]
            m = m.merge(o[["season", "gameCode", *keep]].rename(columns={c: c + suf for c in keep}),
                        on=["season", "gameCode"], how="inner")
        out = {"n": int(len(m)), "master": score(m[SCORE_COLS]) if len(m) else {"n": 0},
               "single": score(_mc_cols(m, "_one")) if len(m) else {"n": 0},
               "mc": score(_mc_cols(m, "_mc")) if len(m) else {"n": 0}}
        recent = [[r.date, r.home, r.away, _r(r.p_mc, 3), _r(r.p_one, 3), _r(r.p, 3), _r(r.mh, 1), _r(r.ma, 1),
                   int(r.hs), int(r.as_)] for r in m.sort_values("date", ascending=False).head(40).itertuples()]
        print(f"   {comp} live: {len(log)} archived, {len(m)} evaluated")
        return out, recent

    def _export(self, md, model, train, test, comps):
        h = model.histories[0]
        out = {
            "trained": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "demo": (RAW_DIR / ".demo").exists(), "arch": self.arch, "archs": list(GARCHS), "seeds": self.seeds,
            "epochs": model.best_epochs, "features": md.feature_cols, "n_train": int(len(train)),
            "n_test": int(len(test)), "train_seasons": sorted(int(s) for s in train.season.unique()),
            "loss": {"train": [round(float(v), 4) for v in h["loss"]], "val": [round(float(v), 4) for v in h["val_loss"]]},
            "comps": comps,
        }
        SITE_DATA.mkdir(parents=True, exist_ok=True)
        (SITE_DATA / "master.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        print(f"   -> master.json ({sum(len(c['next']['rows']) for c in comps.values())} upcoming games)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--arch", choices=list(GARCHS), default="mlp_small")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--seeds", type=int, default=3)
    a = ap.parse_args()
    MasterTrainer(a.arch, a.epochs, a.seeds).run()


if __name__ == "__main__":
    main()
