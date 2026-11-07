"""
Κοινές ρυθμίσεις για όλο το pipeline.
Άλλαξε εδώ διαγωνισμούς / σεζόν / στατιστικά-στόχους του μοντέλου.
"""
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "data" / "raw"          # ακατέργαστα CSV από το API (commit-άρονται στο repo)
SITE_DIR = ROOT / "site"                 # ό,τι ανεβαίνει στο GitHub Pages
SITE_DATA = SITE_DIR / "data"            # JSON βάση που διαβάζει το site
MODEL_DIR = ROOT / "models"              # αποθηκευμένο Keras μοντέλο + scalers

COMPETITIONS = {"E": "EuroLeague", "U": "EuroCup"}


def current_season(today: date | None = None) -> int:
    """Η σεζόν 2026-27 έχει κωδικό 2026. Νέα σεζόν θεωρείται από Αύγουστο."""
    today = today or date.today()
    return today.year if today.month >= 8 else today.year - 1


N_SEASONS = 4                            # πόσες σεζόν πίσω κρατάμε στη βάση
SEASONS = list(range(current_season() - N_SEASONS + 1, current_season() + 1))

# Στατιστικά που προβλέπει το μοντέλο (ονόματα στηλών του tidy game log)
TARGETS = ["PTS", "REB", "AST", "PIR", "MIN"]
