"""
Αποδόσεις NBA από το δημόσιο JSON του ESPN (summary?event=<id> -> "pickcenter").

Για κάθε αγώνα κρατά μία γραμμή ανά πάροχο (συνήθως ESPN BET / DraftKings):
  moneyline γηπεδούχου/φιλοξενούμενου, handicap (spread) από τη μεριά του γηπεδούχου,
  σύνολο πόντων (over/under) και τις αποδόσεις τους, σε δεκαδική μορφή (π.χ. 1.91).
  Όπου το ESPN δίνει άνοιγμα (open) και κλείσιμο (close), κρατιούνται και τα δύο.

  παιγμένοι αγώνες  -> κατεβαίνουν μία φορά (κλειστή γραμμή), μετά μένουν στην cache
  επερχόμενοι (3 ημέρες) -> ξανακατεβαίνουν σε κάθε run (τρέχουσα γραμμή)

Έξοδος: data/raw/NBA{season}_odds.csv

    python scripts/scrapers/odds_espn.py               # τρέχουσα + προηγούμενη σεζόν
    python scripts/scrapers/odds_espn.py --probe 3     # τυπώνει το raw pickcenter 3 αγώνων (debug)
"""
import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import Http  # noqa: E402
from config import RAW_DIR  # noqa: E402

API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
CODE = "NBA"
UPCOMING_DAYS = 3
COLS = ["gameCode", "provider", "fetched_at", "kind",
        "ml_home", "ml_away", "spread", "spread_home_odds", "spread_away_odds",
        "total", "over_odds", "under_odds",
        "open_ml_home", "open_ml_away", "open_spread", "open_total"]


# ---------------------------------------------------------------------------
# μετατροπές
# ---------------------------------------------------------------------------
def american_to_decimal(v):
    """-110 -> 1.909, +150 -> 2.5. Δέχεται αριθμούς ή strings ('+150', '-110', 'EVEN')."""
    if v is None:
        return None
    if isinstance(v, str):
        s = v.strip().upper().replace("−", "-")
        if s in ("", "OFF", "--", "N/A"):
            return None
        if s in ("EVEN", "EV", "PK"):
            return 2.0
        try:
            v = float(s)
        except ValueError:
            return None
    v = float(v)
    if v == 0 or -100 < v < 100:
        return None
    return round(1 + (v / 100 if v > 0 else 100 / -v), 4)


