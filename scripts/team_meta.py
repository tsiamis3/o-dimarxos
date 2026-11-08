"""
«Βάση» σημάτων ομάδων για το site: συντομογραφία + χρώματα ανά ομάδα (site/data/teams_meta.json).

Τα σήματα σχεδιάζονται στον browser σε SVG από αυτά τα στοιχεία (δεν χρησιμοποιούνται επίσημα logos).
Το πεδίο "img" είναι κενό: αν στο μέλλον προστεθούν εικόνες (π.χ. site/img/teams/{comp}/{code}.png),
συμπληρώνεται εδώ και το site τις δείχνει αντί για το σήμα.

Χρώματα: γνωστές ομάδες από τον πίνακα KNOWN (με λέξη-κλειδί στο όνομα), οι υπόλοιπες παίρνουν
σταθερό χρώμα από το hash του κωδικού (ίδιο σε κάθε build).
"""
import colorsys
import hashlib
import json
import re
import unicodedata

from config import COMPETITIONS, SITE_DATA
from dataset import CompetitionData

# λέξη-κλειδί στο όνομα (χωρίς τόνους, κεφαλαία) -> (κύριο χρώμα, δεύτερο χρώμα, συντομογραφία ή None)
KNOWN = [
    ("PANATHINA", "#00843d", "#ffffff", "ΠΑΟ"), ("ΠΑΝΑΘΗΝΑ", "#00843d", "#ffffff", "ΠΑΟ"),
    ("OLYMPIACOS", "#c8102e", "#ffffff", None), ("ΟΛΥΜΠΙΑΚΟΣ", "#c8102e", "#ffffff", "ΟΣΦΠ"),
    ("REAL MADRID", "#f4f4f4", "#3d195b", None), ("BARCELONA", "#a50044", "#004d98", None),
    ("FENERBAHCE", "#002d72", "#ffed00", None), ("ANADOLU EFES", "#003a70", "#ffffff", None),
    ("ZALGIRIS", "#006a44", "#ffffff", None), ("MACCABI", "#ffd200", "#0038a8", None),
    ("HAPOEL IBI", "#d50032", "#ffffff", None), ("PARTIZAN", "#111111", "#ffffff", None),
    ("CRVENA ZVEZDA", "#d2042d", "#ffffff", None), ("BASKONIA", "#0a2240", "#c8102e", None),
    ("VALENCIA", "#f47b20", "#111111", None), ("OLIMPIA MILAN", "#cc0000", "#ffffff", None),
    ("BAYERN", "#dc052d", "#ffffff", None), ("VIRTUS", "#111111", "#ffffff", None),
    ("ASVEL", "#00843d", "#ffffff", None), ("PARIS BASKETBALL", "#1d1d1b", "#e4c58a", None),
    ("DUBAI", "#0b6e4f", "#ffffff", None), ("BESIKTAS", "#111111", "#ffffff", None),
    ("MONACO", "#e2001a", "#ffffff", None),
    ("ARIS", "#ffd200", "#111111", None), ("ΑΡΗΣ", "#ffd200", "#111111", None),
    ("PAOK", "#111111", "#ffffff", None), ("ΠΑΟΚ", "#111111", "#ffffff", "ΠΑΟΚ"),
    ("ΑΕΚ", "#ffd200", "#111111", "ΑΕΚ"), ("ΠΕΡΙΣΤΕΡΙ", "#0055a5", "#ffffff", "ΠΕΡ"),
    ("ΗΡΑΚΛΗΣ", "#0047ab", "#ffffff", "ΗΡΑ"), ("ΠΡΟΜΗΘΕΑΣ", "#6b2c91", "#ffffff", "ΠΡΟ"),
    ("ΚΟΛΟΣΣΟΣ", "#0a3d91", "#ffffff", "ΚΟΛ"), ("ΜΑΡΟΥΣΙ", "#e30613", "#ffffff", "ΜΑΡ"),
    ("ΚΑΡΔΙΤΣΑ", "#005eb8", "#ffffff", "ΚΑΡ"), ("ΜΥΚΟΝΟΣ", "#00a3e0", "#ffffff", "ΜΥΚ"),
    ("ΛΕΥΚΑΔΑΣ", "#1e3f8f", "#ffffff", "ΛΕΥ"), ("FALCONS", "#111111", "#d4af37", "ΦΑΛ"),
    # NBA
    ("ATLANTA", "#e03a3e", "#c1d32f", None), ("BOSTON", "#007a33", "#ba9653", None),
    ("BROOKLYN", "#111111", "#ffffff", None), ("CHARLOTTE", "#1d1160", "#00788c", None),
    ("CHICAGO", "#ce1141", "#111111", None), ("CLEVELAND", "#860038", "#fdbb30", None),
    ("DALLAS", "#00538c", "#b8c4ca", None), ("DENVER", "#0e2240", "#fec524", None),
    ("DETROIT", "#c8102e", "#1d42ba", None), ("GOLDEN STATE", "#1d428a", "#ffc72c", None),
    ("HOUSTON", "#ce1141", "#111111", None), ("INDIANA", "#002d62", "#fdbb30", None),
    ("CLIPPERS", "#c8102e", "#1d428a", None), ("LAKERS", "#552583", "#fdb927", None),
    ("MEMPHIS", "#5d76a9", "#12173f", None), ("MIAMI", "#98002e", "#f9a01b", None),
    ("MILWAUKEE", "#00471b", "#eee1c6", None), ("MINNESOTA", "#0c2340", "#78be20", None),
    ("NEW ORLEANS", "#0c2340", "#c8102e", None), ("NEW YORK", "#006bb6", "#f58426", None),
    ("OKLAHOMA", "#007ac1", "#ef3b24", None), ("ORLANDO", "#0077c0", "#c4ced4", None),
    ("PHILADELPHIA", "#006bb6", "#ed174c", None), ("PHOENIX", "#1d1160", "#e56020", None),
    ("PORTLAND", "#e03a3e", "#111111", None), ("SACRAMENTO", "#5a2d81", "#63727a", None),
    ("SAN ANTONIO", "#c4ced4", "#111111", None), ("TORONTO", "#ce1141", "#111111", None),
    ("UTAH", "#002b5c", "#f9a01b", None), ("WASHINGTON", "#002b5c", "#e31837", None),
]
PREFIX = {"ΑΟ", "ΓΑΣ", "ΜΓΣ", "ΚΑΟ", "ΑΣ", "ΣΦΚ", "ΠΚΑΟ", "ΑΚΟ", "ΓΣ", "ΑΠΣ", "BC", "KK", "FC", "CB", "ΝΟ"}


