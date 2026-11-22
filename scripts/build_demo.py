"""
Βάση του νέου σάιτ (v2, demo): Stoiximan GBL, δύο ομάδες (Άρης, ΠΑΟΚ).

Διαβάζει ό,τι έχει ήδη φτιάξει το build_site.py (site/data/GBL{season}.json, teams_meta.json, edge_GBL.json)
και γράφει ΕΝΑ αρχείο με όλα όσα χρειάζεται το σάιτ, ήδη συνδεδεμένα μεταξύ τους:

  teams      ομάδα -> στοιχεία, ρεκόρ, φόρμα, ρόστερ, αγώνες        (μόνο οι ομάδες του demo)
  opponents  ομάδα -> όνομα/σήμα                                     (οι αντίπαλοί τους)
  standings  βαθμολογία όλης της λίγκας (από όλους τους αγώνες)
  players    παίκτης -> βιογραφικά, μέσοι όροι, αγώνας-αγώνας        (όλη η λίγκα: χρειάζονται για την προσομοίωση)
  teamstats  ομάδα -> ρυθμός, ποσοστά επίθεσης/άμυνας                 (όλη η λίγκα, για την προσομοίωση)
  league     μέσοι όροι λίγκας
  games      αγώνας -> σκορ, box score ή πρόγνωση                    (αγώνες των ομάδων του demo)

    python scripts/build_demo.py         # -> site/db/demo.json
"""
import json
from datetime import datetime, timezone

from config import ROOT, SITE_DATA

DEMO = ["00000005", "0000000C"]            # Άρης, ΠΑΟΚ
OUT = ROOT / "site" / "db" / "demo.json"
STATS = ["MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF", "PIR", "FG2M", "FG2A", "FG3M", "FG3A", "FTM", "FTA"]


def objs(o):
    return [dict(zip(o["cols"], r)) for r in o["rows"]]


def nice(n: str) -> str:
    """«MORGAN, MATTHEW» -> «Matthew Morgan»."""
    parts = [p.strip() for p in str(n or "").split(",")]
    s = " ".join(reversed(parts)) if len(parts) == 2 else str(n or "")
    cap = lambda w: "-".join(x[:1].upper() + x[1:].lower() for x in w.split("-")) if w.isupper() or w.islower() else w
    return " ".join(cap(w) for w in s.split())


