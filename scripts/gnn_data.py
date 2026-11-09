"""
Δεδομένα για το Graph Neural Network: κάθε αγώνας = ένα graph, κάθε παίκτης που έπαιξε = ένας κόμβος.

EuroLeague + EuroCup μαζί: το ιστορικό κάθε παίκτη είναι ΕΝΙΑΙΟ χρονολογικά και στις δύο λίγκες
(κοινοί κωδικοί παικτών), με χαρακτηριστικό για το πού παίχτηκε κάθε ματς.

Κόμβος (παίκτης i στον αγώνα g), χαρακτηριστικά ΜΟΝΟ από αγώνες πριν από την ημέρα του g:
  - εκθετικά σταθμισμένοι μέσοι (μισή βαρύτητα κάθε 10 αγώνες) ανά 100 κατοχές στο παρκέ:
    πόντοι, ριμπάουντ (επιθ./αμυν.), ασίστ, κλεψίματα, κοψίματα, λάθη, σουτ 2π/3π, βολές, PIR
  - ποσοστά: TS%, 3π% (με συρρίκνωση), usage
  - ρόλος: λεπτά/αγώνα, ποσοστό βασικού, κατοχές στο παρκέ
  - plus-minus στο παρκέ ανά 100 κατοχές (από τα stints): «RAPM-lite»
  - εμπειρία: αγώνες στο ιστορικό, ημέρες ξεκούρασης, αγώνες τις 14 τελευταίες ημέρες
  - πλαίσιο: έδρα, λίγκα του αγώνα, μερίδιο του ιστορικού στην EuroLeague, χωρίς ιστορικό (flag)
Ακμές (ζεύγη παικτών στον ίδιο αγώνα):
  - συμπαίκτες: λεπτά μαζί στο παρκέ σε προηγούμενους αγώνες (σεζόν και συνολικά), αγώνες μαζί
  - αντίπαλοι: λεπτά απέναντι σε προηγούμενους αγώνες
Στόχοι:
  - ανά κόμβο (A): πόντοι, ριμπάουντ, ασίστ, PIR, λεπτά του αγώνα
  - ανά κόμβο (B): plus-minus στο παρκέ ανά 100 κατοχές (+ κατοχές, ως βάρος)
  - ανά graph: διαφορά και σύνολο πόντων
Split (χρονικό): train = σεζόν 2023–2024, validation = 2025, test = 2026 (τρέχουσα).

Έξοδοι:
  data/gnn/nodes.csv.gz, data/gnn/edges.csv.gz, data/gnn/graphs.csv.gz   (για την εκπαίδευση· δεν μπαίνουν στο git)
  site/data/gnn_preview.json                                            (σελίδα «Δεδομένα GNN»)

    python scripts/gnn_data.py
"""
import json
import math

import numpy as np
import pandas as pd

from config import ROOT, SITE_DATA
from dataset import CompetitionData
from stints import build as build_stints

