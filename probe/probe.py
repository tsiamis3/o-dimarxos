"""Προσωρινό: τρίτος γύρος — αποθηκεύει σελίδες για μελέτη (probe/pages/)."""
import re
from pathlib import Path
from urllib.parse import urljoin

import requests

OUT = Path("probe/pages"); OUT.mkdir(parents=True, exist_ok=True)
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
                  "Accept-Language": "el-GR,el;q=0.9"})


def get(url):
    try:
        r = S.get(url, timeout=30)
        return r.content.decode("utf-8", "replace"), r.status_code
    except Exception as e:  # noqa: BLE001
        return f"ERROR {e}", 0


def save(name, url):
    t, st = get(url)
    (OUT / f"{name}.html").write_text(f"<!-- {url} status {st} -->\n" + t, encoding="utf-8")
    print(name, st, len(t), url)
    return t


def links(html, base, pat):
    out = []
    for href, txt in re.findall(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", html, re.S | re.I):
        txt = re.sub(r"<[^>]+>", " ", txt).strip()
        if re.search(pat, href + " " + txt, re.I):
            out.append((urljoin(base, href), re.sub(r"\s+", " ", txt)[:80]))
    return list(dict.fromkeys(out))


# ---------------- ESAKE ----------------
B = "https://www.esake.gr"
save("esake_results", B + "/el/action/EsakeResults")
save("esake_results_m1", B + "/el/action/EsakeResults?mode=1")
save("esake_results_m2", B + "/el/action/EsakeResults?mode=2")
save("esake_game_m3", B + "/el/action/EsakegameView?idgame=2FCC32F1&mode=3")
save("esake_stats", B + "/el/action/EsakeStats?mode=")

# ---------------- basket.gr ----------------
G = "https://www.basket.gr"
home = save("basketgr_home", G + "/")
champ = links(home, G, r"2026-2027|champs|πρωτάθλ")
print("CHAMP LINKS:", *champ[:40], sep="\n  ")
seen = 0
for url, txt in champ:
    if "2026-2027" in url + txt and seen < 3:
        page = save(f"basketgr_champ_{seen}", url); seen += 1
        sub = links(page, url, r"a2|α2|γυναικ|women|gyn")
        print("  SUB:", *sub[:30], sep="\n    ")
        for j, (u2, t2) in enumerate(sub[:4]):
            p2 = save(f"basketgr_champ_{seen}_{j}", u2)
            games = links(p2, u2, r"game|agon|αγων|match|stats\.basket|boxscore")
            print("    GAMES:", *games[:15], sep="\n      ")
            if games:
                save(f"basketgr_game_{seen}_{j}", games[0][0])
# JS that may contain EventSource / SSE
for m in set(re.findall(r"<script[^>]+src=[\"']([^\"']+basket\.gr[^\"']+\.js[^\"']*)", home))[:30]:
    t, _ = get(m)
    if re.search(r"EventSource|text/event-stream|sse", t, re.I):
        print("SSE JS:", m)
        (OUT / ("js_" + re.sub(r"\W", "_", m)[-60:] + ".js")).write_text(t, encoding="utf-8")
