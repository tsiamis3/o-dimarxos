"""
Play-by-play EuroLeague / EuroCup (live.euroleague.net/api/PlaybyPlay) για το RAPM.

Κρατά μόνο ό,τι χρειάζεται για να ξαναχτιστούν οι πεντάδες (stints) και το σκορ:
  gameCode, n (σειρά), period, mt (χρόνος στο ρολόι), team, pid, pt (τύπος γεγονότος), pa, pb (σκορ)
Τα stints (ποιοι 10 ήταν στο παρκέ και τι έγινε) υπολογίζονται στο scripts/stints.py.

Έξοδος: data/raw/{C}{season}_pbp.csv.gz   (incremental, μόνο νέα ματς)

    python scripts/scrapers/pbp.py                 # E, U, όλες οι σεζόν
    python scripts/scrapers/pbp.py --comp E --probe 2
"""
import argparse
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config import RAW_DIR, SEASONS  # noqa: E402
from shots import _played  # noqa: E402

COLS = ["gameCode", "n", "period", "mt", "team", "pid", "pt", "pa", "pb"]


def rows_of(df: pd.DataFrame, gc: int) -> pd.DataFrame:
    out = pd.DataFrame({
        "gameCode": gc, "n": df["TRUE_NUMBEROFPLAY"], "period": df["PERIOD"],
        "mt": df.get("MARKERTIME", ""), "team": df.get("CODETEAM", ""),
        "pid": df.get("PLAYER_ID", ""), "pt": df.get("PLAYTYPE", ""),
        "pa": pd.to_numeric(df.get("POINTS_A"), errors="coerce"),
        "pb": pd.to_numeric(df.get("POINTS_B"), errors="coerce"),
    })
    return out[COLS]


def run(comp, seasons, probe=0):
    from euroleague_api.play_by_play_data import PlayByPlay
    api = PlayByPlay(comp)
    for s in seasons:
        path = RAW_DIR / f"{comp}{s}_pbp.csv.gz"
        old = pd.read_csv(path) if path.exists() else pd.DataFrame(columns=COLS)
        have = set(old.gameCode.astype(int)) if len(old) else set()
        todo = [gc for gc in _played(comp, s) if gc not in have]
        if probe:
            todo = todo[:probe]
        print(f"== {comp}{s} pbp: {len(have)} cached, {len(todo)} to download")
        frames = []
        for i, gc in enumerate(todo, 1):
            df = None
            for attempt in range(6):                     # 429 -> αναμονή και ξανά
                try:
                    df = api.get_game_play_by_play_data(s, gc)
                    break
                except Exception as e:  # noqa: BLE001
                    if "429" in str(e) and attempt < 5:
                        time.sleep(30 * (attempt + 1))
                        continue
                    print(f"    ! {gc}: {e}")
                    break
            if df is not None and len(df):
                if probe:
                    print(df.columns.tolist())
                    print(df.PLAYTYPE.value_counts().to_string())
                    print(df.head(12).to_string())
                frames.append(rows_of(df, gc))
            if not probe and (i % 50 == 0 or i == len(todo)) and frames:
                cur = pd.read_csv(path) if path.exists() else pd.DataFrame(columns=COLS)
                out = pd.concat([cur, *frames], ignore_index=True)
                out.to_csv(path, index=False, compression="gzip")
                print(f"    {i}/{len(todo)} -> {path.name}: {out.gameCode.nunique()} games")
                frames = []
            time.sleep(0.6)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--comp", nargs="*", default=["E", "U"])
    ap.add_argument("--probe", type=int, default=0)
    a = ap.parse_args()
    for c in a.comp:
        run(c, SEASONS[-1:] if a.probe else SEASONS, a.probe)
