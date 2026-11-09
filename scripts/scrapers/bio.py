"""
Βιογραφικά παικτών EuroLeague / EuroCup (api-live.euroleague.net, endpoint «people»):
ύψος (cm), βάρος (kg), ημερομηνία γέννησης, εθνικότητα, θέση (Guard/Forward/Center), αριθμός, ομάδα, φωτογραφία.

Έξοδος: data/raw/{C}{season}_bio.csv   (μία γραμμή ανά παίκτη και ομάδα της σεζόν)
Οι παλιές σεζόν κατεβαίνουν μία φορά· η τρέχουσα ξανά σε κάθε run (νέες μεταγραφές).

    python scripts/scrapers/bio.py                 # E, U, όλες οι σεζόν
"""
import argparse
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import RAW_DIR, SEASONS  # noqa: E402

URL = "https://api-live.euroleague.net/v2/competitions/{c}/seasons/{c}{s}/people"
COLS = ["pid", "name", "height", "weight", "birth_date", "country", "position", "dorsal", "club", "headshot"]


def fetch(comp: str, season: int) -> pd.DataFrame:
    for attempt in range(5):
        r = requests.get(URL.format(c=comp, s=season), params={"personType": "J"}, timeout=60)
        if r.status_code == 429 and attempt < 4:
            time.sleep(20 * (attempt + 1))
            continue
        r.raise_for_status()
        break
    js = r.json()
    rows = []
    for x in js.get("data", js) if isinstance(js, dict) else js:
        p = x.get("person") or {}
        code = str(p.get("code") or "").strip()
        if not code:
            continue
        rows.append({
            "pid": "P" + code,                                 # ίδιος κωδικός με box score / play-by-play
            "name": p.get("name"),
            "height": p.get("height") or None,                  # cm (0 = άγνωστο)
            "weight": p.get("weight") or None,                  # kg
            "birth_date": (p.get("birthDate") or "")[:10] or None,
            "country": (p.get("country") or {}).get("code"),
            "position": x.get("positionName"),
            "dorsal": x.get("dorsal"),
            "club": (x.get("club") or {}).get("code"),
            "headshot": (x.get("images") or {}).get("headshot"),
        })
    return pd.DataFrame(rows, columns=COLS)


def run(comps, seasons):
    cur = max(seasons)
    for c in comps:
        for s in seasons:
            path = RAW_DIR / f"{c}{s}_bio.csv"
            if path.exists() and s != cur:
                continue
            try:
                df = fetch(c, s)
            except Exception as e:  # noqa: BLE001
                print(f"  ! {c}{s} bio: {e}")
                continue
            if df.empty:
                print(f"  ! {c}{s} bio: empty")
                continue
            df.to_csv(path, index=False)
            print(f"== {c}{s} bio: {len(df)} players, height {df.height.notna().mean():.0%}, "
                  f"weight {df.weight.notna().mean():.0%}, birth {df.birth_date.notna().mean():.0%}")
            time.sleep(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", default="E,U")
    a = ap.parse_args()
    run(a.comp.split(","), SEASONS)
