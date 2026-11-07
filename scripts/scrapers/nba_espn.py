"""
Scraper NBA μέσω του δημόσιου JSON API του ESPN (site.api.espn.com).
(Τα επίσημα stats.nba.com / cdn.nba.com μπλοκάρουν τους servers του GitHub Actions.)

Ροή:
  1. scoreboard ανά ημέρα -> όλα τα ματς (παιγμένα + επερχόμενα 2 εβδομάδων)
  2. summary?event=<id>   -> box score ανά παίκτη για όσα παιγμένα λείπουν

Κωδικός στα αρχεία: NBA -> data/raw/NBA2026_games.csv (σεζόν 2026-27) κ.λπ.
Το PIR υπολογίζεται (το ESPN δεν δίνει κοψίματα που δέχτηκε / φάουλ που κέρδισε -> 0).

    python scripts/scrapers/nba_espn.py                # τρέχουσα + προηγούμενη σεζόν
    python scripts/scrapers/nba_espn.py --season 2025
"""
import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Http, RawStore, pir  # noqa: E402

API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
CODE = "NBA"
ET = ZoneInfo("America/New_York")      # οι ημερομηνίες ματς του NBA δίνονται σε ώρα ανατολικής ακτής


class NbaScraper:
    def __init__(self):
        self.http = Http(sleep=0.15)

    # ---------- πρόγραμμα ----------
    def day(self, d: date) -> list[dict]:
        j = self.http.json(f"{API}/scoreboard", params={"dates": d.strftime("%Y%m%d"), "limit": 50})
        out = []
        for e in (j or {}).get("events", []):
            if e.get("season", {}).get("type") not in (2, 3):   # 2 = κανονική περίοδος, 3 = playoffs
                continue
            c = e["competitions"][0]
            h = next(t for t in c["competitors"] if t["homeAway"] == "home")
            a = next(t for t in c["competitors"] if t["homeAway"] == "away")
            done = e["status"]["type"].get("completed", False)
            local = datetime.fromisoformat(e["date"].replace("Z", "+00:00")).astimezone(ET)
            out.append(dict(gameCode=int(e["id"]), Round=None, date=local.strftime("%Y-%m-%d"),
                            time=local.strftime("%H:%M"),
                            homecode=h["team"]["abbreviation"], hometeam=h["team"]["displayName"],
                            awaycode=a["team"]["abbreviation"], awayteam=a["team"]["displayName"],
                            homescore=int(h["score"]) if done else None,
                            awayscore=int(a["score"]) if done else None, played=done))
        return out

    def schedule(self, season: int, store: RawStore) -> pd.DataFrame:
        """Incremental: ξανακατεβάζει μόνο από την τελευταία γνωστή παιγμένη ημέρα και μετά."""
        old = store.load_games()
        start, end = date(season, 10, 1), date(season + 1, 6, 30)
        today = datetime.now(timezone.utc).date()
        if len(old) and old.played.any():
            start = max(start, pd.to_datetime(old.loc[old.played, "date"]).max().date() - timedelta(days=2))
        end = min(end, today + timedelta(days=14))
        rows, d = [], start
        while d <= end:
            rows += self.day(d)
            d += timedelta(days=1)
        new = pd.DataFrame(rows)
        games = pd.concat([old, new], ignore_index=True) if len(old) else new
        if len(games):
            games["played"] = games["played"].astype(bool)
            games = games.sort_values("played").drop_duplicates("gameCode", keep="last")
            # αγωνιστική = εβδομάδα από την αρχή της σεζόν (χρήσιμο για το site)
            first = pd.to_datetime(games["date"]).min()
            games["Round"] = ((pd.to_datetime(games["date"]) - first).dt.days // 7 + 1).astype(int)
        return games

    # ---------- box score ----------
    @staticmethod
    def parse_summary(j: dict, season: int, game: dict) -> list[dict]:
        rows = []
        for block in j.get("boxscore", {}).get("players", []):
            team = block["team"]["abbreviation"]
            home = 1 if team == game["homecode"] else 0
            st = block["statistics"][0]
            keys = st.get("keys", [])
            for a in st.get("athletes", []):
                ath = a["athlete"]
                parts = ath.get("displayName", "").split(" ", 1)
                name = f"{parts[1]}, {parts[0]}" if len(parts) == 2 else parts[0]
                vals = dict(zip(keys, a.get("stats", [])))
                if a.get("didNotPlay") or not vals or vals.get("minutes") in (None, "", "0", "--"):
                    continue
                mk = lambda k: [int(x) for x in str(vals.get(k, "0-0")).split("-")]  # noqa: E731
                n = lambda k: int(str(vals.get(k, "0")).replace("+", "") or 0)      # noqa: E731
                fgm, fga = mk("fieldGoalsMade-fieldGoalsAttempted")
                m3, a3 = mk("threePointFieldGoalsMade-threePointFieldGoalsAttempted")
                ftm, fta = mk("freeThrowsMade-freeThrowsAttempted")
                r = dict(Season=season, Gamecode=game["gameCode"], Home=home, Player_ID=f"ESPN{ath['id']}",
                         IsStarter=int(a.get("starter", False)), IsPlaying=1, Team=team,
                         Dorsal=ath.get("jersey"), Player=name, Minutes=f"{n('minutes'):02d}:00",
                         Points=n("points"), FieldGoalsMade2=fgm - m3, FieldGoalsAttempted2=fga - a3,
                         FieldGoalsMade3=m3, FieldGoalsAttempted3=a3, FreeThrowsMade=ftm, FreeThrowsAttempted=fta,
                         OffensiveRebounds=n("offensiveRebounds"), DefensiveRebounds=n("defensiveRebounds"),
                         TotalRebounds=n("rebounds"), Assistances=n("assists"), Steals=n("steals"),
                         Turnovers=n("turnovers"), BlocksFavour=n("blocks"), BlocksAgainst=0,
                         FoulsCommited=n("fouls"), FoulsReceived=0, Plusminus=n("plusMinus"))
                r["Valuation"] = pir(r)
                rows.append(r)
        return rows

    def run(self, seasons: list[int]):
        for s in seasons:
            print(f"== NBA {s}-{str(s + 1)[2:]}")
            store = RawStore(CODE, s)
            games = self.schedule(s, store)
            if games.empty:
                print("  ! no games")
                continue
            store.save_games(games)
            have = store.cached_gamecodes()
            todo = games[games.played & ~games.gameCode.isin(have)]
            print(f"  box scores: {len(have)} cached, {len(todo)} to download")
            rows = []
            for i, g in enumerate(todo.to_dict("records"), 1):
                j = self.http.json(f"{API}/summary", params={"event": g["gameCode"]})
                if j:
                    rows += self.parse_summary(j, s, g)
                if i % 50 == 0:
                    print(f"    {i}/{len(todo)}")
                    store.append_box(rows); rows = []
            store.append_box(rows)


if __name__ == "__main__":
    from config import current_season
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, nargs="*", default=[current_season() - 1, current_season()])
    NbaScraper().run(ap.parse_args().season)
