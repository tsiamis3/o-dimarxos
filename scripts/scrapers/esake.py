"""
Scraper για το ελληνικό πρωτάθλημα ανδρών (Stoiximan GBL) από το esake.gr.

Ροή:
  1. Σελίδα αποτελεσμάτων -> λίστα πρωταθλημάτων (idchampionship ανά σεζόν),
     φάσεις (idseason) και αγωνιστικές (series).
  2. Για κάθε αγωνιστική: τα ματς (ημερομηνία, ομάδες, σκορ, idgame).
  3. Για κάθε παιγμένο ματς που λείπει: το box score (EsakegameView?mode=3).

Κωδικός διοργάνωσης στα αρχεία: GBL  ->  data/raw/GBL2026_games.csv, GBL2026_box.csv.gz

    python scripts/scrapers/esake.py                 # τελευταίες 4 σεζόν
    python scripts/scrapers/esake.py --season 2026
"""
import argparse
import html
import re
import sys
import zlib
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import Http, RawStore  # noqa: E402

BASE = "https://www.esake.gr"
CODE = "GBL"
MONTHS = {"Ιαν": 1, "Φεβ": 2, "Μαρ": 3, "Απρ": 4, "Μαϊ": 5, "Μαΐ": 5, "Μάι": 5, "Μαι": 5, "Ιουν": 6,
          "Ιουλ": 7, "Αυγ": 8, "Σεπ": 9, "Οκτ": 10, "Νοε": 11, "Δεκ": 12}


