"""
Κοινά εργαλεία για τους scrapers άλλων πρωταθλημάτων.

Κάθε scraper γράφει στο ΙΔΙΟ format με το EuroLeague API (data/raw/):
  {CODE}{season}_games.csv   -> gameCode, Round, date, time, homecode, hometeam,
                                awaycode, awayteam, homescore, awayscore, played
  {CODE}{season}_box.csv.gz  -> μία γραμμή ανά παίκτη/αγώνα με στήλες τύπου API
                                (Season, Gamecode, Home, Player_ID, Player, Team, Minutes,
                                 Points, FieldGoalsMade2, ..., Valuation, Plusminus)
Έτσι το scripts/dataset.py τα διαβάζει χωρίς αλλαγές στη λογική του.
"""
import sys
import time
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import RAW_DIR  # noqa: E402

GAME_COLS = ["gameCode", "Round", "date", "time", "homecode", "hometeam",
             "awaycode", "awayteam", "homescore", "awayscore", "played"]
BOX_COLS = ["Season", "Gamecode", "Home", "Player_ID", "IsStarter", "IsPlaying", "Team", "Dorsal",
            "Player", "Minutes", "Points", "FieldGoalsMade2", "FieldGoalsAttempted2",
            "FieldGoalsMade3", "FieldGoalsAttempted3", "FreeThrowsMade", "FreeThrowsAttempted",
            "OffensiveRebounds", "DefensiveRebounds", "TotalRebounds", "Assistances", "Steals",
            "Turnovers", "BlocksFavour", "BlocksAgainst", "FoulsCommited", "FoulsReceived",
            "Valuation", "Plusminus"]

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/124 Safari/537.36")


def pir(r: dict) -> int:
    """PIR (EuroLeague Valuation) από τα επιμέρους στατιστικά."""
    return int((r["Points"] + r["TotalRebounds"] + r["Assistances"] + r["Steals"] + r["BlocksFavour"]
                + r["FoulsReceived"])
               - ((r["FieldGoalsAttempted2"] - r["FieldGoalsMade2"])
                  + (r["FieldGoalsAttempted3"] - r["FieldGoalsMade3"])
                  + (r["FreeThrowsAttempted"] - r["FreeThrowsMade"])
                  + r["Turnovers"] + r["BlocksAgainst"] + r["FoulsCommited"]))


class Http:
    """requests.Session με retries και μικρή παύση ανάμεσα στα αιτήματα (ευγένεια προς τα sites)."""

    def __init__(self, sleep=0.3, headers=None):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "el-GR,el;q=0.9,en;q=0.8"})
        if headers:
            self.s.headers.update(headers)
        self.sleep = sleep

    def get(self, url, **kw):
        for attempt in range(3):
            try:
                r = self.s.get(url, timeout=30, **kw)
                if r.status_code == 200:
                    time.sleep(self.sleep)
                    return r
                print(f"    ! {r.status_code} {url}")
            except requests.RequestException as e:
                print(f"    ! {type(e).__name__} {url}")
            time.sleep(2 * (attempt + 1))
        return None

    def text(self, url, **kw):
        r = self.get(url, **kw)
        return r.content.decode("utf-8", "replace") if r is not None else None

    def json(self, url, **kw):
        r = self.get(url, **kw)
        return r.json() if r is not None else None


class RawStore:
    """Διαβάζει/γράφει τα raw αρχεία ενός (κωδικού διοργάνωσης, σεζόν)."""

    def __init__(self, code: str, season: int):
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        self.code, self.season = code, season
        self.games_path = RAW_DIR / f"{code}{season}_games.csv"
        self.box_path = RAW_DIR / f"{code}{season}_box.csv.gz"

    def load_games(self) -> pd.DataFrame:
        return pd.read_csv(self.games_path) if self.games_path.exists() else pd.DataFrame(columns=GAME_COLS)

    def load_box(self) -> pd.DataFrame:
        return pd.read_csv(self.box_path) if self.box_path.exists() else pd.DataFrame(columns=BOX_COLS)

    def cached_gamecodes(self) -> set[int]:
        b = self.load_box()
        return set(b["Gamecode"].astype(int)) if len(b) else set()

    def save_games(self, games: pd.DataFrame) -> None:
        games = games.reindex(columns=GAME_COLS)
        games = games.drop_duplicates("gameCode", keep="last").sort_values(["date", "gameCode"])
        games.to_csv(self.games_path, index=False)
        print(f"  {self.games_path.name}: {len(games)} games ({int(games.played.sum())} played)")

    def append_box(self, rows: list[dict]) -> None:
        if not rows:
            return
        new = pd.DataFrame(rows).reindex(columns=BOX_COLS)
        old = self.load_box()
        box = pd.concat([old, new], ignore_index=True) if len(old) else new
        box = box.drop_duplicates(["Gamecode", "Player_ID", "Team"], keep="last")
        box.to_csv(self.box_path, index=False, compression="gzip")
        print(f"  {self.box_path.name}: +{len(new)} rows ({len(box)} total)")