def team_stats(logs):
    """Ανά ομάδα (όλη η λίγκα): σύνολα ανά αγώνα για την ίδια και τους αντιπάλους της -> ρυθμός και ποσοστά.
    Κατοχές = FGA + 0.44·FTA − OREB + TOV (εκτίμηση από το box score)."""
    K = ["PTS", "FG2M", "FG2A", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF"]
    by = {}
    for l in logs:
        t = by.setdefault((l["gameCode"], l["team"]), {k: 0.0 for k in K})
        for k in K:
            t[k] += float(l.get(k) or 0)
    games = {}
    for (g, t), v in by.items():
        games.setdefault(g, {})[t] = v
    poss = lambda v: v["FG2A"] + v["FG3A"] + 0.44 * v["FTA"] - v["OREB"] + v["TOV"]
    acc = {}
    for g, two in games.items():
        if len(two) != 2:
            continue
        (a, va), (b, vb) = two.items()
        for t, me, op in ((a, va, vb), (b, vb, va)):
            s = acc.setdefault(t, {"gp": 0, "me": {k: 0.0 for k in K}, "op": {k: 0.0 for k in K}, "poss": 0.0, "opp_poss": 0.0})
            s["gp"] += 1
            s["poss"] += poss(me); s["opp_poss"] += poss(op)
            for k in K:
                s["me"][k] += me[k]; s["op"][k] += op[k]
    def rates(me, op, pos, opos, gp):
        fga = me["FG2A"] + me["FG3A"]
        return {"gp": gp, "pace": round((pos + opos) / 2 / gp, 2), "ortg": round(100 * me["PTS"] / pos, 2), "drtg": round(100 * op["PTS"] / opos, 2),
                "efg": round((me["FG2M"] + 1.5 * me["FG3M"]) / max(fga, 1), 4),
                "opp_efg": round((op["FG2M"] + 1.5 * op["FG3M"]) / max(op["FG2A"] + op["FG3A"], 1), 4),
                "tov": round(me["TOV"] / pos, 4), "opp_tov": round(op["TOV"] / opos, 4),
                "orb": round(me["OREB"] / max(me["OREB"] + op["DREB"], 1), 4), "drb": round(me["DREB"] / max(me["DREB"] + op["OREB"], 1), 4),
                "ftr": round(me["FTA"] / max(fga, 1), 4), "opp_ftr": round(op["FTA"] / max(op["FG2A"] + op["FG3A"], 1), 4)}
    TS = {t: rates(s["me"], s["op"], s["poss"], s["opp_poss"], s["gp"]) for t, s in acc.items()}
    tot = {k: sum(s["me"][k] for s in acc.values()) for k in K}
    P = sum(s["poss"] for s in acc.values()); G = sum(s["gp"] for s in acc.values())
    fga = tot["FG2A"] + tot["FG3A"]
    LG = {"pace": round(P / G, 2), "ortg": round(100 * tot["PTS"] / P, 2), "efg": round((tot["FG2M"] + 1.5 * tot["FG3M"]) / fga, 4),
          "fg2": round(tot["FG2M"] / tot["FG2A"], 4), "fg3": round(tot["FG3M"] / tot["FG3A"], 4), "ft": round(tot["FTM"] / tot["FTA"], 4),
          "tov": round(tot["TOV"] / P, 4), "orb": round(tot["OREB"] / (tot["OREB"] + tot["DREB"]), 4), "ftr": round(tot["FTA"] / fga, 4),
          "three_rate": round(tot["FG3A"] / fga, 4), "ast_fgm": round(tot["AST"] / (tot["FG2M"] + tot["FG3M"]), 4),
          "stl_tov": round(tot["STL"] / tot["TOV"], 4), "blk_fg2a": round(tot["BLK"] / tot["FG2A"], 4)}
    return TS, LG


def main():
    man = json.loads((SITE_DATA / "manifest.json").read_text())
    season = max(next(c for c in man["competitions"] if c["code"] == "GBL")["seasons"])
    S = json.loads((SITE_DATA / f"GBL{season}.json").read_text())
    meta = json.loads((SITE_DATA / "teams_meta.json").read_text()).get("GBL", {}) if (SITE_DATA / "teams_meta.json").exists() else {}
    edge = json.loads((SITE_DATA / "edge_GBL.json").read_text()) if (SITE_DATA / "edge_GBL.json").exists() else {}
    prob = {u["gameCode"]: u for u in edge.get("upcoming", [])}

    games, upcoming, logs = objs(S["games"]), objs(S["upcoming"]), objs(S["logs"])
    games.sort(key=lambda g: (g["date"], g["gameCode"]))
    gdate = {g["gameCode"]: g["date"] for g in games}
    tm = lambda c: {"code": c, "name": S["teams"].get(c, c), "abbr": meta.get(c, {}).get("abbr") or S["teams"].get(c, c)[:3],
                    "c1": meta.get(c, {}).get("c1", "#666"), "fg": meta.get(c, {}).get("fg", "#fff")}

    # ---- βαθμολογία (όλη η λίγκα)
    rec = {}
    for g in games:
        for c, my, op, home in ((g["home"], g["hs"], g["as"], True), (g["away"], g["as"], g["hs"], False)):
            r = rec.setdefault(c, {"code": c, "gp": 0, "w": 0, "l": 0, "pf": 0, "pa": 0, "hw": 0, "hl": 0, "aw": 0, "al": 0, "form": []})
            win = my > op
            r["gp"] += 1; r["pf"] += my; r["pa"] += op
            r["w" if win else "l"] += 1
            r[("h" if home else "a") + ("w" if win else "l")] += 1
            r["form"].append("W" if win else "L")
    standings = sorted(rec.values(), key=lambda r: (-r["w"] / max(r["gp"], 1), -(r["pf"] - r["pa"]), r["code"]))
    for i, r in enumerate(standings, 1):
        r["pos"], r["form"] = i, r["form"][-5:]

    # ---- αγώνες των ομάδων του demo (παιγμένοι + επερχόμενοι)
    G = {}
    for g in games:
        if g["home"] in DEMO or g["away"] in DEMO:
            G[g["gameCode"]] = {"code": g["gameCode"], "round": g["round"], "date": g["date"], "time": None, "home": g["home"],
                                "away": g["away"], "hs": g["hs"], "as": g["as"], "played": True, "box": {g["home"]: [], g["away"]: []}}
    for u in sorted(upcoming, key=lambda u: (u["date"], u.get("time") or "")):
        if u["home"] in DEMO or u["away"] in DEMO:
            p = prob.get(u["gameCode"])
            G[u["gameCode"]] = {"code": u["gameCode"], "round": u["round"], "date": u["date"], "time": u.get("time"), "home": u["home"],
                                "away": u["away"], "played": False,
                                "model": {"p_home": p["p_home"], "line": p["line"], "total": p["total"]} if p else None}

    # ---- παίκτες: όλη η λίγκα, με όλη τη σεζόν τους (η προσομοίωση χρειάζεται και τους αντιπάλους)
    bio_cols = S.get("bio_cols", [])
    P = {}
    for l in sorted(logs, key=lambda l: (gdate.get(l["gameCode"], ""), l["gameCode"])):
        p = P.get(l["pid"])
        if not p:
            b = dict(zip(bio_cols, S.get("bio", {}).get(l["pid"], []))) if l["pid"] in S.get("bio", {}) else {}
            p = P[l["pid"]] = {"pid": l["pid"], "name": nice(S["players"].get(l["pid"], l["pid"])), "team": l["team"],
                               "number": b.get("number"), "pos": b.get("pos"), "height": b.get("height"), "weight": b.get("weight"),
                               "birth": b.get("birth"), "country": b.get("country"), "photo": b.get("photo"),
                               "tot": {k: 0 for k in STATS}, "gp": 0, "log": []}
        p["team"] = l["team"]                                   # η πιο πρόσφατη ομάδα
        played = (l.get("MIN") or 0) > 0
        g = next((x for x in games if x["gameCode"] == l["gameCode"]), None)
        my, op = (g["hs"], g["as"]) if g and g["home"] == l["team"] else ((g["as"], g["hs"]) if g else (None, None))
        row = {"g": l["gameCode"], "date": gdate.get(l["gameCode"]), "team": l["team"], "opp": l["opp"], "home": bool(l["home"]),
               "res": None if my is None else ("W" if my > op else "L"), "score": None if my is None else f"{my}-{op}",
               **{k.lower(): round(float(l.get(k) or 0), 1) if k == "MIN" else int(l.get(k) or 0) for k in STATS}}
        p["log"].append(row)
        if played:
            p["gp"] += 1
            for k in STATS:
                p["tot"][k] += float(l.get(k) or 0)
        if l["gameCode"] in G and G[l["gameCode"]]["played"]:
            G[l["gameCode"]]["box"].setdefault(l["team"], []).append({"pid": l["pid"], **{k.lower(): row[k.lower()] for k in STATS}})
    for p in P.values():
        n = max(p["gp"], 1)
        t = p.pop("tot")
        p["avg"] = {k.lower(): round(t[k] / n, 1) for k in STATS}
        p["pct"] = {"fg2": round(t["FG2M"] / t["FG2A"], 3) if t["FG2A"] else None, "fg3": round(t["FG3M"] / t["FG3A"], 3) if t["FG3A"] else None,
                    "ft": round(t["FTM"] / t["FTA"], 3) if t["FTA"] else None}
    for g in G.values():
        for side in g.get("box", {}).values():
            side.sort(key=lambda r: -r["min"])

    # ---- ομάδες του demo
    T = {}
    for c in DEMO:
        r = next((x for x in standings if x["code"] == c), {})
        roster = sorted([p for p in P.values() if p["team"] == c], key=lambda p: (-p["avg"]["min"], p["name"]))
        T[c] = {**tm(c), "record": {k: r.get(k) for k in ["pos", "gp", "w", "l", "pf", "pa", "hw", "hl", "aw", "al", "form"]},
                "roster": [p["pid"] for p in roster], "games": [g["code"] for g in G.values() if c in (g["home"], g["away"])]}
    opp = {c: tm(c) for c in {g[s] for g in G.values() for s in ("home", "away")} | {r["code"] for r in standings} if c not in T}

    TS, LG = team_stats(logs)
    out = {"league": "Stoiximan GBL", "season": season, "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
           "demo": DEMO, "teams": T, "opponents": opp, "standings": standings, "players": P, "games": G,
           "teamstats": TS, "lg": LG}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"-> {OUT.relative_to(ROOT)}: {len(T)} ομάδες, {len(P)} παίκτες, {len(G)} αγώνες "
          f"({sum(g['played'] for g in G.values())} παιγμένοι), {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
