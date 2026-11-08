"""
Αποδόσεις από το The Odds API (https://the-odds-api.com) για τις λίγκες χωρίς δωρεάν πηγή
(EuroLeague, EuroCup, ελληνική λίγκα αν υπάρχει) και για επιπλέον bookmakers στο NBA.

Χρειάζεται δωρεάν κλειδί (500 credits/μήνα): ως GitHub secret ODDS_API_KEY.
Χωρίς κλειδί ο scraper απλώς δεν κάνει τίποτα (το workflow συνεχίζει κανονικά).
Κόστος: 3 credits ανά λίγκα ανά run (markets h2h,spreads,totals · region eu) -> ~12/ημέρα.

Κάθε run κρατά στιγμιότυπο (kind=current) ανά bookmaker για τα επερχόμενα ματς· το τελευταίο
στιγμιότυπο πριν από το τζάμπολ λειτουργεί ως γραμμή κλεισίματος για την αξιολόγηση.
Τα ματς αντιστοιχίζονται στα δικά μας (gameCode) με ημερομηνία ± 1 ημέρα και ομοιότητα ονομάτων.

Έξοδος: data/raw/{C}{season}_odds.csv (ίδιο σχήμα με το odds_espn.py, provider = bookmaker)

    ODDS_API_KEY=... python scripts/scrapers/odds_api.py
"""
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import Http  # noqa: E402
from config import RAW_DIR, current_season  # noqa: E402
from odds_espn import COLS  # noqa: E402

API = "https://api.the-odds-api.com/v4"
# διοργάνωση -> λέξεις που αναζητούνται στο key/title των αθλημάτων του API
MATCH = {"E": ["euroleague"], "U": ["eurocup"], "GBL": ["greece", "greek", "basket league"], "NBA": ["basketball_nba"]}
STOP = {"bc", "kk", "bk", "fc", "basketball", "basket", "club", "sad", "ksk", "the", "de", "b.c.", "cb", "sk"}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return " ".join(w for w in s.split() if w not in STOP)


def sim(a: str, b: str) -> float:
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0.0
    if a in b or b in a:
        return 0.95
    ta, tb = set(a.split()), set(b.split())
    jac = len(ta & tb) / len(ta | tb)
    return max(SequenceMatcher(None, a, b).ratio(), jac)


def match_event(ev: dict, games: pd.DataFrame):
    """-> gameCode του δικού μας αγώνα ή None."""
    t = pd.Timestamp(ev["commence_time"]).tz_convert("UTC").tz_localize(None).normalize()
    d = pd.to_datetime(games["date"])
    cand = games[(d >= t - pd.Timedelta(days=1)) & (d <= t + pd.Timedelta(days=1))]
    best, best_s = None, 0.0
    for g in cand.itertuples():
        s = (sim(ev["home_team"], g.hometeam) + sim(ev["away_team"], g.awayteam)) / 2
        if s > best_s:
            best, best_s = g.gameCode, s
    return best if best_s >= 0.55 else None


def parse_event(ev: dict) -> list[dict]:
    """Ένα event του API -> μία γραμμή ανά bookmaker (δεκαδικές αποδόσεις, spread από τη μεριά του γηπεδούχου)."""
    home, away = ev["home_team"], ev["away_team"]
    rows = []
    for bk in ev.get("bookmakers", []):
        r = {c: None for c in COLS}
        r["provider"] = bk.get("key") or bk.get("title")
        for m in bk.get("markets", []):
            oc = {o.get("name"): o for o in m.get("outcomes", [])}
            if m.get("key") == "h2h":
                r["ml_home"] = (oc.get(home) or {}).get("price")
                r["ml_away"] = (oc.get(away) or {}).get("price")
            elif m.get("key") == "spreads":
                h, a = oc.get(home) or {}, oc.get(away) or {}
                r["spread"] = h.get("point")
                r["spread_home_odds"], r["spread_away_odds"] = h.get("price"), a.get("price")
            elif m.get("key") == "totals":
                o, u = oc.get("Over") or {}, oc.get("Under") or {}
                r["total"] = o.get("point")
                r["over_odds"], r["under_odds"] = o.get("price"), u.get("price")
        rows.append(r)
    return rows


class OddsApi:
    def __init__(self, key: str):
        self.key = key
        self.http = Http(sleep=0.5)

    def sports(self) -> list[dict]:
        return self.http.json(f"{API}/sports", params={"apiKey": self.key}) or []

    def run(self):
        sports = [s for s in self.sports() if s.get("active") and not s.get("has_outrights")]
        season = current_season()
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
        for comp, words in MATCH.items():
            keys = [s["key"] for s in sports
                    if any(w in (s["key"] + " " + s.get("title", "") + " " + s.get("description", "")).lower() for w in words)
                    and s.get("group", "").lower() == "basketball"]
            gp = RAW_DIR / f"{comp}{season}_games.csv"
            if not keys or not gp.exists():
                print(f"== {comp}: {'no sport on the API' if not keys else 'no games file'}")
                continue
            games = pd.read_csv(gp)
            games = games[~games.played.astype(str).str.lower().isin(["true", "1"])]
            rows, unmatched = [], 0
            for key in keys:
                r = self.http.get(f"{API}/sports/{key}/odds", params={
                    "apiKey": self.key, "regions": "eu", "markets": "h2h,spreads,totals", "oddsFormat": "decimal"})
                if r is None:
                    continue
                print(f"== {comp} ({key}): credits left {r.headers.get('x-requests-remaining')}")
                for ev in r.json():
                    gc = match_event(ev, games)
                    if gc is None:
                        unmatched += 1
                        continue
                    for row in parse_event(ev):
                        row.update(gameCode=int(gc), fetched_at=stamp, kind="current")
                        rows.append(row)
            path = RAW_DIR / f"{comp}{season}_odds.csv"
            old = pd.read_csv(path) if path.exists() else pd.DataFrame(columns=COLS)
            new = pd.DataFrame(rows, columns=COLS)
            out = pd.concat([old, new], ignore_index=True) if len(old) else new
            out = out.drop_duplicates(["gameCode", "provider", "kind"], keep="last")
            out.to_csv(path, index=False)
            print(f"   {path.name}: +{new.gameCode.nunique() if len(new) else 0} games, {len(new)} bookmaker rows, "
                  f"{unmatched} events not matched")


if __name__ == "__main__":
    key = os.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        print("ODDS_API_KEY not set -> skip (πρόσθεσε το κλειδί ως GitHub secret για αποδόσεις EuroLeague/EuroCup)")
        sys.exit(0)
    OddsApi(key).run()
