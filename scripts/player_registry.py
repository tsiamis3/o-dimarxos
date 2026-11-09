"""
Ενιαίο μητρώο παικτών ανάμεσα σε πηγές με διαφορετικούς κωδικούς.

  - EuroLeague / EuroCup: κοινοί κωδικοί (P…) -> ήδη ίδιος παίκτης
  - Ελληνική λίγκα (esake.gr): δικοί της κωδικοί, σταθεροί από σεζόν σε σεζόν
  - NBA (ESPN): δικοί του κωδικοί
Σύνδεση ανάμεσα σε πηγές με το κανονικοποιημένο όνομα «ΕΠΩΝΥΜΟ|ΟΝΟΜΑ» (χωρίς τόνους, παύλες, τελείες,
Jr./II/III), ΜΟΝΟ αν το όνομα είναι μοναδικό μέσα σε κάθε πηγή (αλλιώς δεν ρισκάρουμε λάθος σύνδεση).
Ονόματα σε ελληνική γραφή (παλιές σεζόν της ελληνικής λίγκας): (α) μέσω του σταθερού κωδικού της πηγής, αν ο ίδιος
παίκτης έχει και σεζόν με λατινική γραφή· (β) αλλιώς φωνητικά (μεταγραφή ΜΠ->B, ΝΤ->D, ΓΚ->G, ΤΖ->J, ΟΥ->U, ... και
«σκελετός» συμφώνων), μόνο με ίδια ομάδα την ίδια σεζόν ή σχεδόν ταυτόσημο όνομα, μοναδικό ταίρι, ένα-προς-ένα.

    uid = link(tables)   # tables: {(comp, season): DataFrame με pid, player} -> {(comp, pid): uid}
"""
import re
import unicodedata
from difflib import SequenceMatcher

SUFFIX = {"JR", "SR", "II", "III", "IV"}
# υποκοριστικά -> πλήρες όνομα (ίδιος άνθρωπος γραμμένος αλλιώς σε άλλη πηγή)
NICK = {"GIORGOS": "GEORGIOS", "YIORGOS": "GEORGIOS", "KOSTAS": "KONSTANTINOS", "NIKOS": "NIKOLAOS",
        "STELIOS": "STYLIANOS", "VASILIS": "VASILEIOS", "VASSILIS": "VASILEIOS", "DIMITRIS": "DIMITRIOS",
        "GIANNIS": "IOANNIS", "YANNIS": "IOANNIS", "THANASIS": "ATHANASIOS", "PANOS": "PANAGIOTIS",
        "TAKIS": "PANAGIOTIS", "MICHALIS": "MICHAIL", "MANOLIS": "EMMANOUIL", "LEFTERIS": "ELEFTHERIOS",
        "NENO": "NENAD", "MATT": "MATTHEW", "WILL": "WILLIAM", "MIKE": "MICHAEL", "NICK": "NICHOLAS",
        "ALEX": "ALEXANDER", "TONY": "ANTHONY", "CHRIS": "CHRISTOPHER", "DAN": "DANIEL", "ZACH": "ZACHARY",
        "JOE": "JOSEPH", "TJ": "TJ", "PJ": "PJ"}


def group(comp: str, pid: str) -> str:
    """Πηγή κωδικών: EuroLeague και EuroCup μοιράζονται κωδικούς."""
    return "EU" if comp in ("E", "U") else comp


def name_key(name) -> str | None:
    """'ROBINSON - EARL, JEREMIAH' / 'Robinson-Earl, Jeremiah' -> 'ROBINSONEARL|JEREMIAH'. None αν δεν είναι λατινικό."""
    if not isinstance(name, str) or "##" in name or re.search(r"[Ͱ-Ͽ]", name):
        return None
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().upper()
    if "," in s:
        last, first = s.split(",", 1)
    else:                                   # 'First Last'
        parts = s.split()
        if len(parts) < 2:
            return None
        first, last = " ".join(parts[:-1]), parts[-1]

    def clean(x):
        toks = [t for t in re.split(r"[\s.\-']+", x) if t and t not in SUFFIX]
        return "".join(re.sub(r"[^A-Z]", "", t) for t in toks)

    last = clean(last)
    toks = [t for t in re.split(r"[\s.\-']+", first) if t and t not in SUFFIX]
    toks = [re.sub(r"[^A-Z]", "", t) for t in toks]
    toks = [NICK.get(t, t) for t in toks if t]
    first = "".join(toks)
    return f"{last}|{first}" if last and first else None


