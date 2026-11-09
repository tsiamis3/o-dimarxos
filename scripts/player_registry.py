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

    last, first = clean(last), clean(first)
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
    out = {}
    for node, comps in comps_of.items():
        r = find(node)
        uid = r[1] if r[0] == "EU" else f"{r[0]}:{r[1]}"
        for c in comps:
            out[(c, node[1])] = uid
    return out
