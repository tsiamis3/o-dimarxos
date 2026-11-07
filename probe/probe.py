"""Προσωρινό: τέταρτος γύρος — apps.basket.gr (stats app της ΕΟΚ) + ESAKE results ανά αγωνιστική."""
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


def save(name, url, **kw):
    try:
        r = S.get(url, timeout=30, **kw)
        t, st, ct = r.content.decode("utf-8", "replace"), r.status_code, r.headers.get("content-type", "")
    except Exception as e:  # noqa: BLE001
        t, st, ct = f"ERROR {e}", 0, ""
    ext = "json" if "json" in ct else ("txt" if "event-stream" in ct else "html")
    (OUT / f"{name}.{ext}").write_text(t, encoding="utf-8")
    print(name, st, ct, len(t), url)
    return t


A = "https://apps.basket.gr"
p = save("apps_standings_12", A + "/iframe/seasons/12/standings")
save("apps_root", A + "/")
# όλα τα links / scripts της σελίδας
hrefs = sorted(set(urljoin(A, h) for h in re.findall(r"(?:href|src)=[\"']([^\"'#]+)", p)))
print("HREFS:", *hrefs[:80], sep="\n  ")
for i, js in enumerate([h for h in hrefs if h.endswith(".js") or ".js?" in h][:12]):
    t = save(f"apps_js_{i}", js)
    for m in sorted(set(re.findall(r"""["'`](/(?:api|iframe|sse|stream|events)[^"'`\s]{0,120})["'`]""", t)))[:80]:
        print("   API PATH:", m)
# πιθανά routes
for i, path in enumerate(["/iframe/seasons/12/games", "/iframe/seasons/12/schedule", "/iframe/seasons/12/results",
                          "/iframe/seasons/12/stats", "/iframe/seasons/12/players", "/iframe/seasons/12/teams",
                          "/iframe/seasons", "/api/seasons", "/api/seasons/12", "/api/seasons/12/games",
                          "/api/competitions", "/iframe/seasons/11/standings", "/iframe/seasons/13/standings"]):
    save(f"apps_try_{i}", A + path)

# basket.gr wbl1 & livescore (μπορεί να έχουν iframes)
for n, u in [("basketgr_wbl1", "https://www.basket.gr/wbl1/"), ("basketgr_livescore", "https://www.basket.gr/livescore/")]:
    t = save(n, u)
    print("  IFRAMES:", *re.findall(r"<iframe[^>]+src=[\"']([^\"']+)", t), sep="\n    ")

# ESAKE: results για συγκεκριμένη αγωνιστική / σεζόν
B = "https://www.esake.gr"
t = save("esake_results", B + "/el/action/EsakeResults")
for i, m in enumerate(sorted(set(re.findall(r"EsakeResults\?[^\"'\s<>]+", t)))[:20]):
    print("  ESAKE RESULTS LINK:", m)
print("  onclick/series:", *sorted(set(re.findall(r"""(?:onclick|data-[a-z]+)=["'][^"']*(?:series|idseason|champ)[^"']*["']""", t)))[:20], sep="\n    ")
