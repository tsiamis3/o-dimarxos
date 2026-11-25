"""
Αποδόσεις κλεισίματος (μέσος όρος bookmakers, 1/2 με την παράταση) για τους παιγμένους αγώνες της τρέχουσας σεζόν
από το betexplorer.com (σελίδα αποτελεσμάτων κάθε λίγκας). Αντιστοίχιση με τους δικούς μας αγώνες (gameCode) με
σκορ και ημερομηνία ± 1 ημέρα (τα ονόματα διαφέρουν: ελληνικά στη GBL, άλλες γραφές αλλού).

Έξοδος: data/raw/{C}{season}_closing.csv  (gameCode, date, home, away, hs, as, odds_home, odds_away, src_home, src_away)

    python scripts/scrapers/betexplorer_closing.py                    # τρέχουσα σεζόν: GBL, E, U
    python scripts/scrapers/betexplorer_closing.py --season 2025      # προηγούμενη σεζόν (όλες οι φάσεις: κανονική, πλέι-οφ…)
"""
import csv
import html
import json
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import RAW_DIR, SITE_DATA  # noqa: E402

PAGES = {"E": "/basketball/europe/euroleague{}/results/", "U": "/basketball/europe/eurocup{}/results/",
         "GBL": "/basketball/greece/basket-league{}/results/"}
STAGE = re.compile(r'href="(\?stage=[A-Za-z0-9]+)"')
ROW = re.compile(r'<tr><td class="h-text-left"><a[^>]*class="in-match"><span>(?:<strong>)?([^<]*)(?:</strong>)?</span> - <span>(?:<strong>)?([^<]*)'
                 r'(?:</strong>)?</span></a></td><td class="h-text-center"><a[^>]*>([^<]*)</a></td>(.*?)<td class="h-text-right h-text-no-wrap">([^<]*)</td></tr>', re.S)


def fetch(path: str) -> str:
    req = Request("https://www.betexplorer.com" + path, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=30) as r:
        return r.read().decode("utf8", "replace")


def when(s: str, season: int, today: date) -> date | None:
    s = s.strip()
    if s.lower() == "today":
        return today
    if s.lower() == "yesterday":
        return today - timedelta(days=1)
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})?", s)
    if not m:
        return None
    d, mo = int(m.group(1)), int(m.group(2))
    y = int(m.group(3)) if m.group(3) else (season if mo >= 7 else season + 1)
    return date(y, mo, d)


def main(today: date | None = None, season_req: int | None = None):
    today = today or date.today()
    man = json.loads((SITE_DATA / "manifest.json").read_text())
    for comp, tmpl in PAGES.items():
        season = season_req or max(next(c for c in man["competitions"] if c["code"] == comp)["seasons"])
        page = tmpl.format(f"-{season}-{season + 1}" if season_req else "")
        S = json.loads((SITE_DATA / f"{comp}{season}.json").read_text())
        games = [dict(zip(S["games"]["cols"], r)) for r in S["games"]["rows"]]
        first = fetch(page)
        htmls = [first] + [(time.sleep(1.5), fetch(page + st))[1] for st in sorted(set(STAGE.findall(first)))]
        rows, seen = [], set()
        for hm, aw, sc, mid, d in [r for h in htmls for r in ROW.findall(h)]:
            od = re.findall(r'data-odd="([0-9.]+)"', mid)
            m = re.match(r"(\d+):(\d+)", sc.strip())
            dt = when(d, season, today)
            if len(od) != 2 or not m or not dt:
                continue
            key = (dt, html.unescape(hm).strip(), html.unescape(aw).strip())
            if key in seen:
                continue
            seen.add(key)
            rows.append((dt, key[1], key[2], int(m.group(1)), int(m.group(2)), float(od[0]), float(od[1])))
        out, miss = [], 0
        for dt, hm, aw, hs, as_, o1, o2 in rows:
            cand = [g for g in games if g["hs"] == hs and g["as"] == as_ and abs((date.fromisoformat(g["date"]) - dt).days) <= 1]
            if len(cand) != 1:
                miss += 1
                continue
            g = cand[0]
            out.append({"gameCode": g["gameCode"], "date": g["date"], "home": g["home"], "away": g["away"], "hs": hs, "as": as_,
                        "odds_home": o1, "odds_away": o2, "src_home": hm, "src_away": aw})
        path = RAW_DIR / f"{comp}{season}_closing.csv"
        with open(path, "w", newline="", encoding="utf8") as f:
            w = csv.DictWriter(f, fieldnames=list(out[0].keys()) if out else ["gameCode"])
            w.writeheader()
            w.writerows(out)
        print(f"== {comp}{season}: {len(htmls)} σελίδες, {len(rows)} αγώνες με αποδόσεις, {len(out)} αντιστοιχίστηκαν, {miss} όχι -> {path.name}")
        time.sleep(2)


if __name__ == "__main__":
    main(season_req=int(sys.argv[sys.argv.index("--season") + 1]) if "--season" in sys.argv else None)