COMPS = ["E", "U"]
HALF_LIFE = 10                     # αγώνες
OUT = ROOT / "data" / "gnn"
BOX = ["PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "FG2A", "FG3A", "FG3M", "FTA", "FTM", "FG2M", "PIR"]
RATE = ["PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "FG2A", "FG3A", "FTA", "PIR"]
TARGETS_A = ["PTS", "REB", "AST", "PIR", "MIN"]
SPLIT = {2023: "train", 2024: "train", 2025: "val", 2026: "test"}
K_POSS, K_PM, K_TSA = 50.0, 150.0, 20.0   # εικονικές κατοχές/προσπάθειες προς τον μέσο όρο (μικρά δείγματα)

FEATURES = {   # όνομα -> περιγραφή (για τη σελίδα)
    **{f"r_{s.lower()}": f"{s} ανά 100 κατοχές στο παρκέ (σταθμισμένο: μισή βαρύτητα / {HALF_LIFE} αγώνες· +{int(K_POSS)} εικονικές κατοχές στον μέσο όρο)" for s in RATE},
    "ts": f"True shooting % (σταθμισμένο, +{int(K_TSA)} εικονικές προσπάθειες στον μέσο όρο)",
    "fg3p": "Τρίποντα % (συρρίκνωση προς τον μέσο όρο με 40 εικονικές προσπάθειες)",
    "usg": f"Usage: σουτ + 0.44·βολές + λάθη ανά κατοχή της ομάδας στο παρκέ (+{int(K_POSS)} εικονικές κατοχές)",
    "min": "Λεπτά ανά αγώνα (εκθετικός μέσος)",
    "min_last": "Λεπτά στον προηγούμενο αγώνα",
    "starter": "Ποσοστό βασικού (εκθετικός μέσος)",
    "on_poss": "Κατοχές στο παρκέ ανά αγώνα (εκθετικός μέσος)",
    "pm100": f"Plus-minus στο παρκέ ανά 100 κατοχές (από τα stints· +{int(K_PM)} εικονικές κατοχές στο 0)",
    "log_games": "log(1 + αγώνες στο ιστορικό, και στις δύο λίγκες)",
    "rest": "Ημέρες από τον προηγούμενο αγώνα (έως 14)",
    "games14": "Αγώνες τις 14 τελευταίες ημέρες",
    "home": "1 = γηπεδούχος",
    "comp_E": "1 = ο αγώνας είναι EuroLeague, 0 = EuroCup",
    "hist_E": "Μερίδιο των λεπτών του ιστορικού στην EuroLeague",
    "no_hist": "1 = κανένας προηγούμενος αγώνας (τα υπόλοιπα = μέσος όρος)",
}
EDGE_FEATURES = {
    "teammate": "1 = συμπαίκτες, 0 = αντίπαλοι",
    "min_season": "Λεπτά μαζί (συμπαίκτες) ή απέναντι (αντίπαλοι) στο παρκέ, ίδια σεζόν, σε προηγούμενους αγώνες",
    "min_all": "Το ίδιο, σε όλο το ιστορικό",
    "games_all": "Αγώνες όπου βρέθηκαν μαζί στο παρκέ (ή απέναντι)",
}


def _r(v, d=3):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), d)


# ---------------------------------------------------------------------------
def load():
    logs, games, stints = [], [], []
    for c in COMPS:
        d = CompetitionData(c)
        lg = d.logs.copy()
        lg["comp"] = c
        logs.append(lg)
        g = d.games.copy()
        g["comp"], g["date"] = c, pd.to_datetime(g["date"])
        games.append(g)
        for s in d.seasons:
            st = build_stints(c, s, d)
            if len(st):
                st["comp"] = c
                stints.append(st)
    logs = pd.concat(logs, ignore_index=True)
    games = pd.concat(games, ignore_index=True)
    stints = pd.concat(stints, ignore_index=True)
    for df in (logs, games, stints):
        df["gid"] = df.comp + df.season.astype(str) + "-" + df.gameCode.astype(str)
    stints = stints.merge(games[["gid", "date", "homecode", "awaycode"]], on="gid")
    stints["sid"] = np.arange(len(stints))
    return logs, games, stints


def on_court(stints):
    """Ανά (αγώνα, παίκτη): κατοχές, δευτερόλεπτα, plus-minus στο παρκέ. Ανά ζεύγος: δευτερόλεπτα μαζί/απέναντι."""
    poss = (stints.poss_h + stints.poss_a) / 2
    long = []
    for side, other in (("h", "a"), ("a", "h")):
        for k in range(5):
            long.append(pd.DataFrame({"sid": stints.sid, "gid": stints.gid, "pid": stints[f"{side}{k}"], "side": side,
                                      "secs": stints.secs, "poss": poss,
                                      "pm": stints[f"pts_{side}"] - stints[f"pts_{other}"]}))
    long = pd.concat(long, ignore_index=True)
    pg = long.groupby(["gid", "pid"]).agg(on_poss=("poss", "sum"), on_secs=("secs", "sum"), pm=("pm", "sum")).reset_index()
    pg["pm100"] = 100 * pg.pm / pg.on_poss.replace(0, np.nan)
    # ζεύγη στο ίδιο stint
    a = long[["sid", "gid", "pid", "side", "secs"]]
    pr = a.merge(a[["sid", "pid", "side"]], on="sid", suffixes=("", "_j"))
    pr = pr[pr.pid < pr.pid_j]
    pr["teammate"] = (pr.side == pr.side_j).astype(int)
    pairs = pr.groupby(["gid", "pid", "pid_j", "teammate"]).secs.sum().reset_index()
    return pg, pairs


