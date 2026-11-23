"""
Βάση του σάιτ (v2), μία ανά λίγκα: Stoiximan GBL, EuroLeague, EuroCup. Όλες οι ομάδες και όλοι οι αγώνες της τρέχουσας
σεζόν, μόνο με δεδομένα της λίγκας. Προαιρετικά για την προσομοίωση: οι αγώνες των ίδιων παικτών στις άλλες λίγκες και
στην περσινή σεζόν, μετατρεμμένοι στην κλίμακα της λίγκας από τους κοινούς παίκτες (sources, player.ext).

Διαβάζει ό,τι έχει ήδη φτιάξει το build_site.py (site/data/GBL{season}.json, teams_meta.json, edge_GBL.json)
και γράφει ΕΝΑ αρχείο με όλα όσα χρειάζεται το σάιτ, ήδη συνδεδεμένα μεταξύ τους:

  teams      ομάδα -> στοιχεία, ρεκόρ, φόρμα, ρόστερ, αγώνες        (όλες οι ομάδες της λίγκας)
  opponents  ομάδα -> όνομα/σήμα                                     (οι αντίπαλοί τους)
  standings  βαθμολογία όλης της λίγκας (από όλους τους αγώνες)
  players    παίκτης -> βιογραφικά, μέσοι όροι, αγώνας-αγώνας        (όλη η λίγκα: χρειάζονται για την προσομοίωση)
  teamstats  ομάδα -> ρυθμός, ποσοστά επίθεσης/άμυνας                 (όλη η λίγκα, για την προσομοίωση)
  league     μέσοι όροι λίγκας
  games      αγώνας -> σκορ, box score ή πρόγνωση                    (όλοι οι αγώνες της σεζόν)
  sources    άλλες πηγές για την προσομοίωση -> ετικέτα, κοινοί παίκτες, μετατροπή κλίμακας (logit) ανά ποσοστό
  player.ext πηγή -> [[ημερομηνία, λεπτά, 2πμ, 2πα, 3πμ, 3πα, βολ.μ, βολ.α, λάθη], …] (μόνο ποιότητα, όχι ρόλος)

    python scripts/build_demo.py         # -> site/db/GBL.json, site/db/E.json, site/db/U.json
"""
import json
import math
from datetime import datetime, timezone

from config import ROOT, SITE_DATA

EXT_COLS = ["date", "min", "fg2m", "fg2a", "fg3m", "fg3a", "ftm", "fta", "tov"]
COMP_LABEL = {"E": "EuroLeague", "U": "EuroCup", "GBL": "GBL"}
LEAGUES = ["GBL", "E", "U"]
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


def lgt(p):
    p = min(max(p, 0.005), 0.995)
    return math.log(p / (1 - p))


def ukey(comp, pid, uid_gbl):
    """Κοινός κωδικός παίκτη σε όλες τις πηγές: EuroLeague/EuroCup έχουν ήδη κοινούς κωδικούς, η GBL μέσω του careers.json."""
    return (uid_gbl.get(str(pid)) or f"GBL:{pid}") if comp == "GBL" else str(pid)


