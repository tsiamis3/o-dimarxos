"""
Δεδομένα για το Graph Neural Network: κάθε αγώνας = ένα graph, κάθε παίκτης του ρόστερ = ένας κόμβος
(και όσοι δεν έπαιξαν, DNP, με στόχο 0 λεπτά), συν ένας κόμβος «ομάδα» ανά πλευρά.

EuroLeague + EuroCup μαζί: το ιστορικό κάθε παίκτη είναι ΕΝΙΑΙΟ χρονολογικά και στις δύο λίγκες
(κοινοί κωδικοί παικτών), με χαρακτηριστικό για το πού παίχτηκε κάθε ματς.

Κόμβος (παίκτης i στον αγώνα g), χαρακτηριστικά ΜΟΝΟ από αγώνες πριν από την ημέρα του g:
  - εκθετικά σταθμισμένοι μέσοι (μισή βαρύτητα κάθε 10 αγώνες) ανά 100 κατοχές στο παρκέ:
    πόντοι, ριμπάουντ (επιθ./αμυν.), ασίστ, κλεψίματα, κοψίματα, λάθη, σουτ 2π/3π, βολές, PIR, φάουλ (κάνει/δέχεται)
  - «νευρική» φόρμα (μισή βαρύτητα / 3 αγώνες), σταθερότητα (διακύμανση πόντων/PIR)
  - προφίλ σουτ ανά ζώνη + ευστοχία, % εύστοχων από ασίστ, πόντοι υπέρ/κατά στο παρκέ
  - RAPM επίθεσης/άμυνας (επανεκπαίδευση κάθε 14 ημέρες, μόνο με προηγούμενα stints)
  - ποσοστά: TS%, 3π% (με συρρίκνωση), usage
  - ρόλος: λεπτά/αγώνα, ποσοστό βασικού, κατοχές στο παρκέ
  - plus-minus στο παρκέ ανά 100 κατοχές (από τα stints): «RAPM-lite»
  - εμπειρία: αγώνες στο ιστορικό, ημέρες ξεκούρασης, αγώνες τις 14 τελευταίες ημέρες
  - πλαίσιο: έδρα, λίγκα του αγώνα, μερίδιο του ιστορικού στην EuroLeague, χωρίς ιστορικό (flag)
Ακμές (ζεύγη παικτών στον ίδιο αγώνα):
  - συμπαίκτες: λεπτά μαζί στο παρκέ σε προηγούμενους αγώνες (σεζόν και συνολικά), αγώνες μαζί
  - αντίπαλοι: λεπτά απέναντι σε προηγούμενους αγώνες
  - ασίστ με κατεύθυνση (play-by-play) και net rating του διδύμου όταν παίζουν μαζί
Κόμβος ομάδας: ratings επίθεσης/άμυνας/ρυθμού πριν από τον αγώνα, αναμενόμενοι πόντοι, ξεκούραση.
  - και για κάθε ζεύγος, ανεξάρτητα από τη σημερινή σχέση: λεπτά μαζί / λεπτά απέναντι σε όλο το ιστορικό
Στόχοι:
  - ανά κόμβο (A): πόντοι, ριμπάουντ, ασίστ, PIR, λεπτά του αγώνα
  - ανά κόμβο (B): plus-minus στο παρκέ ανά 100 κατοχές (+ κατοχές, ως βάρος)
  - ανά graph: διαφορά και σύνολο πόντων
Split (χρονικό): train = σεζόν 2023–2024, validation = 2025, test = 2026 (τρέχουσα).

Έξοδοι:
  data/gnn/{nodes,edges,graphs,teams}.csv.gz                               (για την εκπαίδευση· δεν μπαίνουν στο git)
  site/data/gnn_preview.json                                            (σελίδα «Δεδομένα GNN»)

    python scripts/gnn_data.py
"""
import json
import math

import numpy as np
import pandas as pd

from config import RAW_DIR, ROOT, SITE_DATA
from dataset import STAT_COLS, CompetitionData, _minutes
from rapm import RAPM
from ratings import RidgeRatings, team_games
from shots_agg import zone as shot_zone
from stints import build as build_stints