def _txt(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def _options(page: str, select_id: str) -> list[tuple[str, str]]:
    m = re.search(rf'<select[^>]+id="{select_id}".*?</select>', page, re.S)
    return [(v, _txt(t)) for v, t in re.findall(r'<option value="([^"]*)"[^>]*>(.*?)</option>', m.group(0))] if m else []


class EsakeScraper:
    def __init__(self):
        self.http = Http(sleep=0.4)

    # ---------- πρωταθλήματα / σεζόν ----------
    def championships(self) -> dict[int, str]:
        """{έτος έναρξης σεζόν: idchampionship} — μόνο το κυρίως πρωτάθλημα."""
        page = self.http.text(BASE + "/el/action/EsakeResults")
        out = {}
        for val, label in _options(page, "idchampionship"):
            m = re.search(r"(\d{4})\s*-\s*(\d{2,4})", label)
            if val and m:                       # η λίστα έχει πρώτα τη νεότερη διοργάνωση
                out.setdefault(int(m.group(1)), val)
        return out

    def _results_url(self, champ, idseason="", series=""):
        return (f"{BASE}/el/action/EsakeResults?idchampionship={champ}&idteam=&idseason={idseason}"
                f"&series={series}")

    # ---------- ματς αγωνιστικής ----------
    @staticmethod
    def _date(raw: str, season: int) -> tuple[str | None, str]:
        """'Σαβ 7 Νοε - 15:00' -> ('2026-11-07', '15:00'). Το έτος βγαίνει από τη σεζόν."""
        m = re.search(r"(\d{1,2})\s+([Α-Ωα-ωάέήίόύώϊΐ]+)\.?\s*(?:-\s*(\d{1,2}:\d{2}))?", raw)
        if not m:
            return None, ""
        mon = next((v for k, v in MONTHS.items() if m.group(2).startswith(k)), None)
        if not mon:
            return None, m.group(3) or ""
        year = season if mon >= 8 else season + 1
        return f"{year}-{mon:02d}-{int(m.group(1)):02d}", m.group(3) or ""

    def games_of_page(self, page: str, season: int) -> list[dict]:
        out = []
        blocks = page.split('<div class="esake-program-game">')[1:]
        for b in blocks:
            rnd = re.search(r"<h5>\s*(\d+)", b)
            info = re.findall(r'esake-program-game-info[^>]*>(.*?)</div>', b, re.S)
            date, tm = self._date(_txt(info[0]) if info else "", season)
            teams = re.findall(r"/dat/esaketeam/([0-9A-F]+)/", b)
            sc = b[b.find("esake-program-game-final-score"):] if "esake-program-game-final-score" in b else ""
            names = [_txt(x) for x in re.findall(r"<span>(.*?)</span>", sc, re.S)[:3]]
            if len(teams) < 2:
                continue
            home_name, mid, away_name = (names + ["", "", ""])[:3]
            score = re.match(r"(\d+)\s*-\s*(\d+)", mid.replace("\xa0", " "))
            gid = re.search(r"idgame=([0-9A-F]+)&mode=3", b)
            # μελλοντικά ματς δεν έχουν ακόμα idgame -> σταθερός κωδικός από ομάδες+ημερομηνία
            code = int(gid.group(1), 16) if gid else 9_000_000_000 + zlib.crc32(f"{teams[0]}{teams[1]}{date}".encode()) % 10**9
            out.append(dict(gameCode=code, idgame=gid.group(1) if gid else None, Round=int(rnd.group(1)) if rnd else None,
                            date=date, time=tm, homecode=teams[0], hometeam=home_name, awaycode=teams[1],
                            awayteam=away_name, homescore=int(score.group(1)) if score else None,
                            awayscore=int(score.group(2)) if score else None, played=bool(score)))
        return out

    def season_games(self, champ: str, season: int) -> pd.DataFrame:
        first = self.http.text(self._results_url(champ))
        phases = [v for v, _ in _options(first, "idseason") if v] or [""]
        games = []
        for ph in phases:
            p = self.http.text(self._results_url(champ, ph))
            series = sorted(set(re.findall(r"new Option\('[^']*',\s*'(\d+)'\)", p or "")))
            for s in series:
                page = self.http.text(self._results_url(champ, ph, s))
                if page:
                    games += self.games_of_page(page, season)
        df = pd.DataFrame(games)
        return df.drop_duplicates("gameCode") if len(df) else df

    # ---------- box score ----------
    @staticmethod
    def parse_box(page: str, season: int, game: dict) -> list[dict]:
        rows = []
        sections = re.split(r'<div class="table-stats-title">', page)[1:]
        for sec in sections:
            team = re.search(r"idteam=([0-9A-F]+)", sec)
            table = re.search(r"<tbody>(.*?)</tbody>", sec, re.S)
            if not team or not table:
                continue
            team = team.group(1)
            home = 1 if team == game["homecode"] else 0
            for tr in re.findall(r"<tr>(.*?)</tr>", table.group(1), re.S):
                pid = re.search(r"idplayer=([0-9A-F]+)", tr)
                tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
                if not pid or len(tds) < 17:
                    continue
                last = _txt((re.search(r"<SPAN>(.*?)</SPAN>", tds[0], re.I) or [None, ""])[1])
                full = _txt(re.sub(r'<div class="table-image-wrapper.*?</div>', "", tds[0], flags=re.S))
                dorsal = re.match(r"#(\d+)", full)
                first = full.replace(dorsal.group(0) if dorsal else "", "", 1).strip()
                first = first[len(last):].strip() if first.upper().startswith(last.upper()) else first
                v = [_txt(x) for x in tds[1:]]
                pm = lambda s: [int(x) for x in re.findall(r"\d+", s)][:2] or [0, 0]  # noqa: E731
                (m2, a2), (m3, a3), (ftm, fta) = pm(v[1]), pm(v[2]), pm(v[3])
                n = lambda s: int(s) if re.fullmatch(r"-?\d+", s or "") else 0     # noqa: E731
                hh, mm, ss = (list(map(int, re.findall(r"\d+", v[14]))) + [0, 0, 0])[:3]
                mins = hh * 60 + mm
                r = dict(Season=season, Gamecode=game["gameCode"], Home=home, Player_ID=pid.group(1),
                         IsStarter=0, IsPlaying=int(mins * 60 + ss > 0), Team=team,
                         Dorsal=int(dorsal.group(1)) if dorsal else None,
                         Player=f"{last}, {first}" if first else last,
                         Minutes=f"{mins:02d}:{ss:02d}" if mins * 60 + ss > 0 else "DNP",
                         Points=n(v[0]), FieldGoalsMade2=m2, FieldGoalsAttempted2=a2, FieldGoalsMade3=m3,
                         FieldGoalsAttempted3=a3, FreeThrowsMade=ftm, FreeThrowsAttempted=fta,
                         TotalRebounds=n(v[4]), DefensiveRebounds=n(v[5]), OffensiveRebounds=n(v[6]),
                         Assistances=n(v[7]), BlocksFavour=n(v[8]), BlocksAgainst=n(v[9]),
                         FoulsReceived=n(v[10]),   # "FOULS F" = Κερδισμένα φάουλ
                         FoulsCommited=n(v[11]),   # "FOULS M" = Αμυντικά φάουλ (που έκανε)
                         Steals=n(v[12]), Turnovers=n(v[13]), Valuation=n(v[15]), Plusminus=None)
                rows.append(r)
        return rows

    # ---------- κύρια ροή ----------
    def run(self, seasons: list[int]):
        champs = self.championships()
        print("ESAKE championships:", champs)
        for s in seasons:
            if s not in champs:
                print(f"  ! no championship for {s}")
                continue
            print(f"== GBL {s}-{str(s + 1)[2:]}")
            store = RawStore(CODE, s)
            games = self.season_games(champs[s], s)
            if games.empty:
                print("  ! no games parsed")
                continue
            store.save_games(games)
            have = store.cached_gamecodes()
            todo = games[games.played & games.idgame.notna() & ~games.gameCode.isin(have)]
            print(f"  box scores: {len(have)} cached, {len(todo)} to download")
            rows = []
            for i, g in enumerate(todo.to_dict("records"), 1):
                page = self.http.text(f"{BASE}/el/action/EsakegameView?idgame={g['idgame']}&mode=3")
                if page:
                    rows += self.parse_box(page, s, g)
                if i % 25 == 0:
                    print(f"    {i}/{len(todo)}")
                    store.append_box(rows); rows = []
            store.append_box(rows)


if __name__ == "__main__":
    from config import SEASONS
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, nargs="*", default=SEASONS)
    EsakeScraper().run(ap.parse_args().season)
