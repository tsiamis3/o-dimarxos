"""
Scraper για τα πρωταθλήματα της ΕΟΚ μέσω του apps.basket.gr (iframe JSON της ΕΟΚ).

Δίνει ΠΡΟΓΡΑΜΜΑ και ΑΠΟΤΕΛΕΣΜΑΤΑ (σκορ ομάδων) ανά αγωνιστική. Στατιστικά παικτών
(box scores) δεν δημοσιεύονται σε αυτό το σύστημα, οπότε γράφεται μόνο το *_games.csv.

Ροή:
  /iframe/seasons/{sid}/standings?competition_id={cid}  -> όμιλοι (data-group-id)
  /iframe/groups/{gid}/standings                        -> αγωνιστικές (matchweeks)
  /iframe/matchweeks/{mw}/matches                       -> κάρτες αγώνων (ημ/νία, ομάδες, σκορ)

Διοργανώσεις (competition_id): 1 Elite League, 2 National League 1, 3 National League 2,
4 Women's Basketball League 1 (Α1), 5 Women's Basketball League 2 (Α2), 119 Women's National League.

    python scripts/scrapers/eok_apps.py                       # Α2 γυναικών, τρέχουσα σεζόν
    python scripts/scrapers/eok_apps.py --comp 4 --code WBL1  # Α1 γυναικών
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

BASE = "https://apps.basket.gr"
SEASON_ID_OFFSET = 2014     # season_id 12 = 2026-27 στο σύστημα της ΕΟΚ


def _txt(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def team_code(name: str) -> str:
    """Σταθερός σύντομος κωδικός ομάδας από το όνομα (η ΕΟΚ δεν δίνει κωδικούς εδώ)."""
    return f"T{zlib.crc32(name.encode()) % 10**6:06d}"


class EokScraper:
    def __init__(self, competition_id: int, code: str):
        self.cid, self.code = competition_id, code
        self.http = Http(sleep=0.3, headers={"X-Requested-With": "XMLHttpRequest"})

    def groups(self, sid: int) -> list[str]:
        page = self.http.text(f"{BASE}/iframe/seasons/{sid}/standings?competition_id={self.cid}") or ""
        return sorted(set(re.findall(r'data-group-id="(\d+)"', page)))

    def matchweeks(self, gid: str) -> list[tuple[str, int]]:
        j = self.http.json(f"{BASE}/iframe/groups/{gid}/standings") or {}
        opts = re.findall(r'<option[^>]*value="(\d+)"[^>]*>\s*(\d+)', j.get("html", ""))
        return [(v, int(n)) for v, n in opts]

    @staticmethod
    def parse_cards(h: str, rnd: int, gid: str) -> list[dict]:
        out = []
        for card in h.split('<div class="match-card">')[1:]:
            info = [_txt(x) for x in re.findall(r'match-card-info-row">(.*?)</div>', card, re.S)]
            teams = [_txt(x) for x in re.findall(r'match-card-score-first-column">.*?<span>(.*?)</span>', card, re.S)]
            scores = [_txt(x) for x in re.findall(r'match-card-score-second-column">\s*<span>(.*?)</span>', card, re.S)]
            if len(teams) < 2:
                continue
            d = re.match(r"(\d{2})/(\d{2})/(\d{4})", info[0] if info else "")
            date = f"{d.group(3)}-{d.group(2)}-{d.group(1)}" if d else None
            sc = [int(s) if s.isdigit() else None for s in (scores + ["", ""])[:2]]
            played = sc[0] is not None and sc[1] is not None and (sc[0] + sc[1]) > 0
            out.append(dict(gameCode=zlib.crc32(f"{gid}|{rnd}|{teams[0]}|{teams[1]}".encode()) % 10**9,
                            Round=rnd, date=date, time=info[1] if len(info) > 1 else "",
                            homecode=team_code(teams[0]), hometeam=teams[0],
                            awaycode=team_code(teams[1]), awayteam=teams[1],
                            homescore=sc[0] if played else None, awayscore=sc[1] if played else None,
                            played=played, group=gid, venue=info[2] if len(info) > 2 else ""))
        return out

    def run(self, seasons: list[int]):
        for s in seasons:
            sid = s - SEASON_ID_OFFSET
            print(f"== {self.code} {s}-{str(s + 1)[2:]} (season_id {sid}, competition {self.cid})")
            games = []
            for gid in self.groups(sid):
                for mw, rnd in self.matchweeks(gid):
                    j = self.http.json(f"{BASE}/iframe/matchweeks/{mw}/matches") or {}
                    games += self.parse_cards(j.get("html", ""), rnd, gid)
            if not games:
                print("  ! no games found")
                continue
            df = pd.DataFrame(games)
            RawStore(self.code, s).save_games(df)
            # επιπλέον: οι όμιλοι/γήπεδα σε ξεχωριστό αρχείο (το games.csv κρατά το κοινό format)
            df[["gameCode", "group", "venue"]].to_csv(RawStore(self.code, s).games_path.with_name(
                f"{self.code}{s}_meta.csv"), index=False)


if __name__ == "__main__":
    from config import current_season
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", type=int, default=5, help="competition_id της ΕΟΚ (5 = Α2 γυναικών)")
    ap.add_argument("--code", default="WBL2", help="κωδικός για τα αρχεία")
    ap.add_argument("--season", type=int, nargs="*", default=[current_season()])
    a = ap.parse_args()
    EokScraper(a.comp, a.code).run(a.season)