def _plain(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s))
    return "".join(ch for ch in s if unicodedata.category(ch) != "Mn").upper()


def _lum(hexc: str) -> float:
    r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _hash_color(code: str) -> tuple[str, str]:
    h = int(hashlib.md5(code.encode()).hexdigest()[:8], 16)
    hue = (h % 360) / 360
    r, g, b = colorsys.hls_to_rgb(hue, 0.38, 0.55)
    return "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255)), "#ffffff"


def abbr(code: str, name: str) -> str:
    if re.fullmatch(r"[A-Z]{2,4}", str(code)):
        return code
    words = [w for w in re.split(r"[\s.\-]+", _plain(name)) if w and w not in PREFIX]
    if not words:
        return str(code)[:3]
    w = words[0]
    return w if len(w) <= 4 else w[:3]


def meta_for(code: str, name: str) -> dict:
    p = _plain(name)
    for key, c1, c2, ab in KNOWN:
        if _plain(key) in p:
            fg = "#111111" if _lum(c1) > 0.6 else "#ffffff"
            ab = code if re.fullmatch(r"[A-Z]{2,4}", str(code)) else (ab or abbr(code, name))
            return {"abbr": ab, "c1": c1, "c2": c2, "fg": fg, "img": None}
    c1, c2 = _hash_color(code)
    return {"abbr": abbr(code, name), "c1": c1, "c2": c2, "fg": "#ffffff", "img": None}


def build() -> dict:
    out = {}
    for comp in COMPETITIONS:
        try:
            names = CompetitionData(comp).team_names()
        except (FileNotFoundError, ValueError):
            continue
        out[comp] = {code: meta_for(code, name) for code, name in names.items()}
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    (SITE_DATA / "teams_meta.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    return out


if __name__ == "__main__":
    m = build()
    for c, t in m.items():
        print(c, " ".join(f"{k}:{v['abbr']}" for k, v in list(t.items())[:12]))