# --- ονόματα σε ελληνική γραφή (παλιές σεζόν της ελληνικής λίγκας): φωνητική μεταγραφή και «σκελετός» ---
LAT2GR = str.maketrans("ABEZHIKMNOPTYX", "ΑΒΕΖΗΙΚΜΝΟΡΤΥΧ")      # λατινικά γράμματα μέσα σε ελληνικό κείμενο
GR_DI = [("ΓΟΥΑ", "WA"), ("ΓΟΥΕ", "WE"), ("ΓΟΥΙ", "WI"), ("ΓΟΥΟ", "WO"), ("ΟΥ", "U"), ("ΜΠ", "B"), ("ΝΤ", "D"),
         ("ΓΚ", "G"), ("ΓΓ", "NG"), ("ΤΖ", "J"), ("ΤΣ", "TS"), ("ΑΙ", "E"), ("ΕΙ", "I"), ("ΟΙ", "I"), ("ΥΙ", "I"),
         ("ΑΥ", "AV"), ("ΕΥ", "EV")]
GR_1 = dict(zip("ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ", ["A", "V", "G", "D", "E", "Z", "I", "TH", "I", "K", "L", "M", "N", "KS", "O",
                                           "P", "R", "S", "T", "I", "F", "H", "PS", "O"]))


def is_greek(name) -> bool:
    return isinstance(name, str) and bool(re.search(r"[\u0370-\u03ff]", name))


def greek_to_latin(x: str) -> str:
    x = unicodedata.normalize("NFD", x.upper())
    x = "".join(ch for ch in x if not unicodedata.combining(ch)).replace("Σ", "Σ").translate(LAT2GR)
    for a, b in GR_DI:
        x = x.replace(a, b)
    return "".join(GR_1.get(ch, ch) for ch in x)


def skeleton(latin: str) -> str:
    """Φωνητικός σκελετός: μόνο σύμφωνα, σε κλάσεις (T=D, C=K=Q, PH=F, Z=S, X=KS, J≈TZ), χωρίς διπλά."""
    x = re.sub(r"[^A-Z]", "", unicodedata.normalize("NFKD", latin.upper()).encode("ascii", "ignore").decode())
    for a, b in [("PH", "F"), ("TH", "T"), ("CH", "K"), ("CK", "K"), ("SH", "S"), ("X", "KS"), ("J", "TZ"),
                 ("C", "K"), ("Q", "K"), ("Z", "S"), ("D", "T"), ("NT", "T"), ("W", ""), ("H", "")]:
        x = x.replace(a, b)
    x = re.sub(r"[AEIOUY]", "", x)
    return re.sub(r"(.)\1+", r"\1", x)


def name_parts(name: str):
    """(σκελετός επωνύμου, σκελετός μικρού ονόματος) για ελληνική ή λατινική γραφή («ΕΠΩΝΥΜΟ, ## ΕΠΩΝΥΜΟ ΟΝΟΜΑ»)."""
    if not isinstance(name, str) or "," not in name:
        return None
    last, first = [p.strip() for p in name.split(",", 1)]
    if "##" in first:                      # «## ΕΠΩΝΥΜΟ ΟΝΟΜΑ»
        toks = first.replace("##", "").split()
        lt = last.split()
        first = " ".join(t for t in toks if t not in lt)
    conv = greek_to_latin if is_greek(name) else (lambda v: v)
    first = re.sub(r"\b(JR|SR|II|III|IV)\b\.?", "", conv(first).upper())
    last = re.sub(r"\b(JR|SR|II|III|IV)\b\.?", "", conv(last).upper())
    return skeleton(last), skeleton(first)


