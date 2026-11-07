"""Προσωρινό: έκτος γύρος — JSON endpoints apps.basket.gr και box score αγώνα."""
import json
import re
from pathlib import Path

import requests

OUT = Path("probe/pages"); OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob("*"):
    f.unlink()
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
                  "Accept-Language": "el-GR,el;q=0.9", "X-Requested-With": "XMLHttpRequest"})
A = "https://apps.basket.gr"


def get(name, url):
    try:
        r = S.get(url, timeout=30)
        t, st, ct = r.content.decode("utf-8", "replace"), r.status_code, r.headers.get("content-type", "")
    except Exception as e:  # noqa: BLE001
        t, st, ct = f"ERROR {e}", 0, ""
    (OUT / f"{name}.txt").write_text(f"{url} | {st} | {ct}\n{t}", encoding="utf-8")
    print(f"{name:28s} {st} {ct[:30]:30s} {len(t):7d} {url}")
    return t, st, ct


# 1) λίστα αγώνων WBL2 ανά "φάση/matchweek"
t, st, ct = get("mw_566", A + "/iframe/matchweeks/566/matches")
t2, *_ = get("grp_798", A + "/iframe/groups/798/standings")
# 2) αγώνες από livescores (ημέρα με WBL2)
lv, *_ = get("live_0711", A + "/iframe/livescores?date=07/11/2026")
ids = sorted(set(re.findall(r'data-match[-_]id="?(\d+)', lv)))
print("match ids:", ids[:40])
info, *_ = get("matches_info", A + "/iframe/livescores/get-matches-info?match_ids=" + ",".join(ids[:40]))
try:
    j = json.loads(info)
    print("info type", type(j).__name__, "sample:", json.dumps(j if isinstance(j, dict) else j[:2], ensure_ascii=False)[:1500])
except Exception as e:  # noqa: BLE001
    print("info not json", e)
# 3) υποψήφια routes box score για έναν αγώνα
mid = ids[0] if ids else "19291"
for i, p in enumerate([f"/iframe/matches/{mid}", f"/iframe/matches/{mid}/boxscore", f"/iframe/matches/{mid}/stats",
                       f"/iframe/matches/{mid}/statistics", f"/matches/{mid}", f"/iframe/match/{mid}",
                       f"/iframe/livescores/{mid}", f"/iframe/livescores/match/{mid}", f"/iframe/boxscore/{mid}",
                       f"/iframe/matches/{mid}/player-stats", f"/iframe/livescores/get-match-stats?match_id={mid}",
                       f"/iframe/livescores/get-boxscore?match_id={mid}"]):
    get(f"try_{i}", A + p)
# 4) links μέσα στο livescore προς λεπτομέρειες αγώνα
print("detail links:", sorted(set(re.findall(r"""["'](/[^"']*(?:match|game|box|stat)[^"']*)["']""", lv)))[:30])
print("onclick:", sorted(set(re.findall(r"""onclick=["']([^"']{0,120})""", lv)))[:15])