def node_features(logs, games, pg):
    L = logs.merge(pg[["gid", "pid", "on_poss", "pm100"]], on=["gid", "pid"], how="left")
    L = L.sort_values(["date", "gid"]).reset_index(drop=True)
    L["on_poss"] = L.on_poss.fillna(L.MIN / 40 * 75)            # χωρίς stints: εκτίμηση από τα λεπτά
    L["FGA"] = L.FG2A + L.FG3A
    L["TSA"] = L.FGA + 0.44 * L.FTA
    L["USE"] = L.FGA + 0.44 * L.FTA + L.TOV
    L["isE"] = (L.comp == "E").astype(float)
    g = L.groupby("pid", sort=False)
    alpha = 1 - 0.5 ** (1 / HALF_LIFE)

    def ewm_prev(col, weight=None):
        """Εκθετικός μέσος των ΠΡΟΗΓΟΥΜΕΝΩΝ αγώνων του παίκτη (shift 1)."""
        if weight is None:
            return g[col].transform(lambda x: x.shift(1).ewm(alpha=alpha, ignore_na=True).mean())
        num = (L[col] * L[weight]).groupby(L.pid).transform(lambda x: x.shift(1).ewm(alpha=alpha).mean())
        den = L[weight].groupby(L.pid).transform(lambda x: x.shift(1).ewm(alpha=alpha).mean())
        return num / den.replace(0, np.nan)

    F = pd.DataFrame(index=L.index)
    r = 0.5 ** (1 / HALF_LIFE)
    order = L.groupby("pid", sort=False).indices

    def dsum(col):
        """Σταθμισμένο άθροισμα των ΠΡΟΗΓΟΥΜΕΝΩΝ αγώνων: S_i = r·S_(i−1) + x_(i−1)."""
        x = L[col].fillna(0).to_numpy(float)
        out = np.zeros(len(L))
        for idx in order.values():
            sacc = 0.0
            for k, i in enumerate(idx):
                out[i] = sacc
                sacc = r * sacc + x[i]
        return pd.Series(out, index=L.index)

    S_poss = dsum("on_poss")
    for s in RATE:                    # ανά 100 κατοχές, με K_POSS εικονικές κατοχές στον μέσο όρο της λίγκας
        lg = (L[s].sum() / L.on_poss.sum())
        F[f"r_{s.lower()}"] = 100 * (dsum(s) + K_POSS * lg) / (S_poss + K_POSS)
    lg_ts = L.PTS.sum() / (2 * L.TSA.sum())
    F["ts"] = (dsum("PTS") + 2 * K_TSA * lg_ts) / (2 * (dsum("TSA") + K_TSA))
    c3m = L.FG3M.groupby(L.pid).transform(lambda x: x.shift(1).cumsum())
    c3a = L.FG3A.groupby(L.pid).transform(lambda x: x.shift(1).cumsum())
    lg3 = L.FG3M.sum() / L.FG3A.sum()
    F["fg3p"] = (c3m.fillna(0) + 40 * lg3) / (c3a.fillna(0) + 40)
    # usage: χρήσεις παίκτη / χρήσεις ομάδας όσο είναι μέσα (≈ ομάδα × κατοχές παίκτη / κατοχές ομάδας)
    tuse = L.groupby("gid").USE.transform("sum") / 2               # ~ χρήσεις ομάδας (οι δύο ομάδες / 2)
    tposs = L.groupby(["gid", "team"]).on_poss.transform("sum") / 5
    L["t_use_on"] = (tuse * L.on_poss / tposs.replace(0, np.nan)).fillna(0)
    lg_usg = L.USE.sum() / L.t_use_on.sum()
    F["usg"] = (dsum("USE") + K_POSS * lg_usg) / (dsum("t_use_on") + K_POSS)
    F["min"] = ewm_prev("MIN")
    F["min_last"] = g.MIN.shift(1)
    F["starter"] = ewm_prev("starter")
    F["on_poss"] = ewm_prev("on_poss")
    L["pm_raw"] = L.pm100.fillna(0) * L.on_poss / 100
    F["pm100"] = 100 * dsum("pm_raw") / (S_poss + K_PM)
    n_prev = g.cumcount()
    F["log_games"] = np.log1p(n_prev)
    prev_date = g.date.shift(1)
    F["rest"] = ((L.date - prev_date).dt.days.clip(0, 14)).fillna(14)
    # αγώνες τις 14 τελευταίες ημέρες
    F["games14"] = L.groupby("pid", group_keys=False).apply(
        lambda x: pd.Series([(((x.date.iloc[:i]) >= d - pd.Timedelta(days=14))).sum() for i, d in enumerate(x.date)], index=x.index))
    F["home"] = L.home.astype(float)
    F["comp_E"] = L.isE
    F["hist_E"] = ewm_prev("isE", weight="MIN").fillna(L.isE)
    F["no_hist"] = (n_prev == 0).astype(float)
    # χωρίς ιστορικό -> μέσος όρος της λίγκας του αγώνα (από το train)
    for c in FEATURES:
        if c in F and F[c].isna().any():
            F[c] = F[c].fillna(F.groupby(L.comp)[c].transform("mean")).fillna(F[c].mean())
    keep = ["gid", "comp", "season", "gameCode", "date", "pid", "player", "team", "opp", "home"]
    N = pd.concat([L[keep].reset_index(drop=True), F[list(FEATURES)].reset_index(drop=True).add_prefix("f_")], axis=1)
    for t in TARGETS_A:
        N["y_" + t.lower()] = L[t].values
    N["y_pm100"] = L.pm100.values
    N["y_on_poss"] = L.on_poss.values
    N["split"] = N.season.map(SPLIT).fillna("train")
    return N


