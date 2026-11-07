"""Προσωρινό: πέμπτος γύρος — WBL2 (Α2 γυναικών) στο apps.basket.gr + δομή box score ΕΣΑΚΕ."""
import re
from pathlib import Path
from urllib.parse import urljoin

import requests

OUT = Path("probe/pages"); OUT.mkdir(parents=True, exist_ok=True)
for f in OUT.glob("*"):
    f.unlink()
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
                  "Accept-Language": "el-GR,el;q=0.9"})


def save(name, url, stream=False):
    try:
        if stream:   # SSE: διάβασε μόνο τα πρώτα ~20KB
            r = S.get(url, timeout=20, stream=True); buf = b""
            for chunk in r.iter_content(2048):
                buf += chunk
                if len(buf) > 20000: break
            t = buf.decode("utf-8", "replace")
        else:
            r = S.get(url, timeout=30); t = r.content.decode("utf-8", "replace")
        st, ct = r.status_code, r.headers.get("content-type", "")
    except Exception as e:  # noqa: BLE001
        t, st, ct = f"ERROR {e}", 0, ""
    (OUT / f"{name}.html").write_text(f"<!-- {url} | {st} | {ct} -->\n{t}", encoding="utf-8")
    print(name, st, ct, len(t), url)
    return t


A = "https://apps.basket.gr"
save("esake_game_m3", "https://www.esake.gr/el/action/EsakegameView?idgame=2FCC32F1&mode=3")
st = save("apps_standings_wbl2", A + "/iframe/seasons/12/standings?competition_id=5")
lv = save("apps_livescores", A + "/iframe/livescores")
fl = save("basketgr_live_file", "https://basket.gr/files/live/data/livescore.html")
for name, t, base in [("standings", st, A), ("livescores", lv, A), ("livefile", fl, "https://basket.gr/files/live/data/")]:
    urls = sorted(set(urljoin(base, h) for h in re.findall(r"""(?:href|src|url|EventSource\()\s*[=(]?\s*["']([^"'#]+)["']""", t)))
    print(f"  [{name}] URLS:", *[u for u in urls if not re.search(r"\.(css|png|jpg|svg|woff)", u)][:50], sep="\n    ")
    for m in re.findall(r"(?:EventSource|fetch|\$\.(?:get|ajax|getJSON)|axios)[^;]{0,200}", t)[:10]:
        print("   JS CALL:", m)
# πιθανά endpoints από livescore.html (π.χ. .json / sse)
for i, u in enumerate(sorted(set(re.findall(r"""["']([^"']+\.(?:json|php)[^"']*)["']""", fl)))[:8]):
    save(f"live_dep_{i}", urljoin("https://basket.gr/files/live/data/", u), stream="sse" in u or "stream" in u)
