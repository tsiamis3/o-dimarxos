# o-dimarxos

Στατιστικά EuroLeague / EuroCup σε GitHub Pages, με επερχόμενα ματς, προσομοίωση αγώνων,
σύγκριση ομάδων/παικτών, πλήρη βάση με φίλτρα και πρόβλεψη απόδοσης παικτών (Keras).

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
  train_model.py     feed-forward δίκτυο Keras -> models/ + site/data/predictions_*.json
  evaluate.py        αρχείο προβλέψεων, ζωντανή αξιολόγηση, backtest προσομοίωσης -> site/data/eval_*.json
  game_model.py      νευρωνικό αγώνων Keras (δίπλα στο Monte Carlo) -> site/data/gamenn_*.json
  master_model.py    ένα νευρωνικό αγώνων για όλες τις λίγκες -> site/data/master.json
  ratings.py         κοινή μηχανή ratings (προσαρμοσμένα στον αντίπαλο, απόσβεση, απουσίες)
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
python scripts/train_model.py         # --arch ffn_wide --epochs 80 για άλλη αρχιτεκτονική
python scripts/build_site.py
python -m http.server -d site 8000    # http://localhost:8000
```

## Μοντέλο

Για κάθε (παίκτη, αγώνα) τα features βγαίνουν μόνο από προηγούμενους αγώνες: lag-1, κυλιόμενοι μέσοι
3/5/10, EWM, μέσος σεζόν, πόσα ματς έχει παίξει, ποσοστό βασικού, ξεκούραση, έδρα, και η απόδοση
ομάδας/αντιπάλου μέχρι εκείνη τη στιγμή (πόντοι που δέχεται, PIR που δέχεται, ρυθμός).
Στόχοι: PTS, REB, AST, PIR, MIN του επόμενου αγώνα. Χρονικό split (τελευταίο 15% = test) και σύγκριση
με baselines (μέσος 10 αγώνων, μέσος σεζόν). Νέες αρχιτεκτονικές: πρόσθεσε συνάρτηση στο `ARCHS`
του `train_model.py`.

## Προσομοίωση αγώνα

Monte Carlo στον browser: αναμενόμενοι πόντοι = ρυθμός × (ORTG ομάδας + DRTG αντιπάλου − μέσος όρος)/100,
±1.5 πόντοι για έδρα, θόρυβος N(0, 10) ανά ομάδα, παράταση στην ισοπαλία. Τα ratings «τραβιούνται» προς τον
μέσο όρο στην αρχή της σεζόν (4 εικονικά ματς). Παράμετροι στην κλάση `MatchSim` του `site/app.js`.

## Νευρωνικό αγώνων (δίπλα στο Monte Carlo)

`scripts/game_model.py`, ένα μοντέλο ανά διοργάνωση. Για κάθε ομάδα, μόνο από αγώνες πριν από το ματς:
ratings επίθεσης/άμυνας και ρυθμός (με το ίδιο «τράβηγμα» προς τον μέσο όρο), φόρμα 5 αγώνων, four factors
επίθεσης και άμυνας (eFG%, TOV%, OREB%, FT rate), ξεκούραση, back-to-back, απόδοση εντός/εκτός έδρας.
Έξοδος: πόντοι γηπεδούχου και φιλοξενούμενου ως διμεταβλητή κανονική (μέσοι, σ, συσχέτιση), με Gaussian
negative log-likelihood. Πιθανότητα νίκης = P(διαφορά > 0). Χρονικό split (τελευταίο 15% = test), ensemble
3 seeds, και για τα επερχόμενα επανεκπαίδευση σε όλους τους αγώνες.

Σύγκριση με το Monte Carlo στα ίδια ματς (test: walk-forward backtest, ζωντανά: `data/predictions/{C}_games_nn.csv`
απέναντι στο `{C}_games.csv`): σωστός νικητής, Brier, log loss, βαθμονόμηση, σφάλμα σκορ, κάλυψη 80%.
Φαίνεται στη σελίδα «Μοντέλα», και στην αρχική κάθε ματς δείχνει και τις δύο πιθανότητες.

```bash
python scripts/game_model.py --comp E --arch mlp_wide --seeds 5   # αρχιτεκτονικές: GARCHS (linear, mlp_small, mlp_wide)
```

### Master δίκτυο (όλες οι λίγκες)

`scripts/master_model.py`: ένα δίκτυο για EuroLeague, EuroCup, GBL και NBA (η Α2 γυναικών δεν μπαίνει), ώστε να
εκπαιδεύεται σε περισσότερους αγώνες. Ίδια features με το δίκτυο λίγκας, αλλά σχετικά με τη λίγκα ως εκείνη την
ημέρα (ratings/φόρμα = πόντοι ανά 100 κατοχές πάνω από τον μέσο όρο, ρυθμός ως λόγος, four factors ως διαφορά)
+ one-hot διοργάνωσης. Στόχος: πόντοι / αναμενόμενοι πόντοι λίγκας. Εκπαίδευση σε όλες τις προηγούμενες σεζόν,
test = τα φετινά ματς κάθε λίγκας, όπου συγκρίνεται με δίκτυο μόνο της λίγκας (ίδιο split) και με το Monte Carlo.
Μετά ξαναεκπαιδεύεται σε όλα και προβλέπει τα επερχόμενα φετινά ματς. Ζωντανά: `data/predictions/{C}_games_master.csv`.

### Σύγκριση αρχιτεκτονικών

Σε κάθε run εκπαιδεύονται ΟΛΕΣ οι αρχιτεκτονικές του `GARCHS` (`linear`, `mlp_small`, `mlp_wide`):
στο `master_model.py` ως master και ως δίκτυο μόνο της λίγκας, και μετριούνται μαζί με το Monte Carlo στα ίδια
φετινά ματς. Στο `game_model.py` μετριούνται στο ίδιο test (τελευταίο 15%). Η σελίδα «Μοντέλα» έχει την ενότητα
«Σύγκριση όλων των μοντέλων αγώνων» (ταξινομήσιμος πίνακας, βαθμονόμηση ανά μοντέλο, Brier ανά λίγκα).
Η `--arch` ορίζει ποια αρχιτεκτονική δίνει τις προβλέψεις της αρχικής. Με `--compare` περιορίζεται η σύγκριση.

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
