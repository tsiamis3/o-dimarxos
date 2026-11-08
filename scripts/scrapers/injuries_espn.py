"""
Τραυματίες NBA από το δημόσιο JSON του ESPN (στιγμιότυπο της ημέρας).
Το χρησιμοποιεί το edge_model.py για τις απουσίες στα επερχόμενα ματς.

Έξοδος: data/raw/NBA_injuries.csv  (pid = ESPN<id>, όπως στα box scores, team, status, weight)
  weight: Out 1.0, Doubtful 0.75, Questionable 0.4, Day-To-Day 0.25, Probable 0.1

    python scripts/scrapers/injuries_espn.py
    python scripts/scrapers/injuries_espn.py --probe
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import Http  # noqa: E402
from config import RAW_DIR  # noqa: E402

URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"
WEIGHT = {"out": 1.0, "doubtful": 0.75, "questionable": 0.4, "day-to-day": 0.25, "probable": 0.1}


def _athlete_id(a: dict):
    if a.get("id"):
        return str(a["id"])
    for link in a.get("links", []) or []:
        m = re.search(r"/id/(\d+)", link.get("href", ""))
        if m:
            return m.group(1)
    m = re.search(r"/athletes/(\d+)", (a.get("$ref") or ""))
    return m.group(1) if m else None


def parse(j: dict) -> list[dict]:
    rows = []
    for team in (j or {}).get("injuries", []) or []:
        abbr = (team.get("team") or {}).get("abbreviation") or team.get("abbreviation")
        for inj in team.get("injuries", []) or []:
            a = inj.get("athlete") or {}
            aid = _athlete_id(a)
            status = (inj.get("status") or (inj.get("type") or {}).get("description") or "").strip()
            t = abbr or ((a.get("team") or {}).get("abbreviation"))
            if not aid:
                continue
            rows.append(dict(pid=f"ESPN{aid}", player=a.get("displayName"), team=t, status=status,
                             weight=WEIGHT.get(status.lower(), 0.0), date=inj.get("date")))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", action="store_true")
    a = ap.parse_args()
    j = Http(sleep=0.2).json(URL)
    if a.probe:
        print(json.dumps(j, ensure_ascii=False)[:4000])
    rows = parse(j)
    df = pd.DataFrame(rows, columns=["pid", "player", "team", "status", "weight", "date"])
    df.insert(0, "fetched_at", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"))
    if a.probe:
        print(df.head(20).to_string())
        print(df.status.value_counts().to_string())
    path = RAW_DIR / "NBA_injuries.csv"
    df.to_csv(path, index=False)
    print(f"  {path.name}: {len(df)} injured players ({(df.weight >= 0.75).sum()} out/doubtful)")


if __name__ == "__main__":
    main()