def ext_sources(target, season, P, uid_gbl):
    """Αγώνες των παικτών της λίγκας σε άλλες λίγκες/σεζόν και μετατροπή κλίμακας ανά ποσοστό.
    Κλίμακα: για τους κοινούς παίκτες, logit(ποσοστό στη λίγκα τώρα) − logit(ποσοστό στην πηγή), από τα αθροίσματα,
    «φρεναρισμένο» προς το 0 όταν οι προσπάθειες είναι λίγες."""
    def rates(t):
        fga, plays = t["fg2a"] + t["fg3a"], t["fg2a"] + t["fg3a"] + 0.44 * t["fta"] + t["tov"]
        return {"fg2": (t["fg2m"], t["fg2a"]), "fg3": (t["fg3m"], t["fg3a"]), "ft": (t["ftm"], t["fta"]),
                "tov": (t["tov"], plays), "ftrip": (0.44 * t["fta"], plays), "three": (t["fg3a"], fga)}
    K0 = {"fg2": 150, "fg3": 150, "ft": 100, "tov": 300, "ftrip": 300, "three": 300}
    out = {}
    order = [(target, season - 1)] + [(c, x) for x in (season, season - 1) for c in LEAGUES if c != target]
    mine = {ukey(target, pid, uid_gbl): pid for pid in P}
    for comp, s in order:
        f = SITE_DATA / f"{comp}{s}.json"
        if not f.exists():
            continue
        D = json.loads(f.read_text())
        gd = {g["gameCode"]: g["date"] for g in objs(D["games"])}
        key = f"{comp}{s}"
        n_games = 0
        for l in objs(D["logs"]):
            pid = mine.get(ukey(comp, l["pid"], uid_gbl))
            if not pid or not (l.get("MIN") or 0) > 0:
                continue
            row = [gd.get(l["gameCode"]), round(float(l["MIN"]), 1)] + [int(l.get(c.upper()) or 0) for c in EXT_COLS[2:]]
            P[pid].setdefault("ext", {}).setdefault(key, []).append(row)
            n_games += 1
        players = [pid for pid in P if key in P[pid].get("ext", {})]
        if not players:
            continue
        sumT = lambda rows: {c: sum(r[i] for r in rows) for i, c in enumerate(EXT_COLS) if i >= 2}
        A = {c: 0.0 for c in EXT_COLS[2:]}; B = {c: 0.0 for c in EXT_COLS[2:]}
        for pid in players:
            a = P[pid]["tot"]
            if P[pid]["gp"] == 0:
                continue
            for c in A:
                A[c] += a[c.upper()]
            for c, v in sumT(P[pid]["ext"][key]).items():
                B[c] += v
        ra, rb = rates(A), rates(B)
        shift = {}
        for k in ra:
            (ma, na), (mb, nb) = ra[k], rb[k]
            if na > 0 and nb > 0:
                n = min(na, nb)
                shift[k] = round((lgt(ma / na) - lgt(mb / nb)) * n / (n + K0[k]), 4)
            else:
                shift[k] = 0.0
        out[key] = {"label": f"{COMP_LABEL[comp]} {s}-{(s + 1) % 100:02d}", "comp": comp, "season": s,
                    "players": len(players), "games": n_games, "shift": shift, "cols": EXT_COLS}
        print(f"   πηγή {key}: {len(players)} κοινοί παίκτες, {n_games} εμφανίσεις, κλίμακα {shift}")
    return out


ACRO = {"PAOK", "LDLC", "CSKA", "UCAM", "BAXI", "MHP", "ASVEL"}
KEEP_LOWER = {"BET", "ARI", "REAL", "ROMA", "ARIS", "CLUB", "CITY", "RIGA", "MANS", "ULM", "SAN", "DEL", "LA", "LE", "DE", "THE", "BASKET", "TEL"}


def title(n: str) -> str:
    """«PANATHINAIKOS AKTOR ATHENS» -> «Panathinaikos Aktor Athens»· τα σύντομα ακρωνύμια (PAOK, FC, LDLC, AEK) μένουν κεφαλαία."""
    def w1(w):
        core = w.strip(".&-")
        if core.isalpha() and core.isupper() and (len(core) <= 3 and core not in KEEP_LOWER or core in ACRO):
            return w
        return "-".join(x[:1].upper() + x[1:].lower() for x in w.split("-"))
    return " ".join(w1(w) for w in str(n).split())


def fill_rounds(games, upcoming):
    """Όσοι επόμενοι αγώνες δεν έχουν αγωνιστική: κάθε ομάδα παίζει μία φορά ανά αγωνιστική -> νέα όταν ξαναβγεί ομάδα."""
    if all(u.get("round") not in (None, "") for u in upcoming):
        return
    r = max([int(g["round"]) for g in games if str(g.get("round") or "").isdigit()] or [0]) + 1
    seen = set()
    for u in sorted(upcoming, key=lambda u: (u["date"], u.get("time") or "", u["gameCode"])):
        if u.get("round") not in (None, ""):
            continue
        if u["home"] in seen or u["away"] in seen:
            r += 1
            seen = set()
        u["round"] = r
        seen |= {u["home"], u["away"]}


def groups_of(games, teams):
    """Όμιλοι = συνεκτικές συνιστώσες του γράφου «ποιος έχει παίξει με ποιον» (π.χ. EuroCup)."""
    par = {t: t for t in teams}
    def f(x):
        while par[x] != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    for g in games:
        if g["home"] in par and g["away"] in par:
            par[f(g["home"])] = f(g["away"])
    comp = {}
    for t in teams:
        comp.setdefault(f(t), []).append(t)
    G = sorted(comp.values(), key=lambda c: (-len(c), sorted(c)[0]))
    return {t: chr(65 + i) for i, c in enumerate(G) for t in c} if len(G) > 1 else {}