def _sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def link(tables: dict, report: list | None = None) -> dict:
    """tables: {(comp, season): DataFrame(pid, player[, team])} -> {(comp, pid): uid}.
    report: αν δοθεί λίστα, προστίθενται οι φωνητικές συνδέσεις (τρίτο πέρασμα) για έλεγχο."""
    parent = {}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            # αντιπρόσωπος: προτιμάμε κωδικό EuroLeague/EuroCup, μετά NBA, μετά ελληνική λίγκα
            order = {"EU": 0, "NBA": 1}
            if order.get(rb[0], 2) < order.get(ra[0], 2):
                ra, rb = rb, ra
            parent[rb] = ra

    names = {}                                     # (group, pid) -> σύνολο κλειδιών ονόματος
    comps_of = {}
    raw = {}                                       # (group, pid) -> σύνολο ονομάτων όπως γράφονται
    seasons = {}                                   # (group, pid) -> {σεζόν: ομάδα}
    for (comp, season), t in tables.items():
        if t is None or len(t) == 0:
            continue
        g = group(comp, "")
        teams = t.team.astype(str) if "team" in t else [""] * len(t)
        for pid, nm, tm in zip(t.pid.astype(str), t.player, teams):
            node = (g, pid)
            parent.setdefault(node, node)
            comps_of.setdefault(node, set()).add(comp)
            raw.setdefault(node, set()).add(nm)
            seasons.setdefault(node, {})[int(season)] = (comp, tm)
            k = name_key(nm)
            if k:
                names.setdefault(node, set()).add(k)
    # κλειδί -> κόμβοι ανά πηγή
    by_key = {}
    for node, ks in names.items():
        for k in ks:
            by_key.setdefault(k, {}).setdefault(node[0], set()).add(node)
    for k, per_group in by_key.items():
        if len(per_group) < 2:
            continue
        if any(len(nodes) > 1 for nodes in per_group.values()):
            continue                               # συνωνυμία μέσα σε μία πηγή: χωρίς σύνδεση
        nodes = [next(iter(v)) for v in per_group.values()]
        for n in nodes[1:]:
            union(nodes[0], n)
    # δεύτερο πέρασμα: ίδιο επώνυμο, το ένα μικρό όνομα αρχή του άλλου (JEAN ↔ JEANCLAUDIO), και το επώνυμο
    # μοναδικό σε ΚΑΘΕ πηγή (ένας μόνο παίκτης με αυτό το επώνυμο) -> σύνδεση
    by_last = {}
    for node, ks in names.items():
        for k in ks:
            last, first = k.split("|")
            by_last.setdefault(last, {}).setdefault(node[0], {})[node] = first
    for last, per_group in by_last.items():
        if len(per_group) < 2 or any(len(v) > 1 for v in per_group.values()):
            continue
        nodes = [(next(iter(v)), next(iter(v.values()))) for v in per_group.values()]
        n0, f0 = nodes[0]
        for n, f in nodes[1:]:
            if f.startswith(f0) or f0.startswith(f):
                union(n0, n)
    # τρίτο πέρασμα: παίκτες ελληνικής λίγκας με ΜΟΝΟ ελληνική γραφή -> φωνητική σύνδεση με EuroLeague/EuroCup/NBA
    _phonetic(parent, find, union, raw, seasons, report)
    out = {}
    for node, comps in comps_of.items():
        r = find(node)
        uid = r[1] if r[0] == "EU" else f"{r[0]}:{r[1]}"
        for c in comps:
            out[(c, node[1])] = uid
    return out


