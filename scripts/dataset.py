"""
Φόρτωση raw CSV -> καθαρό "game log" DataFrame (μία γραμμή = παίκτης σε ματς).
Το χρησιμοποιούν όλα τα scripts (build_site, analytics, edge_model, gnn_data κ.λπ.).
"""
import re

import numpy as np
import pandas as pd

from config import RAW_DIR

# raw όνομα API -> σύντομο όνομα στήλης
RENAME = {
    "Points": "PTS", "FieldGoalsMade2": "FG2M", "FieldGoalsAttempted2": "FG2A",
    "FieldGoalsMade3": "FG3M", "FieldGoalsAttempted3": "FG3A", "FreeThrowsMade": "FTM",
    "FreeThrowsAttempted": "FTA", "OffensiveRebounds": "OREB", "DefensiveRebounds": "DREB",
    "TotalRebounds": "REB", "Assistances": "AST", "Steals": "STL", "Turnovers": "TOV",
    "BlocksFavour": "BLK", "BlocksAgainst": "BLKA", "FoulsCommited": "PF", "FoulsReceived": "FD",
    "Valuation": "PIR", "Plusminus": "PM",
}
STAT_COLS = ["MIN", *RENAME.values()]


def _minutes(x) -> float:
    try:
        m, s = str(x).split(":")
        return int(m) + int(s) / 60
    except ValueError:
        return 0.0


class CompetitionData:
    """Όλα τα δεδομένα ενός διαγωνισμού (όλες οι σεζόν που υπάρχουν στο data/raw)."""

    def __init__(self, comp: str):
        self.comp = comp
        self.games = self._load_games()
        self.logs = self._load_logs()

    @property
    def seasons(self) -> list[int]:
        return sorted(self.games["season"].unique().tolist())

    def _load_games(self) -> pd.DataFrame:
        frames = []
        for p, season in self._files("games.csv"):
            df = pd.read_csv(p)
            df["season"] = season
            frames.append(df)
        if not frames:
            raise FileNotFoundError(f"Δεν βρέθηκαν δεδομένα για {self.comp} στο {RAW_DIR}")
        g = pd.concat(frames, ignore_index=True)
        g["played"] = g["played"].astype(str).str.lower().isin(["true", "1"])
        return g

    def _files(self, suffix: str) -> list[tuple]:
        """Αρχεία {κωδικός}{σεζόν}_{suffix} — ο κωδικός μπορεί να έχει πολλά γράμματα (GBL, WBL2)."""
        pat = re.compile(rf"^{re.escape(self.comp)}(\d{{4}})_{re.escape(suffix)}$")
        return sorted((p, int(m.group(1))) for p in RAW_DIR.iterdir() if (m := pat.match(p.name)))

    @property
    def has_box(self) -> bool:
        return len(self.logs) > 0

    def _load_logs(self) -> pd.DataFrame:
        frames = [pd.read_csv(p) for p, _ in self._files("box.csv.gz")]
        cols = ["season", "gameCode", "Round", "date", "pid", "player", "team", "opp", "home", "starter", *STAT_COLS]
        if not frames:                       # διοργάνωση μόνο με αποτελέσματα (π.χ. Α2 γυναικών)
            return pd.DataFrame(columns=cols)
        b = pd.concat(frames, ignore_index=True).rename(columns=RENAME)
        b = b.rename(columns={"Season": "season", "Gamecode": "gameCode", "Home": "home",
                              "Player_ID": "pid", "Player": "player", "Team": "team",
                              "IsStarter": "starter"})
        b["pid"] = b["pid"].astype(str).str.strip()
        b["MIN"] = b["Minutes"].map(_minutes)
        b = b[b["MIN"] > 0].copy()                          # μόνο όσοι έπαιξαν
        for c in STAT_COLS:
            b[c] = pd.to_numeric(b.get(c, np.nan), errors="coerce")
        b[STAT_COLS] = b[STAT_COLS].fillna({c: 0 for c in STAT_COLS if c != "PM"})

        # αντίπαλος = η άλλη ομάδα του ίδιου ματς
        teams = b.groupby(["season", "gameCode", "home"])["team"].first().unstack("home")
        teams.columns = ["away_team", "home_team"] if list(teams.columns) == [0, 1] else teams.columns
        b = b.merge(teams.reset_index(), on=["season", "gameCode"], how="left")
        b["opp"] = np.where(b["home"] == 1, b["away_team"], b["home_team"])

        # ημερομηνία από το πρόγραμμα
        b = b.merge(self.games[["season", "gameCode", "date", "Round"]], on=["season", "gameCode"], how="left")
        b["date"] = pd.to_datetime(b["date"], errors="coerce")
        b = b.sort_values(["date", "season", "gameCode"]).reset_index(drop=True)
        return b[["season", "gameCode", "Round", "date", "pid", "player", "team", "opp",
                  "home", "starter", *STAT_COLS]]

    def team_names(self) -> dict[str, str]:
        g = self.games
        a = g[["homecode", "hometeam"]].set_axis(["code", "name"], axis=1)
        b = g[["awaycode", "awayteam"]].set_axis(["code", "name"], axis=1)
        names = pd.concat([a, b]).dropna().drop_duplicates("code", keep="last")
        out = dict(zip(names.code, names.name))
        for t in self.logs["team"].unique():          # ομάδες χωρίς όνομα στο πρόγραμμα
            out.setdefault(t, t)
        return out

    def upcoming(self, season: int) -> pd.DataFrame:
        g = self.games[(self.games.season == season) & ~self.games.played].copy()
        return g.sort_values(["date", "gameCode"])