def main():
    for comp in LEAGUES:
        build(comp)


def build(comp):
    man = json.loads((SITE_DATA / "manifest.json").read_text())
    C = next((c for c in man["competitions"] if c["code"] == comp), None)
    if not C:
        print(f"   ! {comp}: δεν υπάρχει στο manifest")
        return
    season = max(C["seasons"])
    if not (SITE_DATA / f"{comp}{season}.json").exists():
        print(f"   ! {comp}{season}.json λείπει")
        return
    OUT = ROOT / "site" / "db" / f"{comp}.json"
    S = json.loads((SITE_DATA / f"{comp}{season}.json").read_text())
    meta = json.loads((SITE_DATA / "teams_meta.json").read_text()).get(comp, {}) if (SITE_DATA / "teams_meta.json").exists() else {}
    edge = json.loads((SITE_DATA / f"edge_{comp}.json").read_text()) if (SITE_DATA / f"edge_{comp}.json").exists() else {}
    prob = {u["gameCode"]: u for u in edge.get("upcoming", [])}

    games, upcoming, logs = objs(S["games"]), objs(S["upcoming"]), objs(S["logs"])
    games.sort(key=lambda g: (g["date"], g["gameCode"]))
    fill_rounds(games, upcoming)
    gdate = {g["gameCode"]: g["date"] for g in games}
    tname = lambda c: S["teams"].get(c, c) if comp == "GBL" else title(S["teams"].get(c, c))
    tm = lambda c: {"code": c, "name": tname(c), "abbr": meta.get(c, {}).get("abbr") or S["teams"].get(c, c)[:3],
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

    DEMO = [r["code"] for r in standings] + sorted(c for c in S["teams"] if c not in {r["code"] for r in standings})
    # ---- όλοι οι αγώνες (παιγμένοι + επερχόμενοι)
    G = {}
    for g in games:
        if True:
            G[g["gameCode"]] = {"code": g["gameCode"], "round": g["round"], "date": g["date"], "time": None, "home": g["home"],
                                "away": g["away"], "hs": g["hs"], "as": g["as"], "played": True, "box": {g["home"]: [], g["away"]: []}}
    for u in sorted(upcoming, key=lambda u: (u["date"], u.get("time") or "")):
        if True:
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
    # ---- άλλες λίγκες/σεζόν των ίδιων παικτών (για την προσομοίωση, προαιρετικά)
    car = SITE_DATA / "careers.json"
    uid_gbl = json.loads(car.read_text()).get("uid", {}).get("GBL", {}) if car.exists() else {}
    sources = ext_sources(comp, season, P, uid_gbl)
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

    grp = groups_of(games, [r["code"] for r in standings])
    for r in standings:
        if grp:
            r["group"] = grp.get(r["code"])
    TS, LG = team_stats(logs)
    # αρχική τιμή των ratings: η περσινή σεζόν της ίδιας λίγκας (επίθεση/άμυνα σε πόντους ανά 100 κατοχές, ως προς τη λίγκα)
    prior = {}
    fp = SITE_DATA / f"{comp}{season - 1}.json"
    if fp.exists():
        TSp, LGp = team_stats(objs(json.loads(fp.read_text())["logs"]))
        prior = {t: {"o": round(v["ortg"] - LGp["ortg"], 2), "d": round(LGp["ortg"] - v["drtg"], 2), "gp": v["gp"]} for t, v in TSp.items()}
    out = {"comp": comp, "league": C.get("name") or comp, "short": COMP_LABEL.get(comp, comp), "season": season,
           "leagues": [{"comp": c["code"], "name": c.get("name") or c["code"], "short": COMP_LABEL.get(c["code"], c["code"])}
                       for c in man["competitions"] if c["code"] in LEAGUES], "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
           "demo": DEMO, "sources": sources, "teams": T, "opponents": opp, "standings": standings, "players": P, "games": G,
           "teamstats": TS, "lg": LG, "prior_ratings": prior}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"-> {OUT.relative_to(ROOT)}: {len(T)} ομάδες{f' σε {len(set(grp.values()))} ομίλους' if grp else ''}, {len(P)} παίκτες, {len(G)} αγώνες "
          f"({sum(g['played'] for g in G.values())} παιγμένοι), {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
