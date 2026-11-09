# o-dimarxos

Στατιστικά EuroLeague / EuroCup / GBL / NBA σε GitHub Pages, με επερχόμενα ματς, Monte Carlo αγώνων,
σύγκριση ομάδων/παικτών, αναλύσεις, πλήρη βάση με φίλτρα και (σε εξέλιξη) graph neural network.

## Ενότητες του site

| Ενότητα | Διοργανώσεις | Πηγή | Στατιστικά παικτών |
| --- | --- | --- | --- |
| Ευρώπη | EuroLeague, EuroCup | EuroLeague API | Ναι |
| Ελλάδα | Stoiximan GBL, Α2 Γυναικών | esake.gr, apps.basket.gr (ΕΟΚ) | GBL ναι, Α2 μόνο αποτελέσματα |
| NBA | NBA | ESPN API | Ναι |

Νέα διοργάνωση: scraper που γράφει στο ίδιο format (`scripts/scrapers/common.py`) + μια γραμμή στο
`COMPETITIONS` και στο `SECTIONS` του `scripts/config.py`.

## Δομή

```
scripts/
  config.py          ρυθμίσεις (διοργανώσεις, σεζόν, στόχοι μοντέλου)
  fetch_data.py      κατέβασμα από το EuroLeague API (incremental) -> data/raw/
  dataset.py         raw CSV -> καθαρό game log (κοινό για site + μοντέλο)
  evaluate.py        βοηθητικά αξιολόγησης + απλό Monte Carlo (baseline σύγκρισης)
  ratings.py         κοινή μηχανή ratings (προσαρμοσμένα στον αντίπαλο, απόσβεση, απουσίες)
  gnn_data.py        δεδομένα για το graph neural network (graphs ανά αγώνα) -> data/gnn/, site/data/gnn_preview.json
  stints.py, rapm.py play-by-play -> διαστήματα με σταθερές πεντάδες -> RAPM
  scrapers/pbp.py    play-by-play EuroLeague/EuroCup
  shots_agg.py       σουτ -> εξάγωνα/ζώνες για τα shot charts -> site/data/shots_*.json
  team_meta.py       «βάση» σημάτων ομάδων (συντομογραφία, χρώματα, μελλοντικά εικόνες) -> site/data/teams_meta.json
  scrapers/shots.py  σουτ με συντεταγμένες (EuroLeague/EuroCup API, NBA από ESPN)
  analytics.py       σελίδα «Ανάλυση» -> site/data/analytics_*.json
  edge_model.py      σελίδα «Στοίχημα»: μοντέλο vs αγορά -> site/data/edge_*.json
  scrapers/odds_espn.py, injuries_espn.py   αποδόσεις και τραυματίες NBA (ESPN)
  scrapers/odds_api.py                      αποδόσεις The Odds API (προαιρετικό secret ODDS_API_KEY)
docs/REVIEW.md       αξιολόγηση του project και πρόταση σχεδιασμού
  build_site.py      JSON βάση για το site -> site/data/
  make_demo_data.py  συνθετικά δεδομένα για τοπικό test χωρίς internet
site/                index.html, style.css, app.js (στατικό, χωρίς build step)
.github/workflows/update.yml   καθημερινό fetch -> train -> build -> deploy
```

## Στήσιμο στο GitHub

1. Νέο repo (π.χ. `o-dimarxos`), ανέβασε όλα τα αρχεία (GitHub Desktop: copy στον φάκελο, commit, push).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions → "Update data, train model, deploy site" → Run workflow**.
   Το πρώτο run κατεβάζει 4 σεζόν × 2 διοργανώσεις (~20–40 λεπτά). Μετά τρέχει μόνο του κάθε πρωί
   και κατεβάζει μόνο τα νέα ματς.
4. Το site: `https://<username>.github.io/o-dimarxos/`

## Αισθητική

Όλα τα χρώματα, οι γραμματοσειρές και τα στρογγυλέματα είναι στο `site/theme.css`.
Το όνομα/λογότυπο είναι στο `<h1>` και στο `<title>` του `site/index.html`.
Το `site/style.css` έχει μόνο layout.

## Τοπικά

```bash
pip install -r requirements.txt
python scripts/fetch_data.py          # ή: python scripts/make_demo_data.py
python scripts/analytics.py           # σελίδες Ανάλυση / Παίκτες
python scripts/edge_model.py          # Monte Carlo αγώνων (ratings + απουσίες) και Στοίχημα
python scripts/gnn_data.py            # δεδομένα GNN (χρειάζεται το play-by-play: scripts/scrapers/pbp.py)
python scripts/build_site.py
python -m http.server -d site 8000    # http://localhost:8000
```

## Monte Carlo αγώνων

