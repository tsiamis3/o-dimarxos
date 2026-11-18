"""
Lab: πόσες «κρυφές μεταβλητές» χρειάζονται για να εξηγηθούν τα δεδομένα;

Για κάθε k = 1..K_MAX εκπαιδεύεται ένας autoencoder n → 32 → k → 32 → n (μη γραμμικός, tanh) και συγκρίνεται με
PCA k συνιστωσών (γραμμικό). Μέτρο: ποσοστό της διασποράς που ξαναφτιάχνεται σε δεδομένα ΕΚΤΟΣ εκπαίδευσης
(cross-validation ανά σεζόν), αλλιώς ένα μεγάλο δίκτυο «απομνημονεύει» ακόμα και με k = 1.
Δεύτερη γνώμη: εκτιμητής εγγενούς διάστασης TwoNN (Facco et al. 2017), χωρίς εκπαίδευση.

Δύο σύνολα δεδομένων:
  A. Αγώνες: box score ομάδας ανά αγώνα (EuroLeague, EuroCup, GBL), 14 μεγέθη, z ανά λίγκα-σεζόν.
  B. Παίκτες: τα 13 μεγέθη στυλ των ρόλων (roles.py), παίκτες-σεζόν με ≥ 300′.

    python scripts/lab_autoencoder.py        # -> site/lab/ae.json (μπαίνει στο git: το lab το διαβάζει)
"""
import json
import math
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.exceptions import ConvergenceWarning
from sklearn.neural_network import MLPRegressor

import roles as R
from config import ROOT
from dataset import CompetitionData

warnings.filterwarnings("ignore", category=ConvergenceWarning)
OUT = ROOT / "site" / "lab" / "ae.json"
K_MAX = 10
SEEDS = [0, 1, 2]
HIDDEN = 32
BOX = ["PTS", "FG2M", "FG2A", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "AST", "STL", "TOV", "BLK", "PF"]
BOX_GR = {"PTS": "πόντοι", "FG2M": "εύστοχα 2π", "FG2A": "σουτ 2π", "FG3M": "εύστοχα 3π", "FG3A": "σουτ 3π", "FTM": "εύστοχες βολές",
          "FTA": "βολές", "OREB": "επιθ. ριμπάουντ", "DREB": "αμυντ. ριμπάουντ", "AST": "ασίστ", "STL": "κλεψίματα", "TOV": "λάθη",
          "BLK": "κοψίματα", "PF": "φάουλ"}


def games_data():
    rows = []
    for c in ["E", "U", "GBL"]:
        L = CompetitionData(c).logs
        g = L.groupby(["season", "gameCode", "team"])[BOX].sum().reset_index()
        g["comp"] = c
        rows.append(g)
    D = pd.concat(rows, ignore_index=True)
    Z = D.groupby(["comp", "season"])[BOX].transform(lambda v: (v - v.mean()) / (v.std() + 1e-9))
    return Z.to_numpy(float), (D.comp + D.season.astype(str)).to_numpy(), BOX, [BOX_GR[c] for c in BOX]


def players_data():
    P = R.load_all()
    Z = R.zscores(P)
    X = Z[R.FEATS].to_numpy()
    fit = ((P.MIN >= R.MIN_MIN) & P.comp.isin(R.COMPS)).to_numpy() & ~np.isnan(X).any(axis=1)
    return X[fit], (P.comp + P.season.astype(str)).to_numpy()[fit], list(R.FEATS), [R.FEAT_GR[f] for f in R.FEATS]


def r2(X, Xh):
    return 1 - np.sum((X - Xh) ** 2) / np.sum((X - X.mean(0)) ** 2)


def ae(k, seed):
    return MLPRegressor(hidden_layer_sizes=(HIDDEN, k, HIDDEN), activation="tanh", alpha=1e-3, learning_rate_init=3e-3,
                        max_iter=600, early_stopping=True, validation_fraction=0.1, n_iter_no_change=25, random_state=seed)


def encode(m, X, k):
    """Ενεργοποιήσεις του κεντρικού κόμβου (στένωση) ενός εκπαιδευμένου MLPRegressor."""
    h = X
    for i in range(2):
        h = np.tanh(h @ m.coefs_[i] + m.intercepts_[i])
    return h