def _phonetic(parent, find, union, raw, seasons, report):
    """Ελληνικό όνομα (μεταγραφή) ↔ λατινικό, κοινή ή διπλανή σεζόν. Είτε ίδια ομάδα την ίδια σεζόν (ομάδα ελληνικής
    λίγκας ↔ κωδικός EuroLeague/EuroCup από τους ήδη συνδεδεμένους) με σκελετό επωνύμου ≥ 0.8 και μικρού ονόματος ≥ 0.5,
    είτε (χωρίς ομάδα) σκελετοί ≥ 0.95 και στα δύο. Μοναδικό καλύτερο ταίρι, ένα-προς-ένα."""
    gr = [n for n in raw if n[0] == "GBL" and all(is_greek(x) or "##" in str(x) for x in raw[n]) and find(n)[0] == "GBL"]
    if not gr:
        return
    # ομάδα ελληνικής λίγκας -> ομάδα άλλης πηγής, ανά σεζόν (πλειοψηφία των ήδη συνδεδεμένων)
    groups = {}
    for n in raw:
        groups.setdefault(find(n), []).append(n)
    votes = {}
    for members in groups.values():
        gbl = [m for m in members if m[0] == "GBL"]
        oth = [m for m in members if m[0] != "GBL"]
        for a in gbl:
            for b in oth:
                for s, (_, ta) in seasons.get(a, {}).items():
                    if s in seasons.get(b, {}):
                        key = (s, ta, seasons[b][s][1])
                        votes[key] = votes.get(key, 0) + 1
    team_map = {}
    for (s, ta, tb), v in votes.items():
        if v >= 2 and v > team_map.get((s, ta), ("", 0))[1]:
            team_map[(s, ta)] = (tb, v)
    cands = []
    for n, nm_set in raw.items():
        if n[0] == "GBL" or find(n)[0] == "GBL":
            continue
        lat = [x for x in nm_set if not is_greek(x)]
        parts = [name_parts(x) for x in lat]
        parts = [p for p in parts if p]
        if parts:
            cands.append((n, parts))
    proposals = []
    for g in gr:
        pg = [p for p in (name_parts(x) for x in raw[g]) if p]
        if not pg:
            continue
        gseas = seasons.get(g, {})
        scored = []
        for n, parts in cands:
            ns = seasons.get(n, {})
            if not any(abs(a - b) <= 1 for a in gseas for b in ns):
                continue
            best = None
            for a in pg:
                for b in parts:
                    ls, fs = _sim(a[0], b[0]), _sim(a[1], b[1])
                    short = min(len(a[0]), len(b[0])) < 3
                    if best is None or ls + 0.5 * fs > best[0] + 0.5 * best[1]:
                        best = (ls, fs, short)
            ls, fs, short = best
            team = any(team_map.get((s, ta), ("",))[0] == ns.get(s, ("", None))[1] for s, (_, ta) in gseas.items() if s in ns)
            # χωρίς ίδια ομάδα: ουσιαστικά ίδιος σκελετός σε επώνυμο ΚΑΙ μικρό όνομα· με ίδια ομάδα: πιο χαλαρά
            ok = (not short and ls >= 0.95 and fs >= 0.95) or (team and ls >= 0.8 and fs >= (0.8 if short else 0.5))
            if ok:
                scored.append((ls + 0.5 * fs + (0.3 if team else 0), n, ls, fs, team))
        if not scored:
            continue
        scored.sort(reverse=True)
        if len(scored) > 1 and scored[0][0] - scored[1][0] < 0.1:
            continue
        proposals.append((scored[0], g))
    # ένα-προς-ένα: κάθε παίκτης της άλλης πηγής συνδέεται με το πολύ έναν της ελληνικής λίγκας (ο καλύτερος)
    taken = set()
    for (sc, n, ls, fs, team), g in sorted(proposals, key=lambda x: -x[0][0]):
        if n in taken or find(n)[0] == "GBL":
            continue
        taken.add(n)
        union(n, g)
        if report is not None:
            report.append({"gbl": sorted(raw[g])[0], "other": sorted(x for x in raw[n] if not is_greek(x))[0],
                           "uid": n[1], "surname": round(ls, 2), "first": round(fs, 2), "team": team})
