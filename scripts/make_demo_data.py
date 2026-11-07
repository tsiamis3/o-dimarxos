"""
Συνθετικά (ψεύτικα) δεδομένα στο ΙΔΙΟ format με το API, για τοπικό test
χωρίς internet. Ομάδες και παίκτες είναι φανταστικοί.

    python scripts/make_demo_data.py
"""
import numpy as np
import pandas as pd

from config import RAW_DIR, SEASONS

RNG = np.random.default_rng(7)
CITIES = ["Athens", "Thessaloniki", "Belgrade", "Madrid", "Barcelona", "Istanbul", "Milan",
          "Munich", "Paris", "Tel Aviv", "Kaunas", "Vitoria", "Valencia", "Monaco", "Berlin",
          "Bologna", "Lyon", "Zagreb", "Ljubljana", "Gran Canaria"]
NICK = ["Owls", "Comets", "Wolves", "Falcons", "Titans", "Sharks", "Storm", "Lions", "Rockets",
        "Bears", "Eagles", "Pirates", "Knights", "Foxes", "Hornets", "Bulls", "Ravens", "Tigers",
        "Waves", "Giants"]
FIRST = ["Nikos", "Marko", "Luka", "Jordan", "Alex", "Kostas", "Mateo", "Jonas", "Ivan", "Dario",
         "Tyler", "Sergio", "Mike", "Petar", "Lorenzo", "Theo", "Facundo", "Rudy", "Kevin", "Elias"]
LAST = ["Papadakis", "Jovic", "Ruiz", "Novak", "Kuric", "Moreau", "Larsen", "Bianchi", "Okafor",
        "Silva", "Horvat", "Kaya", "Weber", "Dimitriou", "Nunez", "Petrovic", "Costa", "Fischer",
        "Andersen", "Ivanov", "Rossi", "Marin", "Lopez", "Volkov"]