def edge_features(N, pairs, games):
    """Όλα τα ζεύγη κόμβων κάθε graph, με ιστορικό μαζί/απέναντι από ΠΡΟΗΓΟΥΜΕΝΟΥΣ αγώνες."""
    gd = games.set_index("gid").date
    pairs = pairs.assign(date=pairs.gid.map(gd), season=pairs.gid.str[1:5].where(pairs.gid.str[0] == "E", pairs.gid.str[1:5]))
    pairs["season"] = pairs.gid.str.extract(r"^[A-Z](\d{4})")[0].astype(int)
    pairs = pairs.sort_values(["date", "gid"])
    key = ["pid", "pid_j", "teammate"]
    gk = pairs.groupby(key, sort=False)
    pairs["min_all"] = (gk.secs.cumsum() - pairs.secs) / 60
    pairs["games_all"] = gk.cumcount()
    pairs["min_season"] = (pairs.groupby(key + ["season"], sort=False).secs.cumsum() - pairs.secs) / 60
    pairs["y_min_shared"] = pairs.secs / 60
    # όλα τα ζεύγη κάθε graph (και όσα δεν μοιράστηκαν παρκέ σε αυτόν τον αγώνα)
    nodes = N[["gid", "pid", "team"]]
    allp = nodes.merge(nodes, on="gid", suffixes=("", "_j"))
    allp = allp[allp.pid < allp.pid_j]
    allp["teammate"] = (allp.team == allp.team_j).astype(int)
    E = allp[["gid", "pid", "pid_j", "teammate"]].merge(pairs[["gid"] + key + ["min_season", "min_all", "games_all", "y_min_shared"]],
                                                        on=["gid"] + key, how="left")
    # ζεύγη που ΔΕΝ βρέθηκαν μαζί σε αυτόν τον αγώνα: ιστορικό από το τελευταίο προηγούμενο κοινό ματς
    miss = E.min_all.isna()
    if miss.any():
        hist = pairs.assign(min_all=pairs.min_all + pairs.y_min_shared, games_all=pairs.games_all + 1)[key + ["date", "season", "min_all", "games_all"]]
        hist = hist.sort_values("date")
        q = E[miss][["gid", "pid", "pid_j", "teammate"]].copy()
        q["date"] = q.gid.map(gd)
        q = q.sort_values("date")
        m = pd.merge_asof(q, hist.drop(columns="season"), on="date", by=key, allow_exact_matches=False)
        E.loc[q.index, "min_all"] = m.min_all.values
        E.loc[q.index, "games_all"] = m.games_all.values
    E["min_season"] = E.min_season.fillna(0)
    E["min_all"] = E.min_all.fillna(0)
    E["games_all"] = E.games_all.fillna(0)
    E["y_min_shared"] = E.y_min_shared.fillna(0)
    return E