def twonn(X):
    """Εγγενής διάσταση TwoNN: d = N / Σ log(r2/r1), με r1, r2 τις αποστάσεις στους δύο πλησιέστερους γείτονες."""
    from scipy.spatial import cKDTree
    Xu = np.unique(np.round(X, 6), axis=0)
    d, _ = cKDTree(Xu).query(Xu, k=3)
    mu = d[:, 2] / np.maximum(d[:, 1], 1e-12)
    mu = mu[np.isfinite(mu) & (mu > 1)]
    mu = np.sort(mu)[: int(0.9 * len(mu))]           # χωρίς το 10% των ακραίων (θόρυβος)
    return float(len(mu) / np.sum(np.log(mu)))


def run(name, X, grp, feats, labels):
    folds = np.unique(grp)
    rng = np.random.default_rng(0)
    # 3 ομάδες σεζόν ως folds (κάθε λίγκα-σεζόν μένει ολόκληρη εκτός ή μέσα)
    assign = {g: i % 3 for i, g in enumerate(rng.permutation(folds))}
    fold = np.array([assign[g] for g in grp])
    res = {"pca": [], "ae": [], "ae_sd": []}
    for k in range(1, min(K_MAX, X.shape[1]) + 1):
        pr, ar = [], []
        for f in range(3):
            tr, te = fold != f, fold == f
            p = PCA(k).fit(X[tr])
            pr.append(r2(X[te], p.inverse_transform(p.transform(X[te]))))
            for s in SEEDS:
                m = ae(k, s).fit(X[tr], X[tr])
                ar.append(r2(X[te], m.predict(X[te])))
        res["pca"].append(round(float(np.mean(pr)), 4))
        res["ae"].append(round(float(np.mean(ar)), 4))
        res["ae_sd"].append(round(float(np.std(ar)), 4))
        print(f"  {name} k={k}: PCA {np.mean(pr):.3f} | AE {np.mean(ar):.3f} ± {np.std(ar):.3f}")
    # αγκώνας: το μικρότερο k όπου ο autoencoder φτάνει το 90% της πληροφορίας που ξαναφτιάχνει με k = K_MAX
    ae_ = np.array(res["ae"])
    elbow = int(np.argmax(ae_ >= 0.9 * ae_.max()) + 1)
    # ερμηνεία των κόμβων για k = elbow: συσχέτιση κάθε κόμβου με τα αρχικά μεγέθη (μοντέλο σε όλα τα δεδομένα)
    m = ae(elbow, 0).fit(X, X)
    Hk = encode(m, X, elbow)
    nodes = []
    for j in range(elbow):
        c = np.array([np.corrcoef(Hk[:, j], X[:, i])[0, 1] for i in range(X.shape[1])])
        top = np.argsort(-np.abs(c))[:4]
        nodes.append([[labels[i], round(float(c[i]), 2)] for i in top])
    # ίδια ερμηνεία για τις συνιστώσες του PCA (για σύγκριση)
    p = PCA(elbow).fit(X)
    pcs = [[[labels[i], round(float(v[i]), 2)] for i in np.argsort(-np.abs(v))[:4]] for v in p.components_]
    td = twonn(X)
    print(f"  {name}: αγκώνας k={elbow}, TwoNN {td:.1f}")
    return {"name": name, "n": int(len(X)), "n_feats": int(X.shape[1]), "feats": labels, "k": list(range(1, len(res["ae"]) + 1)),
            **res, "elbow": elbow, "twonn": round(td, 2), "nodes": nodes, "pcs": pcs}


def main():
    out = {"hidden": HIDDEN, "seeds": len(SEEDS), "folds": 3, "datasets": []}
    X, g, f, lab = games_data()
    print(f"A. αγώνες: {X.shape}")
    out["datasets"].append({"key": "games", "title": "Αγώνες: box score ομάδας", **run("games", X, g, f, lab)})
    X, g, f, lab = players_data()
    print(f"B. παίκτες: {X.shape}")
    out["datasets"].append({"key": "players", "title": "Παίκτες: στυλ (13 μεγέθη ρόλων)", **run("players", X, g, f, lab)})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"-> {OUT}")


if __name__ == "__main__":
    main()
