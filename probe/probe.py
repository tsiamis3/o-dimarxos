"""Προσωρινό: δεύτερος γύρος — δομή σελίδων/endpoints."""
import json
import re

import requests

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "el-GR,el;q=0.9,en;q=0.8"}
S = requests.Session(); S.headers.update(UA)


def strip(html, n=1500):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", t)[:n]


def show(name, url, n=1500, grep=None):
    print(f"\n===== {name}: {url}")
    try:
        r = S.get(url, timeout=25)
    except Exception as e:  # noqa: BLE001
        print("ERROR", e); return None
    ct = r.headers.get("content-type", "")
    print("STATUS", r.status_code, "|", ct, "| bytes", len(r.content), "| final", r.url)
    t = r.text
    if "json" in ct:
        print(t[:n]); return r
    scripts = sorted(set(re.findall(r"<script[^>]+src=[\"']([^\"']+)", t)))
    print("SCRIPTS:", *scripts[:25], sep="\n  ")
    js = sorted(set(re.findall(r"""["'`]((?:https?:)?/[^"'`\s]*(?:api|ajax|json|sse|stream|data|feed|action|stats)[^"'`\s]*)["'`]""", t, re.I)))
    print("URLS IN PAGE:", *js[:60], sep="\n  ")
    if grep:
        for m in re.finditer(grep, t, re.I):
            print("GREP:", t[max(0, m.start() - 200): m.end() + 300].replace("\n", " "))
            break
    tables = re.findall(r"<table.*?</table>", t, re.S | re.I)
    print("TABLES:", len(tables))
    for tb in tables[:2]:
        print("  TABLE TEXT:", strip(tb, 700))
    print("TEXT:", strip(t, n))
    return r


# ---------- ESAKE ----------
show("esake-results", "https://www.esake.gr/el/action/EsakeResults", grep=r"idgame|season|round")
show("esake-game-m2", "https://www.esake.gr/el/action/EsakegameView?idgame=2FCC32F1&mode=2")
show("esake-game-m3", "https://www.esake.gr/el/action/EsakegameView?idgame=2FCC32F1&mode=3")
show("esake-stats", "https://www.esake.gr/el/action/EsakeStats?mode=", grep=r"season|idseason")

# ---------- basket.gr ----------
show("stats-basketgr", "https://stats.basket.gr/", grep=r"EventSource|fetch\(|axios|api")
show("basketgr-stats-women", "https://www.basket.gr/stats-women/", grep=r"stats\.basket\.gr|iframe|EventSource|api")
show("basketgr-all-games", "https://www.basket.gr/all-games/", grep=r"stats\.basket\.gr|iframe|api|game")

# ---------- ESPN NBA ----------
sb = S.get("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261105", timeout=25).json()
evs = sb.get("events", [])
print("\n===== espn scoreboard 2026-11-05: events", len(evs))
if evs:
    e = evs[0]
    print("event keys:", list(e.keys()), "| id", e["id"], "|", e["name"], "|", e["date"], "|", e["status"]["type"]["name"])
    sm = S.get(f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event={e['id']}", timeout=25).json()
    print("summary keys:", list(sm.keys()))
    bp = sm["boxscore"]["players"][0]
    print("team:", bp["team"]["abbreviation"], "| stat groups:", len(bp["statistics"]))
    st = bp["statistics"][0]
    print("labels:", st.get("labels")); print("names:", st.get("names")); print("keys:", st.get("keys"))
    print("first athlete:", json.dumps(st["athletes"][0])[:700])
