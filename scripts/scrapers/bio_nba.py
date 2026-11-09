"""
Βιογραφικά παικτών NBA από το ESPN: ύψος, βάρος, ημερομηνία γέννησης, θέση, φωτογραφία.

  1. ρόστερ των 30 ομάδων (site.api.espn.com, μία κλήση ανά ομάδα): όλοι οι ενεργοί παίκτες
  2. όσοι παίκτες των box scores δεν βρέθηκαν σε ρόστερ: ένας-ένας (sports.core.api.espn.com)
Μονάδες: ίντσες -> cm, λίβρες -> kg. Κωδικός παίκτη ίδιος με τα box scores (ESPN<id>).

Έξοδος: data/raw/NBA_bio.csv (ένα αρχείο για όλες τις σεζόν· ενημερώνεται σε κάθε run)

    python scripts/scrapers/bio_nba.py
"""
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import RAW_DIR  # noqa: E402

SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
CORE = "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/{}"
OUT = RAW_DIR / "NBA_bio.csv"
COLS = ["pid", "name", "height", "weight", "birth_date", "position", "headshot"]
POS = {"G": "Guard", "F": "Forward", "C": "Center"}


def _get(url, tries=4):
    for k in range(tries):
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 429 and k < tries - 1:
                time.sleep(10 * (k + 1))
                continue
            if r.status_code == 404:
                return None
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if k == tries - 1:
                raise
            time.sleep(3 * (k + 1))
    return None


def _row(a: dict) -> dict:
    pos = a.get("position") or {}
    ab = str(pos.get("abbreviation") or "")
    # ESPN: G, F, C ή συνδυασμοί (π.χ. "G-F", "PG"): κρατάμε το πρώτο γράμμα που αντιστοιχεί
    p = next((POS[ch] for ch in ab.replace("P", "").replace("S", "") if ch in POS), None)
    h, w = a.get("height"), a.get("weight")
    return {
        "pid": f"ESPN{a.get('id')}",
        "name": a.get("fullName") or a.get("displayName"),
        "height": round(float(h) * 2.54, 1) if h else None,
        "weight": round(float(w) * 0.4536, 1) if w else None,
        "birth_date": (a.get("dateOfBirth") or "")[:10] or None,
        "position": p,
        "headshot": (a.get("headshot") or {}).get("href"),
    }


def rosters() -> list[dict]:
    teams = _get(f"{SITE}/teams") or {}
    ids = [t["team"]["id"] for sp in teams.get("sports", []) for lg in sp.get("leagues", []) for t in lg.get("teams", [])]
    rows = []
    for tid in ids:
        js = _get(f"{SITE}/teams/{tid}/roster") or {}
        for a in js.get("athletes", []):
            for x in (a.get("items") if isinstance(a, dict) and "items" in a else [a]):
                rows.append(_row(x))
        time.sleep(0.3)
    return rows


def main():
    old = pd.read_csv(OUT) if OUT.exists() else pd.DataFrame(columns=COLS)
    rows = rosters()
    print(f"== NBA rosters: {len(rows)} players")
    have = {r["pid"] for r in rows} | set(old.pid)
    need = set()
    for f in RAW_DIR.glob("NBA20*_box.csv.gz"):
        need |= set(pd.read_csv(f, usecols=["Player_ID"]).Player_ID.astype(str))
    todo = sorted(p for p in need - have if p.startswith("ESPN"))
    print(f"   players in box scores without bio: {len(todo)}")
    for i, pid in enumerate(todo, 1):
        a = _get(CORE.format(pid[4:]))
        if a:
            rows.append(_row(a))
        time.sleep(0.2)
        if i % 50 == 0:
            print(f"   {i}/{len(todo)}")
    new = pd.DataFrame(rows, columns=COLS)
    df = pd.concat([old, new]).drop_duplicates("pid", keep="last")        # τα νέα (ρόστερ) υπερισχύουν
    df.to_csv(OUT, index=False)
    print(f"-> {OUT.name}: {len(df)} players, height {df.height.notna().mean():.0%}, "
          f"weight {df.weight.notna().mean():.0%}, birth {df.birth_date.notna().mean():.0%}")


if __name__ == "__main__":
    main()
