"""
Ενιαίο μητρώο παικτών ανάμεσα σε πηγές με διαφορετικούς κωδικούς.

  - EuroLeague / EuroCup: κοινοί κωδικοί (P…) -> ήδη ίδιος παίκτης
  - Ελληνική λίγκα (esake.gr): δικοί της κωδικοί, σταθεροί από σεζόν σε σεζόν
  - NBA (ESPN): δικοί του κωδικοί
Σύνδεση ανάμεσα σε πηγές με το κανονικοποιημένο όνομα «ΕΠΩΝΥΜΟ|ΟΝΟΜΑ» (χωρίς τόνους, παύλες, τελείες,
Jr./II/III), ΜΟΝΟ αν το όνομα είναι μοναδικό μέσα σε κάθε πηγή (αλλιώς δεν ρισκάρουμε λάθος σύνδεση).
Ονόματα σε ελληνική μεταγραφή (παλιές σεζόν της ελληνικής λίγκας) δεν συνδέονται με το όνομα, αλλά
συνδέονται μέσω του σταθερού κωδικού της πηγής με τις σεζόν όπου το όνομα είναι γραμμένο με λατινικά.

    uid = link(tables)   # tables: {(comp, season): DataFrame με pid, player} -> {(comp, pid): uid}
"""
import re
import unicodedata

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


def link(tables: dict) -> dict:
    """tables: {(comp, season): DataFrame(pid, player)} -> {(comp, pid): uid}."""
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
    for (comp, _), t in tables.items():
        if t is None or len(t) == 0:
            continue
        g = group(comp, "")
        for pid, nm in zip(t.pid.astype(str), t.player):
            node = (g, pid)
            parent.setdefault(node, node)
            comps_of.setdefault(node, set()).add(comp)
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
    out = {}
    for node, comps in comps_of.items():
        r = find(node)
        uid = r[1] if r[0] == "EU" else f"{r[0]}:{r[1]}"
        for c in comps:
            out[(c, node[1])] = uid
    return out