class DemoLeague:
    def __init__(self, comp: str, n_teams: int):
        self.comp = comp
        idx = RNG.permutation(len(CITIES))[:n_teams]
        self.teams = []
        for k, i in enumerate(idx):
            code = (comp + CITIES[i][:2] + NICK[(i + k) % len(NICK)][0]).upper()
            self.teams.append(dict(code=code, name=f"{CITIES[i]} {NICK[(i + k) % len(NICK)]}",
                                   off=RNG.normal(0, 0.06), deff=RNG.normal(0, 0.06), players=[]))
        self.next_pid = 1
        for t in self.teams:
            for j in range(12):
                t["players"].append(self._new_player(j))

    def _new_player(self, rank: int) -> dict:
        pid = f"P{self.comp}{self.next_pid:05d}"
        self.next_pid += 1
        role = max(0.25, 1.15 - rank * 0.08 + RNG.normal(0, 0.1))  # βασικοί -> πολλά λεπτά
        big = RNG.random() < 0.35
        return dict(
            pid=pid, name=f"{RNG.choice(LAST).upper()}, {RNG.choice(FIRST).upper()}",
            dorsal=int(RNG.integers(0, 55)), role=role, form=0.0,
            usg=RNG.uniform(0.7, 1.4), three=0.15 if big else RNG.uniform(0.3, 0.6),
            p2=RNG.uniform(0.5, 0.64) if big else RNG.uniform(0.44, 0.56),
            p3=RNG.uniform(0.28, 0.42), pft=RNG.uniform(0.6, 0.9),
            reb=RNG.uniform(1.4, 2.2) if big else RNG.uniform(0.5, 1.1),
            ast=RNG.uniform(0.2, 0.5) if big else RNG.uniform(0.5, 1.6),
        )

    def offseason(self):
        """Μικρές αλλαγές ρόστερ/δυναμικότητας ανάμεσα στις σεζόν."""
        for t in self.teams:
            t["off"] = 0.6 * t["off"] + RNG.normal(0, 0.04)
            t["deff"] = 0.6 * t["deff"] + RNG.normal(0, 0.04)
            for j in range(len(t["players"])):
                if RNG.random() < 0.3:
                    t["players"][j] = self._new_player(j)

    def _box(self, team, opp, home, season, gc, mins_scale=1.0):
        rows = []
        ps = team["players"]
        for p in ps:  # random-walk "φόρμα" -> αυτό που πρέπει να μάθει το μοντέλο
            p["form"] = 0.85 * p["form"] + RNG.normal(0, 0.12)
        w = np.array([max(0.05, p["role"] * (1 + 0.5 * p["form"]) + RNG.normal(0, 0.12)) for p in ps])
        dnp = RNG.random(len(ps)) < np.where(w < 0.45, 0.45, 0.04)
        w[dnp] = 0
        minutes = 200 * w / w.sum() * mins_scale
        minutes = np.minimum(minutes, 38)
        minutes *= 200 / minutes.sum()
        starters = set(np.argsort(-minutes)[:5])
        f = np.exp(team["off"] - opp["deff"] + (0.03 if home else -0.03))
        for k, p in enumerate(ps):
            m = minutes[k]
            if m <= 0.5:
                rows.append(dict(Player_ID=p["pid"], Player=p["name"], Minutes="DNP", IsStarter=0))
                continue
            rate = m / 40 * p["usg"] * (1 + 0.35 * p["form"])
            fga = RNG.poisson(13 * rate)
            a3 = RNG.binomial(fga, p["three"]); a2 = fga - a3
            m2 = RNG.binomial(a2, min(0.75, p["p2"] * f)); m3 = RNG.binomial(a3, min(0.6, p["p3"] * f))
            fta = RNG.poisson(3.2 * rate); ftm = RNG.binomial(fta, p["pft"])
            orb = RNG.poisson(1.6 * m / 40 * p["reb"]); drb = RNG.poisson(4.4 * m / 40 * p["reb"])
            ast = RNG.poisson(4.2 * m / 40 * p["ast"] * (1 + 0.3 * p["form"]))
            stl = RNG.poisson(1.1 * m / 40); tov = RNG.poisson(2.1 * rate)
            blk = RNG.poisson(0.5 * m / 40 * p["reb"]); blka = RNG.poisson(0.4 * m / 40)
            pf = RNG.poisson(3.0 * m / 40); fd = RNG.poisson(3.0 * rate)
            pts = 2 * m2 + 3 * m3 + ftm
            pir = (pts + orb + drb + ast + stl + blk + fd
                   - (a2 - m2) - (a3 - m3) - (fta - ftm) - tov - blka - pf)
            rows.append(dict(
                Player_ID=p["pid"], Player=p["name"], IsStarter=int(k in starters),
                Minutes=f"{int(m):02d}:{int((m % 1) * 60):02d}", Points=pts,
                FieldGoalsMade2=m2, FieldGoalsAttempted2=a2, FieldGoalsMade3=m3, FieldGoalsAttempted3=a3,
                FreeThrowsMade=ftm, FreeThrowsAttempted=fta, OffensiveRebounds=orb, DefensiveRebounds=drb,
                TotalRebounds=orb + drb, Assistances=ast, Steals=stl, Turnovers=tov, BlocksFavour=blk,
                BlocksAgainst=blka, FoulsCommited=pf, FoulsReceived=fd, Valuation=pir))
        df = pd.DataFrame(rows)
        df.insert(0, "Season", season); df.insert(1, "Gamecode", gc); df.insert(2, "Home", int(home))
        df["Team"] = team["code"]; df["IsPlaying"] = (df["Minutes"] != "DNP").astype(int)
        df["Dorsal"] = [p["dorsal"] for p in ps]
        return df

    def season(self, season: int, played_rounds: int | None):
        n = len(self.teams)
        idx = list(range(n))
        fixtures = []  # double round robin (circle method)
        for r in range(n - 1):
            pairs = [(idx[i], idx[n - 1 - i]) for i in range(n // 2)]
            fixtures.append([(a, b) if r % 2 else (b, a) for a, b in pairs])
            idx = [idx[0]] + [idx[-1]] + idx[1:-1]
        fixtures += [[(b, a) for a, b in rnd] for rnd in fixtures]
        start = pd.Timestamp(f"{season}-09-20")
        games, boxes, gc = [], [], 0
        for r, rnd in enumerate(fixtures, 1):
            day = start + pd.Timedelta(days=7 * (r - 1) + (2 if r % 2 else 0))
            played = played_rounds is None or r <= played_rounds
            for h, a in rnd:
                gc += 1
                H, A = self.teams[h], self.teams[a]
                g = dict(gameCode=gc, Round=r, date=day.strftime("%Y-%m-%d"), time="20:30",
                         homecode=H["code"], hometeam=H["name"], awaycode=A["code"], awayteam=A["name"],
                         homescore=np.nan, awayscore=np.nan, played=played)
                if played:
                    while True:
                        bh = self._box(H, A, True, season, gc); ba = self._box(A, H, False, season, gc)
                        if bh.Points.sum() != ba.Points.sum():
                            break
                    hs, as_ = int(bh.Points.sum()), int(ba.Points.sum())
                    for b, diff in ((bh, hs - as_), (ba, as_ - hs)):
                        mins = pd.to_numeric(b.Minutes.str.replace("DNP", "0:0").str.split(":").str[0])
                        b["Plusminus"] = np.where(mins > 0, np.round(diff * mins / 200 * 5 / 5 + RNG.normal(0, 4, len(b))), np.nan)
                    boxes += [bh, ba]
                    g.update(homescore=hs, awayscore=as_)
                games.append(g)
        return pd.DataFrame(games), pd.concat(boxes, ignore_index=True)


def main():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / ".demo").write_text("synthetic data\n")  # σήμα στο site ότι είναι demo
    for comp, n in (("E", 18), ("U", 20)):
        lg = DemoLeague(comp, n)
        for s in SEASONS:
            last = s == SEASONS[-1]
            games, box = lg.season(s, played_rounds=7 if last else None)
            games.to_csv(RAW_DIR / f"{comp}{s}_games.csv", index=False)
            box.to_csv(RAW_DIR / f"{comp}{s}_box.csv.gz", index=False, compression="gzip")
            print(comp, s, len(games), "games", len(box), "box rows")
            lg.offseason()


if __name__ == "__main__":
    main()
