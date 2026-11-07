"""Προσωρινό: ελέγχει ποιες πηγές δεδομένων απαντούν από το GitHub Actions."""
import re
import sys

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "el-GR,el;q=0.9,en;q=0.8"}
NBA_STATS_H = {**UA, "Referer": "https://www.nba.com/", "Origin": "https://www.nba.com",
               "x-nba-stats-origin": "stats", "x-nba-stats-token": "true", "Accept": "application/json"}

URLS = [
    # ---- NBA ----
    ("nba-cdn-schedule", "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json", UA),
    ("nba-cdn-scoreboard", "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json", UA),
    ("nba-stats-gamelog", "https://stats.nba.com/stats/leaguegamelog?Counter=0&Direction=ASC&LeagueID=00&PlayerOrTeam=P&Season=2025-26&SeasonType=Regular%20Season&Sorter=DATE", NBA_STATS_H),
    ("espn-nba-scoreboard", "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", UA),
    # ---- Greek Basket League ----
    ("esake-home", "https://www.esake.gr/", UA),
    ("esake-en", "https://www.esake.gr/en", UA),
    ("3steps-esake", "https://3stepsbasket.com/esake/charts", UA),
    ("bbref-gbl", "https://www.basketball-reference.com/international/greek-basket-league/", UA),
    # ---- basket.gr / ΕΟΚ ----
    ("basketgr-home", "https://www.basket.gr/", UA),
    ("eok-home", "https://www.eok.gr/", UA),
    # ---- generic ----
    ("espn-gbl", "https://site.api.espn.com/apis/site/v2/sports/basketball/greek.1/scoreboard", UA),
]

KEY = re.compile(r"""(?:href|src|action|url|endpoint|EventSource)\s*[=:(]\s*["']([^"']*(?:api|json|stat|game|match|box|sse|stream|event|champ|league|competition|fixture|result|livestats|genius)[^"']*)["']""", re.I)
HOSTS = re.compile(r"https?://[a-z0-9.-]*(?:api|stats|genius|fiba|livestats|sse|data|feeds|cdn)[a-z0-9.-]*\.[a-z]{2,}[^\s\"'<>]*", re.I)

for name, url, h in URLS:
    print(f"\n===== {name}: {url}")
    try:
        r = requests.get(url, headers=h, timeout=25)
    except Exception as e:  # noqa: BLE001
        print("ERROR", type(e).__name__, str(e)[:200])
        continue
    ct = r.headers.get("content-type", "")
    print("STATUS", r.status_code, "| type", ct, "| bytes", len(r.content), "| final", r.url)
    txt = r.text
    if "json" in ct:
        print("JSON head:", txt[:600].replace("\n", " "))
    else:
        links = sorted(set(KEY.findall(txt)))[:60]
        hosts = sorted(set(HOSTS.findall(txt)))[:40]
        print("TITLE:", (re.search(r"<title>(.*?)</title>", txt, re.S | re.I) or [None, ""])[1].strip()[:120])
        print("LINKS:", *links, sep="\n  ")
        print("HOSTS:", *hosts, sep="\n  ")
sys.exit(0)