def _num(v):
    """'-6.5' / -6.5 / 'o220.5' / 'PK' -> float."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().lower().replace("−", "-").lstrip("ou")
    if s in ("pk", "even"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


def _dig(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def _american(side, kind, market):
    """Νεότερη μορφή ESPN: homeTeamOdds.{open,close,current}.{moneyLine,spread}.american."""
    v = _dig(side, kind, market)
    if isinstance(v, dict):
        return v.get("american") or v.get("value")
    return v


def parse_pickcenter(item: dict) -> dict:
    """Ένα στοιχείο του pickcenter -> μία γραμμή (δεκαδικές αποδόσεις, spread από τη μεριά του γηπεδούχου)."""
    h, a = item.get("homeTeamOdds") or {}, item.get("awayTeamOdds") or {}
    # κλείσιμο/τρέχουσα: πρώτα τα επίπεδα πεδία, μετά οι εμφωλευμένες μορφές
    ml_h = h.get("moneyLine") or _american(h, "close", "moneyLine") or _american(h, "current", "moneyLine")
    ml_a = a.get("moneyLine") or _american(a, "close", "moneyLine") or _american(a, "current", "moneyLine")
    spread = _num(item.get("spread"))
    if spread is None:
        spread = _num(_dig(h, "close", "pointSpread", "american") or _dig(h, "current", "pointSpread", "american"))
    total = _num(item.get("overUnder"))
    if total is None:
        total = _num(_dig(item, "close", "total", "american") or _dig(item, "current", "total", "american"))
    over = item.get("overOdds") or _american(item, "close", "over") or _american(item, "current", "over")
    under = item.get("underOdds") or _american(item, "close", "under") or _american(item, "current", "under")
    return dict(
        provider=_dig(item, "provider", "name") or "?",
        ml_home=american_to_decimal(ml_h), ml_away=american_to_decimal(ml_a),
        spread=spread,
        spread_home_odds=american_to_decimal(h.get("spreadOdds") or _american(h, "close", "spread")),
        spread_away_odds=american_to_decimal(a.get("spreadOdds") or _american(a, "close", "spread")),
        total=total, over_odds=american_to_decimal(over), under_odds=american_to_decimal(under),
        open_ml_home=american_to_decimal(_american(h, "open", "moneyLine")),
        open_ml_away=american_to_decimal(_american(a, "open", "moneyLine")),
        open_spread=_num(_dig(h, "open", "pointSpread", "american")),
        open_total=_num(_dig(item, "open", "total", "american")),
    )


# ---------------------------------------------------------------------------
class EspnOdds:
    def __init__(self):
        self.http = Http(sleep=0.12)
        self.now = datetime.now(timezone.utc)

    def fetch(self, gc: int) -> list[dict]:
        j = self.http.json(f"{API}/summary", params={"event": gc})
        out = []
        for item in (j or {}).get("pickcenter", []) or []:
            r = parse_pickcenter(item)
            if r["ml_home"] or r["spread"] is not None or r["total"] is not None:
                out.append(r)
        return out

    def run(self, seasons, probe=0):
        for s in seasons:
            gp = RAW_DIR / f"{CODE}{s}_games.csv"
            if not gp.exists():
                continue
            games = pd.read_csv(gp)
            path = RAW_DIR / f"{CODE}{s}_odds.csv"
            old = pd.read_csv(path) if path.exists() else pd.DataFrame(columns=COLS)
            have_closed = set(old.loc[old.kind == "close", "gameCode"]) if len(old) else set()
            played = games[games.played.astype(str).str.lower().isin(["true", "1"])]
            soon = games[~games.gameCode.isin(played.gameCode)]
            d = pd.to_datetime(soon["date"])
            soon = soon[(d >= pd.Timestamp(self.now.date()) - pd.Timedelta(days=1))
                        & (d <= pd.Timestamp(self.now.date()) + pd.Timedelta(days=UPCOMING_DAYS))]
            todo = [(gc, "close") for gc in played.gameCode if gc not in have_closed] + \
                   [(gc, "current") for gc in soon.gameCode]
            if probe:
                todo = todo[:probe] + [(gc, "current") for gc in soon.gameCode[:probe]]
            print(f"== NBA odds {s}: {len(have_closed)} closed cached, {len(todo)} to fetch")
            rows, stamp = [], self.now.strftime("%Y-%m-%d %H:%M")
            for i, (gc, kind) in enumerate(todo, 1):
                if probe:
                    j = self.http.json(f"{API}/summary", params={"event": gc})
                    print(f"--- probe {gc} ({kind}) pickcenter:")
                    print(json.dumps((j or {}).get("pickcenter"), ensure_ascii=False)[:3000])
                    print(f"--- probe {gc} odds keys:", list((j or {}).keys()))
                for r in self.fetch(int(gc)):
                    rows.append(dict(gameCode=int(gc), fetched_at=stamp, kind=kind, **r))
                if i % 200 == 0:
                    print(f"    {i}/{len(todo)}")
            if probe:
                print(pd.DataFrame(rows).to_string())
                continue
            new = pd.DataFrame(rows, columns=COLS)
            # τρέχουσες γραμμές: κρατάμε μόνο την πιο πρόσφατη ανά (αγώνα, πάροχο)
            keep = old[~((old.kind == "current") & old.gameCode.isin(new.gameCode))] if len(old) else old
            out = pd.concat([keep, new], ignore_index=True) if len(keep) else new
            out = out.drop_duplicates(["gameCode", "provider", "kind"], keep="last").sort_values(["gameCode", "kind"])
            out.to_csv(path, index=False)
            n_ml = out.ml_home.notna().sum() if len(out) else 0
            print(f"  {path.name}: {out.gameCode.nunique() if len(out) else 0} games with odds "
                  f"({n_ml} rows with moneyline)")


if __name__ == "__main__":
    from config import current_season
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, nargs="*", default=[current_season() - 1, current_season()])
    ap.add_argument("--probe", type=int, default=0)
    a = ap.parse_args()
    EspnOdds().run(a.season, a.probe)
