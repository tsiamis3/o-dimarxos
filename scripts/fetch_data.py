"""
Κατέβασμα δεδομένων EuroLeague / EuroCup με το πακέτο `euroleague-api`.

Για κάθε (διαγωνισμό, σεζόν) γράφει στο data/raw/:
  {C}{season}_games.csv  -> όλα τα ματς (παιγμένα + επερχόμενα) με σκορ/ημερομηνία
  {C}{season}_box.csv.gz -> box score κάθε παίκτη σε κάθε παιγμένο ματς

Είναι incremental: κατεβάζει box scores ΜΟΝΟ για ματς που λείπουν από το CSV,
οπότε το καθημερινό run στο GitHub Actions είναι γρήγορο.

Χρήση:
    python scripts/fetch_data.py                 # όλοι οι διαγωνισμοί, όλες οι σεζόν του config
    python scripts/fetch_data.py --comp E --season 2026
"""
import argparse
import re
import time

import pandas as pd

from config import COMPETITIONS, EUROLEAGUE_API, RAW_DIR, SEASONS

GAME_COLS = ["gameCode", "Round", "date", "time", "homecode", "hometeam",
             "awaycode", "awayteam", "homescore", "awayscore", "played"]


def _pick(df: pd.DataFrame, *names, default=None) -> pd.Series:
    """Επιστρέφει την πρώτη στήλη που υπάρχει (case-insensitive) — το API αλλάζει ονόματα κατά καιρούς."""
    lower = {c.lower(): c for c in df.columns}
    for n in names:
        if n.lower() in lower:
            return df[lower[n.lower()]]
    return pd.Series([default] * len(df), index=df.index)


def _to_code(x) -> int | None:
    """'E2025_12' ή '12' -> 12"""
    if pd.isna(x):
        return None
    m = re.findall(r"(\d+)$", str(x))
    return int(m[0]) if m else None


class SeasonFetcher:
    """Κατεβάζει/ενημερώνει τα raw αρχεία ενός (διαγωνισμού, σεζόν)."""

    def __init__(self, comp: str, season: int, sleep: float = 0.15):
        from euroleague_api.boxscore_data import BoxScoreData
        from euroleague_api.EuroLeagueData import EuroLeagueData
        from euroleague_api.schedule import Schedule

        self.comp, self.season, self.sleep = comp, season, sleep
        self.base = EuroLeagueData(competition=comp)
        self.box_api = BoxScoreData(competition=comp)
        self.sched_api = Schedule(competition=comp)
        self.games_path = RAW_DIR / f"{comp}{season}_games.csv"
        self.box_path = RAW_DIR / f"{comp}{season}_box.csv.gz"

    # ---------- πρόγραμμα / αποτελέσματα ----------
    def _normalize(self, df: pd.DataFrame) -> pd.DataFrame:
        out = pd.DataFrame({
            "gameCode": _pick(df, "gameCode", "gamecode", "game", "gamenumber").map(_to_code),
            "Round": pd.to_numeric(_pick(df, "Round", "gameday"), errors="coerce"),
            "date": pd.to_datetime(_pick(df, "date"), errors="coerce", format="mixed").dt.strftime("%Y-%m-%d"),
            "time": _pick(df, "time", "startime", default=""),
            "homecode": _pick(df, "homecode"),
            "hometeam": _pick(df, "hometeam"),
            "awaycode": _pick(df, "awaycode"),
            "awayteam": _pick(df, "awayteam"),
            "homescore": pd.to_numeric(_pick(df, "homescore"), errors="coerce"),
            "awayscore": pd.to_numeric(_pick(df, "awayscore"), errors="coerce"),
            "played": _pick(df, "played", default=False).astype(str).str.lower().isin(["true", "1"]),
        })
        return out.dropna(subset=["gameCode"])

    def fetch_games(self) -> pd.DataFrame:
        frames = []
        # 1) αποτελέσματα (έχουν σκορ)
        try:
            frames.append(self._normalize(self.base.get_gamecodes_season(self.season)))
        except Exception as e:  # noqa: BLE001
            print(f"  ! results {self.comp}{self.season}: {e}")
        # 2) πρόγραμμα (έχει και τα μελλοντικά ματς)
        try:
            frames.append(self._normalize(self.sched_api.get_schedule(self.season)))
        except Exception as e:  # noqa: BLE001
            print(f"  ! schedule {self.comp}{self.season}: {e}")
        if not frames:
            return pd.DataFrame(columns=GAME_COLS)

        games = pd.concat(frames, ignore_index=True)
        # Αν ένα ματς υπάρχει και στα δύο, κρατάμε τη γραμμή με σκορ/played=True
        games = (games.sort_values(["gameCode", "played", "homescore"], na_position="first")
                      .drop_duplicates("gameCode", keep="last")
                      .sort_values("gameCode").reset_index(drop=True))
        games["gameCode"] = games["gameCode"].astype(int)
        games.to_csv(self.games_path, index=False)
        print(f"  games: {len(games)} ({int(games.played.sum())} played)")
        return games

    # ---------- box scores ----------
    def fetch_boxscores(self, games: pd.DataFrame) -> None:
        old = pd.read_csv(self.box_path) if self.box_path.exists() else pd.DataFrame()
        have = set(old["Gamecode"].unique()) if len(old) else set()
        todo = [int(g) for g in games.loc[games.played, "gameCode"] if int(g) not in have]
        print(f"  box scores: {len(have)} cached, {len(todo)} to download")

        new = []
        for i, gc in enumerate(todo, 1):
            try:
                df = self.box_api.get_players_boxscore_stats(self.season, gc)
                df = df[~df["Player"].isin(["Team", "Total"])]
                new.append(df)
            except Exception as e:  # noqa: BLE001
                print(f"    ! game {gc}: {e}")
            if i % 25 == 0:
                print(f"    {i}/{len(todo)}")
            time.sleep(self.sleep)

        if new:
            box = pd.concat([old, *new], ignore_index=True)
            box["Player_ID"] = box["Player_ID"].astype(str).str.strip()
            box.to_csv(self.box_path, index=False, compression="gzip")

    def run(self) -> None:
        print(f"== {COMPETITIONS[self.comp]} {self.season}-{str(self.season + 1)[2:]}")
        games = self.fetch_games()
        if len(games):
            self.fetch_boxscores(games)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", choices=EUROLEAGUE_API, nargs="*", default=EUROLEAGUE_API)
    ap.add_argument("--season", type=int, nargs="*", default=SEASONS)
    args = ap.parse_args()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if (RAW_DIR / ".demo").exists():  # μην ανακατέψεις demo με πραγματικά δεδομένα
        for f in RAW_DIR.iterdir():
            f.unlink()
    for c in args.comp:
        for s in args.season:
            SeasonFetcher(c, s).run()


if __name__ == "__main__":
    main()