Το μοναδικό μοντέλο αγώνων. Το `edge_model.py` υπολογίζει κάθε μέρα, walk-forward, για κάθε επερχόμενο ματς
αναμενόμενη διαφορά και σύνολο από ratings επίθεσης/άμυνας/ρυθμού προσαρμοσμένα στον αντίπαλο (ridge με χρονική
απόσβεση, `ratings.py`), με έδρα μετρημένη ανά λίγκα και διόρθωση για απουσίες, και τις αβεβαιότητές τους (σ).
Ο browser (`MatchSim` στο `site/app.js`) προσομοιώνει: διαφορά ~ N(μ, σ_διαφ.), σύνολο ~ N(T, σ_συν.), ισοπαλία ->
παράταση. Το απλό Monte Carlo (μόνο τρέχουσα σεζόν, σταθερή έδρα/σ, `evaluate.py`) μένει ως baseline σύγκρισης.

## Ανάλυση (`scripts/analytics.py`)

Μόνο μεγέθη με στατιστικό νόημα:

- **Ομάδες:** ratings επίθεσης/άμυνας ανά 100 κατοχές, προσαρμοσμένα στον αντίπαλο (ridge regression), και
  δυσκολία προγράμματος.
- **Τύχη:** νίκες μείον αναμενόμενες νίκες από τη διαφορά πόντων, και ρεκόρ σε κλειστά ματς.
- **Four factors:** πόσους πόντους εξηγεί καθένας για κάθε ομάδα.
- **Έδρα:** πλεονέκτημα έδρας με 95% διάστημα εμπιστοσύνης.
- **Παίκτες:** μεγέθη ανά 100 κατοχές, usage, TS% με διόρθωση δείγματος, on/off με συρρίκνωση.
- **Φόρμα:** έλεγχος φόρμας με διόρθωση πολλαπλών ελέγχων (Benjamini–Hochberg).

## Στοίχημα (`scripts/edge_model.py`)

Walk-forward πρόβλεψη από:

- ratings με χρονική απόσβεση (τ/λ ανά λίγκα, επιλεγμένα σε προηγούμενες σεζόν),
- απουσίες βασικών (στα επερχόμενα NBA από τους τραυματίες του ESPN),
- online βαθμονόμηση.

Σύγκριση με τις αποδόσεις κλεισίματος:

- συντελεστής «πληροφορίας πέρα από την αγορά»,
- backtest ROI με 90% bootstrap,
- ετυμηγορία ανά αγορά.

Συστάσεις (¼ Kelly, έως 2%) **μόνο** όπου το edge αποδεικνύεται. Αποτέλεσμα σήμερα: στο NBA δεν υπάρχει edge.
Για EuroLeague, EuroCup και GBL χρειάζονται αποδόσεις: πρόσθεσε δωρεάν κλειδί του
[The Odds API](https://the-odds-api.com) ως GitHub secret `ODDS_API_KEY`
(Settings → Secrets and variables → Actions).

## Παίκτες και ματσάρισμα

- **Ratings 0–99**: εκατοστημόρια μέσα στη λίγκα (παίκτες με αρκετά λεπτά) σε έξι κατηγορίες:
  Σκοράρισμα, Σουτ, Δημιουργία, Ριμπάουντ, Άμυνα, Επιρροή (on/off), συν το Overall.
  - Με λίγα λεπτά τα μεγέθη τραβιούνται προς το επίπεδο του ίδιου παίκτη την προηγούμενη σεζόν
    (αλλιώς προς τον μέσο όρο).
  - Η άμυνα από box scores (κλεψίματα, κοψίματα, ριμπάουντ) είναι χονδρική εκτίμηση.
- **Θέση**: εκτίμηση από το προφίλ (ασίστ, τρίποντα, ριμπάουντ, κοψίματα), όχι επίσημη.
- **Shot charts**: εξάγωνα με μέγεθος = συχνότητα και χρώμα = εύστοχα σε σχέση με τη λίγκα στο ίδιο
  σημείο, και ζώνες.
  - EuroLeague/EuroCup από το επίσημο API, NBA από το ESPN.
  - Η GBL δεν έχει θέσεις σουτ, οπότε δείχνει κατανομή δίποντα/τρίποντα/βολές από τα box scores.
- **Ματσάρισμα**: δύο ομάδες στο γήπεδο, παίκτης προς παίκτη ανά θέση.
  - Πιθανή πεντάδα από τους βασικούς των 5 τελευταίων αγώνων, με αλλαγές από τον πάγκο.
  - Πιθανότητα νίκης από τα προσαρμοσμένα ratings ομάδων.
- **Σήματα ομάδων**: δικά μας SVG από το `teams_meta.json` (χρώματα, συντομογραφία).
  - Για πραγματικές εικόνες στο μέλλον: συμπλήρωσε το πεδίο `img` στο `scripts/team_meta.py`.

## Αλλαγή (Νοέμβριος 2026): ένα μοντέλο αγώνων

Τα νευρωνικά αγώνων (λίγκας, master), η σύγκριση αρχιτεκτονικών και το μοντέλο απόδοσης παικτών αφαιρέθηκαν.
Το μοναδικό μοντέλο αγώνων είναι το **Monte Carlo** πάνω στο μοντέλο ratings + απουσίες (`edge_model.py`):
αναμενόμενη διαφορά/σύνολο και σ ανά λίγκα -> προσομοίωση στον browser (`MatchSim` στο `site/app.js`).
Σε εξέλιξη: graph neural network (κάθε αγώνας = graph παικτών)· δεδομένα στη σελίδα `gnn.html`.