COMPS = ["E", "U"]
HALF_LIFE = 10                     # αγώνες
OUT = ROOT / "data" / "gnn"
BOX = ["PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "FG2A", "FG3A", "FG3M", "FTA", "FTM", "FG2M", "PIR"]
RATE = ["PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "FG2A", "FG3A", "FTA", "PIR", "PF", "FD", "BLKA"]
TARGETS_A = ["PTS", "REB", "AST", "PIR", "MIN"]
SPLIT = {2023: "train", 2024: "train", 2025: "val", 2026: "test"}
K_POSS, K_PM, K_TSA = 50.0, 150.0, 20.0   # εικονικές κατοχές/προσπάθειες προς τον μέσο όρο (μικρά δείγματα)
HALF_SHORT = 3                     # «νευρική» φόρμα: μισή βαρύτητα κάθε 3 αγώνες
K_SHOT, K_FG, K_ASTD = 20.0, 15.0, 15.0    # εικονικά σουτ (προφίλ), προσπάθειες (% ζώνης), εύστοχα (% με ασίστ)
K_REB = 20.0                       # εικονικές ευκαιρίες ριμπάουντ (OREB% / DREB%)
K_PAIR, K_AST = 100.0, 30.0        # εικονικές κοινές κατοχές: net rating διδύμου, ασίστ ζεύγους
TEAM_TAU_LAM = (365, 2.0)          # ratings ομάδας για τους κόμβους-ομάδες (ημέρες μισής ζωής, ridge)
RAPM_EVERY = 14                    # ημέρες ανάμεσα σε επανεκπαιδεύσεις του RAPM (χωρίς δεδομένα από το μέλλον)
ZONES = ["rim", "paint", "mid", "corner3", "arc3"]
ZONE_SHORT = {"rim": "rim", "paint": "paint", "mid": "mid", "corner3": "c3", "arc3": "a3"}

FEATURES = {   # όνομα -> περιγραφή (για τη σελίδα)
    **{f"r_{s.lower()}": f"{s} ανά 100 μετρημένες κατοχές στο παρκέ (σταθμισμένο: μισή βαρύτητα / {HALF_LIFE} αγώνες· +{int(K_POSS)} εικονικές κατοχές στον μέσο όρο)" for s in RATE},
    **{f"r_{s.lower()}_s": f"{s} ανά 100 κατοχές, «νευρική» φόρμα (μισή βαρύτητα / {HALF_SHORT} αγώνες)" for s in ["PTS", "PIR"]},
    "min_s": f"Λεπτά ανά αγώνα, «νευρική» φόρμα (μισή βαρύτητα / {HALF_SHORT} αγώνες)",
    "sd_pts": "Διακύμανση (τυπ. απόκλιση) πόντων στους προηγούμενους αγώνες: πόσο σταθερός είναι",
    "sd_pir": "Διακύμανση (τυπ. απόκλιση) PIR στους προηγούμενους αγώνες",
    **{f"sh_{ZONE_SHORT[z]}": f"Μερίδιο των σουτ του από τη ζώνη «{z}» (+{int(K_SHOT)} εικονικά σουτ με το προφίλ της λίγκας)" for z in ZONES},
    **{f"fg_{z}": f"Ευστοχία στη ζώνη «{z}» (+{int(K_FG)} εικονικές προσπάθειες στον μέσο όρο)" for z in ["rim", "paint", "mid"]},
    "astd": f"Ποσοστό των εύστοχων σουτ του που ήρθαν από ασίστ (εκτελεστής ↔ δημιουργός· +{int(K_ASTD)} εικονικά)",
    "off100": f"Πόντοι της ομάδας του ανά 100 κατοχές όσο είναι στο παρκέ (+{int(K_PM)} εικονικές κατοχές)",
    "def100": f"Πόντοι του αντιπάλου ανά 100 κατοχές όσο είναι στο παρκέ (μικρότερο = καλύτερη άμυνα)",
    "rapm_o": f"RAPM επίθεσης: πόντοι/100 που προσθέτει, με έλεγχο για συμπαίκτες και αντιπάλους (εκπαίδευση κάθε {RAPM_EVERY} ημέρες μόνο με προηγούμενα δεδομένα)",
    "rapm_d": "RAPM άμυνας: πόντοι/100 που επιτρέπει (αρνητικό = καλή άμυνα)",
    "rapm_exp": "log(1 + σταθμισμένες κατοχές στο RAPM): πόσο αξιόπιστο είναι",
    "oreb_pct": f"OREB%: ποσοστό των διαθέσιμων επιθετικών ριμπάουντ που παίρνει όσο είναι στο παρκέ (+{int(K_REB)} εικονικές ευκαιρίες)",
    "dreb_pct": f"DREB%: ποσοστό των διαθέσιμων αμυντικών ριμπάουντ που παίρνει όσο είναι στο παρκέ (+{int(K_REB)} εικονικές ευκαιρίες)",
    "ts": f"True shooting %: πόντοι / (2 × (σουτ + ΜΕΤΡΗΜΕΝΕΣ επισκέψεις στη γραμμή)), όχι 0.44 × βολές (+{int(K_TSA)} εικονικές προσπάθειες)",
    "fg3p": "Τρίποντα % (συρρίκνωση προς τον μέσο όρο με 40 εικονικές προσπάθειες)",
    "usg": f"Usage: οι φάσεις που τελειώνει (σουτ, επίσκεψη στη γραμμή, λάθος) / όλες οι φάσεις της ομάδας του όσο είναι στο παρκέ, μετρημένες (+{int(K_POSS)} εικονικές)",
    "min": "Λεπτά ανά αγώνα (εκθετικός μέσος· μαζί με τα DNP = αναμενόμενα λεπτά από το ρόστερ)",
    "min_last": "Λεπτά στον προηγούμενο αγώνα",
    "starter": "Ποσοστό βασικού (εκθετικός μέσος)",
    "on_poss": "Κατοχές στο παρκέ ανά αγώνα, μετρημένες από το play-by-play (εκθετικός μέσος)",
    "pm100": f"Plus-minus στο παρκέ ανά 100 κατοχές (από τα stints· +{int(K_PM)} εικονικές κατοχές στο 0)",
    "log_games": "log(1 + αγώνες στο ιστορικό, και στις δύο λίγκες)",
    "rest": "Ημέρες από τον προηγούμενο αγώνα (έως 14)",
    "games14": "Αγώνες που έπαιξε τις 14 τελευταίες ημέρες",
    "home": "1 = γηπεδούχος",
    "comp_E": "1 = ο αγώνας είναι EuroLeague, 0 = EuroCup",
    "hist_E": "Μερίδιο των λεπτών του ιστορικού στην EuroLeague",
    "no_hist": "1 = κανένας προηγούμενος αγώνας (τα υπόλοιπα = μέσος όρος)",
}
TEAM_FEATURES = {
    "t_off": "Rating επίθεσης ομάδας (πόντοι/100 πάνω από τον μέσο όρο, με διόρθωση για αντιπάλους)",
    "t_def": "Rating άμυνας ομάδας (πόντοι/100 που επιτρέπει πάνω από τον μέσο όρο· αρνητικό = καλή άμυνα)",
    "t_pace": "Ρυθμός (κατοχές ανά αγώνα)",
    "t_exp_for": "Αναμενόμενοι πόντοι της ομάδας σε αυτόν τον αγώνα (ratings + έδρα)",
    "t_exp_against": "Αναμενόμενοι πόντοι του αντιπάλου",
    "t_neff": "log(1 + σταθμισμένοι αγώνες που στηρίζουν το rating)",
    "t_rest": "Ημέρες από τον προηγούμενο αγώνα της ομάδας (έως 14)",
    "t_home": "1 = γηπεδούχος",
    "t_no_hist": "1 = δεν υπάρχει ακόμα rating (αρχή του ιστορικού)",
}
EDGE_FEATURES = {
    "teammate": "1 = συμπαίκτες, 0 = αντίπαλοι",
    "min_season": "Λεπτά μαζί (συμπαίκτες) ή απέναντι (αντίπαλοι) στο παρκέ, ίδια σεζόν, σε προηγούμενους αγώνες",
    "min_all": "Το ίδιο, σε όλο το ιστορικό",
    "games_all": "Αγώνες όπου βρέθηκαν μαζί στο παρκέ (ή απέναντι)",
    "min_with_all": "Λεπτά ΜΑΖΙ στο παρκέ σε όλο το ιστορικό, ανεξάρτητα από τη σημερινή σχέση (πρώην συμπαίκτες)",
    "min_vs_all": "Λεπτά ΑΠΕΝΑΝΤΙ στο παρκέ σε όλο το ιστορικό, ανεξάρτητα από τη σημερινή σχέση",
    "games_with": "Αγώνες μαζί στο παρκέ (όλο το ιστορικό)",
    "games_vs": "Αγώνες απέναντι στο παρκέ (όλο το ιστορικό)",
    "ast_ij": f"Ασίστ του i (pid) προς τον j ανά 100 κοινές κατοχές ως συμπαίκτες, όλο το ιστορικό (+{int(K_AST)} εικονικές κατοχές)",
    "ast_ji": "Το ίδιο, από τον j προς τον i (η ακμή έχει κατεύθυνση)",
    "net_with": f"Net rating του διδύμου: plus-minus ανά 100 κατοχές όταν παίζουν μαζί (+{int(K_PAIR)} εικονικές κατοχές στο 0)",
}


def _r(v, d=3):
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return None
    return round(float(v), d)


# ---------------------------------------------------------------------------
def load():
    logs, games, stints, pbp, shots, dnp, tgs, trips = [], [], [], [], [], [], [], []
    for c in COMPS:
        d = CompetitionData(c)
        lg = d.logs.copy()
        lg["comp"] = c
        logs.append(lg)
        g = d.games.copy()
        g["comp"], g["date"] = c, pd.to_datetime(g["date"])
        games.append(g)
        tg = team_games(d).copy()
        tg["comp"] = c
        tgs.append(tg)
        for s in d.seasons:
            tr = []
            st = build_stints(c, s, d, trips_out=tr)
            if tr:
                trips.append(pd.DataFrame(tr).assign(comp=c))
            if len(st):
                st["comp"] = c
                stints.append(st)
            for kind, out in (("pbp", pbp), ("shots", shots)):
                f = RAW_DIR / f"{c}{s}_{kind}.csv.gz"
                if f.exists():
                    x = pd.read_csv(f)
                    x["comp"], x["season"] = c, s
                    out.append(x)
            f = RAW_DIR / f"{c}{s}_box.csv.gz"
            if f.exists():                     # όσοι ήταν στο ρόστερ αλλά δεν έπαιξαν (DNP)
                b = pd.read_csv(f, usecols=["Gamecode", "Home", "Player_ID", "Player", "Team", "Minutes"])
                b["pid"] = b.Player_ID.astype(str).str.strip()
                b = b[(b.Minutes.map(_minutes) <= 0) & b.pid.str.match(r"^P")]
                dnp.append(pd.DataFrame({"comp": c, "season": s, "gameCode": b.Gamecode, "pid": b.pid,
                                         "player": b.Player, "team": b.Team, "home": b.Home}))
    logs = pd.concat(logs, ignore_index=True)
    games = pd.concat(games, ignore_index=True)
    stints = pd.concat(stints, ignore_index=True)
    pbp = pd.concat(pbp, ignore_index=True)
    shots = pd.concat(shots, ignore_index=True)
    dnp = pd.concat(dnp, ignore_index=True)
    tgs = pd.concat(tgs, ignore_index=True)
    trips = pd.concat(trips, ignore_index=True)
    for df in (logs, games, stints, pbp, shots, dnp, tgs, trips):
        df["gid"] = df.comp + df.season.astype(str) + "-" + df.gameCode.astype(str)
    stints = stints.merge(games[["gid", "date", "homecode", "awaycode"]], on="gid")
    # ΜΕΤΡΗΜΕΝΕΣ κατοχές από το play-by-play (όχι εκτίμηση με 0.44 × βολές): για όλα τα παρακάτω και το RAPM
    stints["poss_h"], stints["poss_a"] = stints.cposs_h.astype(float), stints.cposs_a.astype(float)
    stints["sid"] = np.arange(len(stints))
    # DNP: μόνο σε αγώνες με box score, με τα ίδια πεδία (στατιστικά 0)
    dnp = dnp[dnp.gid.isin(logs.gid)]
    dnp = dnp.merge(logs.drop_duplicates(["gid", "team"])[["gid", "team", "opp", "date", "Round"]], on=["gid", "team"])
    dnp = dnp[~dnp.set_index(["gid", "pid"]).index.isin(logs.set_index(["gid", "pid"]).index)]
    for c in STAT_COLS:
        dnp[c] = 0.0
    dnp["starter"] = 0.0
    logs["played"], dnp["played"] = 1, 0
    logs = pd.concat([logs, dnp[logs.columns]], ignore_index=True)
    # επισκέψεις στη γραμμή ανά παίκτη (0 σε αγώνες με play-by-play, κενό αλλιώς -> εκτίμηση 0.44 × βολές)
    logs = logs.merge(trips[["gid", "pid", "trips"]], on=["gid", "pid"], how="left")
    logs.loc[logs.trips.isna() & logs.gid.isin(stints.gid), "trips"] = 0
    return logs, games, stints, pbp, shots, tgs


def assist_pairs(pbp):
    """Ζεύγη (δημιουργός → εκτελεστής) από το play-by-play: κάθε «AS» δένεται με το αμέσως προηγούμενο
    εύστοχο σουτ (2FGM/3FGM) ή εύστοχη βολή (ασίστ σε φάουλ) της ίδιας ομάδας, έως 4 γεγονότα πίσω."""
    p = pbp.sort_values(["gid", "n"]).reset_index(drop=True)
    fgm = p.pt.isin(["2FGM", "3FGM", "FTM"])
    p["s_pid"] = p.pid.where(fgm)
    p["s_team"] = p.team.where(fgm)
    p["s_n"] = p.n.where(fgm)
    p["s_fg"] = (p.pt != "FTM").astype(float).where(fgm)
    p[["s_pid", "s_team", "s_n", "s_fg"]] = p.groupby("gid")[["s_pid", "s_team", "s_n", "s_fg"]].ffill()
    a = p[p.pt == "AS"]
    ok = (a.s_team == a.team) & ((a.n - a.s_n) <= 4) & a.pid.notna() & (a.s_pid != a.pid)
    a = a[ok].drop_duplicates(["gid", "s_n"])                  # ένα εύστοχο σουτ = το πολύ μία ασίστ
    rate = len(a) / max(1, (p.pt == "AS").sum())
    out = (a.groupby(["gid", "pid", "s_pid"]).agg(ast=("n", "size"), ast_fg=("s_fg", "sum")).reset_index()
           .rename(columns={"pid": "passer", "s_pid": "scorer"}))
    return out, rate


def shot_zones(shots):
    """Ανά (αγώνα, παίκτη): προσπάθειες και εύστοχα ανά ζώνη."""
    d = shots[(shots.y >= -1.5) & (shots.y <= 14) & (shots.x.abs() <= 7.8)].copy()
    d["pid"] = d.pid.astype(str).str.strip()
    d["zone"] = [shot_zone(x, y, pts) for x, y, pts in zip(d.x, d.y, d.pts)]
    att = d.groupby(["gid", "pid", "zone"]).made.agg(["size", "sum"]).unstack("zone").fillna(0)
    out = pd.DataFrame(index=att.index)
    for z in ZONES:
        out[f"za_{z}"] = att[("size", z)] if ("size", z) in att else 0.0
        out[f"zm_{z}"] = att[("sum", z)] if ("sum", z) in att else 0.0
    return out.reset_index()


def on_court(stints):
    """Ανά (αγώνα, παίκτη): κατοχές, δευτερόλεπτα, plus-minus στο παρκέ. Ανά ζεύγος: δευτερόλεπτα μαζί/απέναντι."""
    poss = (stints.poss_h + stints.poss_a) / 2
    long = []
    for side, other in (("h", "a"), ("a", "h")):
        for k in range(5):
            long.append(pd.DataFrame({"sid": stints.sid, "gid": stints.gid, "pid": stints[f"{side}{k}"], "side": side,
                                      "secs": stints.secs, "poss": poss, "pf": stints[f"pts_{side}"], "pa": stints[f"pts_{other}"],
                                      "orb_ch": stints[f"orb_{side}"] + stints[f"drb_{other}"],     # επιθετικά ριμπάουντ «στο τραπέζι»
                                      "drb_ch": stints[f"drb_{side}"] + stints[f"orb_{other}"],     # αμυντικά
                                      "plays": stints[f"fga_{side}"] + stints[f"trip_{side}"] + stints[f"tov_{side}"],
                                      "pm": stints[f"pts_{side}"] - stints[f"pts_{other}"]}))
    long = pd.concat(long, ignore_index=True)
    pg = long.groupby(["gid", "pid"]).agg(on_poss=("poss", "sum"), on_secs=("secs", "sum"), pm=("pm", "sum"),
                                          on_pf=("pf", "sum"), on_pa=("pa", "sum"), orb_ch=("orb_ch", "sum"),
                                          drb_ch=("drb_ch", "sum"), t_plays_on=("plays", "sum")).reset_index()
    pg["pm100"] = 100 * pg.pm / pg.on_poss.replace(0, np.nan)
    # ζεύγη στο ίδιο stint
    a = long[["sid", "gid", "pid", "side", "secs", "poss", "pm"]]
    pr = a.merge(a[["sid", "pid", "side"]], on="sid", suffixes=("", "_j"))
    pr = pr[pr.pid < pr.pid_j]
    pr["teammate"] = (pr.side == pr.side_j).astype(int)
    pairs = pr.groupby(["gid", "pid", "pid_j", "teammate"])[["secs", "poss", "pm"]].sum().reset_index()   # pm: από τη μεριά του pid
    return pg, pairs


def rapm_asof(stints, keys):
    """RAPM χωρίς μέλλον: επανεκπαίδευση στην αρχή κάθε διαστήματος RAPM_EVERY ημερών, μόνο με stints πριν από αυτήν.
    keys: DataFrame με date, pid -> rapm_o, rapm_d, rapm_exp."""
    st = stints[(stints.poss_h + stints.poss_a) > 0.5]
    t0 = keys.date.min()
    bucket = t0 + pd.to_timedelta(((keys.date - t0).dt.days // RAPM_EVERY) * RAPM_EVERY, unit="D")
    out = pd.DataFrame(index=keys.index, columns=["rapm_o", "rapm_d", "rapm_exp"], dtype=float)
    for r in sorted(bucket.unique()):
        past = st[st.date < r]
        if len(past) < 3000:
            continue
        m = RAPM().fit(past, asof=r)
        tab = m.table().set_index("pid")
        ix = bucket.index[bucket == r]
        pids = keys.loc[ix, "pid"]
        out.loc[ix, "rapm_o"] = pids.map(tab.O).values
        out.loc[ix, "rapm_d"] = pids.map(tab.D).values
        out.loc[ix, "rapm_exp"] = np.log1p(pids.map(tab.poss)).values
    return out.astype(float).fillna({"rapm_o": 0.0, "rapm_d": 0.0, "rapm_exp": 0.0})


def node_features(logs, games, pg, zones, ast, stints):
    L = logs.merge(pg[["gid", "pid", "on_poss", "pm100", "on_pf", "on_pa", "orb_ch", "drb_ch", "t_plays_on"]], on=["gid", "pid"], how="left")
    L = L.merge(zones, on=["gid", "pid"], how="left")
    astd = ast.groupby(["gid", "scorer"]).ast_fg.sum().rename("astd").reset_index().rename(columns={"scorer": "pid"})
    L = L.merge(astd, on=["gid", "pid"], how="left")
    L = L.sort_values(["date", "gid"]).reset_index(drop=True)
    L["st_poss"] = L.on_poss.fillna(0)                          # κατοχές ΜΟΝΟ από stints (για on/off)
    L["on_poss"] = L.on_poss.fillna(L.MIN / 40 * 73)            # χωρίς stints: εκτίμηση από τα λεπτά
    L[["on_pf", "on_pa", "astd"]] = L[["on_pf", "on_pa", "astd"]].fillna(0)
    for z in ZONES:
        L[[f"za_{z}", f"zm_{z}"]] = L[[f"za_{z}", f"zm_{z}"]].fillna(0)
    L["za_all"] = L[[f"za_{z}" for z in ZONES]].sum(axis=1)
    L["FGA"] = L.FG2A + L.FG3A
    L["FGM"] = L.FG2M + L.FG3M
    L["trips"] = L.trips.fillna(0.44 * L.FTA)                   # μετρημένες επισκέψεις στη γραμμή (αλλιώς εκτίμηση)
    L["TSA"] = L.FGA + L.trips
    L["USE"] = L.FGA + L.trips + L.TOV                          # «ολοκληρωμένες φάσεις»: σουτ, επίσκεψη στη γραμμή, λάθος
    has_st = L.orb_ch.notna()
    L[["orb_ch", "drb_ch"]] = L[["orb_ch", "drb_ch"]].fillna(0)
    L["OREB_st"], L["DREB_st"] = L.OREB.where(has_st, 0), L.DREB.where(has_st, 0)
    L["isE"] = (L.comp == "E").astype(float)
    pl = L.played == 1
    g = L.groupby("pid", sort=False)
    alpha = 1 - 0.5 ** (1 / HALF_LIFE)
    alpha_s = 1 - 0.5 ** (1 / HALF_SHORT)

    def ewm_prev(col, weight=None, a=alpha):
        """Εκθετικός μέσος των ΠΡΟΗΓΟΥΜΕΝΩΝ αγώνων του παίκτη (shift 1)."""
        if weight is None:
            return g[col].transform(lambda x: x.shift(1).ewm(alpha=a, ignore_na=True).mean())
        num = (L[col] * L[weight]).groupby(L.pid).transform(lambda x: x.shift(1).ewm(alpha=a).mean())
        den = L[weight].groupby(L.pid).transform(lambda x: x.shift(1).ewm(alpha=a).mean())
        return num / den.replace(0, np.nan)

    F = pd.DataFrame(index=L.index)
    order = L.groupby("pid", sort=False).indices

    def dsum(col, hl=HALF_LIFE):
        """Σταθμισμένο άθροισμα των ΠΡΟΗΓΟΥΜΕΝΩΝ αγώνων: S_i = r·S_(i−1) + x_(i−1)."""
        r = 0.5 ** (1 / hl)
        x = (L[col] if isinstance(col, str) else col).fillna(0).to_numpy(float)
        out = np.zeros(len(L))
        for idx in order.values():
            sacc = 0.0
            for i in idx:
                out[i] = sacc
                sacc = r * sacc + x[i]
        return pd.Series(out, index=L.index)

    def shrunk(num, den, k, prior):
        return (num + k * prior) / (den + k)

    S_poss = dsum("on_poss")
    for s in RATE:                    # ανά 100 κατοχές, με K_POSS εικονικές κατοχές στον μέσο όρο της λίγκας
        lg = (L[s].sum() / L.on_poss.sum())
        F[f"r_{s.lower()}"] = 100 * shrunk(dsum(s), S_poss, K_POSS, lg)
    S_poss_s = dsum("on_poss", HALF_SHORT)
    for s in ["PTS", "PIR"]:
        F[f"r_{s.lower()}_s"] = 100 * shrunk(dsum(s, HALF_SHORT), S_poss_s, K_POSS, L[s].sum() / L.on_poss.sum())
    F["min_s"] = ewm_prev("MIN", a=alpha_s)
    for s in ["PTS", "PIR"]:          # σταθερότητα: μόνο αγώνες που έπαιξε
        v = L[s].where(pl)
        F[f"sd_{s.lower()}"] = v.groupby(L.pid).transform(lambda x: x.shift(1).ewm(alpha=alpha, ignore_na=True, min_periods=3).std())
    # προφίλ σουτ
    S_za = dsum("za_all")
    tot = L[[f"za_{z}" for z in ZONES]].sum()
    for z in ZONES:
        F[f"sh_{ZONE_SHORT[z]}"] = shrunk(dsum(f"za_{z}"), S_za, K_SHOT, tot[f"za_{z}"] / tot.sum())
    for z in ["rim", "paint", "mid"]:
        F[f"fg_{z}"] = shrunk(dsum(f"zm_{z}"), dsum(f"za_{z}"), K_FG, L[f"zm_{z}"].sum() / max(1, L[f"za_{z}"].sum()))
    F["astd"] = shrunk(dsum("astd"), dsum("FGM"), K_ASTD, L.astd.sum() / max(1, L.loc[L.gid.isin(ast.gid), "FGM"].sum()))
    F["oreb_pct"] = shrunk(dsum("OREB_st"), dsum("orb_ch"), K_REB, L.OREB_st.sum() / L.orb_ch.sum())
    F["dreb_pct"] = shrunk(dsum("DREB_st"), dsum("drb_ch"), K_REB, L.DREB_st.sum() / L.drb_ch.sum())
    S_st = dsum("st_poss")
    F["off100"] = 100 * shrunk(dsum("on_pf"), S_st, K_PM, L.on_pf.sum() / L.st_poss.sum())
    F["def100"] = 100 * shrunk(dsum("on_pa"), S_st, K_PM, L.on_pa.sum() / L.st_poss.sum())
    F[["rapm_o", "rapm_d", "rapm_exp"]] = rapm_asof(stints, L[["date", "pid"]])
    lg_ts = L.PTS.sum() / (2 * L.TSA.sum())
    F["ts"] = (dsum("PTS") + 2 * K_TSA * lg_ts) / (2 * (dsum("TSA") + K_TSA))
    c3m = L.FG3M.groupby(L.pid).transform(lambda x: x.shift(1).cumsum())
    c3a = L.FG3A.groupby(L.pid).transform(lambda x: x.shift(1).cumsum())
    lg3 = L.FG3M.sum() / L.FG3A.sum()
    F["fg3p"] = (c3m.fillna(0) + 40 * lg3) / (c3a.fillna(0) + 40)
    # usage: χρήσεις παίκτη / χρήσεις ομάδας όσο είναι μέσα (≈ ομάδα × κατοχές παίκτη / κατοχές ομάδας)
    # παρονομαστής: οι φάσεις της ομάδας του όσο ήταν στο παρκέ (μετρημένες από τα stints· αλλιώς εκτίμηση)
    tuse = L.groupby(["gid", "team"]).USE.transform("sum")
    tposs = L.groupby(["gid", "team"]).on_poss.transform("sum") / 5
    L["t_use_on"] = L.t_plays_on.fillna((tuse * L.on_poss / tposs.replace(0, np.nan)).fillna(0))
    lg_usg = L.USE.sum() / L.t_use_on.sum()
    F["usg"] = (dsum("USE") + K_POSS * lg_usg) / (dsum("t_use_on") + K_POSS)
    F["min"] = ewm_prev("MIN")                                     # μαζί με τα DNP (0'): αναμενόμενα λεπτά από το ρόστερ
    F["min_last"] = g.MIN.shift(1)
    F["starter"] = ewm_prev("starter")
    F["on_poss"] = ewm_prev("on_poss")
    L["pm_raw"] = L.pm100.fillna(0) * L.on_poss / 100
    F["pm100"] = 100 * dsum("pm_raw") / (S_poss + K_PM)
    n_prev = g.played.cumsum() - L.played                          # αγώνες που ΕΠΑΙΞΕ πριν
    F["log_games"] = np.log1p(n_prev)
    prev_play = L.date.where(pl).groupby(L.pid).transform(lambda x: x.shift(1).ffill())
    F["rest"] = ((L.date - prev_play).dt.days.clip(0, 14)).fillna(14)
    # αγώνες που έπαιξε τις 14 τελευταίες ημέρες
    g14 = np.zeros(len(L))
    dts, plv = L.date.to_numpy("datetime64[D]"), L.played.to_numpy()
    for idx in order.values():
        pdts = []
        for i in idx:
            d0 = dts[i] - np.timedelta64(14, "D")
            g14[i] = sum(1 for x in pdts if x >= d0)
            if plv[i]:
                pdts.append(dts[i])
    F["games14"] = g14
    F["home"] = L.home.astype(float)
    F["comp_E"] = L.isE
    F["hist_E"] = ewm_prev("isE", weight="MIN").fillna(L.isE)
    F["no_hist"] = (n_prev == 0).astype(float)
    # χωρίς ιστορικό -> μέσος όρος της λίγκας του αγώνα
    for c in FEATURES:
        if c in F and F[c].isna().any():
            F[c] = F[c].fillna(F.groupby(L.comp)[c].transform("mean")).fillna(F[c].mean())
    keep = ["gid", "comp", "season", "gameCode", "date", "pid", "player", "team", "opp", "home", "played"]
    N = pd.concat([L[keep].reset_index(drop=True), F[list(FEATURES)].reset_index(drop=True).add_prefix("f_")], axis=1)
    for t in TARGETS_A:
        N["y_" + t.lower()] = L[t].values
    N["y_pm100"] = L.pm100.where(pl).values
    N["y_on_poss"] = L.on_poss.values
    N["y_played"] = L.played.values
    N["split"] = N.season.map(SPLIT).fillna("train")
    return N


def edge_features(N, pairs, games, ast):
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
    # ιστορικό ανεξάρτητα από τη σημερινή σχέση: λεπτά ΜΑΖΙ και λεπτά ΑΠΕΝΑΝΤΙ σε όλους τους προηγούμενους αγώνες
    # (π.χ. πρώην συμπαίκτες που σήμερα είναι αντίπαλοι κρατούν τα κοινά τους λεπτά)
    # + ασίστ με κατεύθυνση και net rating διδύμου (μόνο όταν ήταν συμπαίκτες)
    a = ast.copy()
    a["pid"], a["pid_j"] = np.minimum(a.passer, a.scorer), np.maximum(a.passer, a.scorer)
    a["a_ij"] = np.where(a.passer == a.pid, a.ast, 0)            # pid -> pid_j
    a["a_ji"] = np.where(a.passer == a.pid, 0, a.ast)            # pid_j -> pid
    a = a.groupby(["gid", "pid", "pid_j"], as_index=False)[["a_ij", "a_ji"]].sum()
    h = pairs[["gid", "pid", "pid_j", "teammate", "secs", "poss", "pm"]].merge(a, on=["gid", "pid", "pid_j"], how="outer")
    h["teammate"] = h.teammate.fillna(1)
    h = h.fillna(0)
    h["date"] = h.gid.map(gd)
    h["w"], h["v"] = h.secs * h.teammate / 60, h.secs * (1 - h.teammate) / 60
    h["gw"], h["gv"] = h.teammate * (h.secs > 0), (1 - h.teammate) * (h.secs > 0)
    h["pw"], h["mw"] = h.poss * h.teammate, h.pm * h.teammate
    cols = ["w", "v", "gw", "gv", "pw", "mw", "a_ij", "a_ji"]
    h = h.groupby(["date", "pid", "pid_j"], as_index=False)[cols].sum().sort_values("date")
    gk2 = h.groupby(["pid", "pid_j"], sort=False)
    for c in cols:
        h["c_" + c] = gk2[c].cumsum()
    q = E[["gid", "pid", "pid_j"]].copy()
    q["date"] = q.gid.map(gd)
    q = q.reset_index().sort_values("date")
    m = pd.merge_asof(q, h[["date", "pid", "pid_j"] + ["c_" + c for c in cols]],
                      on="date", by=["pid", "pid_j"], allow_exact_matches=False).set_index("index").reindex(E.index).fillna(0)
    E["min_with_all"], E["min_vs_all"] = m.c_w.values, m.c_v.values
    E["games_with"], E["games_vs"] = m.c_gw.values, m.c_gv.values
    E["ast_ij"] = (100 * m.c_a_ij / (m.c_pw + K_AST)).values
    E["ast_ji"] = (100 * m.c_a_ji / (m.c_pw + K_AST)).values
    E["net_with"] = (100 * m.c_mw / (m.c_pw + K_PAIR)).values
    # στο ίδιο το ματς (αποτέλεσμα, όχι είσοδος): ασίστ ανά κατεύθυνση
    E = E.merge(a.rename(columns={"a_ij": "y_ast_ij", "a_ji": "y_ast_ji"}), on=["gid", "pid", "pid_j"], how="left")
    E[["y_ast_ij", "y_ast_ji"]] = E[["y_ast_ij", "y_ast_ji"]].fillna(0)
    return E


def team_nodes(tgs, N):
    """Κόμβος «ομάδα» ανά (αγώνα, ομάδα): ratings ομάδας ΠΡΙΝ από τον αγώνα (ίδια ridge με το Monte Carlo)."""
    rows = []
    for c, tg in tgs.groupby("comp"):
        tg = tg.copy()
        tg["date"] = pd.to_datetime(tg.date)
        tau, lam = TEAM_TAU_LAM          # σταθερά (ίδια τοπικά και στο workflow)
        tg = tg.sort_values("date")
        tg["t_rest"] = tg.groupby("team").date.diff().dt.days.clip(0, 14).fillna(14)
        nt = tg.team.nunique()
        for d in sorted(tg.date.unique()):
            today = tg[tg.date == d]
            past = tg[tg.date < d]
            m = RidgeRatings(tau, lam).fit(past, asof=d) if len(past) >= 6 * nt else None
            for r in today.itertuples():
                if m is None:
                    rows.append((r.gid, r.team, r.home, np.nan, np.nan, np.nan, np.nan, np.nan, 0.0, r.t_rest, 1.0))
                    continue
                o, df_, _ = m.team(r.team)
                if r.home == 1:
                    hp, ap, poss = m.predict(r.team, r.opp)
                else:
                    ap, hp, poss = m.predict(r.opp, r.team)
                i = m.ix.get(r.team)
                neff = float(m.n_eff[i]) if i is not None else 0.0
                rows.append((r.gid, r.team, r.home, o, df_, poss, hp, ap, np.log1p(neff), r.t_rest, 0.0))
    T = pd.DataFrame(rows, columns=["gid", "team", "t_home", "t_off", "t_def", "t_pace", "t_exp_for", "t_exp_against",
                                    "t_neff", "t_rest", "t_no_hist"])
    T = T[T.gid.isin(N.gid)]
    for c in ["t_off", "t_def", "t_pace", "t_exp_for", "t_exp_against"]:
        T[c] = T[c].fillna(T.groupby(T.gid.str[0])[c].transform("mean"))
    return T.reset_index(drop=True)


def graphs_table(N, games, logs):
    s = logs.groupby(["gid", "home"]).PTS.sum().unstack()
    G = games[["gid", "comp", "season", "gameCode", "date", "homecode", "awaycode"]].copy()
    G = G[G.gid.isin(N.gid.unique())]
    G["y_home"] = G.gid.map(s.get(1))
    G["y_away"] = G.gid.map(s.get(0))
    G["y_margin"], G["y_total"] = G.y_home - G.y_away, G.y_home + G.y_away
    G["n_nodes"] = G.gid.map(N.groupby("gid").size())
    G["n_played"] = G.gid.map(N.groupby("gid").played.sum())
    G["split"] = G.season.map(SPLIT).fillna("train")
    return G.sort_values("date")


def preview(N, E, G, T, logs, ast_rate, poss_game=None):
    """Περίληψη + δείγμα graphs για τη σελίδα «Δεδομένα GNN»."""
    feats = [{"name": c, "desc": d, "mean": _r(N["f_" + c].mean()), "std": _r(N["f_" + c].std()),
              "min": _r(N["f_" + c].min()), "max": _r(N["f_" + c].max())} for c, d in FEATURES.items()]
    tg = [{"name": t, "mean": _r(N[t].mean(), 2), "std": _r(N[t].std(), 2), "missing": _r(N[t].isna().mean())}
          for t in [c for c in N.columns if c.startswith("y_")]]
    efeat = [{"name": c, "desc": d, "mean": _r(E[c].mean(), 2), "std": _r(E[c].std(), 2), "max": _r(E[c].max(), 1)}
             for c, d in EDGE_FEATURES.items()]
    tfeat = [{"name": c, "desc": d, "mean": _r(T[c].mean(), 2), "std": _r(T[c].std(), 2), "min": _r(T[c].min(), 1), "max": _r(T[c].max(), 1)}
             for c, d in TEAM_FEATURES.items()]
    # ιστογράμματα στόχων
    hist = {}
    for t, lo, hi in [("y_pts", 0, 40), ("y_pir", -10, 45), ("y_min", 0, 40), ("y_pm100", -80, 80)]:
        v = N.loc[N.played == 1, t].dropna().clip(lo, hi)
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
    show_f = ["r_pts", "r_reb", "r_ast", "r_pir", "r_pts_s", "ts", "usg", "oreb_pct", "dreb_pct", "astd", "sh_rim", "sh_a3", "min", "starter",
              "pm100", "rapm_o", "rapm_d", "sd_pts", "log_games", "rest", "hist_E", "no_hist"]
    for gid in sample_ids:
        nd = N[N.gid == gid]
        ed = E[E.gid == gid]
        g = G[G.gid == gid].iloc[0]
        tt = T[T.gid == gid]
        gs[gid] = {"date": g.date.strftime("%Y-%m-%d"), "comp": g.comp, "home": g.homecode, "away": g.awaycode,
                   "hs": _r(g.y_home, 0), "as": _r(g.y_away, 0), "split": g.split,
                   "teams": {"cols": ["team", *TEAM_FEATURES],
                             "rows": [[r.team, *[_r(getattr(r, c), 2) for c in TEAM_FEATURES]] for r in tt.itertuples()]},
                   "nodes": {"cols": ["pid", "player", "team", "home", "played", *show_f, "y_pts", "y_reb", "y_ast", "y_pir", "y_min", "y_pm100", "y_on_poss"],
                             "rows": [[r.pid, r.player, r.team, int(r.home), int(r.played), *[_r(getattr(r, "f_" + f), 3) for f in show_f],
                                       _r(r.y_pts, 0), _r(r.y_reb, 0), _r(r.y_ast, 0), _r(r.y_pir, 0), _r(r.y_min, 1), _r(r.y_pm100, 1), _r(r.y_on_poss, 1)]
                                      for r in nd.itertuples()]},
                   "edges": {"cols": ["i", "j", "teammate", "min_season", "min_all", "games_all", "min_with_all", "min_vs_all",
                                      "ast_ij", "ast_ji", "net_with", "y_min_shared", "y_ast_ij", "y_ast_ji"],
                             "rows": [[r.pid, r.pid_j, int(r.teammate), _r(r.min_season, 1), _r(r.min_all, 1), int(r.games_all),
                                       _r(r.min_with_all, 1), _r(r.min_vs_all, 1), _r(r.ast_ij, 2), _r(r.ast_ji, 2), _r(r.net_with, 1),
                                       _r(r.y_min_shared, 1), int(r.y_ast_ij), int(r.y_ast_ji)]
                                      for r in ed.itertuples()]}}
    splits = G.groupby(["split", "comp"]).size().unstack(fill_value=0)
    out = {
        "graphs": int(len(G)), "nodes": int(len(N)), "edges": int(len(E)),
        "poss_game": _r(poss_game, 1),
        "dnp_nodes": int((N.played == 0).sum()), "ast_rate": _r(ast_rate), "ast_pairs": int((E.y_ast_ij + E.y_ast_ji).gt(0).sum()),
        "n_node_feats": len(FEATURES), "n_edge_feats": len(EDGE_FEATURES), "n_team_feats": len(TEAM_FEATURES), "team_features": tfeat,
        "avg_nodes": _r(G.n_nodes.mean(), 1), "avg_edges": _r(len(E) / max(1, len(G)), 1),
        "teammate_edges": int(E.teammate.sum()),
        "ex_teammates": int(((E.teammate == 0) & (E.min_with_all > 0)).sum()), "no_hist_rate": _r(N.f_no_hist.mean()),
        "stint_coverage": _r(N.y_pm100[N.played == 1].notna().mean()),
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
    logs, games, stints, pbp, shots, tgs = load()
    logs = logs.merge(games[["gid", "date"]].rename(columns={"date": "gdate"}), on="gid", how="left")
    logs["date"] = logs.gdate.fillna(logs.date)
    print(f"logs {len(logs)} (DNP {int((logs.played == 0).sum())}) | games {logs.gid.nunique()} | stints {len(stints)}")
    pg, pairs = on_court(stints)
    ast, ast_rate = assist_pairs(pbp)
    print(f"assists matched to a made shot: {ast_rate:.1%} ({int(ast.ast.sum())})")
    zones = shot_zones(shots)
    N = node_features(logs, games, pg, zones, ast, stints)
    E = edge_features(N, pairs, games, ast)
    T = team_nodes(tgs, N)
    G = graphs_table(N, games, logs[logs.played == 1])
    G.attrs["ast_rate"] = ast_rate
    OUT.mkdir(parents=True, exist_ok=True)
    N.to_csv(OUT / "nodes.csv.gz", index=False, compression="gzip")
    E.to_csv(OUT / "edges.csv.gz", index=False, compression="gzip")
    G.to_csv(OUT / "graphs.csv.gz", index=False, compression="gzip")
    T.to_csv(OUT / "teams.csv.gz", index=False, compression="gzip")
    print(f"nodes {len(N)} | edges {len(E)} | graphs {len(G)} | avg nodes {G.n_nodes.mean():.1f}")
    poss_game = ((stints.cposs_h + stints.cposs_a) / 2).groupby(stints.gid).sum().mean()
    preview(N, E, G, T, logs[logs.played == 1], ast_rate, poss_game)
    print("-> site/data/gnn_preview.json")


if __name__ == "__main__":
    main()
