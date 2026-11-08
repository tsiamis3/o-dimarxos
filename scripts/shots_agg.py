"""
Συγκέντρωση σουτ (data/raw/{C}{season}_shots.csv.gz) για τα shot charts του site:
  - εξάγωνα (hexbins) ανά παίκτη και για όλη τη λίγκα: προσπάθειες, εύστοχα
  - ζώνες ανά παίκτη και λίγκα: καλάθι, ρακέτα, μέση απόσταση, γωνία 3π, 3π
Έξοδος: site/data/shots_{C}{season}.json  (το διαβάζει μόνο η σελίδα «Παίκτες»)
"""
import json
import math

import numpy as np
import pandas as pd

from config import RAW_DIR, SITE_DATA

HEX = 0.75                     # ακτίνα εξαγώνου σε μέτρα
X_MAX, Y_MAX = 7.6, 11.0       # μισό γήπεδο (πλάτος 15.2 μ.), μέχρι ~11 μ. από το καλάθι
ZONES = ["rim", "paint", "mid", "corner3", "arc3"]


def zone(x, y, pts):
    d = math.hypot(x, y)
    if pts == 3:
        return "corner3" if abs(x) > 6.0 and y < 1.6 else "arc3"
    if d < 1.6:
        return "rim"
    if abs(x) < 2.45 and y < 4.6:      # ρακέτα FIBA: 4.9 μ. πλάτος, 5.8 μ. από την τελική (~4.6 από το καλάθι)
        return "paint"
    return "mid"


def hex_axial(x, y, r=HEX):
    """Pointy-top εξάγωνα: (x, y) -> (q, r) ακέραιοι."""
    q = (math.sqrt(3) / 3 * x - 1 / 3 * y) / r
    rr = (2 / 3 * y) / r
    # στρογγυλοποίηση κύβου
    xc, zc = q, rr
    yc = -xc - zc
    rx, ry, rz = round(xc), round(yc), round(zc)
    dx, dy, dz = abs(rx - xc), abs(ry - yc), abs(rz - zc)
    if dx > dy and dx > dz:
        rx = -ry - rz
    elif dy > dz:
        ry = -rx - rz
    else:
        rz = -rx - ry
    return int(rx), int(rz)


def build(comp: str, season: int) -> dict | None:
    p = RAW_DIR / f"{comp}{season}_shots.csv.gz"
    if not p.exists():
        return None
    d = pd.read_csv(p)
    d = d[(d.y >= -1.5) & (d.y <= 14) & (d.x.abs() <= 7.8)]
    if d.empty:
        return None
    d["pid"] = d.pid.astype(str)
    d["zone"] = [zone(x, y, pts) for x, y, pts in zip(d.x, d.y, d.pts)]
    inside = (d.y <= Y_MAX) & (d.x.abs() <= X_MAX)
    hx = [hex_axial(x, y) if ok else (None, None) for x, y, ok in zip(d.x, d.y, inside)]
    d["q"], d["r"] = [h[0] for h in hx], [h[1] for h in hx]
    h = d[inside]
    lg_hex = h.groupby(["q", "r"]).made.agg(["size", "sum"]).reset_index()
    lg_zone = d.groupby("zone").made.agg(["size", "sum"]).reindex(ZONES).fillna(0)
    players = {}
    for pid, g in h.groupby("pid"):
        a = g.groupby(["q", "r"]).made.agg(["size", "sum"]).reset_index()
        players[pid] = a[["q", "r", "size", "sum"]].astype(int).values.tolist()
    pz = d.groupby(["pid", "zone"]).made.agg(["size", "sum"]).unstack("zone").reindex(columns=ZONES, level=1)
    zones = {}
    for pid in pz.index:
        zones[pid] = [[int(pz.loc[pid, ("size", z)]) if not pd.isna(pz.loc[pid, ("size", z)]) else 0,
                       int(pz.loc[pid, ("sum", z)]) if not pd.isna(pz.loc[pid, ("sum", z)]) else 0] for z in ZONES]
    # επιθετικά χαρακτηριστικά παίκτη: αιφνιδιασμός / δεύτερη ευκαιρία
    extra = {}
    if d.fastbreak.sum() > 0:
        for pid, g in d.groupby("pid"):
            extra[pid] = [int(g.fastbreak.sum()), int(g.second_chance.sum())]
    out = {"comp": comp, "season": int(season), "hex": HEX, "xmax": X_MAX, "ymax": Y_MAX, "zones": ZONES,
           "n": int(len(d)),
           "league": {"hex": lg_hex[["q", "r", "size", "sum"]].astype(int).values.tolist(),
                      "zones": [[int(lg_zone.loc[z, "size"]), int(lg_zone.loc[z, "sum"])] for z in ZONES]},
           "players": players, "pzones": zones, "extra": extra}
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    (SITE_DATA / f"shots_{comp}{season}.json").write_text(json.dumps(out, separators=(",", ":")))
    return out