def graphs_table(N, games, logs):
    s = logs.groupby(["gid", "home"]).PTS.sum().unstack()
    G = games[["gid", "comp", "season", "gameCode", "date", "homecode", "awaycode"]].copy()
    G = G[G.gid.isin(N.gid.unique())]
    G["y_home"] = G.gid.map(s.get(1))
    G["y_away"] = G.gid.map(s.get(0))
    G["y_margin"], G["y_total"] = G.y_home - G.y_away, G.y_home + G.y_away
    G["n_nodes"] = G.gid.map(N.groupby("gid").size())
    G["split"] = G.season.map(SPLIT).fillna("train")
    return G.sort_values("date")


def preview(N, E, G, logs):
    """Περίληψη + δείγμα graphs για τη σελίδα «Δεδομένα GNN»."""
    feats = [{"name": c, "desc": d, "mean": _r(N["f_" + c].mean()), "std": _r(N["f_" + c].std()),
              "min": _r(N["f_" + c].min()), "max": _r(N["f_" + c].max())} for c, d in FEATURES.items()]
    tg = [{"name": t, "mean": _r(N[t].mean(), 2), "std": _r(N[t].std(), 2), "missing": _r(N[t].isna().mean())}
          for t in [c for c in N.columns if c.startswith("y_")]]
    efeat = [{"name": c, "desc": d, "mean": _r(E[c].mean(), 2), "std": _r(E[c].std(), 2), "max": _r(E[c].max(), 1)}
             for c, d in EDGE_FEATURES.items()]
    # ιστογράμματα στόχων
    hist = {}
    for t, lo, hi in [("y_pts", 0, 40), ("y_pir", -10, 45), ("y_min", 0, 40), ("y_pm100", -80, 80)]:
        v = N[t].dropna().clip(lo, hi)
        c, b = np.histogram(v, bins=24, range=(lo, hi))
        hist[t] = {"counts": c.tolist(), "lo": lo, "hi": hi}
    # παίκτες και στις δύο λίγκες
    by = logs.groupby(["pid", "comp"]).agg(g=("gameCode", "size"), m=("MIN", "sum")).unstack("comp").fillna(0)
    both = by[(by[("g", "E")] > 0) & (by[("g", "U")] > 0)]
    last = logs.sort_values("date").groupby("pid").agg(player=("player", "last"), team=("team", "last"), comp=("comp", "last"))
    cross = [[pid, last.loc[pid, "player"], last.loc[pid, "team"], last.loc[pid, "comp"], int(r[("g", "E")]), int(r[("g", "U")]),
              _r(r[("m", "E")], 0), _r(r[("m", "U")], 0)] for pid, r in both.iterrows()]
    cross.sort(key=lambda x: -(x[4] + x[5]))
    # δείγμα: τελευταίοι 40 αγώνες κάθε διοργάνωσης
    sample_ids = list(G.groupby("comp").tail(30).gid)
    gs = {}
    show_f = ["r_pts", "r_reb", "r_ast", "r_pir", "ts", "usg", "min", "starter", "pm100", "log_games", "rest", "hist_E", "no_hist"]
    for gid in sample_ids:
        nd = N[N.gid == gid]
        ed = E[E.gid == gid]
        g = G[G.gid == gid].iloc[0]
        gs[gid] = {"date": g.date.strftime("%Y-%m-%d"), "comp": g.comp, "home": g.homecode, "away": g.awaycode,
                   "hs": _r(g.y_home, 0), "as": _r(g.y_away, 0), "split": g.split,
                   "nodes": {"cols": ["pid", "player", "team", "home", *show_f, "y_pts", "y_reb", "y_ast", "y_pir", "y_min", "y_pm100", "y_on_poss"],
                             "rows": [[r.pid, r.player, r.team, int(r.home), *[_r(getattr(r, "f_" + f), 3) for f in show_f],
                                       _r(r.y_pts, 0), _r(r.y_reb, 0), _r(r.y_ast, 0), _r(r.y_pir, 0), _r(r.y_min, 1), _r(r.y_pm100, 1), _r(r.y_on_poss, 1)]
                                      for r in nd.itertuples()]},
                   "edges": {"cols": ["i", "j", "teammate", "min_season", "min_all", "games_all", "y_min_shared"],
                             "rows": [[r.pid, r.pid_j, int(r.teammate), _r(r.min_season, 1), _r(r.min_all, 1), int(r.games_all), _r(r.y_min_shared, 1)]
                                      for r in ed.itertuples()]}}
    splits = G.groupby(["split", "comp"]).size().unstack(fill_value=0)
    out = {
        "graphs": int(len(G)), "nodes": int(len(N)), "edges": int(len(E)),
        "avg_nodes": _r(G.n_nodes.mean(), 1), "avg_edges": _r(len(E) / max(1, len(G)), 1),
        "teammate_edges": int(E.teammate.sum()), "no_hist_rate": _r(N.f_no_hist.mean()),
        "stint_coverage": _r(N.y_pm100.notna().mean()),
        "splits": {s: {c: int(v) for c, v in row.items()} for s, row in splits.iterrows()},
        "seasons": {f"{c}{s}": int(n) for (c, s), n in G.groupby(["comp", "season"]).size().items()},
        "features": feats, "edge_features": efeat, "targets": tg, "hist": hist,
        "cross": {"cols": ["pid", "player", "team", "comp", "g_E", "g_U", "min_E", "min_U"], "rows": cross},
        "same_season_moves": int((logs.groupby(["pid", "season"]).comp.nunique() > 1).sum()),
        "half_life": HALF_LIFE, "sample": gs,
    }
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    (SITE_DATA / "gnn_preview.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))


def main():
    logs, games, stints = load()
    logs = logs.merge(games[["gid", "date"]].rename(columns={"date": "gdate"}), on="gid", how="left")
    logs["date"] = logs.gdate.fillna(logs.date)
    print(f"logs {len(logs)} | games {logs.gid.nunique()} | stints {len(stints)}")
    pg, pairs = on_court(stints)
    N = node_features(logs, games, pg)
    E = edge_features(N, pairs, games)
    G = graphs_table(N, games, logs)
    OUT.mkdir(parents=True, exist_ok=True)
    N.to_csv(OUT / "nodes.csv.gz", index=False, compression="gzip")
    E.to_csv(OUT / "edges.csv.gz", index=False, compression="gzip")
    G.to_csv(OUT / "graphs.csv.gz", index=False, compression="gzip")
    print(f"nodes {len(N)} | edges {len(E)} | graphs {len(G)} | avg nodes {G.n_nodes.mean():.1f}")
    preview(N, E, G, logs)
    print("-> site/data/gnn_preview.json")


if __name__ == "__main__":
    main()
