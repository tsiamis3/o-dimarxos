/* Στατικό SPA για GitHub Pages.
 * Όλη η επεξεργασία (aggregation, filtering, προσομοίωση) γίνεται στον browser
 * πάνω στα JSON που παράγει το scripts/build_site.py.
 */
"use strict";

/* =========================================================================
 * 1. Βοηθητικά
 * ========================================================================= */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => v != null && !Number.isNaN(+v) && Number.isFinite(+v);
const fmt = (v, d = 1) => (isNum(v) ? (+v).toFixed(d) : "–");
const fmtPct = (v) => (isNum(v) ? (100 * v).toFixed(1) + "%" : "–");
const sum = (a) => a.reduce((s, x) => s + (+x || 0), 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const div = (a, b) => (b ? a / b : NaN);
const rowsToObjs = (o) => o.rows.map((r) => Object.fromEntries(o.cols.map((c, i) => [c, r[i]])));
/** Συνάρτηση σφάλματος (Abramowitz–Stegun 7.1.26), για πιθανότητες από κανονική κατανομή. */
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y.slice(2)}`; };
const seasonLabel = (s) => `${s}-${String(s + 1).slice(2)}`;
function niceName(n) {
  if (!n) return "";
  const tc = (s) => s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  n = n.replace(/\s*-\s*/g, "-");                 // «ROBINSON - EARL» -> «Robinson-Earl» (γραφή της πηγής EuroCup)
  const [last, first] = n.split(",").map((s) => s.trim());
  return first ? `${tc(first)} ${tc(last)}` : tc(last);
}
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

/* =========================================================================
 * 2. Ορισμοί στατιστικών
 * ========================================================================= */
const SUM_STATS = ["MIN", "PTS", "FG2M", "FG2A", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB", "REB",
  "AST", "STL", "TOV", "BLK", "BLKA", "PF", "FD", "PIR", "PM"];

// label = σύντομο (κεφαλίδα πίνακα), name = πλήρες, pct = ποσοστό, d = δεκαδικά, low = "μικρότερο είναι καλύτερο"
const STAT = {
  GP: { label: "ΑΓ", name: "Αγώνες", d: 0 }, GS: { label: "ΒΑΣ", name: "Βασικός", d: 0 },
  MIN: { label: "ΛΕΠ", name: "Λεπτά" }, PTS: { label: "ΠΤΣ", name: "Πόντοι" },
  REB: { label: "ΡΙΜ", name: "Ριμπάουντ" }, OREB: { label: "ΕΠΙΘ", name: "Επιθ. ριμπάουντ" },
  DREB: { label: "ΑΜΥΝ", name: "Αμυν. ριμπάουντ" }, AST: { label: "ΑΣΙΣΤ", name: "Ασίστ" },
  STL: { label: "ΚΛΕΨ", name: "Κλεψίματα" }, BLK: { label: "ΚΟΨ", name: "Κοψίματα" },
  BLKA: { label: "ΚΟΨ-Δ", name: "Κοψίματα που δέχτηκε", low: true },
  TOV: { label: "ΛΑΘ", name: "Λάθη", low: true }, PF: { label: "ΦΑΟΥΛ", name: "Φάουλ", low: true },
  FD: { label: "ΦΑΟΥΛ-Δ", name: "Φάουλ που κέρδισε" }, PIR: { label: "PIR", name: "PIR (Valuation)" },
  PM: { label: "+/-", name: "Plus/minus" },
  FG2M: { label: "2ΠΕ", name: "Δίποντα εύστοχα" }, FG2A: { label: "2ΠΠ", name: "Δίποντα προσπάθειες" },
  FG2P: { label: "2Π%", name: "Δίποντα %", pct: true },
  FG3M: { label: "3ΠΕ", name: "Τρίποντα εύστοχα" }, FG3A: { label: "3ΠΠ", name: "Τρίποντα προσπάθειες" },
  FG3P: { label: "3Π%", name: "Τρίποντα %", pct: true },
  FTM: { label: "ΒΟΛΕ", name: "Βολές εύστοχες" }, FTA: { label: "ΒΟΛΠ", name: "Βολές προσπάθειες" },
  FTP: { label: "ΒΟΛ%", name: "Βολές %", pct: true },
  EFG: { label: "eFG%", name: "Effective FG%", pct: true }, TS: { label: "TS%", name: "True shooting %", pct: true },
  PIR36: { label: "PIR/36", name: "PIR ανά 36'" }, PTS36: { label: "ΠΤΣ/36", name: "Πόντοι ανά 36'" },
  // ομάδες
  W: { label: "Ν", name: "Νίκες", d: 0 }, L: { label: "Η", name: "Ήττες", d: 0, low: true },
  WPCT: { label: "Ν%", name: "Ποσοστό νικών", pct: true },
  OPP: { label: "ΠΤΣ-Δ", name: "Πόντοι που δέχεται", low: true }, DIFF: { label: "ΔΙΑΦ", name: "Διαφορά πόντων" },
  PACE: { label: "PACE", name: "Κατοχές / αγώνα", neutral: true }, ORTG: { label: "ORTG", name: "Πόντοι / 100 κατοχές" },
  DRTG: { label: "DRTG", name: "Πόντοι που δέχεται / 100 κατοχές", low: true },
  NET: { label: "NET", name: "Net rating" }, OEFG: { label: "ΑΝΤ eFG%", name: "eFG% αντιπάλων", pct: true, low: true },
  TOVP: { label: "TOV%", name: "Λάθη / κατοχή", pct: true, low: true },
  OREBP: { label: "OREB%", name: "Ποσοστό επιθ. ριμπάουντ", pct: true },
  FTR: { label: "FTr", name: "Βολές / σουτ", pct: true }, OPIR: { label: "PIR-Δ", name: "PIR αντιπάλων", low: true },
  // αναλυτικά (analytics.py)
  ADJ_O: { label: "aORTG", name: "Προσαρμοσμένοι πόντοι / 100 κατοχές" },
  ADJ_D: { label: "aDRTG", name: "Προσαρμοσμένοι πόντοι που δέχεται / 100 κατοχές", low: true },
  ADJ_NET: { label: "aNET", name: "Προσαρμοσμένο net rating" }, LUCK: { label: "Τύχη", name: "Νίκες − αναμενόμενες νίκες" },
  USG: { label: "USG%", name: "Usage % (κατοχές που τελειώνει)", pct: true },
  TSA: { label: "TS%", name: "True shooting % (διορθωμένο για δείγμα)", pct: true },
};
const fmtStat = (k, v) => (STAT[k]?.pct ? fmtPct(v) : fmt(v, STAT[k]?.d ?? 1));

const PLAYER_COLS = ["GP", "GS", "MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF", "FD", "PIR", "PM",
  "FG2M", "FG2A", "FG2P", "FG3M", "FG3A", "FG3P", "FTM", "FTA", "FTP", "EFG", "TS", "PTS36", "PIR36"];
const TEAM_COLS = ["GP", "W", "L", "WPCT", "PTS", "OPP", "DIFF", "PACE", "ORTG", "DRTG", "NET", "EFG", "OEFG", "TOVP",
  "OREBP", "FTR", "FG2P", "FG3P", "FTP", "REB", "AST", "STL", "BLK", "TOV", "PIR", "OPIR"];
const TEAM_BASIC = ["GP", "W", "L", "WPCT", "PTS", "OPP", "DIFF"];   // όταν δεν υπάρχουν box scores
/** Σύντομη ετικέτα ομάδας για γραφήματα: ο κωδικός αν είναι "ανθρώπινος" (OLY, BOS), αλλιώς η 1η λέξη. */
const teamShort = (S, code) => (/^[A-Z]{2,4}$/.test(code) ? code : (S.teamName(code).split(/\s+/)[0] || code).slice(0, 9));

const LOG_STATS = ["MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF", "FD", "PIR", "PM",
  "FG2M", "FG2A", "FG3M", "FG3A", "FTM", "FTA"];

/* Παράγωγα στατιστικά από αθροίσματα (ισχύει για παίκτη και ομάδα). */
function derive(t) {
  const fga = t.FG2A + t.FG3A, fgm = t.FG2M + t.FG3M;
  return {
    FG2P: div(t.FG2M, t.FG2A), FG3P: div(t.FG3M, t.FG3A), FTP: div(t.FTM, t.FTA),
    EFG: div(fgm + 0.5 * t.FG3M, fga), TS: div(t.PTS, 2 * (fga + 0.44 * t.FTA)),
  };
}

/* =========================================================================
 * 3. Μία σεζόν ενός διαγωνισμού (δεδομένα + aggregations)
 * ========================================================================= */
class Season {
  constructor(raw) {
    this.comp = raw.comp;
    this.season = raw.season;
    this.teams = raw.teams;
    this.playerNames = raw.players;
    const bc = raw.bio_cols || [];
    this.bio = Object.fromEntries(Object.entries(raw.bio || {}).map(([pid, v]) => [pid, Object.fromEntries(bc.map((c, i) => [c, v[i]]))]));
    this.games = rowsToObjs(raw.games);
    this.upcoming = rowsToObjs(raw.upcoming);
    const gmap = new Map(this.games.map((g) => [g.gameCode, g]));
    this.logs = rowsToObjs(raw.logs).map((r) => {
      const g = gmap.get(r.gameCode);
      r.date = g?.date; r.round = g?.round; r.season = this.season;
      r.player = this.playerNames[r.pid];
      return r;
    });
    this.hasBox = this.logs.length > 0;   // false = διοργάνωση μόνο με αποτελέσματα (π.χ. Α2 γυναικών)
    this._tg = null; this._ta = null; this._pa = null;
  }
  teamName(c) { return this.teams[c] || c || "?"; }
  playerName(pid) { return niceName(this.playerNames[pid]) || pid; }

  /** Σύνολα ομάδας ανά ματς + αντίπαλος + κατοχές. */
  get teamGames() {
    if (this._tg) return this._tg;
    if (!this.hasBox) return (this._tg = this.teamGamesFromScores());
    const m = new Map();
    for (const r of this.logs) {
      const k = r.gameCode + "|" + r.team;
      let t = m.get(k);
      if (!t) {
        t = { code: r.team, opp: r.opp, gameCode: r.gameCode, date: r.date, round: r.round, home: r.home };
        SUM_STATS.forEach((s) => (t[s] = 0));
        m.set(k, t);
      }
      SUM_STATS.forEach((s) => (t[s] += +r[s] || 0));
    }
    for (const t of m.values()) {
      t.POSS = t.FG2A + t.FG3A + 0.44 * t.FTA - t.OREB + t.TOV;
    }
    for (const t of m.values()) {
      const o = m.get(t.gameCode + "|" + t.opp);
      t.o = o || null;
      t.win = o ? t.PTS > o.PTS : null;
    }
    this._tg = [...m.values()].filter((t) => t.o).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.gameCode - b.gameCode);
    return this._tg;
  }

  /** Χωρίς box scores: κάθε αγώνας μετρά ως 100 "κατοχές", άρα τα ratings = πόντοι ανά αγώνα
   *  και η προσομοίωση δουλεύει με πόντους υπέρ/κατά. */
  teamGamesFromScores() {
    const out = [];
    for (const g of this.games) {
      if (!isNum(g.hs) || !isNum(g.as)) continue;
      const mk = (code, opp, pts, home) => {
        const t = { code, opp, gameCode: g.gameCode, date: g.date, round: g.round, home, POSS: 100 };
        SUM_STATS.forEach((k) => (t[k] = 0)); t.PTS = pts;
        return t;
      };
      const h = mk(g.home, g.away, g.hs, 1), a = mk(g.away, g.home, g.as, 0);
      h.o = a; a.o = h; h.win = g.hs > g.as; a.win = g.as > g.hs;
      out.push(h, a);
    }
    return out.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.gameCode - b.gameCode);
  }

  /** Μέσοι όροι / ratings ανά ομάδα. */
  get teamAgg() {
    if (this._ta) return this._ta;
    const by = new Map();
    for (const t of this.teamGames) { if (!by.has(t.code)) by.set(t.code, []); by.get(t.code).push(t); }
    const out = new Map();
    for (const [code, gs] of by) {
      const S = (f) => sum(gs.map(f));
      const tot = {}; SUM_STATS.forEach((s) => (tot[s] = S((g) => g[s])));
      const gp = gs.length, poss = S((g) => (g.POSS + g.o.POSS) / 2);
      const opp = {}; SUM_STATS.forEach((s) => (opp[s] = S((g) => g.o[s])));
      const W = gs.filter((g) => g.win).length;
      const a = {
        code, name: this.teamName(code), GP: gp, W, L: gp - W, WPCT: W / gp,
        PTS: tot.PTS / gp, OPP: opp.PTS / gp, DIFF: (tot.PTS - opp.PTS) / gp, PACE: poss / gp,
        ORTG: 100 * tot.PTS / poss, DRTG: 100 * opp.PTS / poss,
        OEFG: derive(opp).EFG, TOVP: tot.TOV / poss,
        OREBP: div(tot.OREB, tot.OREB + opp.DREB), FTR: div(tot.FTA, tot.FG2A + tot.FG3A),
        REB: tot.REB / gp, AST: tot.AST / gp, STL: tot.STL / gp, BLK: tot.BLK / gp, TOV: tot.TOV / gp,
        PIR: tot.PIR / gp, OPIR: opp.PIR / gp, ...derive(tot), games: gs,
      };
      a.NET = a.ORTG - a.DRTG;
      out.set(code, a);
    }
    this._ta = out;
    return out;
  }

  standings() {
    return [...this.teamAgg.values()].sort((a, b) => b.W - a.W || b.DIFF - a.DIFF);
  }

  /** Μέσοι όροι παικτών (cache για το default). */
  get playerAgg() {
    if (!this._pa) this._pa = aggregatePlayers(this.logs, false, "avg");
    return this._pa;
  }
}

/** Aggregation παικτών πάνω σε οποιοδήποτε σύνολο game logs. */
function aggregatePlayers(logs, bySeason, mode) {
  const m = new Map();
  for (const r of logs) {
    const k = bySeason ? r.pid + "|" + r.season : r.pid;
    let p = m.get(k);
    if (!p) {
      p = { pid: r.pid, season: r.season, player: r.player, team: r.team, GP: 0, GS: 0, _last: "" };
      SUM_STATS.forEach((s) => (p[s] = 0));
      m.set(k, p);
    }
    p.GP++; p.GS += +r.starter || 0;
    SUM_STATS.forEach((s) => (p[s] += +r[s] || 0));
    if ((r.date || "") >= p._last) { p._last = r.date || ""; p.team = r.team; }
  }
  const out = [];
  for (const p of m.values()) {
    const d = derive(p);
    const o = { pid: p.pid, season: p.season, player: niceName(p.player), team: p.team, GP: p.GP, GS: p.GS, ...d };
    o.PTS36 = div(36 * p.PTS, p.MIN); o.PIR36 = div(36 * p.PIR, p.MIN);
    SUM_STATS.forEach((s) => (o[s] = mode === "tot" ? p[s] : p[s] / p.GP));
    o.MIN_AVG = p.MIN / p.GP;
    out.push(o);
  }
  return out;
}

/* =========================================================================
 * 4. Προσομοίωση αγώνα (Monte Carlo πάνω σε ratings ομάδων)
 *    αναμενόμενοι πόντοι = pace * (ORTG_A + DRTG_B - μέσο_rating) / 100 ± πλεονέκτημα έδρας
 *    θόρυβος ~ N(0, SD) ανά ομάδα, ισοπαλία -> παράταση
 * ========================================================================= */
class MatchSim {
  /* Monte Carlo αγώνα. Κύριος κινητήρας: το μοντέλο ratings + απουσίες (scripts/edge_model.py), που δίνει
   * για κάθε επερχόμενο ματς αναμενόμενη διαφορά, σύνολο και την αβεβαιότητά τους (σ), εκτιμημένα ανά λίγκα.
   * Αν ένα ματς δεν είναι εκεί (π.χ. πολύ μακριά), εφεδρικά: ratings της σεζόν με σταθερή έδρα/σ. */
  static HCA = 3.0;      // εφεδρικό: πόντοι πλεονέκτημα έδρας
  static SD = 10.0;      // εφεδρικό: τυπική απόκλιση σκορ ομάδας
  static SHRINK = 4;     // εφεδρικό: "εικονικά" ματς μέσου όρου

  constructor(season, edge = null) {
    const tg = season.teamGames;
    const poss = sum(tg.map((t) => t.POSS));
    this.lg = tg.length ? 100 * sum(tg.map((t) => t.PTS)) / poss : 110;
    this.lgPace = tg.length ? poss / tg.length : 75;
    this.agg = season.teamAgg;
    this.ext = new Map((edge?.upcoming || []).map((u) => [String(u.gameCode), u]));
  }
  rating(code) {
    const a = this.agg.get(code), k = MatchSim.SHRINK;
    if (!a) return { o: this.lg, d: this.lg, p: this.lgPace };
    const sh = (v, lg) => (a.GP * v + k * lg) / (a.GP + k);
    return { o: sh(a.ORTG, this.lg), d: sh(a.DRTG, this.lg), p: sh(a.PACE, this.lgPace) };
  }
  /** -> {mh, ma, sdm (σ διαφοράς), sdt (σ συνόλου), src: "model" | "fallback"} */
  expected(home, away, gameCode) {
    const e = gameCode != null ? this.ext.get(String(gameCode)) : null;
    if (e && e.home === home && e.away === away) {
      return { mh: (e.total - e.line) / 2, ma: (e.total + e.line) / 2, sdm: e.sd_m, sdt: e.sd_t || 1.3 * e.sd_m, src: "model",
        mv_h: e.mv_h || 0, mv_a: e.mv_a || 0 };
    }
    const h = this.rating(home), a = this.rating(away), pace = (h.p + a.p) / 2;
    return { mh: pace * (h.o + a.d - this.lg) / 100 + MatchSim.HCA / 2, ma: pace * (a.o + h.d - this.lg) / 100 - MatchSim.HCA / 2,
      sdm: MatchSim.SD * Math.SQRT2, sdt: MatchSim.SD * Math.SQRT2, src: "fallback", mv_h: 0, mv_a: 0 };
  }
  once(home, away, gameCode) {
    const x = this.expected(home, away, gameCode);
    // διαφορά και σύνολο κληρώνονται ανεξάρτητα, η καθεμία με τη δική της σ -> σκορ κάθε ομάδας
    const m = x.mh - x.ma + x.sdm * randn(), t = x.mh + x.ma + x.sdt * randn();
    let hs = Math.round((t + m) / 2), as = Math.round((t - m) / 2), ot = 0;
    while (hs === as && ot < 5) {           // παράταση 5' ≈ 1/8 του αγώνα
      ot++;
      hs += Math.max(0, Math.round(x.mh / 8 + 3 * randn()));
      as += Math.max(0, Math.round(x.ma / 8 + 3 * randn()));
    }
    if (hs === as) hs++;
    return { hs, as, ot };
  }
  run(home, away, n = 5000, gameCode = null) {
    let w = 0; const margins = new Array(n); let sh = 0, sa = 0;
    for (let i = 0; i < n; i++) {
      const r = this.once(home, away, gameCode);
      if (r.hs > r.as) w++;
      margins[i] = r.hs - r.as; sh += r.hs; sa += r.as;
    }
    return { pHome: w / n, margins, avgH: sh / n, avgA: sa / n, ...this.expected(home, away, gameCode) };
  }
}

/* =========================================================================
 * 5. Γραφήματα (μικρό SVG toolkit, χρώματα από CSS tokens)
 * ========================================================================= */
const Charts = {
  /** Πλάτος viewBox = πραγματικό διαθέσιμο πλάτος, ώστε τα γράμματα να μένουν ~13px σε κινητό και desktop. */
  W(max = 960) { return Math.round(Math.max(320, Math.min(max, Math.min(window.innerWidth, 1180) - 52))); },

  ticks(min, max, n = 5) {
    if (!(max > min)) { max = min + 1; }
    const step0 = (max - min) / n, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, t = [];
    for (let v = lo; v <= hi + step / 2; v += step) t.push(+v.toFixed(10));
    return t;
  },
  scale(d0, d1, r0, r1) { return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0); },

  /** series: [{k:'k1', pts:[[x,y]], dash, thin, dots, area}] · xLabel(x) -> string */
  line({ series, xLabel = (x) => x, yFmt = (v) => v, W = Charts.W(), H = 0, yZero = false }) {
    H = H || Math.round(Math.min(300, Math.max(200, W * 0.42)));
    const all = series.flatMap((s) => s.pts).filter((p) => isNum(p[1]));
    if (!all.length) return `<div class="empty">Δεν υπάρχουν δεδομένα</div>`;
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const yt = this.ticks(yZero ? Math.min(0, ...ys) : Math.min(...ys), Math.max(...ys));
    const L = 44, R = 12, T = 12, B = 30;
    const X = this.scale(Math.min(...xs), Math.max(...xs), L, W - R), Y = this.scale(yt[0], yt.at(-1), H - B, T);
    const xu = [...new Set(xs)].sort((a, b) => a - b), every = Math.ceil(xu.length / Math.max(3, Math.floor(W / 80)));
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    yt.forEach((v) => (s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${yFmt(v)}</text>`));
    xu.forEach((x, i) => { if (i % every === 0) s += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle">${esc(xLabel(x))}</text>`; });
    for (const se of series) {
      const p = se.pts.filter((q) => isNum(q[1]));
      if (!p.length) continue;
      const d = p.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("");
      if (se.area) s += `<path class="area ${se.k}" d="${d}L${X(p.at(-1)[0])},${Y(yt[0])}L${X(p[0][0])},${Y(yt[0])}Z"/>`;
      if (!se.dotsOnly) s += `<path class="line ${se.k} ${se.dash ? "dash" : ""} ${se.thin ? "thin" : ""}" d="${d}"/>`;
      if (se.dots || se.dotsOnly) p.forEach((q) => (s += `<circle class="dot ${se.k}" cx="${X(q[0])}" cy="${Y(q[1])}" r="${se.r || 3.5}"><title>${esc(xLabel(q[0]))}: ${yFmt(q[1])}</title></circle>`));
    }
    return s + "</svg>";
  },

  /** Ιστόγραμμα διαφοράς πόντων προσομοίωσης. */
  marginHist(margins, W = 300, H = 150) {
    const lo = -40, hi = 40, bw = 4, bins = [];
    for (let x = lo; x < hi; x += bw) bins.push({ x0: x, n: 0 });
    margins.forEach((m) => { const i = Math.floor((Math.max(lo, Math.min(hi - 1, m)) - lo) / bw); bins[i].n++; });
    const mx = Math.max(...bins.map((b) => b.n)), L = 10, R = 10, T = 8, B = 26;
    const X = this.scale(lo, hi, L, W - R), Y = this.scale(0, mx, H - B, T);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Κατανομή διαφοράς πόντων">`;
    bins.forEach((b) => {
      const k = b.x0 >= 0 ? "k1" : "k2";
      s += `<rect class="${k}" x="${X(b.x0) + 1}" y="${Y(b.n)}" width="${X(b.x0 + bw) - X(b.x0) - 2}" height="${H - B - Y(b.n)}" rx="2"/>`;
    });
    [-30, -15, 0, 15, 30].forEach((v) => (s += `<text x="${X(v)}" y="${H - 8}" text-anchor="middle">${v > 0 ? "+" + v : v}</text>`));
    s += `<line class="axis" x1="${X(0)}" x2="${X(0)}" y1="${T}" y2="${H - B}"/>`;
    return s + "</svg>";
  },

  /** Radar: axes = [label], series = [{k, vals:[0..1]}] */
  radar({ axes, series, W = 420, H = 380, mid = false }) {
    const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 58, n = axes.length;
    const pt = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" style="min-width:280px">`;
    [0.25, 0.5, 0.75, 1].forEach((f) => (s += `<polygon class="grid" fill="none" points="${axes.map((_, i) => pt(i, R * f).join(",")).join(" ")}"/>`));
    axes.forEach((a, i) => {
      const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 22);
      s += `<line class="grid" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
      s += `<text x="${lx}" y="${ly + 4}" text-anchor="${Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end"}">${esc(a)}</text>`;
    });
    if (mid) s += `<polygon fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="2 3" points="${axes.map((_, i) => pt(i, R * 0.5).join(",")).join(" ")}"/>
      <text x="${cx + 4}" y="${cy - R * 0.5 - 4}" style="font-size:10px;fill:var(--muted)">μέσος όρος</text>`;
    series.forEach((se) => {
      const p = se.vals.map((v, i) => pt(i, R * Math.max(0.03, isNum(v) ? v : 0)).join(",")).join(" ");
      if (se.dash) s += `<polygon class="line ${se.k}" points="${p}" style="stroke-dasharray:5 4;stroke-width:1.5;opacity:.85"/>`;
      else s += `<polygon class="area ${se.k}" points="${p}" style="opacity:.18"/><polygon class="line ${se.k}" points="${p}"/>`;
    });
    return s + "</svg>";
  },

  /** Bubble scatter: pts [{x, y, r(0..1), label, team?, pid?, hi}] — median γραμμές, κλικ = άνοιγμα ομάδας/παίκτη. */
  bubble({ pts, xKey, yKey, W = Charts.W(900) }) {
    const ok = pts.filter((p) => isNum(p.x) && isNum(p.y));
    if (!ok.length) return `<div class="empty">Δεν υπάρχουν δεδομένα για αυτόν τον συνδυασμό.</div>`;
    const H = Math.round(Math.min(560, Math.max(320, W * 0.7))), L = 64, R = 24, T = 18, B = 44;
    const xs = ok.map((p) => p.x), ys = ok.map((p) => p.y);
    const pad = (a) => { const lo = Math.min(...a), hi = Math.max(...a), d = (hi - lo) * 0.08 || 1; return [lo - d, hi + d]; };
    const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
    const xt = this.ticks(x0, x1, 6).filter((v) => v >= x0 && v <= x1), yt = this.ticks(y0, y1, 6).filter((v) => v >= y0 && v <= y1);
    const X = this.scale(x0, x1, L, W - R), Y = this.scale(y0, y1, H - B, T);
    const f = (k) => (v) => (STAT[k]?.pct ? (100 * v).toFixed(0) + "%" : +v.toFixed(2));
    const med = (a) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
    const many = ok.length > 40;
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(STAT[yKey]?.name)} ως προς ${esc(STAT[xKey]?.name)}">`;
    xt.forEach((v) => (s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}"/><text x="${X(v)}" y="${H - B + 16}" text-anchor="middle">${f(xKey)(v)}</text>`));
    yt.forEach((v) => (s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${f(yKey)(v)}</text>`));
    s += `<line class="axis" x1="${X(med(xs))}" x2="${X(med(xs))}" y1="${T}" y2="${H - B}" stroke-dasharray="4 4"/>`;
    s += `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(med(ys))}" y2="${Y(med(ys))}" stroke-dasharray="4 4"/>`;
    for (const p of [...ok].sort((a, b) => (a.hi ? 1 : 0) - (b.hi ? 1 : 0) || b.r - a.r)) {
      const rad = many ? 3 + 7 * (p.r ?? 0.3) : 8 + 16 * (p.r ?? 0.5);
      const attr = p.team ? `data-team="${esc(p.team)}"` : p.pid ? `data-pid="${esc(p.pid)}"` : "";
      s += `<g ${attr} style="cursor:pointer"><circle class="${p.hi ? "k2" : "k1"}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${rad.toFixed(1)}" style="opacity:${p.hi ? 0.85 : many ? 0.45 : 0.55}"><title>${esc(p.name || p.label)}: ${STAT[xKey]?.label} ${fmtStat(xKey, p.x)}, ${STAT[yKey]?.label} ${fmtStat(yKey, p.y)}</title></circle>`;
      if (!many || p.hi) s += `<text x="${X(p.x).toFixed(1)}" y="${(Y(p.y) - rad - 4).toFixed(1)}" text-anchor="middle" style="font-size:12px;fill:var(--fg)">${esc(p.label)}</text>`;
      s += `</g>`;
    }
    s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${esc(STAT[xKey]?.name || xKey)}</text>`;
    s += `<text x="14" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 14 ${(T + H - B) / 2})">${esc(STAT[yKey]?.name || yKey)}</text>`;
    return s + "</svg>";
  },

  /** Βαθμονόμηση: bins [{pred, obs, n}] — κύκλοι με εμβαδό ανάλογο του n, διαγώνιος = τέλεια. */
  calibration(bins, W = Charts.W(520)) {
    if (!bins.length) return `<div class="empty">Δεν υπάρχουν δεδομένα</div>`;
    const H = Math.round(W * 0.8), L = 64, R = 14, T = 12, B = 40;
    const X = this.scale(0, 1, L, W - R), Y = this.scale(0, 1, H - B, T), mx = Math.max(...bins.map((b) => b.n));
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Βαθμονόμηση πιθανοτήτων">`;
    [0, 0.25, 0.5, 0.75, 1].forEach((g) => (s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 6}" y="${Y(g) + 4}" text-anchor="end">${g * 100}%</text><text x="${X(g)}" y="${H - 22}" text-anchor="middle">${g * 100}%</text>`));
    s += `<line class="axis" x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" stroke-dasharray="4 4"/>`;
    bins.forEach((b) => (s += `<circle class="k1" cx="${X(b.pred)}" cy="${Y(b.obs)}" r="${(4 + 14 * Math.sqrt(b.n / mx)).toFixed(1)}" style="opacity:.55"><title>${fmtPct(b.pred)} προβλ. → ${fmtPct(b.obs)} πραγμ. (${b.n} ματς)</title></circle>`));
    s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">Πρόβλεψη νίκης γηπεδούχου</text>`;
    s += `<text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">Πραγματικό ποσοστό</text>`;
    return s + "</svg>";
  },

  scatter({ pts, xLabel, yLabel, W = Charts.W(600), H = 0 }) {
    H = H || Math.round(W * 0.7);
    if (!pts.length) return `<div class="empty">Δεν υπάρχουν δεδομένα</div>`;
    const v = pts.flat(), t = this.ticks(Math.min(0, ...v), Math.max(...v));
    const L = 44, R = 12, T = 12, B = 40;
    const X = this.scale(t[0], t.at(-1), L, W - R), Y = this.scale(t[0], t.at(-1), H - B, T);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
    t.forEach((g) => (s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(g)}" y2="${Y(g)}"/><text x="${L - 6}" y="${Y(g) + 4}" text-anchor="end">${g}</text><text x="${X(g)}" y="${H - 22}" text-anchor="middle">${g}</text>`));
    s += `<line class="axis" x1="${X(t[0])}" y1="${Y(t[0])}" x2="${X(t.at(-1))}" y2="${Y(t.at(-1))}" stroke-dasharray="4 4"/>`;
    pts.forEach(([x, y]) => (s += `<circle class="k1" cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="2.6" style="opacity:.45"/>`));
    s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
    s += `<text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${esc(yLabel)}</text>`;
    return s + "</svg>";
  },
};

/* =========================================================================
 * 5β. Σήματα ομάδων, avatars παικτών, μπάλα, γήπεδο, shot chart (όλα δικά μας SVG)
 *     Τα χρώματα/συντομογραφίες έρχονται από data/teams_meta.json (scripts/team_meta.py).
 *     Αν μια ομάδα αποκτήσει "img", χρησιμοποιείται αυτή αντί για το σήμα.
 * ========================================================================= */
const Gfx = {
  meta(code, comp = App.comp) {
    const m = App.teamMeta?.[comp]?.[code];
    return m || { abbr: String(code || "?").slice(0, 3), c1: "var(--muted)", c2: "var(--surface)", fg: "#fff", img: null };
  },
  /** Σήμα ομάδας ως <g> μέσα σε SVG (κέντρο cx,cy, ακτίνα r). */
  badgeG(code, cx, cy, r, extra = "") {
    const m = this.meta(code);
    if (m.img) return `<image href="${esc(m.img)}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" ${extra}/>`;
    const fs = Math.max(7, r * (m.abbr.length > 3 ? 0.62 : 0.78));
    return `<g ${extra}><circle cx="${cx}" cy="${cy}" r="${r}" fill="${m.c1}" stroke="${m.c2}" stroke-width="${Math.max(1.5, r * 0.12)}"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="fill:${m.fg};font:700 ${fs.toFixed(1)}px var(--font-display);letter-spacing:-.02em">${esc(m.abbr)}</text></g>`;
  },
  /** Σήμα ομάδας ως αυτόνομο inline SVG (για κείμενο/πίνακες). */
  badge(code, size = 22) {
    return `<svg class="badge" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="vertical-align:middle;flex:none">${this.badgeG(code, size / 2, size / 2, size / 2 - 1.5)}</svg>`;
  },
  initials(name) {
    const n = String(name || "?").replace(/,/g, " ").split(/\s+/).filter(Boolean);
    return ((n[0]?.[0] || "") + (n.length > 1 ? n[n.length - 1][0] : "")).toUpperCase();
  },
  /** Avatar παίκτη: κύκλος με αρχικά, δαχτυλίδι στα χρώματα της ομάδας. */
  avatarG(name, code, cx, cy, r) {
    const m = this.meta(code);
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--surface)" stroke="${m.c1}" stroke-width="${Math.max(2, r * 0.16)}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${r * 0.78}" fill="${m.c1}" opacity=".14"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="fill:var(--fg);font:700 ${(r * 0.72).toFixed(1)}px var(--font-display)">${esc(this.initials(name))}</text>`;
  },
  /** Φωτογραφία παίκτη (αν υπάρχει) πάνω από το avatar με τα αρχικά, που μένει αν η εικόνα δεν φορτώσει. */
  photo(src, name, code, size = 56) {
    if (!src) return this.avatar(name, code, size);
    return `<span class="photo" style="width:${size}px;height:${size}px">${this.avatar(name, code, size)}<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
  },
  avatar(name, code, size = 56) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" style="flex:none">${this.avatarG(name, code, size / 2, size / 2, size / 2 - 3)}</svg>`;
  },
  /** Μπάλα μπάσκετ (για bubbles παικτών). */
  ballG(cx, cy, r, ring = "") {
    const s = (v) => v.toFixed(1);
    return `<g><circle cx="${s(cx)}" cy="${s(cy)}" r="${s(r)}" fill="var(--c2)" ${ring ? `stroke="${ring}" stroke-width="${s(Math.max(1.5, r * .22))}"` : `stroke="rgba(0,0,0,.35)" stroke-width="1"`}/>` +
      `<path d="M${s(cx - r)} ${s(cy)}H${s(cx + r)}M${s(cx)} ${s(cy - r)}V${s(cy + r)}M${s(cx - r * .7)} ${s(cy - r * .7)}Q${s(cx - r * .15)} ${s(cy)} ${s(cx - r * .7)} ${s(cy + r * .7)}M${s(cx + r * .7)} ${s(cy - r * .7)}Q${s(cx + r * .15)} ${s(cy)} ${s(cx + r * .7)} ${s(cy + r * .7)}" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="${s(Math.max(.6, r * .07))}"/></g>`;
  },
  /** Τράβηγμα κύκλων ώστε να μην επικαλύπτονται (λίγες επαναλήψεις αρκούν). */
  relax(nodes, x0, x1, y0, y1, iters = 120) {
    for (let it = 0; it < iters; it++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = b.px - a.px, dy = b.py - a.py; const d = Math.hypot(dx, dy) || 0.01, min = a.pr + b.pr + 1.5;
        if (d < min) { const push = (min - d) / 2; dx /= d; dy /= d; a.px -= dx * push; a.py -= dy * push; b.px += dx * push; b.py += dy * push; moved = true; }
      }
      // ελαφριά επιστροφή προς τη σωστή θέση
      for (const n of nodes) { n.px += (n.tx - n.px) * 0.04; n.py += (n.ty - n.py) * 0.04; n.px = Math.max(x0 + n.pr, Math.min(x1 - n.pr, n.px)); n.py = Math.max(y0 + n.pr, Math.min(y1 - n.pr, n.py)); }
      if (!moved && it > 10) break;
    }
    return nodes;
  },
};

/** Γράφημα «σήματα»: κάθε σημείο είναι σήμα ομάδας ή μπάλα, το μέγεθος κωδικοποιεί ένα μέγεθος (sizeLabel).
 *  pts: [{x, y, s (0..1), code?|ball?, label, title, team?, pid?, hi?}] */
Charts.badges = function ({ pts, xName, yName, fx = (v) => fmt(v), fy = (v) => fmt(v), invertY = false, quads = null, sizeLabel = "", diag = null, W = Charts.W(620), rMin = 9, rMax = 24 }) {
  const ok = pts.filter((p) => isNum(p.x) && isNum(p.y));
  if (!ok.length) return `<div class="empty">Δεν υπάρχουν δεδομένα.</div>`;
  const small = W < 480;
  const H = Math.round(Math.min(560, Math.max(320, W * 0.72))), L = small ? 44 : 56, R = 16, T = 16, B = 46;
  const ext = (a) => { const lo = Math.min(...a), hi = Math.max(...a), d = (hi - lo) * 0.1 || 1; return [lo - d, hi + d]; };
  const [x0, x1] = ext(ok.map((p) => p.x)), [y0, y1] = ext(ok.map((p) => p.y));
  const X = this.scale(x0, x1, L, W - R), Y = invertY ? this.scale(y0, y1, T, H - B) : this.scale(y0, y1, H - B, T);
  const dense = ok.length > 60;                      // πολλά σημεία: μικρότερα και ΣΤΗ σωστή θέση (χωρίς μετατόπιση)
  const rs = (small ? 0.7 : 1) * (dense ? 0.6 : 1);
  const nodes = ok.map((p) => { const pr = (rMin + (rMax - rMin) * Math.sqrt(Math.max(0, Math.min(1, p.s ?? 0.5)))) * rs; return { ...p, tx: X(p.x), ty: Y(p.y), px: X(p.x), py: Y(p.y), pr }; });
  if (!dense) Gfx.relax(nodes, L, W - R, T, H - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yName)} ως προς ${esc(xName)}">`;
  this.ticks(x0, x1, 6).filter((v) => v >= x0 && v <= x1).forEach((v) => (s += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${T}" y2="${H - B}"/><text x="${X(v)}" y="${H - B + 16}" text-anchor="middle">${fx(v)}</text>`));
  this.ticks(y0, y1, 6).filter((v) => v >= y0 && v <= y1).forEach((v) => (s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${fy(v)}</text>`));
  if (diag) s += diag(X, Y, x0, x1, y0, y1);
  const med = (a) => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
  const mx = med(ok.map((p) => p.x)), my = med(ok.map((p) => p.y));
  s += `<line class="axis" x1="${X(mx)}" x2="${X(mx)}" y1="${T}" y2="${H - B}" stroke-dasharray="4 4" opacity=".6"/><line class="axis" x1="${L}" x2="${W - R}" y1="${Y(my)}" y2="${Y(my)}" stroke-dasharray="4 4" opacity=".6"/>`;
  if (quads) {
    const q = (t, x, y, a) => `<text x="${x}" y="${y}" text-anchor="${a}" style="font-size:12px;font-weight:600;opacity:.75">${esc(t)}</text>`;
    s += q(quads[0], L + 6, T + 14, "start") + q(quads[1], W - R - 6, T + 14, "end") + q(quads[2], L + 6, H - B - 8, "start") + q(quads[3], W - R - 6, H - B - 8, "end");
  }
  for (const n of [...nodes].sort((a, b) => (a.hi ? 1 : 0) - (b.hi ? 1 : 0) || b.pr - a.pr)) {
    const attr = n.team ? `data-team="${esc(n.team)}"` : n.pid ? `data-pid="${esc(n.pid)}"` : "";
    const moved = Math.hypot(n.px - n.tx, n.py - n.ty) > 2;
    s += `<g ${attr} style="cursor:pointer" opacity="${n.dim ? 0.3 : 1}"><title>${esc(n.title || n.label)}</title>`;
    if (moved) s += `<line x1="${n.tx.toFixed(1)}" y1="${n.ty.toFixed(1)}" x2="${n.px.toFixed(1)}" y2="${n.py.toFixed(1)}" class="axis" opacity=".5"/><circle cx="${n.tx.toFixed(1)}" cy="${n.ty.toFixed(1)}" r="2" class="k1"/>`;
    s += n.code ? Gfx.badgeG(n.code, +n.px.toFixed(1), +n.py.toFixed(1), +n.pr.toFixed(1)) : Gfx.ballG(n.px, n.py, n.pr, n.ring || "");
    if (n.showLabel) s += `<text x="${n.px.toFixed(1)}" y="${(n.py + n.pr + 12).toFixed(1)}" text-anchor="middle" style="font-size:11px;fill:var(--fg)">${esc(n.label)}</text>`;
    s += `</g>`;
  }
  s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${esc(xName)}</text>`;
  s += `<text x="12" y="${(T + H - B) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(T + H - B) / 2})">${esc(yName)}</text>`;
  s += `</svg>`;
  return s + (sizeLabel ? `<div class="muted" style="font-size:12px;margin-top:4px">Μέγεθος: ${esc(sizeLabel)}</div>` : "");
};

/** Μισό γήπεδο (μέτρα, καλάθι στο 0,0, y προς το κέντρο). comp NBA -> γραμμή 3π NBA. */
const Court = {
  dims(comp) {
    return comp === "NBA" ? { three: 7.24, corner: 6.71, cornerY: 4.22 - 1.575, key: 2.44, ft: 5.8 - 1.575, w: 7.62 }
      : { three: 6.75, corner: 6.6, cornerY: 2.99 - 1.575, key: 2.45, ft: 5.8 - 1.575, w: 7.5 };
  },
  /** Γραμμές μισού γηπέδου σε SVG, με συνάρτηση προβολής P(x,y) -> [px,py]. */
  half(P, comp, cls = "axis") {
    const d = this.dims(comp), line = (pts) => `<path class="${cls}" fill="none" d="${pts.map((p, i) => (i ? "L" : "M") + P(...p).map((v) => v.toFixed(1)).join(" ")).join("")}"/>`;
    const arc = (r, a0, a1, n = 40) => { const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([r * Math.cos(a), r * Math.sin(a)]); } return pts; };
    const base = -1.575;
    let s = line([[-d.w, base], [d.w, base]]);                                   // τελική
    s += line([[-d.w, base], [-d.w, 12.5]]) + line([[d.w, base], [d.w, 12.5]]);  // πλάγιες
    s += line([[-d.key, base], [-d.key, d.ft], [d.key, d.ft], [d.key, base]]);    // ρακέτα
    s += line(arc(1.8, 0, Math.PI).map(([x, y]) => [x, y + d.ft]));               // κύκλος βολών
    s += line(arc(1.25, 0, Math.PI));                                             // no-charge
    const a0 = Math.asin(d.cornerY / d.three);
    s += line([[-d.corner, base], [-d.corner, d.cornerY]]) + line([[d.corner, base], [d.corner, d.cornerY]]);
    s += line(arc(d.three, a0, Math.PI - a0).map(([x, y]) => [x, y]).reverse().map(([x, y]) => [x, y]));
    const [bx, by] = P(0, 0), [rx] = P(0.23, 0);
    s += `<circle class="${cls}" fill="none" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${Math.abs(rx - bx).toFixed(1)}"/>`;
    s += line([[-0.9, -0.375], [0.9, -0.375]]);                                   // ταμπλό
    return s;
  },
  /** Shot chart: εξάγωνα μέγεθος = συχνότητα, χρώμα = εύστοχα vs μέσος όρος λίγκας στην ίδια θέση. */
  shotChart({ cells, league, hex, comp, W = 360, title = "" }) {
    const d = this.dims(comp), H = Math.round(W * 0.94), pad = 6;
    const sc = (W - 2 * pad) / (2 * d.w), P = (x, y) => [W / 2 + x * sc, pad + (y + 1.575) * sc];
    const lg = new Map(league.map(([q, r, a, m]) => [q + "," + r, [a, m]]));
    const tot = cells.reduce((s, c) => s + c[2], 0);
    if (!tot) return `<div class="empty">Δεν υπάρχουν σουτ.</div>`;
    const maxShare = Math.max(...cells.map((c) => c[2] / tot));
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || "Χάρτης σουτ")}">`;
    s += `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--surface-2)" opacity=".45"/>`;
    s += this.half(P, comp);
    for (const [q, r, a, m] of cells) {
      const cx = hex * Math.sqrt(3) * (q + r / 2), cy = hex * 1.5 * r;
      if (cy > 11) continue;
      const [l0, l1] = lg.get(q + "," + r) || [0, 0];
      const lgp = l0 ? l1 / l0 : 0.45;
      // συρρίκνωση προς τη λίγκα (5 εικονικά σουτ)
      const diff = (m + 5 * lgp) / (a + 5) - lgp;
      const rr = hex * sc * (0.3 + 0.7 * Math.sqrt(a / tot / maxShare));
      const [px, py] = P(cx, cy);
      const pts = []; for (let i = 0; i < 6; i++) { const ang = Math.PI / 180 * (60 * i - 30); pts.push([px + rr * Math.cos(ang), py + rr * Math.sin(ang)]); }
      const col = diff > 0 ? "var(--good)" : "var(--bad)", op = Math.min(0.95, 0.25 + Math.abs(diff) * 4);
      s += `<polygon points="${pts.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="${col}" opacity="${op.toFixed(2)}"><title>${a} σουτ · ${fmtPct(m / a)} (λίγκα ${fmtPct(lgp)})</title></polygon>`;
    }
    return s + `</svg>`;
  },
};

/* =========================================================================
 * 6. Πίνακας με ταξινόμηση + σελιδοποίηση
 * ========================================================================= */
class SortTable {
  /** cols: [{key, label, n (αριθμητικό), fmt(v,row), html(row)}] */
  constructor(el, { cols, rows, sortKey, sortDir = -1, pageSize = 0 }) {
    Object.assign(this, { el, cols, rows, sortKey, sortDir, pageSize, page: 0 });
    el.addEventListener("click", (e) => {
      const th = e.target.closest("th[data-k]");
      if (th) {
        const k = th.dataset.k;
        this.sortDir = this.sortKey === k ? -this.sortDir : (this.cols.find((c) => c.key === k)?.n ? -1 : 1);
        this.sortKey = k; this.page = 0; this.render();
      }
      const pg = e.target.closest("[data-page]");
      if (pg) { this.page += +pg.dataset.page; this.render(); }
    });
    this.render();
  }
  setRows(rows) { this.rows = rows; this.page = 0; this.render(); }
  sorted() {
    const k = this.sortKey, d = this.sortDir;
    if (!k) return this.rows;
    return [...this.rows].sort((a, b) => {
      const x = a[k], y = b[k];
      if (!isNum(x) && !isNum(y)) return d * String(x ?? "").localeCompare(String(y ?? ""));
      if (!isNum(x)) return 1; if (!isNum(y)) return -1;
      return d * (x - y);
    });
  }
  render() {
    const all = this.sorted(), n = all.length, ps = this.pageSize || n;
    const pages = Math.max(1, Math.ceil(n / ps)); this.page = Math.min(this.page, pages - 1);
    const rows = all.slice(this.page * ps, this.page * ps + ps);
    const th = this.cols.map((c) => `<th data-k="${c.key}" class="sortable ${c.n ? "n" : ""} ${this.sortKey === c.key ? "sorted" + (this.sortDir > 0 ? " asc" : "") : ""}" title="${esc(STAT[c.key]?.name || c.label)}">${esc(c.label)}</th>`).join("");
    const tb = rows.map((r) => `<tr>${this.cols.map((c) => `<td class="${c.n ? "n" : ""}">${c.html ? c.html(r) : c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("");
    const pager = this.pageSize && pages > 1
      ? `<div class="pager"><span class="muted">${n} γραμμές · σελίδα ${this.page + 1}/${pages}</span><button class="btn" data-page="-1" ${this.page === 0 ? "disabled" : ""}>‹</button><button class="btn" data-page="1" ${this.page >= pages - 1 ? "disabled" : ""}>›</button></div>`
      : `<div class="pager"><span class="muted">${n} γραμμές</span></div>`;
    this.el.innerHTML = `<div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tb || `<tr><td colspan="${this.cols.length}" class="muted">Καμία γραμμή</td></tr>`}</tbody></table></div>${pager}`;
  }
  csv() {
    const head = this.cols.map((c) => c.label).join(",");
    const body = this.sorted().map((r) => this.cols.map((c) => {
      const v = r[c.key]; return isNum(v) ? (+v).toFixed(3).replace(/\.?0+$/, "") : `"${String(v ?? "").replace(/"/g, '""')}"`;
    }).join(",")).join("\n");
    return head + "\n" + body;
  }
}
const statCol = (k) => ({ key: k, label: STAT[k]?.label || k, n: true, fmt: (v) => fmtStat(k, v) });
/** Στήλη για game logs: ακέραιοι εκτός από λεπτά. */
const logCol = (k) => ({ key: k, label: STAT[k]?.label || k, n: true, fmt: (v) => fmt(v, k === "MIN" ? 1 : 0) });

/* =========================================================================
 * 7. Εφαρμογή: κατάσταση, φόρτωση δεδομένων, routing
 * ========================================================================= */
const VIEWS = ["home", "teams", "players", "court", "analysis", "explorer", "predictions", "edge", "game"];

const App = {
  manifest: null, section: "europe", comp: "E", season: null,
  cache: new Map(),       // "E2026" -> Season
  analytics: new Map(),   // "E" -> αναλυτικά (analytics_E.json) | null
  edge: new Map(),        // "E" -> μοντέλο στοιχήματος (edge_E.json) | null
  shots: new Map(),       // "E2025" -> συγκεντρωτικά σουτ (shots_E2025.json) | null
  roles: new Map(),       // "E" -> ρόλοι παικτών (roles_E.json) | null
  teamMeta: null,         // σήματα ομάδων (teams_meta.json)
  ui: {
    team: null, team2: "", players: [], pstat: "PTS", pteam: "",
    an2: { team: "", minPct: null },
    court: { a: "", b: "", lineups: {}, sel: 0 },
    ex: { level: "players", all: false, mode: "avg", team: "", minGP: 1, minMIN: 0, q: "", cs: "PTS", co: ">=", cv: "",
          cols: { players: ["GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "PIR", "FG3P", "TS"],
                  teams: ["GP", "W", "L", "PTS", "OPP", "NET", "PACE", "ORTG", "DRTG", "EFG", "TOVP", "OREBP"],
                  logs: ["MIN", "PTS", "REB", "AST", "STL", "TOV", "PIR", "PM"] } },
    predGame: "", predTarget: "PTS", cmpModel: "",
  },

  async json(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  },
  async loadSeason(comp, season) {
    const k = comp + season;
    if (!this.cache.has(k)) this.cache.set(k, new Season(await this.json(`data/${k}.json`)));
    return this.cache.get(k);
  },
  async loadOpt(map, comp, flag, file) {
    if (!map.has(comp)) {
      const c = this.compInfo(comp);
      map.set(comp, c?.[flag] ? await this.json(`data/${file}_${comp}.json`).catch(() => null) : null);
    }
    return map.get(comp);
  },
  async loadShots(comp, season) {
    const k = comp + season;
    if (!this.shots.has(k)) this.shots.set(k, await this.json(`data/shots_${k}.json`).catch(() => null));
    return this.shots.get(k);
  },
  compInfo(comp = this.comp) { return this.manifest.competitions.find((c) => c.code === comp); },
  latestSeason(comp = this.comp) { return Math.max(...this.compInfo(comp).seasons); },
  get S() { return this.cache.get(this.comp + this.season); },

  async init() {
    try {
      this.manifest = await this.json("data/manifest.json");
    } catch (e) {
      $("#view").innerHTML = `<div class="empty">Δεν βρέθηκε η βάση δεδομένων (data/manifest.json). Τρέξε το GitHub Action ή το scripts/build_site.py.</div>`;
      return;
    }
    if (!this.manifest.competitions.length) { $("#view").innerHTML = `<div class="empty">Η βάση είναι άδεια.</div>`; return; }
    $("#updated").textContent = "ενημέρωση " + this.manifest.updated;
    this.teamMeta = await this.json("data/teams_meta.json").catch(() => null);
    $("#demo-banner").hidden = !this.manifest.demo;
    const secs = this.sections();
    const savedSec = store.get("section");
    this.section = secs.some((x) => x.key === savedSec) ? savedSec : secs[0].key;
    const saved = store.get("comp");
    const inSec = this.sectionInfo().comps;
    this.comp = inSec.includes(saved) ? saved : inSec[0];
    this.season = this.latestSeason();
    this.renderControls();
    window.addEventListener("hashchange", () => this.render());
    await this.render();
  },

  /** Ενότητες (σελίδες) του site: Ευρώπη / Ελλάδα / NBA. Παλιό manifest χωρίς sections -> μία ενότητα. */
  sections() {
    return this.manifest.sections?.length ? this.manifest.sections
      : [{ key: "europe", name: "Ευρώπη", comps: this.manifest.competitions.map((c) => c.code) }];
  },
  sectionInfo() { return this.sections().find((x) => x.key === this.section) || this.sections()[0]; },

  renderControls() {
    const secs = this.sections();
    $("#section-seg").hidden = secs.length < 2;
    $("#section-seg").innerHTML = secs.map((x) =>
      `<button data-sec="${x.key}" aria-pressed="${x.key === this.section}">${esc(x.name)}</button>`).join("");
    $("#section-seg").onclick = (e) => {
      const b = e.target.closest("[data-sec]"); if (!b || b.dataset.sec === this.section) return;
      this.section = b.dataset.sec; store.set("section", this.section);
      this.comp = this.sectionInfo().comps[0]; store.set("comp", this.comp);
      this.season = this.latestSeason(); this.resetSelections(); this.renderControls(); this.render();
    };
    const comps = this.sectionInfo().comps.map((c) => this.compInfo(c)).filter(Boolean);
    $("#comp-seg").hidden = comps.length < 2;
    $("#comp-seg").innerHTML = comps.map((c) =>
      `<button data-comp="${c.code}" aria-pressed="${c.code === this.comp}">${esc(c.name)}</button>`).join("");
    $("#comp-seg").onclick = (e) => {
      const b = e.target.closest("[data-comp]"); if (!b || b.dataset.comp === this.comp) return;
      this.comp = b.dataset.comp; store.set("comp", this.comp);
      this.season = this.latestSeason(); this.resetSelections(); this.renderControls(); this.render();
    };
    const sel = $("#season-sel");
    sel.innerHTML = [...this.compInfo().seasons].reverse().map((s) => `<option value="${s}" ${s === this.season ? "selected" : ""}>${seasonLabel(s)}</option>`).join("");
    sel.onchange = () => { this.season = +sel.value; this.resetSelections(); this.render(); };
  },
  resetSelections() { this.ui.team = null; this.ui.team2 = ""; this.ui.players = []; this.ui.ex.team = ""; this.ui.predGame = ""; },

  route() {
    const h = location.hash.slice(1);
    if (h.startsWith("game/")) { this.ui.gameCode = decodeURIComponent(h.slice(5)); return "game"; }
    return VIEWS.includes(h) && h !== "game" ? h : "home";
  },
  go(view) { if (this.route() === view) this.render(); else location.hash = view; window.scrollTo(0, 0); },
  goPlayer(pid) { this.ui.players = [pid]; this.go("players"); },
  goTeam(code) { this.ui.team = code; this.ui.team2 = ""; this.go("teams"); },

  async render() {
    const info = this.compInfo();
    const off = { players: info.hasBox === false, court: info.hasBox === false, predictions: !info.edge, edge: !info.edge };
    $$("#tabs a").forEach((a) => (a.hidden = !!off[a.getAttribute("href").slice(1)]));
    if (off[this.route()]) { location.hash = "home"; return; }
    const v = this.route();
    $$("#tabs a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
    const view = $("#view");
    try {
      await this.loadSeason(this.comp, this.season);
      if (["home", "predictions", "game", "edge"].includes(v)) await this.loadOpt(this.edge, this.comp, "edge", "edge");
      if (["analysis", "teams", "players", "court", "game"].includes(v)) await this.loadOpt(this.analytics, this.comp, "analytics", "analytics");
      if (v === "players" || v === "teams") await this.loadOpt(this.roles, this.comp, "roles", "roles");
      if (v === "game") {
        const prev = this.compInfo().seasons.filter((x) => x < this.latestSeason()).slice(-1);
        for (const s of prev) await this.loadSeason(this.comp, s).catch(() => null); }
      if (["edge", "predictions", "game"].includes(v)) await this.loadSeason(this.comp, this.latestSeason());
      await Views[v](view, this.S);
    } catch (e) {
      console.error(e);
      view.innerHTML = `<div class="empty">Σφάλμα φόρτωσης: ${esc(e.message)}</div>`;
    }
  },

  /** Σύνδεσμοι που χρησιμοποιούνται σε πίνακες. */
  playerLink(pid, name) { return `<button class="link" data-pid="${esc(pid)}">${esc(name)}</button>`; },
  teamLink(code, S) { return `<button class="link" data-team="${esc(code)}">${esc(S.teamName(code))}</button>`; },
};

// Ένας κοινός click handler για όλους τους συνδέσμους παικτών/ομάδων
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pid]"); if (p) return App.goPlayer(p.dataset.pid);
  const t = e.target.closest("[data-team]"); if (t) return App.goTeam(t.dataset.team);
});

/* =========================================================================
 * 8. Σελίδες
 * ========================================================================= */
/* ---------------- Κοινά: ρόστερ, πλέγμα ομάδων (πρόσβαση με ένα κλικ σε ομάδες και παίκτες) ---------------- */
const POS_GR = { Guard: "Guard", Forward: "Forward", Center: "Center" };
/** Πληροφορίες παίκτη για κάρτες: αναλυτικά (OVR), ρόλος, βιομετρικά. */
function playerMeta(S, pid) {
  const A = App.analytics.get(App.comp)?.seasons?.[String(S.season)];
  if (A?.players && !A._idx) A._idx = new Map(rowsToObjs(A.players).map((r) => [r.pid, r]));
  const RJ = App.roles.get(App.comp);
  if (RJ && !RJ._idx) RJ._idx = {};
  const key = String(S.season);
  if (RJ && !RJ._idx[key]) RJ._idx[key] = new Map((RJ.players?.[key] || []).map((row) => { const o = Object.fromEntries(RJ.cols.map((c, i) => [c, row[i]])); return [o.pid, o]; }));
  const o = RJ?._idx[key]?.get(pid);
  const role = o ? o.probs.map((q, k) => [k, q]).sort((a, b) => b[1] - a[1])[0] : null;
  return { r: A?._idx?.get(pid), o, role: role ? { name: RJ.roles[role[0]].name, p: role[1] } : null, b: S.bio?.[pid] || {} };
}
function teamGrid(S, active, attr = "data-team") {
  const codes = [...new Set(S.playerAgg.map((p) => p.team))].sort((a, b) => S.teamName(a).localeCompare(S.teamName(b)));
  return `<div class="team-grid">${codes.map((c) => `<button ${attr}="${esc(c)}" class="${c === active ? "on" : ""}" title="${esc(S.teamName(c))}">${Gfx.badge(c, 22)}<span>${esc(S.teamName(c))}</span></button>`).join("")}</div>`;
}
function rosterCards(S, code, attr = "data-pid") {
  const ps = S.playerAgg.filter((p) => p.team === code).sort((a, b) => b.MIN_AVG - a.MIN_AVG);
  return `<div class="roster">${ps.map((p) => {
    const m = playerMeta(S, p.pid), b = m.b;
    const sub = [b.number ? "#" + b.number : "", b.pos || m.r?.pos || "", b.height ? b.height + " cm" : "", `${fmt(p.MIN_AVG, 0)}′ · ${fmt(p.PTS, 1)} π.`].filter(Boolean).join(" · ");
    return `<button class="rcard" ${attr}="${esc(p.pid)}">${Gfx.photo(b.photo, p.player, p.team, 44)}
      <span style="min-width:0"><span class="nm">${esc(p.player)}</span><br><span class="sub">${esc(sub)}</span>${m.role ? `<br><span class="sub" style="color:var(--fg)">${esc(m.role.name)}</span>` : ""}</span>
      ${isNum(m.r?.ovr) ? `<span class="ovr-s" title="OVR">${m.r.ovr}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

const Views = {
  /* ---------------- Αρχική: επερχόμενα + προσομοίωση + αποτελέσματα + βαθμολογία ---------------- */
  home(el, S) {
    const sim = new MatchSim(S, S.season === App.latestSeason() ? App.edge.get(App.comp) : null);
    const nextRound = S.upcoming.length ? S.upcoming[0].round : null;
    const upcoming = S.upcoming.filter((g) => g.round === nextRound).slice(0, 12);
    const lastRound = S.games.length ? Math.max(...S.games.map((g) => g.round || 0)) : null;
    const results = S.games.filter((g) => g.round === lastRound);

    const gameCard = (g, i) => {
      const r = sim.run(g.home, g.away, 3000, g.gameCode);
      const ph = Math.round(r.pHome * 100);
      return `<article class="game" data-i="${i}" data-game="${esc(g.gameCode)}" style="cursor:pointer">
        <div class="meta"><span>${fmtDate(g.date)} ${esc(g.time || "")}</span><span>Αγ. ${g.round ?? "–"}</span></div>
        <div class="match">
          <span class="team">${App.teamLink(g.home, S)}</span><span class="score muted">${Math.round(r.mh)}</span>
          <span class="team">${App.teamLink(g.away, S)}</span><span class="score muted">${Math.round(r.ma)}</span>
        </div>
        <div class="probbar" aria-label="Πιθανότητα νίκης"><i style="width:${ph}%"></i><i style="width:${100 - ph}%"></i></div>
        <div class="problabels"><span>${ph}% νίκη έδρας${r.mv_h || r.mv_a ? ` <span title="Μετρήθηκαν απουσίες βασικών">· απουσίες</span>` : ""}</span><span>${100 - ph}%</span></div>
        <div class="actions"><a class="btn primary" href="#game/${encodeURIComponent(g.gameCode)}" style="text-decoration:none">Ανάλυση αγώνα →</a><button class="btn" data-sim="${i}">Προσομοίωση</button><button class="btn" data-once="${i}">Παίξε ένα ματς</button></div>
        <div class="simbox" hidden></div>
      </article>`;
    };
    const resultCard = (g) => {
      const hw = g.hs > g.as;
      return `<article class="game">
        <div class="meta"><span>${fmtDate(g.date)}</span><span>Αγ. ${g.round ?? "–"}</span></div>
        <div class="match">
          <span class="team ${hw ? "win" : "loss"}">${App.teamLink(g.home, S)}</span><span class="score">${g.hs ?? "–"}</span>
          <span class="team ${hw ? "loss" : "win"}">${App.teamLink(g.away, S)}</span><span class="score">${g.as ?? "–"}</span>
        </div></article>`;
    };

    el.innerHTML = `
      <section>
        <div class="sec-head"><h2>${nextRound != null ? `Επόμενη αγωνιστική · ${nextRound}η` : "Δεν υπάρχουν επερχόμενα ματς"}</h2>
          <span class="muted">${esc(App.compInfo().name)} ${seasonLabel(S.season)}</span></div>
        ${upcoming.length ? `<p class="muted" style="margin:0">Οι αριθμοί δίπλα στις ομάδες είναι το αναμενόμενο σκορ και η μπάρα η πιθανότητα νίκης από το Monte Carlo: ratings επίθεσης/άμυνας προσαρμοσμένα στον αντίπαλο (με μνήμη από την προηγούμενη σεζόν), έδρα και αβεβαιότητα μετρημένες σε αυτή τη λίγκα, και διόρθωση για απουσίες βασικών. Πάτα ένα ματς για την πλήρη ανάλυση.</p>
        <div class="games" id="up">${upcoming.map(gameCard).join("")}</div>` : `<div class="empty">Η σεζόν ${seasonLabel(S.season)} δεν έχει άλλα προγραμματισμένα ματς.</div>`}
      </section>
      ${results.length ? `<section><div class="sec-head"><h2>Αποτελέσματα · ${lastRound}η αγωνιστική</h2></div>
        <div class="games">${results.map(resultCard).join("")}</div></section>` : ""}
      <section><div class="sec-head"><h2>Βαθμολογία</h2></div><div id="standings"></div></section>`;

    const st = S.standings().map((t, i) => ({ ...t, pos: i + 1 }));
    new SortTable($("#standings", el), {
      cols: [{ key: "pos", label: "#", n: true }, { key: "name", label: "Ομάδα", html: (r) => App.teamLink(r.code, S) },
        statCol("GP"), statCol("W"), statCol("L"), statCol("PTS"), statCol("OPP"), statCol("DIFF"), ...(S.hasBox ? [statCol("NET")] : [])],
      rows: st, sortKey: "pos", sortDir: 1,
    });

    // κουμπιά προσομοίωσης
    const up = $("#up", el);
    if (up) up.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sim],[data-once]");
      if (!b) {   // κλικ στην κάρτα (όχι σε κουμπί/σύνδεσμο) -> σελίδα αγώνα
        const card = e.target.closest("[data-game]");
        if (card && !e.target.closest("a,button,.simbox")) location.hash = "game/" + encodeURIComponent(card.dataset.game);
        return;
      }
      const i = +(b.dataset.sim ?? b.dataset.once), g = upcoming[i], box = $(`.game[data-i="${i}"] .simbox`, up);
      box.hidden = false;
      if (b.dataset.once != null) {
        const r = sim.once(g.home, g.away, g.gameCode);
        const old = $(".single-result", box);
        const line = `<div class="single-result">${esc(S.teamName(g.home))} ${r.hs} – ${r.as} ${esc(S.teamName(g.away))}${r.ot ? ` (${r.ot > 1 ? r.ot + "×" : ""}παράταση)` : ""}</div>`;
        if (old) old.outerHTML = line; else box.insertAdjacentHTML("afterbegin", line);
        return;
      }
      const r = sim.run(g.home, g.away, 10000, g.gameCode);
      const single = $(".single-result", box)?.outerHTML || "";
      box.innerHTML = `${single}
        <div class="row" style="justify-content:space-between"><span class="eyebrow">10.000 προσομοιώσεις</span>
          <span class="num">${fmt(r.avgH)} – ${fmt(r.avgA)}</span></div>
        <div class="chart">${Charts.marginHist(r.margins)}</div>
        <div class="problabels"><span>νίκη έδρας ${fmtPct(r.pHome)}</span><span>διαφορά πόντων (έδρα − φιλοξ.)</span></div>`;
    });
  },

  /* ---------------- Ομάδες: προφίλ + σύγκριση ---------------- */
  teams(el, S) {
    const agg = S.teamAgg, list = S.standings();
    if (!list.length) { el.innerHTML = `<div class="empty">Δεν έχουν παιχτεί ακόμα ματς σε αυτή τη σεζόν.</div>`; return; }
    if (!agg.has(App.ui.team)) App.ui.team = list[0].code;
    if (App.ui.team2 && !agg.has(App.ui.team2)) App.ui.team2 = "";
    const A = agg.get(App.ui.team), B = App.ui.team2 ? agg.get(App.ui.team2) : null;
    const opts = (sel, blank) => (blank ? `<option value="">— χωρίς σύγκριση —</option>` : "") +
      [...list].sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option value="${t.code}" ${t.code === sel ? "selected" : ""}>${esc(t.name)}</option>`).join("");

    el.innerHTML = `
      ${S.hasBox ? `<section>${teamGrid(S, App.ui.team)}</section>` : ""}
      <section><div class="filters">
        <label>Ομάδα<select id="t1">${opts(App.ui.team)}</select></label>
        <label>Σύγκριση με<select id="t2">${opts(App.ui.team2, true)}</select></label>
        <a class="btn" href="#analysis" style="text-decoration:none">Ανάλυση όλων των ομάδων →</a>
      </div></section><div id="tv" style="display:flex;flex-direction:column;gap:28px"></div>`;
    $("#t1", el).onchange = (e) => { App.ui.team = e.target.value; Views.teams(el, S); };
    $("#t2", el).onchange = (e) => { App.ui.team2 = e.target.value; Views.teams(el, S); };
    const tv = $("#tv", el);
    const rank = (k, v) => { const vals = list.map((t) => t[k]); const low = STAT[k]?.low; return 1 + vals.filter((x) => (low ? x < v : x > v)).length; };

    if (!B) {
      const tile = (k, v = A[k]) => `<div class="tile"><div class="v">${fmtStat(k, v)}</div><div class="l">${STAT[k].name} · ${rank(k, v)}η</div></div>`;
      const gs = A.games;
      tv.innerHTML = `
        <section><div class="sec-head"><h2>${esc(A.name)}</h2><span class="num">${A.W}–${A.L}</span></div>
          <div class="tiles">${(S.hasBox ? ["PTS", "OPP", "NET", "ORTG", "DRTG", "PACE", "EFG", "TOVP"] : ["PTS", "OPP", "DIFF", "WPCT"]).map((k) => tile(k)).join("")}</div>
          ${(() => {
            const an = App.analytics.get(App.comp)?.seasons?.[String(S.season)];
            const t = an ? rowsToObjs(an.teams).find((x) => x.team === A.code) : null;
            if (!t) return "";
            const sg = (v) => (isNum(v) ? (v > 0 ? "+" : "") + (+v).toFixed(1) : "–");
            const at = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
            return `<div class="tiles" style="margin-top:10px">${at(`${sg(t.adj_net)} <span class="muted" style="font-size:13px">${t.adj_rank}η</span>`, "Προσαρμοσμένο net (θέση)")}${at(sg(t.sos), "Δυσκολία προγράμματος")}${at(`${fmt(t.exp_w)}`, `Αναμενόμενες νίκες (έχει ${t.W})`)}${at(sg(t.luck), "Τύχη (νίκες − αναμενόμενες)")}${at(`${t.close_w}–${t.close_l}`, "Κλειστά ματς (≤5 π.)")}</div>`;
          })()}</section>
        <section><h3>Πόντοι ανά αγώνα</h3>
          <div class="legend"><span><i class="c1bg"></i>Πέτυχε</span><span><i class="c2bg"></i>Δέχτηκε</span></div>
          <div class="chart">${Charts.line({ series: [
            { k: "k1", dots: true, pts: gs.map((g, i) => [i + 1, g.PTS]) },
            { k: "k2", dots: true, pts: gs.map((g, i) => [i + 1, g.o.PTS]) }],
            xLabel: (x) => "Αγ." + (gs[x - 1]?.round ?? x) })}</div></section>
        ${S.hasBox ? `<section><h3>Ρόστερ</h3><p class="muted" style="margin:0 0 8px;font-size:13px">Πάτα έναν παίκτη για την κάρτα του.</p>${rosterCards(S, A.code)}</section>
          <section><h3>Ρόστερ (μέσοι όροι)</h3><div id="roster"></div></section>` : ""}
        <section><h3>Αγώνες</h3><div id="glog"></div></section>`;
      if (S.hasBox) new SortTable($("#roster", tv), {
        cols: [{ key: "player", label: "Παίκτης", html: (r) => App.playerLink(r.pid, r.player) },
          ...["GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "PIR", "FG2P", "FG3P", "FTP", "TS"].map(statCol)],
        rows: S.playerAgg.filter((p) => p.team === A.code), sortKey: "PIR",
      });
      new SortTable($("#glog", tv), {
        cols: [{ key: "round", label: "Αγ.", n: true }, { key: "date", label: "Ημ/νία", fmt: fmtDate },
          { key: "opp", label: "Αντίπαλος", html: (r) => (r.home ? "vs " : "@ ") + App.teamLink(r.opp, S) },
          { key: "res", label: "Αποτ.", html: (r) => `<span class="pill ${r.win ? "w" : "l"}">${r.win ? "Ν" : "Η"}</span> <span class="num">${r.PTS}–${r.o.PTS}</span>` },
          ...(S.hasBox ? [statCol("PIR"), statCol("AST"), statCol("TOV")] : [])],
        rows: gs.map((g) => ({ ...g, res: g.PTS - g.o.PTS })), sortKey: "round", sortDir: -1,
      });
      return;
    }

    // ---- σύγκριση δύο ομάδων ----
    const pctRank = (k, v) => { const vals = list.map((t) => t[k]); const low = STAT[k]?.low; return vals.filter((x) => (low ? x > v : x < v)).length / Math.max(1, vals.length - 1); };
    const RADAR = ["ORTG", "DRTG", "PACE", "EFG", "OREBP", "TOVP", "FTR", "AST", "STL", "BLK"];
    const h2h = A.games.filter((g) => g.opp === B.code);
    const roll = (gs) => gs.map((g, i) => [i + 1, mean(gs.slice(Math.max(0, i - 2), i + 1).map((x) => x.PTS - x.o.PTS))]);
    tv.innerHTML = `
      <section><div class="legend"><span><i class="c1bg"></i>${esc(A.name)} (${A.W}–${A.L})</span><span><i class="c2bg"></i>${esc(B.name)} (${B.W}–${B.L})</span></div></section>
      <div class="grid2">
        ${!S.hasBox ? "" : `<section><h3>Προφίλ (εκατοστημόριο στη λίγκα)</h3>
          <div class="chart">${Charts.radar({ axes: RADAR.map((k) => STAT[k].label), series: [
            { k: "k1", vals: RADAR.map((k) => pctRank(k, A[k])) }, { k: "k2", vals: RADAR.map((k) => pctRank(k, B[k])) }] })}</div>
          <p class="muted" style="margin:0;font-size:13px">Πιο έξω = καλύτερο (για DRTG και TOV% έχει αντιστραφεί).</p></section>`}
        <section><h3>Στατιστικά</h3><div class="tbl-wrap"><table><thead><tr><th>Στατιστικό</th><th class="n">${esc(A.code)}</th><th class="n">${esc(B.code)}</th></tr></thead><tbody>
          ${(S.hasBox ? TEAM_COLS : TEAM_BASIC).filter((k) => k !== "GP").map((k) => {
            const a = A[k], b = B[k], low = STAT[k].low, nt = STAT[k].neutral, ab = !nt && (low ? a < b : a > b), ba = !nt && (low ? b < a : b > a);
            return `<tr><td>${STAT[k].name}</td><td class="n ${ab ? "better" : ""}">${fmtStat(k, a)}</td><td class="n ${ba ? "better" : ""}">${fmtStat(k, b)}</td></tr>`;
          }).join("")}</tbody></table></div></section>
      </div>
      <section><h3>Διαφορά πόντων ανά αγώνα (κυλιόμενος μέσος 3)</h3>
        <div class="chart">${Charts.line({ series: [{ k: "k1", pts: roll(A.games) }, { k: "k2", pts: roll(B.games) }], xLabel: (x) => "#" + x })}</div></section>
      <section><h3>Μεταξύ τους</h3>${h2h.length ? `<div class="games">${h2h.map((g) => `<article class="game"><div class="meta"><span>${fmtDate(g.date)}</span><span>Αγ. ${g.round}</span></div>
        <div class="match"><span class="team">${esc(S.teamName(g.home ? A.code : B.code))}</span><span class="score">${g.home ? g.PTS : g.o.PTS}</span>
        <span class="team">${esc(S.teamName(g.home ? B.code : A.code))}</span><span class="score">${g.home ? g.o.PTS : g.PTS}</span></div></article>`).join("")}</div>`
        : `<div class="empty">Δεν έχουν παίξει μεταξύ τους αυτή τη σεζόν.</div>`}</section>`;
  },

  /* ---------------- Παίκτες: προφίλ (ratings 0–99), τι ξεχωρίζει, εκατοστημόρια, shot chart, σύγκριση 2 ---------------- */
  async players(el, S) {
    const pa = S.playerAgg;
    if (!pa.length) { el.innerHTML = `<div class="empty">Δεν υπάρχουν στατιστικά παικτών για αυτή τη σεζόν.</div>`; return; }
    const AN = App.analytics.get(App.comp), A = AN?.seasons?.[String(S.season)];
    const R = new Map(A?.players ? rowsToObjs(A.players).map((p) => [p.pid, p]) : []);
    const pool = [...R.values()].filter((p) => p.qual);
    const SH = A?.shots ? await App.loadShots(App.comp, S.season) : null;
    // ---- ρόλοι (roles.py): σχήμα κανονικοποιημένο σε μήκος 1, πιθανότητες ρόλων, πιο όμοιοι ----
    const RJ = App.roles.get(App.comp);
    const RO = new Map((RJ?.players?.[String(S.season)] || []).map((row) => { const o = Object.fromEntries(RJ.cols.map((c, i) => [c, row[i]])); return [o.pid, o]; }));
    const LG = { E: "EL", U: "EC", NBA: "NBA", GBL: "GBL" };
    const seasonLbl = (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
    const rv = (shape) => shape.map((v) => 0.5 + 0.5 * v);                       // μεσαίος κύκλος = μέσος όρος
    const SHORT = { "Σώμα/ριμπάουντ": "Σώμα/ριμπ.", "Καλάθι/βολές": "Καλάθι", "Μέση απόσταση": "Μέση απόστ." };
    const rAxes = () => RJ.axes.map((a) => SHORT[a] || a);
    const topRoles = (o) => o.probs.map((q, k) => [k, q]).sort((a, b) => b[1] - a[1]);
    const roleNote = `<p class="muted" style="margin:0;font-size:12px">Το σχήμα δείχνει <b>πώς</b> παίζει, όχι πόσο καλός είναι: οι 6 άξονες (από SVD 14 μεγεθών στυλ και σώματος) μετρούν την απόκλιση από τον μέσο όρο της λίγκας του (διακεκομμένος κύκλος), και όλο το σχήμα κανονικοποιείται σε μήκος 1, ώστε δύο παίκτες με ίδιο στυλ να πέφτουν ο ένας πάνω στον άλλο. Ρόλοι: soft clustering σε ${RJ?.n_fit ?? ""} παίκτες-σεζόν EuroLeague, EuroCup και NBA (≥${RJ?.min_fit ?? 300}′).</p>`;
    const similarBlock = (p) => {
      const o = RO.get(p.pid);
      if (!o) return "";
      const sim = o.similar.map(([pid, name, comp, season, c]) => {
        const nm = comp === App.comp && season === S.season ? App.playerLink(pid, niceName(name)) : esc(niceName(name));
        return `<li>${nm} <span class="muted">${LG[comp] || comp} ${seasonLbl(season)}</span> <b class="num" title="ομοιότητα σχήματος (100 = ίδιο στυλ)">${Math.round(100 * c)}</b></li>`; }).join("");
      return `<h3 style="margin-top:14px">Παίζουν με παρόμοιο τρόπο</h3><ul class="insights" style="margin:0">${sim}</ul>`;
    };
    // ---- κάρτα παίκτη (τύπου manager): στοιχεία, radar ρόλου, χαρακτηριστικά όπως είναι στη βάση ----
    const poolBox = pa.filter((x) => x.GP >= Math.max(3, 0.3 * Math.max(...pa.map((y) => y.GP))) && x.MIN_AVG >= 10);
    const poolAn = [...R.values()].filter((x) => x.qual);
    const tier = (pool, key, v, low) => {
      const vals = pool.map((x) => x[key]).filter(isNum);
      if (!vals.length || !isNum(v)) return "";
      const q = vals.filter((x) => (low ? x > v : x < v)).length / vals.length;
      return q >= 0.95 ? "top" : q >= 0.8 ? "hi" : q <= 0.15 ? "lo" : "";
    };
    const ATTRS = [
      ["Επίθεση", [["Πόντοι", "PTS"], ["2π %", "FG2P", "pct"], ["3π %", "FG3P", "pct"], ["Βολές %", "FTP", "pct"], ["True shooting %", "TS", "pct"], ["Τρίποντα εύστοχα", "FG3M"], ["Βολές (προσπάθειες)", "FTA"]]],
      ["Δημιουργία", [["Ασίστ", "AST"], ["Λάθη", "TOV", null, true], ["Usage %", "usg", "pct", false, "an"], ["Ασίστ % (AST%)", "ast_pct", "pct", false, "an"]]],
      ["Άμυνα και ριμπάουντ", [["Ριμπάουντ", "REB"], ["Επιθετικά ριμπάουντ", "OREB"], ["Κλεψίματα", "STL"], ["Κοψίματα", "BLK"]]],
      ["Γενικά", [["Λεπτά", "MIN_AVG"], ["Αγώνες (βασικός)", "GP"], ["PIR", "PIR"], ["+/−", "PM"]]],
    ];
    const fmCard = (p) => {
      const m = playerMeta(S, p.pid), r = m.r, o = m.o, b = m.b;
      const age = b.birth ? Math.floor((Date.now() - Date.parse(b.birth)) / 3.15576e10) : null;
      const facts = [["Θέση", b.pos ? POS_GR[b.pos] || b.pos : r?.pos ? r.pos + "*" : null], ["Ηλικία", age], ["Ύψος", b.height ? b.height + " cm" : null],
        ["Βάρος", b.weight ? b.weight + " kg" : null], ["Εθνικότητα", b.country], ["Αριθμός", b.number ? "#" + b.number : null], ["Ομάδα", App.teamLink(p.team, S)]]
        .filter(([, v]) => v != null && v !== "").map(([k, v]) => `<dt>${k}</dt><dd>${k === "Ομάδα" ? v : esc(v)}</dd>`).join("");
      const tr = o ? topRoles(o) : [];
      const roles = o ? `<div class="eyebrow" style="margin-top:12px">Ρόλος</div>
        <div style="font-weight:700;margin:2px 0 6px">${esc(RJ.roles[tr[0][0]].name)}</div>
        <div class="rbars">${tr.filter(([, q]) => q >= 0.08).slice(0, 3).map(([k, q]) => `<div class="rbar"><span>${esc(RJ.roles[k].name)}</span><b>${Math.round(100 * q)}%</b><span class="pbar"><i style="width:${Math.max(2, 100 * q)}%"></i></span></div>`).join("")}</div>
        ${o.fit ? "" : `<p class="muted" style="margin:6px 0 0;font-size:12px">Μικρό δείγμα (κάτω από ${RJ.min_fit}′): εκτίμηση.</p>`}` : "";
      const radar = o ? `<div class="chart">${Charts.radar({ axes: rAxes(), series: [{ k: "k1", vals: rv(o.shape) }, { k: "k3", dash: true, vals: rv(RJ.roles[tr[0][0]].center) }], mid: true, W: 480 })}</div>
          <div class="legend"><span><i class="c1bg"></i>${esc(p.player)}</span><span><i style="background:var(--c3)"></i>${esc(RJ.roles[tr[0][0]].name)} (κέντρο ρόλου)</span></div>`
        : `<div class="empty">${RJ ? `Δεν υπάρχει σχήμα ρόλου: χρειάζονται τουλάχιστον ${RJ.min_show}′.` : "Δεν υπάρχουν ρόλοι για αυτή τη λίγκα (χρειάζονται ζώνες σουτ)."}</div>`;
      const val = ([label, key, kind, low, src]) => {
        const v = key === "GP" ? `${p.GP} (${p.GS})` : src === "an" ? r?.[key] : p[key];
        const txt = key === "GP" ? v : !isNum(v) ? "–" : kind === "pct" ? (100 * v).toFixed(1) + "%" : key === "PM" ? (v > 0 ? "+" : "") + fmt(v, 1) : fmt(v, 1);
        const cls = key === "GP" ? "" : tier(src === "an" ? poolAn : poolBox, key, v, low);
        return `<div class="fm-attr"><span>${label}</span><b class="${cls}">${txt}</b></div>`;
      };
      return `<div class="fm" style="border-left:4px solid var(--c1)">
        <div><div class="fm-head">${Gfx.photo(b.photo, p.player, p.team, 76)}
            <div style="min-width:0"><div class="fm-name">${esc(p.player)}</div>
              <div class="row muted" style="gap:6px;font-size:13px">${Gfx.badge(p.team, 18)} ${esc(S.teamName(p.team))}</div></div>
            ${r && isNum(r.ovr) ? `<div class="ovr ${ovrCls(r.ovr)}" style="margin-left:auto" title="Συνολική βαθμολογία: επιρροή στη διαφορά πόντων${isNum(r.pc_ovr) ? " · " + topPct(r.pc_ovr) + " της λίγκας" : ""}"><b>${r.ovr}</b><span>OVR</span></div>` : ""}</div>
          <dl class="fm-facts">${facts}</dl>${roles}</div>
        <div>${radar}</div>
        <div class="fm-attrs">${ATTRS.map(([g, list]) => `<div class="fm-group"><h4>${g}</h4>${list.map(val).join("")}</div>`).join("")}
          <p class="muted" style="grid-column:1/-1;margin:2px 0 0;font-size:12px">Μέσοι όροι ανά αγώνα στη σεζόν, όπως είναι στη βάση. <span style="color:var(--good)">Πράσινο</span>: στο κορυφαίο 20% της λίγκας (υπογραμμισμένο: 5%), <span style="color:var(--bad)">κόκκινο</span>: στο χαμηλότερο 15%.</p></div>
      </div>${o ? roleNote : ""}`;
    };
    const roleCompare = (sel) => {
      const os = sel.map((p) => RO.get(p.pid));
      if (!RJ || os.some((o) => !o)) return "";
      const cos = os[0].shape.reduce((a, v, i) => a + v * os[1].shape[i], 0);
      return `<section><h3>Ρόλος και στυλ</h3><div class="grid2">
        <div><div class="chart">${Charts.radar({ axes: rAxes(), series: os.map((o, i) => ({ k: "k" + (i + 1), vals: rv(o.shape) })), mid: true, W: 480 })}</div>
          <div class="legend">${sel.map((p, i) => `<span><i class="c${i + 1}bg"></i>${esc(p.player)}</span>`).join("")}</div></div>
        <div><div class="tile"><div class="v">${Math.round(100 * cos)}</div><div class="l">ομοιότητα σχήματος: 100 = ίδιο στυλ, 0 = άσχετο, −100 = αντίθετο</div></div>
          ${os.map((o, i) => { const [k, q] = topRoles(o)[0]; return `<p style="margin:10px 0 0"><b style="color:var(--c${i + 1})">${esc(sel[i].player)}</b>: ${esc(RJ.roles[k].name)} <span class="muted">${Math.round(100 * q)}%</span></p>`; }).join("")}</div>
      </div>${roleNote}</section>`;
    };
    const byId = new Map(pa.map((p) => [p.pid, p]));
    App.ui.players = App.ui.players.filter((id) => byId.has(id)).slice(0, 2);
    if (!App.ui.players.length) {
      const best = pool.length ? [...pool].sort((a, b) => b.ovr - a.ovr)[0]?.pid : [...pa].filter((p) => p.GP >= 3).sort((a, b) => b.PIR - a.PIR)[0]?.pid;
      App.ui.players = [best || pa[0].pid];
    }
    const sel = App.ui.players.map((id) => byId.get(id));
    const chartStats = ["PTS", "REB", "AST", "PIR", "MIN", "STL", "TOV", "FG3M", "FTA", "PM"];
    if (!chartStats.includes(App.ui.pstat)) App.ui.pstat = "PTS";
    const k = App.ui.pstat;

    // ---- βοηθητικά ----
    const METRICS = [
      ["mpg", "Λεπτά / αγώνα", (v) => fmt(v)], ["pts100", "Πόντοι / 100 κατοχές", (v) => fmt(v)],
      ["usg", "Usage %", fmtPct], ["ts_adj", "True shooting % (διορθ.)", fmtPct],
      ["fg3_adj", "Τρίποντα % (διορθ.)", fmtPct, (p) => p.fg3_rate >= 0.15], ["ft_adj", "Βολές %", fmtPct],
      ["ast_pct", "Ασίστ % (AST%)", fmtPct], ["tov_pct", "Λάθη / κατοχή που τελειώνει", fmtPct, null, true],
      ["orb_pct", "Επιθ. ριμπάουντ %", fmtPct], ["drb_pct", "Αμυν. ριμπάουντ %", fmtPct],
      ["stl100", "Κλεψίματα / 100", (v) => fmt(v)], ["blk100", "Κοψίματα / 100", (v) => fmt(v)],
      ["onoff", "On/Off (π. / 100, συρρικν.)", (v) => (isNum(v) ? (v > 0 ? "+" : "") + fmt(v) : "–")],
    ].filter(([key]) => pool.some((p) => isNum(p[key])));
    const pctl = (key, v, low) => {
      const vals = pool.map((p) => p[key]).filter(isNum);
      if (!vals.length || !isNum(v)) return NaN;
      const below = vals.filter((x) => (low ? x > v : x < v)).length;
      return below / vals.length;
    };
    const CATS = [["r_sco", "Σκοράρισμα"], ["r_sho", "Σουτ"], ["r_pla", "Δημιουργία"], ["r_reb", "Ριμπάουντ"], ["r_def", "Άμυνα"]];
    const topPct = (pc) => (isNum(pc) ? (pc >= 50 ? `top ${Math.max(1, 100 - pc)}%` : `κάτω ${Math.max(1, pc)}%`) : "");
    const sgn = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + fmt(v, d) : "–");
    const bar = (v, max = 99, cls = "") => `<span class="pbar ${cls}"><i style="width:${isNum(v) ? Math.max(2, Math.min(100, (100 * v) / max)) : 0}%"></i></span>`;
    const ovrCls = (v) => (v >= 90 ? "elite" : v >= 75 ? "good" : "");

    const card = (p, i) => {
      const r = R.get(p.pid);
      const head = `<div class="pcard-head">${Gfx.avatar(p.player, p.team, 64)}
          <div style="min-width:0"><div class="pcard-name">${esc(p.player)}</div>
            <div class="row muted" style="gap:6px;font-size:13px">${Gfx.badge(p.team, 18)} ${App.teamLink(p.team, S)}${r?.pos ? ` · <span title="Εκτίμηση από το προφίλ στατιστικών">${r.pos}*</span>` : ""} · ${p.GP} αγ. · ${fmt(p.MIN_AVG ?? p.MIN)}'</div></div>
          ${r && isNum(r.ovr) ? `<div class="ovr ${ovrCls(r.ovr)}" title="Συνολική βαθμολογία (0–99): επιρροή στη διαφορά πόντων${isNum(r.pc_ovr) ? ` · ${topPct(r.pc_ovr)} της λίγκας` : ""}"><b>${r.ovr}</b><span>OVR</span></div>` : ""}</div>`;
      if (!r || !isNum(r.ovr)) return `<div class="pcard" style="border-color:var(--c${i + 1})">${head}<p class="muted" style="margin:0">Δεν υπάρχουν αναλυτικά για αυτόν τον παίκτη.</p></div>`;
      return `<div class="pcard" style="border-color:var(--c${i + 1})">${head}
        ${isNum(r.imp) ? `<div class="tile" style="padding:10px 12px"><div class="row" style="gap:14px;flex-wrap:wrap;font-size:13px">
            <span><span class="muted">Επιρροή</span> <b class="num">${sgn(r.imp)}</b> <span class="muted">π./100</span></span>
            <span><span class="muted">επίθεση</span> <b class="num">${sgn(r.imp_o)}</b></span><span><span class="muted">άμυνα</span> <b class="num">${sgn(r.imp_d)}</b></span>
            ${isNum(r.pc_ovr) ? `<span class="pill ${r.pc_ovr >= 50 ? "w" : "l"}">${topPct(r.pc_ovr)} της λίγκας</span>` : ""}</div>
          <div class="muted" style="font-size:12px;margin-top:4px">${r.imp_src === "rapm" ? "Από το play-by-play: πόσο αλλάζει η διαφορά πόντων όταν παίζει, με διόρθωση για συμπαίκτες και αντιπάλους (RAPM), ξεκινώντας από την εκτίμηση των στατιστικών του." : "Εκτίμηση από τα στατιστικά του (μοντέλο που έμαθε από το play-by-play της EuroLeague/EuroCup ποια στατιστικά συνδέονται με τη νίκη)."}</div></div>` : ""}
        <div class="rbars">${CATS.map(([key, label]) => `<div class="rbar" title="${topPct(r["pc_" + key])}"><span>${label}</span><b>${r[key]}</b>${bar(r[key], 99, ovrCls(r[key]))}</div>`).join("")}</div>
        ${!r.qual ? `<p class="muted" style="margin:0;font-size:12px">Λίγα λεπτά (${fmt(r.MIN, 0)}'): οι βαθμολογίες είναι τραβηγμένες προς τον μέσο όρο.</p>` : ""}</div>`;
    };
    const insights = (p) => {
      const r = R.get(p.pid);
      if (!r || !r.qual) return "";
      const items = METRICS.filter(([key, , , cond]) => !cond || cond(r)).map(([key, label, f, , low]) => ({ label, v: f(r[key]), p: pctl(key, r[key], low) })).filter((x) => isNum(x.p));
      const top = items.filter((x) => x.p >= 0.85).sort((a, b) => b.p - a.p).slice(0, 4);
      const weak = items.filter((x) => x.p <= 0.15).sort((a, b) => a.p - b.p).slice(0, 2);
      if (!top.length && !weak.length) return `<p class="muted" style="margin:0">Κανένα μέγεθος δεν ξεχωρίζει έντονα: ισορροπημένο προφίλ κοντά στον μέσο όρο της λίγκας.</p>`;
      return `<ul class="insights">${top.map((x) => `<li><span class="pill w">κορυφαίο ${Math.max(1, Math.round(100 * (1 - x.p)))}%</span> ${esc(x.label)}: <b>${x.v}</b></li>`).join("")}${weak.map((x) => `<li><span class="pill l">χαμηλότερο ${Math.max(1, Math.round(100 * x.p))}%</span> ${esc(x.label)}: <b>${x.v}</b></li>`).join("")}</ul>`;
    };
    const ZL = { rim: "Στο καλάθι", paint: "Ρακέτα", mid: "Μέση απόσταση", corner3: "Γωνία 3π", arc3: "3π (κορυφή/πλάγια)" };
    const shotBlock = (p, W) => {
      if (SH && SH.players[p.pid]) {
        const z = SH.pzones[p.pid] || [], lz = SH.league.zones, tot = z.reduce((s, x) => s + x[0], 0), ltot = lz.reduce((s, x) => s + x[0], 0);
        return `<div class="chart" style="max-width:${W}px">${Court.shotChart({ cells: SH.players[p.pid], league: SH.league.hex, hex: SH.hex, comp: App.comp, W, title: "Χάρτης σουτ " + p.player })}</div>
          <div class="tbl-wrap"><table><thead><tr><th>Ζώνη</th><th class="n">Σουτ</th><th class="n">% σουτ (λίγκα)</th><th class="n">Εύστοχα % (λίγκα)</th></tr></thead><tbody>
            ${SH.zones.map((zn, i) => { const [a, m] = z[i] || [0, 0], [la, lm] = lz[i]; const fg = a ? m / a : NaN, lf = la ? lm / la : NaN, d = fg - lf;
              return `<tr><td>${ZL[zn]}</td><td class="n">${a}</td><td class="n">${fmtPct(a / Math.max(1, tot))} <span class="muted">(${fmtPct(la / ltot)})</span></td><td class="n">${a ? `<span class="${a >= 10 && d > 0.03 ? "better" : ""}" ${a >= 10 && d < -0.03 ? 'style="color:var(--bad)"' : ""}>${fmtPct(fg)}</span>` : "–"} <span class="muted">(${fmtPct(lf)})</span></td></tr>`; }).join("")}
          </tbody></table></div>`;
      }
      // χωρίς συντεταγμένες (GBL): κατανομή από τα box scores
      const lgA = (key) => { const t = pa.reduce((s, x) => s + x[key] * x.GP, 0); return t; };
      const l2a = lgA("FG2A"), l3a = lgA("FG3A"), lfa = lgA("FTA"), lsum = l2a + l3a;
      const lf2 = lgA("FG2M") / l2a, lf3 = lgA("FG3M") / l3a, lft = lgA("FTM") / lfa;
      const fga = p.FG2A + p.FG3A;
      const row = (label, share, lshare, pctv, lpct) => `<tr><td>${label}</td><td class="n">${fmtPct(share)} <span class="muted">(${fmtPct(lshare)})</span></td><td class="n">${fmtPct(pctv)} <span class="muted">(${fmtPct(lpct)})</span></td></tr>`;
      return `<p class="muted" style="margin:0;font-size:13px">Για αυτή τη διοργάνωση δεν υπάρχουν θέσεις σουτ. Κατανομή από τα box scores:</p>
        <div class="tbl-wrap"><table><thead><tr><th>Σουτ</th><th class="n">Μερίδιο (λίγκα)</th><th class="n">Εύστοχα % (λίγκα)</th></tr></thead><tbody>
          ${row("Δίποντα", p.FG2A / (fga || 1), l2a / lsum, p.FG2P, lf2)}${row("Τρίποντα", p.FG3A / (fga || 1), l3a / lsum, p.FG3P, lf3)}${row("Βολές (ανά σουτ)", p.FTA / (fga || 1), lfa / lsum, p.FTP, lft)}
        </tbody></table></div>`;
    };
    const metricTable = (ps) => `<div class="tbl-wrap"><table><thead><tr><th>Μέγεθος</th>${ps.map((p, i) => `<th class="n" style="color:var(--c${i + 1})">${esc(p.player.split(" ").at(-1))}</th><th class="n muted" style="min-width:90px">εκατοστ.</th>`).join("")}</tr></thead><tbody>
      ${METRICS.map(([key, label, f, cond, low]) => {
        const rs = ps.map((p) => R.get(p.pid));
        const vals = rs.map((r) => r?.[key]);
        const best = ps.length > 1 && vals.every(isNum) ? (low ? Math.min(...vals) : Math.max(...vals)) : null;
        return `<tr><td>${label}</td>${rs.map((r, i) => { const pc = pctl(key, r?.[key], low); return `<td class="n ${best != null && vals[i] === best ? "better" : ""}">${r ? f(r[key]) : "–"}</td><td class="n">${isNum(pc) ? bar(pc, 1) + ` <span class="muted" style="font-size:12px">${Math.round(100 * pc)}</span>` : "–"}</td>`; }).join("")}</tr>`;
      }).join("")}</tbody></table></div>
      <p class="muted" style="margin:0;font-size:13px">Εκατοστημόριο ανάμεσα σε ${pool.length} παίκτες με αρκετά λεπτά (για τα λάθη: χαμηλότερο = καλύτερο). «Διορθ.»: τραβηγμένο προς τον μέσο όρο για λίγες προσπάθειες.</p>`;

    el.innerHTML = `
      <section>
        <div class="filters">
          <label style="flex:1 1 260px">Αναζήτηση παίκτη (έως 2 για σύγκριση)
            <input type="search" id="psearch" placeholder="π.χ. όνομα ή ομάδα" autocomplete="off"></label>
        </div>
        <div class="chips" id="presults"></div>
        <details id="pbrowse" ${App.ui.pteam ? "open" : ""}><summary style="cursor:pointer;font-size:14px">Ομάδες και ρόστερ</summary>
          <div style="margin-top:8px">${teamGrid(S, App.ui.pteam, "data-pteam")}</div>
          ${App.ui.pteam ? `<div style="margin-top:10px">${rosterCards(S, App.ui.pteam, "data-add")}</div>` : ""}</details>
        <div class="row">${sel.map((p, i) => `<span class="sel-chip" style="border-color:var(--c${i + 1})">${esc(p.player)} <span class="muted">${esc(p.team)}</span><button data-rm="${p.pid}" aria-label="Αφαίρεση ${esc(p.player)}">×</button></span>`).join("")}
          ${sel.length === 1 ? `<span class="muted" style="font-size:13px">Πρόσθεσε δεύτερο παίκτη για σύγκριση</span>` : ""}</div>
      </section>
      <div id="pv" style="display:flex;flex-direction:column;gap:28px"></div>`;

    const search = $("#psearch", el), res = $("#presults", el);
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { res.innerHTML = ""; return; }
      const hits = pa.filter((p) => p.player.toLowerCase().includes(q) || S.teamName(p.team).toLowerCase().includes(q) || p.team.toLowerCase() === q)
        .sort((a, b) => (R.get(b.pid)?.ovr ?? 0) - (R.get(a.pid)?.ovr ?? 0) || b.PIR - a.PIR).slice(0, 14);
      res.innerHTML = hits.map((p) => `<button class="chip" data-add="${p.pid}">${Gfx.badge(p.team, 16)} ${esc(p.player)} <span class="muted">${R.get(p.pid)?.ovr ? R.get(p.pid).ovr + " OVR" : fmt(p.PIR) + " PIR"}</span></button>`).join("") || `<span class="muted">Κανένα αποτέλεσμα</span>`;
    };
    res.onclick = (e) => {
      const b = e.target.closest("[data-add]"); if (!b) return;
      const id = b.dataset.add;
      if (!App.ui.players.includes(id)) App.ui.players = App.ui.players.length >= 2 ? [App.ui.players[0], id] : [...App.ui.players, id];
      Views.players(el, S);
    };
    $("#pbrowse", el).onclick = (e) => {
      const t = e.target.closest("[data-pteam]");
      if (t) { e.preventDefault(); App.ui.pteam = App.ui.pteam === t.dataset.pteam ? "" : t.dataset.pteam; Views.players(el, S); return; }
      const b = e.target.closest("[data-add]"); if (!b) return;
      App.ui.players = [b.dataset.add];                       // ένα κλικ στο ρόστερ = η κάρτα του παίκτη
      Views.players(el, S); window.scrollTo({ top: $("#pv", el).offsetTop - 60, behavior: "smooth" });
    };
    el.querySelector(".row").onclick = (e) => {
      const b = e.target.closest("[data-rm]"); if (!b) return;
      App.ui.players = App.ui.players.filter((x) => x !== b.dataset.rm);
      Views.players(el, S);
    };

    const pv = $("#pv", el);
    const logsOf = (pid) => S.logs.filter((r) => r.pid === pid).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const statSelect = `<label class="muted" style="font-size:12px">Στατιστικό <select id="pstat">${chartStats.map((s) => `<option value="${s}" ${s === k ? "selected" : ""}>${STAT[s].name}</option>`).join("")}</select></label>`;
    const bindStat = () => { $("#pstat", pv).onchange = (e) => { App.ui.pstat = e.target.value; Views.players(el, S); }; };
    const shotW = Math.min(420, Charts.W(420));

    if (sel.length === 1) {
      const p = sel[0], lg = logsOf(p.pid);
      const series = [
        { k: "k1", dots: true, thin: true, pts: lg.map((r, i) => [i + 1, r[k]]) },
        { k: "k1", pts: lg.map((r, i) => [i + 1, mean(lg.slice(Math.max(0, i - 4), i + 1).map((x) => x[k]))]) },
      ];
      pv.innerHTML = `
        <section>${fmCard(p)}</section>
        <div class="grid2">
          <section>${card(p, 0)}</section>
          <section><h3>Τι ξεχωρίζει</h3>${insights(p)}${similarBlock(p)}</section>
        </div>
        <div class="grid2">
          <section><h3>Προφίλ στη λίγκα</h3>${R.get(p.pid) ? metricTable([p]) : `<div class="empty">Δεν υπάρχουν αναλυτικά.</div>`}</section>
          <section><h3>Από πού σουτάρει</h3>${shotBlock(p, shotW)}
            ${SH?.players[p.pid] ? `<p class="muted" style="margin:0;font-size:13px">Μέγεθος εξαγώνου = πόσο συχνά σουτάρει από εκεί. Χρώμα = εύστοχα σε σχέση με τον μέσο όρο της λίγκας στο ίδιο σημείο (πράσινο καλύτερα, κόκκινο χειρότερα, πιο έντονο = μεγαλύτερη διαφορά).</p>` : ""}</section>
        </div>
        <section><div class="sec-head"><h3>Ανά αγώνα</h3>${statSelect}</div>
          <div class="legend"><span><i class="c1bg" style="opacity:.5"></i>Αγώνας</span><span><i class="c1bg"></i>Μ.Ο. 5 αγώνων</span></div>
          <div class="chart">${Charts.line({ series, xLabel: (x) => "Αγ." + (lg[x - 1]?.round ?? x), yZero: k !== "PM" })}</div></section>
        <section><h3>Game log</h3><div id="plog"></div></section>
        <p class="muted" style="margin:0;font-size:13px">* Θέση: εκτίμηση από το προφίλ (ασίστ, τρίποντα, ριμπάουντ, κοψίματα), όχι επίσημη. OVR: επιρροή στη διαφορά πόντων (RAPM από το play-by-play με αφετηρία ένα μοντέλο των στατιστικών· στην ελληνική λίγκα και στο NBA μόνο το μοντέλο), σε κλίμακα τύπου 2K: 72 = μέσος παίκτης με ρόλο, 8 μονάδες = μία τυπική απόκλιση. Διόρθωση λίγκας ώστε να συγκρίνονται: EuroCup −7 (από παίκτες που άλλαξαν λίγκα), ελληνική λίγκα −3 και μισή κλίμακα (ίδιοι παίκτες την ίδια σεζόν), NBA +5 (υπόθεση). Τα επιμέρους είναι προφίλ.</p>`;
      bindStat();
      new SortTable($("#plog", pv), {
        cols: [{ key: "round", label: "Αγ.", n: true }, { key: "date", label: "Ημ/νία", fmt: fmtDate },
          { key: "opp", label: "Αντίπ.", html: (r) => (r.home ? "vs " : "@ ") + App.teamLink(r.opp, S) },
          ...LOG_STATS.map(logCol)],
        rows: lg, sortKey: "round", sortDir: -1,
      });
      return;
    }

    // ---- σύγκριση δύο παικτών ----
    const roll3 = (lg) => lg.map((r, i) => [i + 1, mean(lg.slice(Math.max(0, i - 2), i + 1).map((x) => x[k]))]);
    const rs = sel.map((p) => R.get(p.pid));
    const head2 = rs.every((r) => r && isNum(r.ovr));
    pv.innerHTML = `
      <div class="grid2">${sel.map((p, i) => `<section>${card(p, i)}</section>`).join("")}</div>
      ${head2 ? `<section><h3>Κατηγορίες</h3>
        <div class="grid2">
          <div class="chart">${Charts.radar({ axes: CATS.map((c) => c[1]), series: rs.map((r, i) => ({ k: "k" + (i + 1), vals: CATS.map(([key]) => (r[key] - 40) / 59) })) })}</div>
          <div class="h2h">${CATS.map(([key, label]) => { const a = rs[0][key], b = rs[1][key];
            return `<div class="h2h-row"><span class="h2h-bar"><i class="c1bg" style="width:${((a - 30) / 69) * 100}%"></i></span><b class="${a > b ? "better" : ""}">${a}</b><span class="h2h-label">${label}</span><b class="${b > a ? "better" : ""}">${b}</b><span class="h2h-bar r"><i class="c2bg" style="width:${((b - 30) / 69) * 100}%"></i></span></div>`; }).join("")}
            <div class="h2h-row" style="font-size:18px"><span></span><b class="${rs[0].ovr > rs[1].ovr ? "better" : ""}">${rs[0].ovr}</b><span class="h2h-label"><b>OVR</b></span><b class="${rs[1].ovr > rs[0].ovr ? "better" : ""}">${rs[1].ovr}</b><span></span></div></div>
        </div></section>` : ""}
      ${roleCompare(sel)}
      <section><h3>Προφίλ στη λίγκα</h3>${rs.some(Boolean) ? metricTable(sel) : ""}</section>
      <section><h3>Από πού σουτάρουν</h3><div class="grid2">${sel.map((p, i) => `<div><div class="eyebrow" style="color:var(--c${i + 1})">${esc(p.player)}</div>${shotBlock(p, shotW)}</div>`).join("")}</div></section>
      <section><div class="sec-head"><h3>Πορεία (κυλιόμενος μέσος 3 αγώνων)</h3>${statSelect}</div>
        <div class="legend">${sel.map((p, i) => `<span><i class="c${i + 1}bg"></i>${esc(p.player)}</span>`).join("")}</div>
        <div class="chart">${Charts.line({ series: sel.map((p, i) => ({ k: "k" + (i + 1), pts: roll3(logsOf(p.pid)) })), xLabel: (x) => "#" + x, yZero: k !== "PM" })}</div></section>`;
    bindStat();
  },

  /* ---------------- Βάση: πλήρες filtering επί τόπου ---------------- */
  async explorer(el, S) {
    const ex = App.ui.ex;
    const seasons = ex.all ? App.compInfo().seasons : [S.season];
    const SS = await Promise.all(seasons.map((s) => App.loadSeason(App.comp, s)));
    const teamNames = Object.assign({}, ...SS.map((x) => x.teams));
    const tn = (c) => teamNames[c] || c;
    if (!S.hasBox) ex.level = "teams";
    const avail = { players: PLAYER_COLS, teams: S.hasBox ? TEAM_COLS : TEAM_BASIC, logs: LOG_STATS }[ex.level];
    if (!S.hasBox && !ex.cols.teams.some((c) => avail.includes(c))) ex.cols.teams = [...TEAM_BASIC];
    ex.cols[ex.level] = ex.cols[ex.level].filter((c) => avail.includes(c));
    if (!avail.includes(ex.cs)) ex.cs = avail.includes("PTS") ? "PTS" : avail[0];

    el.innerHTML = `
      <section><div class="sec-head"><h2>Βάση δεδομένων</h2><button class="btn" id="csv">Λήψη CSV</button></div>
        <div class="filters">
          <label>Επίπεδο<select id="ex-level">
            ${S.hasBox ? `<option value="players">Παίκτες (σεζόν)</option>` : ""}<option value="teams">Ομάδες (σεζόν)</option>${S.hasBox ? `<option value="logs">Παίκτες ανά αγώνα</option>` : ""}</select></label>
          <label>Σεζόν<select id="ex-all"><option value="0">${seasonLabel(S.season)}</option><option value="1">Όλες (${seasons.length > 1 ? seasons.length : App.compInfo().seasons.length})</option></select></label>
          ${ex.level === "players" ? `<label>Τιμές<select id="ex-mode"><option value="avg">Μέσος όρος</option><option value="tot">Σύνολα</option></select></label>` : ""}
          <label>Ομάδα<select id="ex-team"><option value="">Όλες</option>${Object.keys(teamNames).sort((a, b) => tn(a).localeCompare(tn(b))).map((c) => `<option value="${c}">${esc(tn(c))}</option>`).join("")}</select></label>
          ${ex.level !== "teams" ? `<label>Αναζήτηση<input type="search" id="ex-q" placeholder="όνομα παίκτη"></label>` : ""}
          ${ex.level === "players" ? `<label>Ελάχ. αγώνες<input type="number" id="ex-gp" min="0" style="width:80px"></label><label>Ελάχ. λεπτά (Μ.Ο.)<input type="number" id="ex-min" min="0" style="width:80px"></label>` : ""}
          <label>Συνθήκη<span class="row" style="gap:4px"><select id="ex-cs">${avail.map((c) => `<option value="${c}">${STAT[c]?.label || c}</option>`).join("")}</select>
            <select id="ex-co"><option>&gt;=</option><option>&lt;=</option></select><input type="number" id="ex-cv" step="any" style="width:80px" placeholder="τιμή"></span></label>
        </div>
        <details class="cols"><summary>Στήλες (${ex.cols[ex.level].length} επιλεγμένες)</summary>
          <div class="chips" id="ex-cols">${avail.map((c) => `<label class="chip ${ex.cols[ex.level].includes(c) ? "on" : ""}" title="${esc(STAT[c]?.name)}"><input type="checkbox" value="${c}" ${ex.cols[ex.level].includes(c) ? "checked" : ""}>${STAT[c]?.label || c}</label>`).join("")}</div>
        </details>
        <div id="ex-table"></div>
        ${ex.level !== "teams" ? `<p class="muted" style="margin:0;font-size:13px">Τα ποσοστά (%) υπολογίζονται από τα σύνολα. Πάτα κεφαλίδα για ταξινόμηση.</p>` : ""}
      </section>`;

    // αρχικές τιμές controls
    const set = (id, v) => { const x = $(id, el); if (x) x.value = v; };
    set("#ex-level", ex.level); set("#ex-all", ex.all ? "1" : "0"); set("#ex-mode", ex.mode); set("#ex-team", ex.team);
    set("#ex-q", ex.q); set("#ex-gp", ex.minGP); set("#ex-min", ex.minMIN); set("#ex-cs", ex.cs); set("#ex-co", ex.co); set("#ex-cv", ex.cv);

    // δεδομένα επιπέδου
    const allLogs = SS.flatMap((x) => x.logs);
    const base = () => {
      if (ex.level === "players") return aggregatePlayers(allLogs, ex.all, ex.mode);
      if (ex.level === "teams") return SS.flatMap((x) => [...x.teamAgg.values()].map((t) => ({ ...t, season: x.season })));
      return allLogs.map((r) => ({ ...r, playerN: niceName(r.player) }));
    };
    let data = base();

    const columns = () => {
      const c = [];
      if (ex.all) c.push({ key: "season", label: "Σεζόν", fmt: (v) => seasonLabel(v) });
      if (ex.level === "players") c.push({ key: "player", label: "Παίκτης", html: (r) => (r.season === S.season ? App.playerLink(r.pid, r.player) : esc(r.player)) }, { key: "team", label: "Ομάδα" });
      if (ex.level === "teams") c.push({ key: "name", label: "Ομάδα" });
      if (ex.level === "logs") c.push({ key: "date", label: "Ημ/νία", fmt: fmtDate }, { key: "playerN", label: "Παίκτης" }, { key: "team", label: "Ομάδα" },
        { key: "opp", label: "Αντίπ.", fmt: (v, r) => (r.home ? "vs " : "@ ") + esc(v) });
      return [...c, ...ex.cols[ex.level].map(ex.level === "logs" ? logCol : statCol)];
    };
    const filtered = () => {
      const q = ex.q.trim().toLowerCase(), cv = parseFloat(ex.cv);
      return data.filter((r) => {
        if (ex.team && (r.team ?? r.code) !== ex.team) return false;
        if (q && ex.level !== "teams" && !(r.player || r.playerN || "").toLowerCase().includes(q) && !niceName(r.player || "").toLowerCase().includes(q)) return false;
        if (ex.level === "players" && (r.GP < ex.minGP || r.MIN_AVG < ex.minMIN)) return false;
        if (isNum(cv)) {
          let v = r[ex.cs];
          if (STAT[ex.cs]?.pct) v = 100 * v;               // ο χρήστης γράφει 40 για 40%
          if (!isNum(v) || (ex.co === ">=" ? v < cv : v > cv)) return false;
        }
        return true;
      });
    };
    const sortKey = ex.level === "teams" ? "W" : ex.level === "logs" ? "PIR" : "PIR";
    const table = new SortTable($("#ex-table", el), { cols: columns(), rows: filtered(), sortKey, pageSize: 50 });
    const refresh = () => { table.cols = columns(); table.setRows(filtered()); };

    // events
    $("#ex-level", el).onchange = (e) => { ex.level = e.target.value; Views.explorer(el, S); };
    $("#ex-all", el).onchange = (e) => { ex.all = e.target.value === "1"; Views.explorer(el, S); };
    const mode = $("#ex-mode", el); if (mode) mode.onchange = (e) => { ex.mode = e.target.value; data = base(); refresh(); };
    $("#ex-team", el).onchange = (e) => { ex.team = e.target.value; refresh(); };
    const q = $("#ex-q", el); if (q) q.oninput = (e) => { ex.q = e.target.value; refresh(); };
    const gp = $("#ex-gp", el); if (gp) gp.oninput = (e) => { ex.minGP = +e.target.value || 0; refresh(); };
    const mn = $("#ex-min", el); if (mn) mn.oninput = (e) => { ex.minMIN = +e.target.value || 0; refresh(); };
    $("#ex-cs", el).onchange = (e) => { ex.cs = e.target.value; refresh(); };
    $("#ex-co", el).onchange = (e) => { ex.co = e.target.value; refresh(); };
    $("#ex-cv", el).oninput = (e) => { ex.cv = e.target.value; refresh(); };
    $("#ex-cols", el).onchange = (e) => {
      const c = e.target.value, on = e.target.checked;
      e.target.closest(".chip").classList.toggle("on", on);
      ex.cols[ex.level] = avail.filter((x) => (x === c ? on : ex.cols[ex.level].includes(x)));
      $(".cols summary", el).textContent = `Στήλες (${ex.cols[ex.level].length} επιλεγμένες)`;
      refresh();
    };
    $("#csv", el).onclick = () => {
      const blob = new Blob(["﻿" + table.csv()], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `${App.comp}_${ex.level}_${ex.all ? "all" : S.season}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
    };
  },

  /* ---------------- Ανάλυση: προσαρμοσμένα ratings, τύχη, four factors, ρόλοι/αποδοτικότητα παικτών ---------------- */
  analysis(el, S) {
    const AN = App.analytics.get(App.comp), A = AN?.seasons?.[String(S.season)];
    if (!A) { el.innerHTML = `<div class="empty">Δεν υπάρχουν ακόμα αναλυτικά για αυτή τη σεζόν. Δημιουργούνται στο επόμενο ημερήσιο run.</div>`; return; }
    const ui = App.ui.an2, Lg = A.league, box = AN.box;
    const T = rowsToObjs(A.teams).map((t) => ({ ...t, name: S.teamName(t.team) }));
    const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const sgn = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + (+v).toFixed(d) : "–");
    const neg = (v) => `<span style="color:var(--bad)">${v}</span>`;
    const colored = (v, d = 1) => (!isNum(v) ? "–" : v > 0.05 ? `<span class="better">${sgn(v, d)}</span>` : v < -0.05 ? neg(sgn(v, d)) : sgn(v, d));
    const hist = AN.history || [];
    const sections = [];

    // ---- 1. Λίγκα ----
    sections.push(`<section><div class="sec-head"><h2>Η λίγκα με μια ματιά</h2><span class="muted">${esc(App.compInfo().name)} ${seasonLabel(S.season)} · ${Lg.games} αγώνες</span></div>
      <div class="tiles">
        ${tile(sgn(Lg.hca_adj), "Πλεονέκτημα έδρας (π./αγώνα, προσαρμοσμένο)")}
        ${tile(`${sgn(Lg.home_margin)} <span class="muted" style="font-size:12px">[${fmt(Lg.home_margin_ci?.[0])}, ${fmt(Lg.home_margin_ci?.[1])}]</span>`, "Μέση διαφορά γηπεδούχου (95% Δ.Ε.)")}
        ${tile(fmtPct(Lg.home_win), "Νίκες γηπεδούχου")}
        ${tile(fmt(Lg.sd_margin), "Τυπική απόκλιση διαφοράς (π.)")}
        ${box ? tile(fmt(Lg.pace), "Κατοχές / αγώνα") + tile(fmt(Lg.ortg), "Πόντοι / 100 κατοχές") + tile(fmtPct(Lg.three_rate), "Τρίποντα / σουτ") : tile(fmt(Lg.ppg), "Πόντοι / ομάδα")}
      </div>
      ${hist.length > 1 ? `<div class="tbl-wrap"><table><thead><tr><th>Σεζόν</th><th class="n">Αγώνες</th><th class="n">Έδρα (π.)</th><th class="n">Νίκες γηπ.</th>${box ? `<th class="n">Ρυθμός</th><th class="n">ORTG</th><th class="n">eFG%</th><th class="n">3Π / σουτ</th><th class="n">TOV%</th>` : `<th class="n">Πόντοι</th>`}</tr></thead><tbody>
        ${hist.map((h) => `<tr><td>${seasonLabel(h.season)}</td><td class="n">${h.games}</td><td class="n">${sgn(h.hca_adj)}</td><td class="n">${fmtPct(h.home_win)}</td>${box ? `<td class="n">${fmt(h.pace)}</td><td class="n">${fmt(h.ortg)}</td><td class="n">${fmtPct(h.efg)}</td><td class="n">${fmtPct(h.three_rate)}</td><td class="n">${fmtPct(h.tov)}</td>` : `<td class="n">${fmt(h.ppg)}</td>`}</tr>`).join("")}
      </tbody></table></div>` : ""}
      <p class="muted" style="margin:0;font-size:13px">Το πλεονέκτημα έδρας εκτιμάται από το μοντέλο ratings, ώστε να μη μπερδεύεται με το ποιοι αντίπαλοι έπαιξαν πού. Η τυπική απόκλιση δείχνει πόσο «τυχαίο» είναι ένα ματς: όσο μεγαλύτερη, τόσο πιο συχνά κερδίζει το αουτσάιντερ.</p>
    </section>`);

    // ---- 2. Δύναμη ομάδων ----
    sections.push(`<section><div class="sec-head"><h2>Πραγματική δύναμη ομάδων</h2></div>
      <p style="margin:0;max-width:75ch">Το <b>προσαρμοσμένο net</b> είναι η διαφορά πόντων ανά 100 κατοχές αφού διορθωθεί για τη δυσκολία του προγράμματος και την έδρα (ridge regression σε όλα τα ματς της σεζόν). Είναι καλύτερος οδηγός για τη συνέχεια από το ρεκόρ. Η <b>τύχη</b> είναι νίκες μείον αναμενόμενες νίκες από τη διαφορά πόντων: ομάδες με μεγάλη θετική τύχη έχουν κερδίσει πολλά κλειστά ματς, κάτι που ιστορικά δεν διατηρείται.</p>
      <div id="an-teams"></div>
      <div class="grid2">
        <div><h3>Επίθεση vs άμυνα (προσαρμοσμένες)</h3><div class="chart">${Charts.badges({
            pts: T.map((t) => ({ x: t.adj_o, y: t.adj_d, s: t.W / Math.max(1, t.GP), code: t.team, team: t.team, title: `${t.name}: aORTG ${fmt(t.adj_o)}, aDRTG ${fmt(t.adj_d)}, ${t.W}–${t.L}` })),
            xName: "Επίθεση: πόντοι / 100 κατοχές (προσαρμ.)", yName: "Άμυνα: πόντοι που δέχεται / 100 (↑ καλύτερη)", invertY: true,
            quads: ["Μόνο άμυνα", "Δυνατές και στα δύο", "Αδύναμες", "Μόνο επίθεση"], sizeLabel: "ποσοστό νικών",
            diag: (X, Y, x0, x1, y0, y1) => [-10, -5, 0, 5, 10].map((c) => { const a = Math.max(x0, y0 + c), b = Math.min(x1, y1 + c); if (a >= b) return "";
              return `<line x1="${X(a)}" y1="${Y(a - c)}" x2="${X(b)}" y2="${Y(b - c)}" class="grid" stroke-dasharray="2 5"/><text x="${X(b) - 4}" y="${Y(b - c) + 14}" text-anchor="end" style="font-size:11px">net ${c > 0 ? "+" : ""}${c}</text>`; }).join(""),
            W: Charts.W(560) })}</div>
          <p class="muted" style="margin:0;font-size:13px">Δεξιά = καλύτερη επίθεση, πάνω = καλύτερη άμυνα. Οι διαγώνιες ενώνουν ομάδες με το ίδιο net rating. Μεγαλύτερο σήμα = περισσότερες νίκες.</p></div>
        <div><h3>Τύχη: νίκες − αναμενόμενες</h3><div class="chart">${(() => { const mc = Math.max(1, ...T.map((t) => t.close_w + t.close_l));
            return Charts.badges({ pts: T.map((t) => ({ x: t.adj_net, y: t.luck, s: (t.close_w + t.close_l) / mc, code: t.team, team: t.team, title: `${t.name}: τύχη ${fmt(t.luck)}, κλειστά ${t.close_w}–${t.close_l}` })),
              xName: "Πραγματική δύναμη (προσαρμοσμένο net)", yName: "Νίκες − αναμενόμενες", fx: (v) => (v > 0 ? "+" : "") + v, fy: (v) => (v > 0 ? "+" : "") + v,
              quads: ["Αδύναμη αλλά τυχερή", "Δυνατή και τυχερή", "Αδύναμη και άτυχη", "Δυνατή αλλά άτυχη"], sizeLabel: "πόσα κλειστά ματς (≤5 π.) έχει παίξει", W: Charts.W(560) }); })()}</div>
          <p class="muted" style="margin:0;font-size:13px">Η «τύχη» κρίνεται σχεδόν πάντα στα κλειστά ματς: όσο μεγαλύτερο το σήμα, τόσο περισσότερα κλειστά ματς. Τυπικά διορθώνεται με τον καιρό.</p></div>
      </div>
    </section>`);

    // ---- 3. Four factors ----
    if (A.four_factors) {
      const W = A.ff_meta.weights, LG = A.ff_meta.league;
      sections.push(`<section><div class="sec-head"><h2>Γιατί κερδίζει: four factors</h2></div>
        <p style="margin:0;max-width:75ch">Πόσους πόντους ανά 100 κατοχές κερδίζει (+) ή χάνει (−) κάθε ομάδα σε σχέση με τον μέσο όρο, από κάθε παράγοντα. Τα βάρη βγαίνουν από παλινδρόμηση σε όλους τους αγώνες της διοργάνωσης: +1 μονάδα eFG% ≈ +${fmt(W.efg / 100, 2)} π., +1 μονάδα TOV% ≈ −${fmt(-W.tov / 100, 2)} π., +1 μονάδα OREB% ≈ +${fmt(W.orb / 100, 2)} π., +1 μονάδα βολών/σουτ ≈ +${fmt(W.ftr / 100, 2)} π. Μέσοι όροι λίγκας: eFG ${fmtPct(LG.efg)}, TOV ${fmtPct(LG.tov)}, OREB ${fmtPct(LG.orb)}, FTM/FGA ${fmtPct(LG.ftr)}.</p>
        <div id="an-ff"></div></section>`);
    }

    // ---- 4. Παίκτες ----
    if (A.players) {
      const P = rowsToObjs(A.players).map((p) => ({ ...p, player: niceName(p.player) || p.player }));
      const maxMin = Math.max(...P.map((p) => p.MIN));
      if (ui.minPct == null) ui.minPct = 30;
      const hasOnOff = P.some((p) => isNum(p.onoff));
      sections.push(`<section><div class="sec-head"><h2>Παίκτες: ρόλος και αποδοτικότητα</h2></div>
        <p style="margin:0;max-width:75ch">Όλα ανά 100 κατοχές που ο παίκτης είναι στο παρκέ, ώστε να μη μετράει ο ρυθμός ή τα λεπτά. <b>USG%</b> = πόσες από τις κατοχές της ομάδας τελειώνουν σε αυτόν (σουτ, βολές, λάθος). <b>TS%</b> με διόρθωση μικρού δείγματος (τραβιέται προς τον μέσο όρο με ${60} εικονικές προσπάθειες). ${hasOnOff ? "<b>On/Off</b> = διαφορά πόντων ανά 100 κατοχές με τον παίκτη μέσα μείον έξω, συρρικνωμένη προς το 0 για λίγα λεπτά (είναι θορυβώδες μέγεθος)." : ""}</p>
        <div class="filters">
          <label>Ομάδα<select id="an2-team"><option value="">Όλες</option>${T.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<option value="${esc(t.team)}" ${t.team === ui.team ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></label>
          <label>Ελάχ. λεπτά (% του μέγιστου)<select id="an2-min">${[10, 20, 30, 50, 70].map((v) => `<option value="${v}" ${v === ui.minPct ? "selected" : ""}>${v}% (${Math.round((v / 100) * maxMin)}')</option>`).join("")}</select></label>
        </div>
        <div id="an-players"></div>
        <h3>Όγκος vs αποδοτικότητα</h3>
        <div class="chart" id="an-usg"></div>
        <p class="muted" style="margin:0;font-size:13px">Οι περισσότεροι παίκτες χάνουν αποδοτικότητα όσο παίρνουν περισσότερες κατοχές. Πάνω δεξιά: παίκτες που σηκώνουν μεγάλο όγκο ΚΑΙ σουτάρουν αποδοτικά.</p>
      </section>`);
      // ---- 5. Φόρμα: σήμα ή θόρυβος ----
      const TR = rowsToObjs(A.trend || { cols: [], rows: [] });
      const sig = TR.filter((r) => r.q < 0.1);
      const tested = A.trend_tested || 0;
      sections.push(`<section><div class="sec-head"><h2>Φόρμα παικτών: σήμα ή θόρυβος;</h2></div>
        <p style="margin:0;max-width:75ch">Σύγκριση των 5 τελευταίων αγώνων με την υπόλοιπη σεζόν (PIR ανά 100 κατοχές). Ελέγχθηκαν ${tested} παίκτες με ≥10 αγώνες και ≥12'. ${TR.length} έχουν |z| ≥ 2, ενώ από καθαρή τύχη θα περιμέναμε περίπου ${Math.round(0.046 * tested)}. Μετά τη διόρθωση για πολλαπλούς ελέγχους (q &lt; 0.10) ${sig.length ? `ξεχωρίζουν πραγματικά <b>${sig.length}</b>` : "<b>κανείς</b> δεν ξεχωρίζει από τον θόρυβο"}. Τα «φορμαρισμένα» σερί είναι κατά κανόνα τυχαία διακύμανση.</p>
        ${TR.length ? `<div id="an-trend"></div>` : `<div class="empty">Κανένας παίκτης με |z| ≥ 2.</div>`}
      </section>`);
    }

    el.innerHTML = sections.join("");

    // πίνακες
    new SortTable($("#an-teams", el), {
      cols: [{ key: "name", label: "Ομάδα", html: (r) => App.teamLink(r.team, S) },
        { key: "W", label: "Ν-Η", n: true, fmt: (v, r) => `${r.W}–${r.L}` },
        { key: "adj_net", label: "aNET", n: true, html: (r) => `<b>${sgn(r.adj_net)}</b> <span class="muted">${r.adj_rank}η</span>` },
        { key: "adj_o", label: "aORTG", n: true, fmt: (v) => fmt(v) },
        { key: "adj_d", label: "aDRTG", n: true, fmt: (v) => fmt(v) },
        { key: "net", label: "NET (ακατ.)", n: true, html: (r) => `${sgn(r.net)} <span class="muted">${r.raw_rank}η</span>` },
        { key: "sos", label: "Πρόγραμμα", n: true, html: (r) => sgn(r.sos) },
        { key: "exp_w", label: "Αναμ. Ν", n: true, fmt: (v) => fmt(v) },
        { key: "luck", label: "Τύχη", n: true, html: (r) => colored(r.luck) },
        { key: "close_w", label: "Κλειστά (≤5)", n: true, fmt: (v, r) => `${r.close_w}–${r.close_l}` },
        { key: "form", label: "Φόρμα 8", n: true, html: (r) => `${sgn(r.form)}${isNum(r.form_q) && r.form_q < 0.1 ? ` <span class="pill ${r.form_z > 0 ? "w" : "l"}" title="Στατιστικά σημαντική αλλαγή (q=${fmt(r.form_q, 2)})">${r.form_z > 0 ? "↑" : "↓"}</span>` : ""}` },
        { key: "consistency", label: "Αστάθεια", n: true, fmt: (v) => fmt(v) },
        { key: "home_split", label: "Έδρα", n: true, html: (r) => sgn(r.home_split) }],
      rows: T, sortKey: "adj_net",
    });
    $("#an-teams", el).insertAdjacentHTML("beforeend", `<p class="muted" style="margin:6px 0 0;font-size:13px">aORTG/aDRTG/aNET: προσαρμοσμένα ανά 100 κατοχές. Πρόγραμμα: μέσο aNET αντιπάλων (+ = δύσκολο). Φόρμα 8: προσαρμοσμένο net των 8 τελευταίων· βέλος μόνο αν η αλλαγή είναι στατιστικά σημαντική. Αστάθεια: τυπική απόκλιση της απόδοσης ανά αγώνα. Έδρα: net εντός − εκτός (συρρικνωμένο).</p>`);
    if (A.four_factors) {
      const FF = rowsToObjs(A.four_factors).map((r) => {
        const o = r.o_efg_pts + r.o_tov_pts + r.o_orb_pts + r.o_ftr_pts, d = r.d_efg_pts + r.d_tov_pts + r.d_orb_pts + r.d_ftr_pts;
        return { ...r, name: S.teamName(r.team), off: o, def: d, sum: o + d };
      });
      const c = (k, label) => ({ key: k, label, n: true, html: (r) => colored(r[k]) });
      new SortTable($("#an-ff", el), {
        cols: [{ key: "name", label: "Ομάδα", html: (r) => App.teamLink(r.team, S) },
          c("o_efg_pts", "Επ. σουτ"), c("o_tov_pts", "Επ. λάθη"), c("o_orb_pts", "Επ. ριμπ."), c("o_ftr_pts", "Επ. βολές"), c("off", "Επίθεση"),
          c("d_efg_pts", "Άμ. σουτ"), c("d_tov_pts", "Άμ. λάθη"), c("d_orb_pts", "Άμ. ριμπ."), c("d_ftr_pts", "Άμ. βολές"), c("def", "Άμυνα"),
          c("sum", "Σύνολο")],
        rows: FF, sortKey: "sum",
      });
    }
    if (A.players) {
      const P = rowsToObjs(A.players).map((p) => ({ ...p, player: niceName(p.player) || p.player }));
      const maxMin = Math.max(...P.map((p) => p.MIN));
      const pool = () => P.filter((p) => p.MIN >= (ui.minPct / 100) * maxMin && (!ui.team || p.team === ui.team));
      const pc = (k, label) => ({ key: k, label, n: true, fmt: (v) => fmtPct(v) });
      const n1 = (k, label) => ({ key: k, label, n: true, fmt: (v) => fmt(v) });
      const tab = new SortTable($("#an-players", el), {
        cols: [{ key: "player", label: "Παίκτης", html: (r) => App.playerLink(r.pid, r.player) }, { key: "team", label: "Ομάδα" },
          { key: "GP", label: "ΑΓ", n: true }, n1("mpg", "Λ/αγ"), pc("usg", "USG%"), pc("ts_adj", "TS%"),
          n1("pts100", "ΠΤΣ/100"), pc("ast_pct", "AST%"), pc("orb_pct", "OREB%"), pc("drb_pct", "DREB%"), pc("tov_pct", "TOV%"),
          n1("pir100", "PIR/100"),
          ...(P.some((p) => isNum(p.onoff)) ? [{ key: "onoff", label: "On/Off", n: true, html: (r) => colored(r.onoff) }] : [])],
        rows: pool(), sortKey: "pir100", pageSize: 25,
      });
      const drawUsg = () => {
        const list = pool(), top = new Set([...list].sort((a, b) => b.MIN - a.MIN).slice(0, ui.team ? 15 : 10).map((p) => p.pid));
        const pts = list.map((p) => ({ x: p.usg, y: p.ts_adj, s: p.MIN / maxMin, label: p.player.split(" ").at(-1), title: `${p.player} (${p.team}): USG ${fmtPct(p.usg)}, TS ${fmtPct(p.ts_adj)}, ${fmt(p.MIN, 0)}'`,
          pid: p.pid, showLabel: top.has(p.pid), ring: ui.team ? Gfx.meta(p.team).c1 : "" }));
        $("#an-usg", el).innerHTML = Charts.badges({ pts, xName: "Usage % (κατοχές που τελειώνει)", yName: "True shooting % (διορθωμένο)", fx: (v) => (100 * v).toFixed(0) + "%", fy: (v) => (100 * v).toFixed(0) + "%",
          quads: ["Αποδοτικός ρόλος", "Σταρ: όγκος + αποδοτικότητα", "Περιορισμένος ρόλος", "Όγκος χωρίς αποδοτικότητα"], sizeLabel: "λεπτά συμμετοχής", rMin: 4, rMax: 15, W: Charts.W(960) });
      };
      drawUsg();
      $("#an2-team", el).onchange = (e) => { ui.team = e.target.value; tab.setRows(pool()); drawUsg(); };
      $("#an2-min", el).onchange = (e) => { ui.minPct = +e.target.value; tab.setRows(pool()); drawUsg(); };
      const TR = rowsToObjs(A.trend || { cols: [], rows: [] });
      if (TR.length) new SortTable($("#an-trend", el), {
        cols: [{ key: "player", label: "Παίκτης", html: (r) => App.playerLink(r.pid, niceName(r.player) || r.player) }, { key: "team", label: "Ομάδα" },
          { key: "last", label: "PIR/100 (5 τελευταία)", n: true, fmt: (v) => fmt(v) }, { key: "season", label: "Υπόλοιπη σεζόν", n: true, fmt: (v) => fmt(v) },
          { key: "min_last", label: "Λεπτά (5 τελ. / σεζόν)", n: true, fmt: (v, r) => `${fmt(r.min_last, 0)} / ${fmt(r.min_season, 0)}` },
          { key: "z", label: "z", n: true, fmt: (v) => fmt(v, 2) },
          { key: "q", label: "q (FDR)", n: true, html: (r) => (r.q < 0.1 ? `<span class="better">${fmt(r.q, 2)}</span>` : `<span class="muted">${fmt(r.q, 2)} · θόρυβος</span>`) }],
        rows: TR, sortKey: "z",
      });
    }
  },

  /* ---------------- Στοίχημα: υπάρχει edge απέναντι στην αγορά; ---------------- */
  edge(el) {
    const E = App.edge.get(App.comp);
    if (!E) { el.innerHTML = `<div class="empty">Δεν υπάρχει ακόμα μοντέλο στοιχήματος για αυτή τη διοργάνωση.</div>`; return; }
    const L = App.cache.get(App.comp + App.latestSeason());
    const M = E.market, V = M?.verdict || {}, names = { ml: "Νικητής (1-2)", spread: "Handicap", total: "Σύνολο πόντων" };
    const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const sgn = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + (+v).toFixed(d) : "–");
    const pctS = (v) => (isNum(v) ? (v > 0 ? "+" : "") + (100 * v).toFixed(1) + "%" : "–");
    const anyEdge = Object.values(V).some((v) => v.edge);
    const sections = [];

    // ---- 1. Ετυμηγορία ----
    sections.push(`<section><div class="sec-head"><h2>Υπάρχει edge;</h2><span class="muted">ενημέρωση ${esc(E.updated)}</span></div>
      ${M ? `<p style="margin:0;max-width:75ch">Έλεγχος σε ${M.compare.n} αγώνες (σεζόν ${M.seasons.map(seasonLabel).join(", ")}) με τις αποδόσεις κλεισίματος. Edge υπάρχει μόνο αν <b>και</b> το μοντέλο προσθέτει στατιστικά σημαντική πληροφορία πέρα από την αγορά (συντελεστής γ &gt; 0) <b>και</b> το backtest στοιχήματος έχει θετική απόδοση με 90% βεβαιότητα. Όπου δεν ισχύει αυτό, το site δεν προτείνει στοίχημα.</p>
        <div class="tiles">${["ml", "spread", "total"].map((k) => { const v = V[k] || {}, g = M.info[k === "spread" ? "margin" : k] || {};
          return tile(v.edge ? `<span class="better">ΝΑΙ</span>` : `<span style="color:var(--bad)">ΟΧΙ</span>`, `${names[k]} · γ = ${fmt(g.gamma, 2)} ± ${fmt(g.se, 2)} · ROI ${pctS(v.roi)} (${v.n || 0} στοιχ.)`); }).join("")}</div>
        <p class="muted" style="margin:0;font-size:13px">γ: πόσο αλλάζει το αποτέλεσμα ανά μονάδα πρόβλεψης του μοντέλου, όταν η αγορά είναι ήδη γνωστή (± τυπικό σφάλμα). Αν το 0 είναι μέσα στο γ ± 2·σφάλμα, το μοντέλο δεν ξέρει κάτι που δεν ξέρει ήδη η αγορά. ROI στο κατώφλι αναμενόμενης αξίας ${pctS(E.params.ev_min)}.</p>`
      : `<div class="empty" style="text-align:left">Δεν υπάρχουν ιστορικές αποδόσεις για αυτή τη διοργάνωση, άρα <b>δεν μπορεί να αποδειχθεί edge</b>. Παρακάτω δίνονται οι <b>δίκαιες αποδόσεις</b> του μοντέλου: αν το βιβλίο σου δίνει υψηλότερη απόδοση, το μοντέλο βλέπει αξία, αλλά αυτό είναι ανεπιβεβαίωτο. Με κλειδί του The Odds API (GitHub secret <span class="num">ODDS_API_KEY</span>) αρχίζει καθημερινή καταγραφή αποδόσεων και, με τον καιρό, ο ίδιος έλεγχος.</div>`}
    </section>`);

    // ---- 2. Επερχόμενα ----
    const up = E.upcoming || [];
    const inj = E.injuries || [];
    sections.push(`<section><div class="sec-head"><h2>Επερχόμενοι αγώνες</h2><span class="muted">${up.length} αγώνες · 14 ημέρες</span></div>
      ${up.length ? `<div id="edge-up"></div>
      <p class="muted" style="margin:0;font-size:13px">P(1): πιθανότητα νίκης γηπεδούχου. Δίκαιες = 1/πιθανότητα (χωρίς γκανιότα). Γραμμή: handicap γηπεδούχου κατά το μοντέλο (−5.5 = φαβορί κατά 5.5). ${M ? "Όπου υπάρχουν αποδόσεις, η πιθανότητα συνδυάζει αγορά και μοντέλο (όπως στο backtest). " : ""}EV = αναμενόμενη απόδοση ανά μονάδα πονταρίσματος στην καλύτερη πλευρά. Σύσταση (¼ Kelly, έως ${pctS(E.params.cap).replace("+", "")} του κεφαλαίου) μόνο όπου υπάρχει αποδεδειγμένο edge${anyEdge ? "" : ": <b>προς το παρόν πουθενά</b>"}.</p>` : `<div class="empty">Δεν υπάρχουν αγώνες τις επόμενες 14 ημέρες.</div>`}
      ${inj.length ? `<h3>Απουσίες που μετρήθηκαν</h3><p class="muted" style="margin:0;font-size:13px">Τραυματίες ESPN που είναι βασικοί (≥18'): αξία = PIR ανά αγώνα πάνω από αντικαταστάτη, βαρύτητα ανάλογα με το status. Κάθε μονάδα αξίας ≈ ${fmt(E.params.calib?.c, 2)} πόντοι διαφοράς.</p><div id="edge-inj"></div>` : ""}
    </section>`);

    // ---- 3. Ποιότητα μοντέλου ----
    const ME = E.model_eval || {};
    const qrow = (label, s) => `<tr><td>${label}</td><td class="n">${s?.n ?? "–"}</td><td class="n">${fmtPct(s?.acc)}</td><td class="n">${fmt(s?.brier, 3)}</td><td class="n">${fmt(s?.logloss, 3)}</td><td class="n">${fmt(s?.mae_margin)}</td><td class="n">${fmt(s?.mae_total)}</td></tr>`;
    sections.push(`<section><div class="sec-head"><h2>Το μοντέλο</h2><span class="muted">τ = ${E.params.tau} ημέρες · λ = ${E.params.lam}</span></div>
      <p style="margin:0;max-width:75ch">Ratings επίθεσης/άμυνας/ρυθμού προσαρμοσμένα στον αντίπαλο, με εκθετική απόσβεση (μισή βαρύτητα κάθε ${Math.round(E.params.tau * Math.LN2)} ημέρες, άρα μεταφέρεται και πληροφορία από την προηγούμενη σεζόν), εκτίμηση της έδρας από τα δεδομένα και διόρθωση για απουσίες βασικών. Κάθε πρόβλεψη χρησιμοποιεί μόνο αγώνες πριν από την ημέρα του ματς (walk-forward). Η απόσβεση και η ποινή διαλέχτηκαν σε προηγούμενες σεζόν.</p>
      <div class="tbl-wrap"><table><thead><tr><th>Μοντέλο</th><th class="n">Ματς</th><th class="n">Σωστός νικητής</th><th class="n">Brier</th><th class="n">Log loss</th><th class="n">Σφάλμα διαφοράς</th><th class="n">Σφάλμα συνόλου</th></tr></thead><tbody>
        ${ME.current ? qrow("Ratings · φετινή σεζόν", ME.current.ratings) + qrow("Monte Carlo · φετινή σεζόν", ME.current.mc) : ""}
        ${ME.all ? qrow("Ratings · όλες οι σεζόν", ME.all.ratings) + qrow("Monte Carlo · όλες οι σεζόν", ME.all.mc) : ""}
        ${M ? `<tr><td>Ratings · ματς με αποδόσεις</td><td class="n">${M.compare.n}</td><td class="n">–</td><td class="n">${fmt(M.compare.model.brier, 3)}</td><td class="n">${fmt(M.compare.model.logloss, 3)}</td><td class="n">${fmt(M.compare.model.mae_margin)}</td><td class="n">${fmt(M.compare.model.mae_total)}</td></tr>
          <tr><td><b>Αγορά (κλείσιμο)</b> · ίδια ματς</td><td class="n">${M.compare.n}</td><td class="n">–</td><td class="n"><b>${fmt(M.compare.market.brier, 3)}</b></td><td class="n"><b>${fmt(M.compare.market.logloss, 3)}</b></td><td class="n"><b>${fmt(M.compare.market.mae_margin)}</b></td><td class="n"><b>${fmt(M.compare.market.mae_total)}</b></td></tr>` : ""}
      </tbody></table></div>
      <p class="muted" style="margin:0;font-size:13px">Το ίδιο walk-forward και για το Monte Carlo της αρχικής. ${M ? `Η αγορά είναι πιο ακριβής από το μοντέλο: ${M.compare.market.brier < M.compare.model.brier ? "όπως αναμενόταν, οι γραμμές κλεισίματος ενσωματώνουν πληροφορία (τραυματισμοί, ροτέισον, κίνητρα) που δεν φαίνεται στα box scores." : ""}` : ""}</p>
    </section>`);

    // ---- 4. Backtest ----
    if (M) {
      const R = M.roi;
      const cellR = (src, mk, thr) => { const r = R.find((q) => q.src === src && q.market === mk && q.thr === thr) || {};
        return `<td class="n">${r.n ? `${pctS(r.roi)} <span class="muted" style="font-size:12px">[${pctS(r.lo)}, ${pctS(r.hi)}] · ${r.n}</span>` : "–"}</td>`; };
      const thrs = [...new Set(R.map((q) => q.thr))];
      sections.push(`<section><div class="sec-head"><h2>Backtest στοιχήματος</h2></div>
        <p style="margin:0;max-width:75ch">Για κάθε αγώνα και αγορά ποντάρεται 1 μονάδα στην πλευρά με τη μεγαλύτερη αναμενόμενη αξία, αν αυτή ξεπερνά το κατώφλι. <b>Συνδυασμός</b>: αγορά + μοντέλο με συντελεστές από προηγούμενους αγώνες μόνο (ο σωστός τρόπος). <b>Μόνο μοντέλο</b>: αγνοεί την αγορά (αφελής τρόπος, για σύγκριση). Σε αγκύλες το 90% διάστημα bootstrap και ο αριθμός στοιχημάτων.</p>
        <div class="tbl-wrap"><table><thead><tr><th>Αγορά</th><th>Μέθοδος</th>${thrs.map((t) => `<th class="n">EV ≥ ${(100 * t).toFixed(0)}%</th>`).join("")}</tr></thead><tbody>
          ${["ml", "spread", "total"].map((mk) => ["blend", "model"].map((src, i) => `<tr><td>${i ? "" : names[mk]}</td><td>${src === "blend" ? "Συνδυασμός" : "Μόνο μοντέλο"}</td>${thrs.map((t) => cellR(src, mk, t)).join("")}</tr>`).join("")).join("")}
        </tbody></table></div>
        <div class="grid2">
          <div><h3>Βαθμονόμηση της αγοράς</h3><div class="chart" style="max-width:520px">${Charts.calibration(M.compare.market_calibration || [])}</div>
            <p class="muted" style="margin:0;font-size:13px">Πιθανότητα νίκης γηπεδούχου από τις αποδόσεις (χωρίς γκανιότα) vs πραγματικό ποσοστό.</p></div>
          <div><h3>Τι σημαίνει</h3><p style="margin:0">Η γκανιότα κοστίζει περίπου 4–5% ανά στοίχημα, οπότε ένα μοντέλο χωρίς πληροφορία πέρα από την αγορά χάνει περίπου τόσο. Για να βγει κέρδος πρέπει να <i>ξέρεις κάτι που δεν ξέρει η αγορά</i>, πριν το μάθει. ${anyEdge ? "" : "Σε αυτή τη διοργάνωση, με τα δεδομένα που έχουμε, αυτό δεν συμβαίνει."} Πιο πιθανές πηγές edge: λιγότερο παρακολουθούμενες λίγκες, πρώιμες γραμμές (πριν κινηθεί η αγορά), σύγκριση τιμών μεταξύ πολλών bookmakers.</p></div>
        </div>
      </section>`);
    }

    // ---- 5. Ζωντανή καταγραφή ----
    const LV = E.live || {};
    sections.push(`<section><div class="sec-head"><h2>Ζωντανή καταγραφή</h2></div>
      ${LV.n ? `<div class="tiles">${tile(LV.n, "Αγώνες που κρίθηκαν")}${tile(fmt(LV.brier_model, 3), "Brier μοντέλου")}${LV.n_mkt ? tile(`${fmt(LV.brier_model_same, 3)} / ${fmt(LV.brier_market, 3)}`, `Brier μοντέλο / αγορά (${LV.n_mkt} ματς)`) : ""}${LV.clv_n ? tile(sgn(LV.clv_mean, 2), `Μέσο CLV σε πόντους handicap (${LV.clv_n} ματς, ${fmtPct(LV.clv_pos)} θετικό)`) : ""}</div>
        <p class="muted" style="margin:0;font-size:13px">CLV (closing line value): αν η γραμμή κινείται μέχρι το κλείσιμο προς τη μεριά που έδειχνε το μοντέλο, το μοντέλο «βλέπει» κάτι πριν από την αγορά. Είναι ο πιο γρήγορος δείκτης πραγματικού edge.</p>`
        : `<div class="empty">Κάθε μέρα αποθηκεύονται οι προβλέψεις (και οι αποδόσεις της στιγμής) πριν από τα ματς. ${LV.archived ? `${LV.archived} προβλέψεις σε αναμονή αποτελέσματος.` : ""}</div>`}
      <p class="muted" style="margin:0;font-size:13px">Το στοίχημα ενέχει κίνδυνο απώλειας χρημάτων. Οι αριθμοί εδώ είναι στατιστική ανάλυση, όχι συμβουλή. 18+.</p>
    </section>`);

    el.innerHTML = sections.join("");

    if (up.length) {
      const evCell = (b) => (!b ? "–" : `${{ home: "1", away: "2", over: "Over", under: "Under" }[b.side]} @${fmt(b.odds, 2)} · <span class="${b.ev > 0 ? "better" : ""}">${pctS(b.ev)}</span>${b.rec ? ` <span class="pill w">${(100 * b.stake).toFixed(1)}%</span>` : ""}`);
      new SortTable($("#edge-up", el), {
        cols: [{ key: "date", label: "Ημ/νία", fmt: fmtDate },
          { key: "home", label: "Αγώνας", html: (r) => `${esc(L.teamName(r.home))} – ${esc(L.teamName(r.away))}${r.mv_h || r.mv_a ? ` <span class="muted" title="Αξία απουσιών γηπ./φιλοξ.">(απ. ${fmt(r.mv_h)}/${fmt(r.mv_a)})</span>` : ""}` },
          { key: "p_home", label: "P(1)", n: true, fmt: (v) => fmtPct(v) },
          { key: "fair_home", label: "Δίκαιες 1 / 2", n: true, fmt: (v, r) => `${fmt(r.fair_home, 2)} / ${fmt(r.fair_away, 2)}` },
          { key: "line", label: "Γραμμή", n: true, fmt: (v) => sgn(v) },
          { key: "total", label: "Σύνολο", n: true, fmt: (v) => fmt(v) },
          { key: "mkt", label: "Αγορά (1/2 · hcp · O/U)", html: (r) => (r.mkt ? `${fmt(r.mkt.ml_home, 2)}/${fmt(r.mkt.ml_away, 2)} · ${sgn(r.mkt.spread)} · ${fmt(r.mkt.total)}` : `<span class="muted">—</span>`) },
          { key: "ml", label: "EV νικητή", html: (r) => evCell(r.best?.ml) },
          { key: "sp", label: "EV handicap", html: (r) => evCell(r.best?.spread) },
          { key: "tt", label: "EV συνόλου", html: (r) => evCell(r.best?.total) }],
        rows: up, sortKey: "date", sortDir: 1, pageSize: 30,
      });
    }
    if (inj.length) {
      // ένας παίκτης μία φορά, με τους αγώνες που επηρεάζει
      const by = new Map();
      for (const r of inj) {
        const k = r.player + "|" + r.team;
        if (!by.has(k)) by.set(k, { ...r, n: 0 });
        by.get(k).n++;
      }
      new SortTable($("#edge-inj", el), {
        cols: [{ key: "player", label: "Παίκτης", fmt: (v) => esc(niceName(v) || v) }, { key: "team", label: "Ομάδα" },
          { key: "status", label: "Status" }, { key: "value", label: "Αξία", n: true, fmt: (v) => fmt(v) },
          { key: "n", label: "Αγώνες (14 ημ.)", n: true }],
        rows: [...by.values()], sortKey: "value", pageSize: 15,
      });
    }
  },

  /* ---------------- Ματσάρισμα: δύο ομάδες στο γήπεδο, παίκτης προς παίκτη (σαν μενού 2K) ---------------- */
  court(el, S) {
    const AN = App.analytics.get(App.comp), A = AN?.seasons?.[String(S.season)];
    if (!A?.players) { el.innerHTML = `<div class="empty">Το ματσάρισμα χρειάζεται στατιστικά παικτών (box scores) και αναλυτικά για τη σεζόν.</div>`; return; }
    const P = rowsToObjs(A.players).map((p) => ({ ...p, player: niceName(p.player) || p.player }));
    const T = new Map(rowsToObjs(A.teams).map((t) => [t.team, t]));
    const teams = [...T.keys()].sort((a, b) => S.teamName(a).localeCompare(S.teamName(b)));
    const ui = App.ui.court;
    // προεπιλογή: το επόμενο ματς της διοργάνωσης
    if (!T.has(ui.a) || !T.has(ui.b) || ui.a === ui.b) {
      const g = S.upcoming.find((u) => T.has(u.home) && T.has(u.away));
      ui.a = g ? g.home : teams[0]; ui.b = g ? g.away : teams[1]; ui.lineups = {}; ui.sel = 0;
    }
    const POS = ["PG", "SG", "SF", "PF", "C"];
    const roster = (code) => P.filter((p) => p.team === code && p.GP > 0);
    /** Πιθανή πεντάδα: βασικοί στους 5 τελευταίους αγώνες (μετά λεπτά), ταξινομημένοι από τον πιο «guard» στον πιο «ψηλό». */
    const lineup = (code) => {
      if (ui.lineups[code]) return ui.lineups[code].map((id) => P.find((p) => p.pid === id)).filter(Boolean);
      const r = roster(code).filter((p) => p.gp5 > 0).sort((a, b) => b.gs5 - a.gs5 || (b.min5 || 0) - (a.min5 || 0));
      const five = (r.length >= 5 ? r : roster(code).sort((a, b) => b.MIN - a.MIN)).slice(0, 5).sort((a, b) => (b.guard ?? 0) - (a.guard ?? 0));
      ui.lineups[code] = five.map((p) => p.pid);
      return five;
    };
    const LA = lineup(ui.a), LB = lineup(ui.b);
    const avg = (l) => mean(l.map((p) => p.ovr).filter(isNum));
    const ta = T.get(ui.a), tb = T.get(ui.b);
    // πιθανότητα νίκης (γηπεδούχος = αριστερή ομάδα) από τα προσαρμοσμένα ratings της σεζόν
    const pace = mean([ta.adj_pace, tb.adj_pace]);
    const hca = A.league?.hca_adj ?? 2;
    const margin = ((ta.adj_net - tb.adj_net) * pace) / 100 + hca;
    const sd = AN.sd_game || 12;
    const pHome = 0.5 * (1 + erf(margin / (sd * Math.SQRT2)));
    const CATS = [["r_sco", "Σκορ"], ["r_sho", "Σουτ"], ["r_pla", "Δημ."], ["r_reb", "Ριμπ."], ["r_def", "Άμυνα"]];

    const opts = (sel) => teams.map((c) => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(S.teamName(c))}</option>`).join("");
    el.innerHTML = `
      <section><div class="filters">
        <label>Γηπεδούχος<select id="ct-a">${opts(ui.a)}</select></label>
        <label>Φιλοξενούμενος<select id="ct-b">${opts(ui.b)}</select></label>
        <button class="btn" id="ct-swap" title="Αλλαγή έδρας">⇄</button>
        <button class="btn" id="ct-reset">Επαναφορά πεντάδων</button>
      </div></section>
      <section class="court-head">
        <div class="ct-team">${Gfx.badge(ui.a, 40)}<div><b>${esc(S.teamName(ui.a))}</b><div class="muted" style="font-size:13px">${ta.W}–${ta.L} · aNET ${fmt(ta.adj_net)} · OVR πεντάδας <b>${fmt(avg(LA), 0)}</b></div></div></div>
        <div class="ct-prob"><div class="probbar"><i style="width:${Math.round(100 * pHome)}%"></i><i style="width:${100 - Math.round(100 * pHome)}%"></i></div>
          <div class="problabels"><span>${fmtPct(pHome)}</span><span>${fmt(Math.abs(margin))} π. ${margin >= 0 ? "υπέρ γηπεδούχου" : "υπέρ φιλοξενούμενου"}</span><span>${fmtPct(1 - pHome)}</span></div></div>
        <div class="ct-team r"><div style="text-align:right"><b>${esc(S.teamName(ui.b))}</b><div class="muted" style="font-size:13px">OVR πεντάδας <b>${fmt(avg(LB), 0)}</b> · aNET ${fmt(tb.adj_net)} · ${tb.W}–${tb.L}</div></div>${Gfx.badge(ui.b, 40)}</div>
      </section>
      <section><div class="chart court-chart" id="ct-svg"></div>
        <p class="muted" style="margin:0;font-size:13px">Πάτα έναν παίκτη για να δεις το μονομάχο της ίδιας θέσης. Για αλλαγή: πάτα παίκτη στο γήπεδο και μετά κάποιον από τον πάγκο. Πεντάδα = οι συχνότεροι βασικοί των 5 τελευταίων αγώνων, θέσεις κατ' εκτίμηση από το προφίλ.</p></section>
      <section id="ct-h2h"></section>
      <div class="grid2"><section><h3>Πάγκος · ${esc(S.teamName(ui.a))}</h3><div class="bench" id="ct-bench-a"></div></section>
        <section><h3>Πάγκος · ${esc(S.teamName(ui.b))}</h3><div class="bench" id="ct-bench-b"></div></section></div>
      <p class="muted" style="margin:0;font-size:13px">Πιθανότητα και διαφορά από τα προσαρμοσμένα ratings της σεζόν (με έδρα ${fmt(hca)} π. για τον γηπεδούχο). Το OVR της πεντάδας δεν μπαίνει στον υπολογισμό, είναι για σύγκριση.</p>`;

    // ---- γήπεδο ----
    const draw = () => {
      const W = Charts.W(960), vertical = W < 620;
      const CW = 28, CH = 15;                             // μέτρα, ολόκληρο γήπεδο
      const H = vertical ? Math.round(W * CW / CH * 0.98) : Math.round(W * CH / CW);
      // προβολή: (u, v) με u = 0..28 κατά μήκος (αριστερά -> δεξιά), v = 0..15 κατά πλάτος
      const Pj = (u, v) => (vertical ? [(v / CH) * W, H - (u / CW) * H] : [(u / CW) * W, (v / CH) * H]);
      const line = (pts, cls = "axis") => `<path class="${cls}" fill="none" d="${pts.map((p, i) => (i ? "L" : "M") + Pj(...p).map((x) => x.toFixed(1)).join(" ")).join("")}"/>`;
      let s = `<svg viewBox="0 0 ${vertical ? W : W} ${H}" role="img" aria-label="Γήπεδο ματσαρίσματος">`;
      s += `<rect x="0" y="0" width="${W}" height="${H}" fill="var(--surface-2)" opacity=".5" rx="6"/>`;
      s += line([[0, 0], [28, 0], [28, 15], [0, 15], [0, 0]]) + line([[14, 0], [14, 15]]);
      const circ = (cu, cv, r) => { const pts = []; for (let i = 0; i <= 48; i++) { const a = (i / 48) * 2 * Math.PI; pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a)]); } return line(pts); };
      s += circ(14, 7.5, 1.8);
      for (const side of [0, 1]) {
        const bu = side ? 28 - 1.575 : 1.575, dir = side ? -1 : 1;
        // μισό γήπεδο με την ίδια γεωμετρία: x πλάγια -> v, y από το καλάθι -> u
        const H2 = (x, y) => [bu + dir * y, 7.5 + x];
        s += Court.half((x, y) => Pj(...H2(x, y)), App.comp === "NBA" ? "NBA" : "E");
      }
      // θέσεις (μέτρα από το καλάθι): PG κορυφή, SG/SF φτερά, PF ψηλά/πλάι, C κοντά στο καλάθι
      const SPOT = [[0, 8.2], [-5.6, 5.4], [5.6, 5.4], [-2.4, 2.4], [1.6, 1.1]];
      const nodeR = vertical ? W * 0.055 : H * 0.075;
      const spot = (side, i) => { const [x, y] = SPOT[i]; const bu = side ? 28 - 1.575 : 1.575, dir = side ? -1 : 1; return Pj(bu + dir * y, 7.5 + (side ? -x : x)); };
      const node = (p, side, i) => {
        if (!p) return "";
        const [cx, cy] = spot(side, i), on = ui.sel === i;
        const team = side ? ui.b : ui.a, last = p.player.split(" ").at(-1);
        return `<g data-slot="${side}:${i}" style="cursor:pointer">${on ? `<circle cx="${cx}" cy="${cy}" r="${nodeR * 1.28}" fill="none" stroke="var(--accent)" stroke-width="3"/>` : ""}
          ${Gfx.avatarG(p.player, team, cx, cy, nodeR)}
          <g>${(() => { const ox = cx + nodeR * 0.78, oy = cy - nodeR * 0.78, rr = nodeR * 0.48; return `<circle cx="${ox}" cy="${oy}" r="${rr}" fill="var(--fg)"/><text x="${ox}" y="${oy}" text-anchor="middle" dominant-baseline="central" style="fill:var(--bg);font:700 ${(rr * 1.05).toFixed(1)}px var(--font-num)">${p.ovr ?? "–"}</text>`; })()}</g>
          <text x="${cx}" y="${cy + nodeR * 1.28 + 13}" text-anchor="middle" style="fill:var(--fg);font:600 ${vertical ? 11 : 12.5}px var(--font-body);paint-order:stroke;stroke:var(--surface);stroke-width:3px">${esc(last)}</text>
          <text x="${cx}" y="${cy + nodeR * 1.28 + (vertical ? 25 : 27)}" text-anchor="middle" style="font-size:11px">${POS[i]}</text></g>`;
      };
      LA.forEach((p, i) => (s += node(p, 0, i)));
      LB.forEach((p, i) => (s += node(p, 1, i)));
      s += `</svg>`;
      $("#ct-svg", el).innerHTML = s;
    };
    // ---- μονομαχία θέσης ----
    const h2h = () => {
      const i = ui.sel ?? 0, a = LA[i], b = LB[i];
      if (!a || !b) { $("#ct-h2h", el).innerHTML = ""; return; }
      const stat = [["mpg", "Λεπτά", (v) => fmt(v)], ["pts100", "Πόντοι/100", (v) => fmt(v)], ["ts_adj", "TS%", fmtPct], ["usg", "Usage", fmtPct], ["ast_pct", "AST%", fmtPct], ["drb_pct", "DREB%", fmtPct], ["onoff", "On/Off", (v) => (isNum(v) ? (v > 0 ? "+" : "") + fmt(v) : "–")]];
      $("#ct-h2h", el).innerHTML = `<div class="sec-head"><h2>${POS[i]}: ${esc(a.player)} vs ${esc(b.player)}</h2>
          <div class="seg" id="ct-pos">${POS.map((p, j) => `<button data-pos="${j}" aria-pressed="${j === i}">${p}</button>`).join("")}</div></div>
        <div class="h2h big">
          <div class="h2h-row"><span class="h2h-p">${Gfx.avatar(a.player, ui.a, 44)} ${App.playerLink(a.pid, a.player)}</span><b class="ovr-s ${a.ovr > b.ovr ? "better" : ""}">${a.ovr}</b><span class="h2h-label"><b>OVR</b></span><b class="ovr-s ${b.ovr > a.ovr ? "better" : ""}">${b.ovr}</b><span class="h2h-p r">${App.playerLink(b.pid, b.player)} ${Gfx.avatar(b.player, ui.b, 44)}</span></div>
          ${CATS.map(([k, label]) => { const x = a[k], y = b[k];
            return `<div class="h2h-row"><span class="h2h-bar"><i class="c1bg" style="width:${((x - 30) / 69) * 100}%"></i></span><b class="${x > y ? "better" : ""}">${x}</b><span class="h2h-label">${label}</span><b class="${y > x ? "better" : ""}">${y}</b><span class="h2h-bar r"><i class="c2bg" style="width:${((y - 30) / 69) * 100}%"></i></span></div>`; }).join("")}
        </div>
        <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th class="n">${esc(a.player.split(" ").at(-1))}</th><th style="text-align:center">Μέγεθος</th><th>${esc(b.player.split(" ").at(-1))}</th></tr></thead><tbody>
          ${stat.map(([k, label, f]) => { const x = a[k], y = b[k], lowGood = false, bx = isNum(x) && isNum(y) && (lowGood ? x < y : x > y), by = isNum(x) && isNum(y) && (lowGood ? y < x : y > x);
            return `<tr><td class="n ${bx ? "better" : ""}">${f(x)}</td><td style="text-align:center" class="muted">${label}</td><td class="${by ? "better" : ""}">${f(y)}</td></tr>`; }).join("")}
        </tbody></table></div>`;
      $("#ct-pos", el).onclick = (e) => { const bt = e.target.closest("[data-pos]"); if (!bt) return; ui.sel = +bt.dataset.pos; draw(); h2h(); };
    };
    // ---- πάγκοι ----
    const bench = (code, L, side) => {
      const on = new Set(L.map((p) => p.pid));
      const rows = roster(code).filter((p) => !on.has(p.pid)).sort((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0));
      $(side ? "#ct-bench-b" : "#ct-bench-a", el).innerHTML = rows.map((p) => `<button class="chip" data-bench="${side}:${p.pid}" title="Αλλαγή με τον ${POS[ui.sel ?? 0]}">${Gfx.avatar(p.player, code, 26)} ${esc(p.player)} <span class="muted">${p.pos || ""} · ${p.ovr ?? "–"} · ${fmt(p.mpg)}'</span></button>`).join("") || `<span class="muted">—</span>`;
    };
    const all = () => { draw(); h2h(); bench(ui.a, LA, 0); bench(ui.b, LB, 1); };
    all();
    $("#ct-svg", el).onclick = (e) => { const g = e.target.closest("[data-slot]"); if (!g) return; ui.sel = +g.dataset.slot.split(":")[1]; all(); };
    el.querySelectorAll(".bench").forEach((b) => (b.onclick = (e) => {
      const c = e.target.closest("[data-bench]"); if (!c) return;
      const [side, pid] = c.dataset.bench.split(":"), code = +side ? ui.b : ui.a, L = +side ? LB : LA, i = ui.sel ?? 0;
      const np = P.find((p) => p.pid === pid); if (!np) return;
      L[i] = np; ui.lineups[code] = L.map((p) => p.pid);
      Views.court(el, S);
    }));
    const set = (k, v) => { ui[k] = v; ui.lineups = {}; Views.court(el, S); };
    $("#ct-a", el).onchange = (e) => set("a", e.target.value);
    $("#ct-b", el).onchange = (e) => set("b", e.target.value);
    $("#ct-swap", el).onclick = () => { const t = ui.a; ui.a = ui.b; ui.b = t; Views.court(el, S); };
    $("#ct-reset", el).onclick = () => { ui.lineups = {}; Views.court(el, S); };
  },

  /* ---------------- Αγώνας: προεπισκόπηση επερχόμενου ματς (πιθανότητες, αποδόσεις, ομάδες, παίκτες) ---------------- */
  game(el) {
    const L = App.cache.get(App.comp + App.latestSeason());
    const code = String(App.ui.gameCode || "");
    const g = L?.upcoming.find((u) => String(u.gameCode) === code);
    if (!g) { el.innerHTML = `<div class="empty">Ο αγώνας δεν βρέθηκε στα επερχόμενα αυτής της διοργάνωσης. <a href="#home">← Αρχική</a></div>`; return; }
    const S = L, H = g.home, A = g.away;
    const AN = App.analytics.get(App.comp), AS = AN?.seasons?.[String(S.season)];
    const T = new Map(AS ? rowsToObjs(AS.teams).map((t) => [t.team, t]) : []);
    const FF = new Map(AS?.four_factors ? rowsToObjs(AS.four_factors).map((t) => [t.team, t]) : []);
    const P = AS?.players ? rowsToObjs(AS.players).map((p) => ({ ...p, player: niceName(p.player) || p.player })) : [];
    const E = App.edge.get(App.comp), eg = E?.upcoming?.find((u) => String(u.gameCode) === code);
    const mc = new MatchSim(S, E).run(H, A, 8000, g.gameCode);          // Monte Carlo (ratings + απουσίες)
    const simple = new MatchSim(S).run(H, A, 4000);                       // απλό Monte Carlo (baseline)
    const sgn = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + (+v).toFixed(d) : "–");
    const odds = (p) => (isNum(p) && p > 0.005 ? (1 / p).toFixed(2) : "–");
    const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));

    // ---- κύρια εκτίμηση: Monte Carlo πάνω στο μοντέλο ratings + απουσίες ----
    const main = { src: mc.src === "model" ? "Monte Carlo · ratings + απουσίες" : "Monte Carlo (εφεδρικό)", p: mc.pHome, mu: mc.mh - mc.ma, tot: mc.mh + mc.ma, sdm: mc.sdm, sdt: mc.sdt };
    const models = [
      { name: main.src + " (κύριο)", p: mc.pHome, h: mc.mh, a: mc.ma },
      { name: "Απλό Monte Carlo (μόνο τρέχουσα σεζόν, σταθερή έδρα/σ)", p: simple.pHome, h: simple.mh, a: simple.ma },
    ];
    const mkt = eg?.mkt;

    // ---- over/under και handicap γύρω από τη γραμμή του μοντέλου ----
    const r5 = (v) => Math.round(v * 2) / 2;
    const totLines = [-8, -4, 0, 4, 8].map((d) => r5(main.tot + d) + (Number.isInteger(r5(main.tot + d)) ? 0.5 : 0));
    const spLines = [-6, -3, 0, 3, 6].map((d) => r5(-main.mu + d) + (Number.isInteger(r5(-main.mu + d)) ? 0.5 : 0));
    const pOver = (l) => 1 - Phi((l - main.tot) / main.sdt);
    const pCover = (l) => Phi((main.mu + l) / main.sdm);                 // γηπεδούχος με handicap l

    const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const ph = Math.round(100 * main.p);

    // ---- σύγκριση ομάδων (αντικριστές μπάρες) ----
    const th = T.get(H), ta = T.get(A), fh = FF.get(H), fa = FF.get(A);
    const aggH = S.teamAgg.get(H), aggA = S.teamAgg.get(A);
    const rowsT = [
      ["Ρεκόρ", th ? `${th.W}–${th.L}` : aggH ? `${aggH.W}–${aggH.L}` : "–", ta ? `${ta.W}–${ta.L}` : aggA ? `${aggA.W}–${aggA.L}` : "–", null],
      th && ["Προσαρμοσμένο net / 100", th.adj_net, ta.adj_net, 1, (v) => sgn(v)],
      th && ["Επίθεση (aORTG)", th.adj_o, ta.adj_o, 1, (v) => fmt(v)],
      th && ["Άμυνα (aDRTG, μικρότερο καλύτερο)", th.adj_d, ta.adj_d, -1, (v) => fmt(v)],
      th && S.hasBox && ["Ρυθμός (κατοχές)", th.adj_pace, ta.adj_pace, 0, (v) => fmt(v)],
      th && ["Δυσκολία προγράμματος", th.sos, ta.sos, 0, (v) => sgn(v)],
      th && ["Φόρμα (8 τελευταίοι, aNET)", th.form, ta.form, 1, (v) => sgn(v)],
      th && ["Τύχη (νίκες − αναμενόμενες)", th.luck, ta.luck, 0, (v) => sgn(v)],
      th && ["Εντός − εκτός (net)", th.home_split, ta.home_split, 0, (v) => sgn(v)],
      fh && fa && ["eFG% (επίθεση)", fh.o_efg, fa.o_efg, 1, fmtPct],
      fh && fa && ["eFG% αντιπάλων (άμυνα)", fh.d_efg, fa.d_efg, -1, fmtPct],
      fh && fa && ["Λάθη / κατοχή", fh.o_tov, fa.o_tov, -1, fmtPct],
      fh && fa && ["Επιθ. ριμπάουντ %", fh.o_orb, fa.o_orb, 1, fmtPct],
      fh && fa && ["Βολές / σουτ", fh.o_ftr, fa.o_ftr, 1, fmtPct],
      aggH && aggA && S.hasBox && ["Τρίποντα %", aggH.FG3P, aggA.FG3P, 1, fmtPct],
      aggH && aggA && ["Πόντοι / αγώνα", aggH.PTS, aggA.PTS, 1, (v) => fmt(v)],
      aggH && aggA && ["Δέχεται / αγώνα", aggH.OPP, aggA.OPP, -1, (v) => fmt(v)],
    ].filter(Boolean);
    const teamRow = ([label, a, b, dir, f]) => {
      if (dir == null) return `<div class="h2h-row"><span></span><b>${a}</b><span class="h2h-label">${label}</span><b>${b}</b><span></span></div>`;
      const ok = isNum(a) && isNum(b), wa = ok && dir !== 0 && dir * (a - b) > 0, wb = ok && dir !== 0 && dir * (b - a) > 0;
      const mx = Math.max(Math.abs(a), Math.abs(b), 1e-9), sc = (v) => (dir === 0 ? 50 : Math.max(4, Math.min(100, 50 + 50 * (dir * (v - (a + b) / 2)) / (mx * 0.15 + 1e-9))));
      return `<div class="h2h-row"><span class="h2h-bar"><i class="c1bg" style="width:${sc(a)}%"></i></span><b class="${wa ? "better" : ""}">${f(a)}</b><span class="h2h-label">${label}</span><b class="${wb ? "better" : ""}">${f(b)}</b><span class="h2h-bar r"><i class="c2bg" style="width:${sc(b)}%"></i></span></div>`;
    };

    // ---- πεντάδες (ίδια λογική με το Ματσάρισμα) ----
    const five = (team) => {
      const r = P.filter((p) => p.team === team && p.GP > 0 && p.gp5 > 0).sort((a, b) => b.gs5 - a.gs5 || (b.min5 || 0) - (a.min5 || 0));
      const base = r.length >= 5 ? r : P.filter((p) => p.team === team).sort((a, b) => b.MIN - a.MIN);
      return base.slice(0, 5).sort((a, b) => (b.guard ?? 0) - (a.guard ?? 0));
    };
    const FH = P.length ? five(H) : [], FA = P.length ? five(A) : [];
    const POS = ["PG", "SG", "SF", "PF", "C"];

    // ---- προηγούμενες αναμετρήσεις (τρέχουσα και προηγούμενες σεζόν που είναι φορτωμένες) ----
    const meet = [];
    for (const [k, X] of App.cache) if (k.startsWith(App.comp)) X.games.filter((x) => (x.home === H && x.away === A) || (x.home === A && x.away === H)).forEach((x) => meet.push({ ...x, season: X.season }));
    meet.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    el.innerHTML = `
      <section><a href="#home" class="muted" style="text-decoration:none">← Αρχική</a></section>
      <section class="game-head">
        <div class="gh-team">${Gfx.badge(H, 56)}<div><div class="gh-name">${esc(S.teamName(H))}</div><div class="muted">${th ? `${th.W}–${th.L} · aNET ${sgn(th.adj_net)}` : ""}</div></div></div>
        <div class="gh-mid"><div class="muted">${fmtDate(g.date)} ${esc(g.time || "")} · ${esc(App.compInfo().name)}${g.round ? ` · Αγ. ${g.round}` : ""}</div>
          <div class="gh-score num">${Math.round((main.tot + main.mu) / 2)} – ${Math.round((main.tot - main.mu) / 2)}</div>
          <div class="probbar"><i style="width:${ph}%"></i><i style="width:${100 - ph}%"></i></div>
          <div class="problabels"><span>${ph}%</span><span>${esc(main.src)}</span><span>${100 - ph}%</span></div></div>
        <div class="gh-team r"><div style="text-align:right"><div class="gh-name">${esc(S.teamName(A))}</div><div class="muted">${ta ? `${ta.W}–${ta.L} · aNET ${sgn(ta.adj_net)}` : ""}</div></div>${Gfx.badge(A, 56)}</div>
      </section>

      <section><div class="sec-head"><h2>Εκτιμώμενες αποδόσεις</h2><span class="muted">δίκαιες = 1 / πιθανότητα, χωρίς γκανιότα</span></div>
        <div class="tiles">
          ${tile(`${odds(main.p)} <span class="muted" style="font-size:13px">/ ${odds(1 - main.p)}</span>`, `Νίκη 1 / 2 (${fmtPct(main.p)} / ${fmtPct(1 - main.p)})`)}
          ${tile(sgn(-main.mu), `Handicap γηπεδούχου (γραμμή μοντέλου)`)}
          ${tile(fmt(main.tot), `Σύνολο πόντων (γραμμή μοντέλου)`)}
          ${mkt ? tile(`${fmt(mkt.ml_home, 2)} / ${fmt(mkt.ml_away, 2)}`, `Αγορά 1 / 2 · hcp ${sgn(mkt.spread)} · O/U ${fmt(mkt.total)}`) : ""}
        </div>
        <div class="grid2">
          <div><h3>Over / Under</h3><div class="tbl-wrap"><table><thead><tr><th class="n">Γραμμή</th><th class="n">P(over)</th><th class="n">Over</th><th class="n">Under</th></tr></thead><tbody>
            ${totLines.map((l) => { const p = pOver(l); return `<tr><td class="n">${fmt(l)}</td><td class="n">${fmtPct(p)}</td><td class="n">${odds(p)}</td><td class="n">${odds(1 - p)}</td></tr>`; }).join("")}
          </tbody></table></div></div>
          <div><h3>Handicap γηπεδούχου</h3><div class="tbl-wrap"><table><thead><tr><th class="n">Γραμμή</th><th class="n">P(καλύπτει)</th><th class="n">${esc(teamShort(S, H))}</th><th class="n">${esc(teamShort(S, A))}</th></tr></thead><tbody>
            ${spLines.map((l) => { const p = pCover(l); return `<tr><td class="n">${sgn(l)}</td><td class="n">${fmtPct(p)}</td><td class="n">${odds(p)}</td><td class="n">${odds(1 - p)}</td></tr>`; }).join("")}
          </tbody></table></div></div>
        </div>
        <h3>Τι λέει κάθε μοντέλο</h3>
        <div class="tbl-wrap"><table><thead><tr><th>Μοντέλο</th><th class="n">Νίκη 1</th><th class="n">Δίκαιες 1 / 2</th><th class="n">Σκορ</th></tr></thead><tbody>
          ${models.map((m) => `<tr><td>${esc(m.name)}</td><td class="n">${fmtPct(m.p)}</td><td class="n">${odds(m.p)} / ${odds(1 - m.p)}</td><td class="n">${Math.round(m.h)}–${Math.round(m.a)}</td></tr>`).join("")}
          ${mkt ? `<tr><td><b>Αγορά</b> (χωρίς γκανιότα)</td><td class="n">${fmtPct(mkt.p)}</td><td class="n">${odds(mkt.p)} / ${odds(1 - mkt.p)}</td><td class="n">hcp ${sgn(mkt.spread)}</td></tr>` : ""}
        </tbody></table></div>
        <p class="muted" style="margin:0;font-size:13px">Οι πιθανότητες για over/under και handicap βγαίνουν από την αναμενόμενη διαφορά/σύνολο του Monte Carlo και την αβεβαιότητά τους (σ διαφοράς ${fmt(main.sdm)}, σ συνόλου ${fmt(main.sdt)} π.). ${E?.market && !Object.values(E.market.verdict || {}).some((v) => v.edge) ? "Στο backtest αυτής της διοργάνωσης δεν αποδείχθηκε edge απέναντι στην αγορά: οι αριθμοί είναι εκτιμήσεις, όχι σύσταση." : !E?.market ? "Για αυτή τη διοργάνωση δεν υπάρχουν ιστορικές αποδόσεις, άρα το edge δεν έχει ελεγχθεί." : ""} Το στοίχημα ενέχει κίνδυνο· 18+.</p>
      </section>

      ${rowsT.length > 1 ? `<section><div class="sec-head"><h2>Σύγκριση ομάδων</h2><span class="muted">${seasonLabel(S.season)}</span></div>
        <div class="legend"><span><i class="c1bg"></i>${esc(S.teamName(H))}</span><span><i class="c2bg"></i>${esc(S.teamName(A))}</span></div>
        <div class="h2h wide">${rowsT.map(teamRow).join("")}</div>
        ${eg && (eg.mv_h || eg.mv_a) ? `<p class="muted" style="margin:0;font-size:13px">Απουσίες που μετρήθηκαν: αξία ${fmt(eg.mv_h)} (γηπ.) / ${fmt(eg.mv_a)} (φιλοξ.).</p>` : ""}</section>` : ""}

      ${FH.length && FA.length ? `<section><div class="sec-head"><h2>Πιθανές πεντάδες</h2><a class="btn" href="#court" id="g-court" style="text-decoration:none">Άνοιξε στο Ματσάρισμα →</a></div>
        <div class="h2h big">
          <div class="h2h-row"><span class="h2h-p"><b>${esc(teamShort(S, H))}</b></span><b class="ovr-s">${fmt(mean(FH.map((p) => p.ovr)), 0)}</b><span class="h2h-label"><b>OVR πεντάδας</b></span><b class="ovr-s">${fmt(mean(FA.map((p) => p.ovr)), 0)}</b><span class="h2h-p r"><b>${esc(teamShort(S, A))}</b></span></div>
          ${POS.map((pos, i) => { const a = FH[i], b = FA[i]; if (!a || !b) return "";
            return `<div class="h2h-row"><span class="h2h-p">${Gfx.avatar(a.player, H, 34)} ${App.playerLink(a.pid, a.player)}</span><b class="${a.ovr > b.ovr ? "better" : ""}">${a.ovr}</b><span class="h2h-label">${pos}</span><b class="${b.ovr > a.ovr ? "better" : ""}">${b.ovr}</b><span class="h2h-p r">${App.playerLink(b.pid, b.player)} ${Gfx.avatar(b.player, A, 34)}</span></div>`; }).join("")}
        </div></section>` : ""}

      <section><div class="sec-head"><h2>Εκτίμηση απόδοσης παικτών</h2></div>
        <div class="empty" style="text-align:left">Θα την υπολογίζει το graph neural network που στήνουμε (κάθε αγώνας = graph, κάθε παίκτης = κόμβος). <a href="gnn.html">Δες τα δεδομένα του →</a></div></section>

      ${meet.length ? `<section><h2>Προηγούμενες αναμετρήσεις</h2><div class="games">${meet.slice(0, 6).map((x) => { const hw = x.hs > x.as;
        return `<article class="game"><div class="meta"><span>${fmtDate(x.date)}</span><span>${seasonLabel(x.season)}</span></div>
          <div class="match"><span class="team ${hw ? "win" : "loss"}">${esc(S.teamName(x.home))}</span><span class="score">${x.hs ?? "–"}</span>
          <span class="team ${hw ? "loss" : "win"}">${esc(S.teamName(x.away))}</span><span class="score">${x.as ?? "–"}</span></div></article>`; }).join("")}</div></section>` : ""}`;

    const gc = $("#g-court", el);
    if (gc) gc.onclick = () => { App.ui.court = { a: H, b: A, lineups: {}, sel: 0 }; };
  },

  /* ---------------- Μοντέλα: το Monte Carlo αγώνων (πάνω στο μοντέλο ratings + απουσίες) ---------------- */
  predictions(el) {
    const E = App.edge.get(App.comp);
    if (!E) { el.innerHTML = `<div class="empty">Δεν υπάρχει ακόμα μοντέλο αγώνων για αυτή τη διοργάνωση.</div>`; return; }
    const ME = E.model_eval || {}, LV = E.live || {}, C = E.params?.calib || {};
    const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    const sgn = (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + (+v).toFixed(d) : "–");
    const best = (a, b, low = true) => (isNum(a) && isNum(b) && (low ? a < b : a > b) ? "better" : "");
    const row = (label, s, o, k, f, low = true) => `<tr><td>${label}</td><td class="n ${best(s?.[k], o?.[k], low)}">${f(s?.[k])}</td><td class="n ${best(o?.[k], s?.[k], low)}">${f(o?.[k])}</td></tr>`;
    const table = (title, x) => !x ? "" : `<div><h3>${title} <span class="muted" style="font-size:13px">(${x.ratings.n} αγώνες)</span></h3><div class="tbl-wrap"><table><thead><tr><th>Μετρική</th><th class="n">Monte Carlo</th><th class="n">Απλό MC</th></tr></thead><tbody>
      ${row("Σωστός νικητής", x.ratings, x.mc, "acc", fmtPct, false)}${row("Brier", x.ratings, x.mc, "brier", (v) => fmt(v, 3))}${row("Log loss", x.ratings, x.mc, "logloss", (v) => fmt(v, 3))}
      ${row("Σφάλμα διαφοράς (π.)", x.ratings, x.mc, "mae_margin", (v) => fmt(v, 1))}${row("Σφάλμα συνόλου (π.)", x.ratings, x.mc, "mae_total", (v) => fmt(v, 1))}
      ${row("Κάλυψη διαστήματος 80% (ιδανικά 80%)", x.ratings, x.mc, "cover80", fmtPct, false)}
    </tbody></table></div></div>`;
    const ha = isNum(C.a) ? C.a : null;
    el.innerHTML = `
      <section><div class="sec-head"><h2>Monte Carlo αγώνων</h2><span class="muted">ενημέρωση ${esc(E.updated)}</span></div>
        <p style="margin:0;max-width:75ch">Το μοναδικό μοντέλο αγώνων του site. <b>Κινητήρας</b>: ratings επίθεσης/άμυνας/ρυθμού προσαρμοσμένα στον αντίπαλο (ridge regression), με εκθετική απόσβεση ώστε να μεταφέρεται πληροφορία από την προηγούμενη σεζόν, έδρα μετρημένη σε αυτή τη λίγκα και διόρθωση για απουσίες βασικών (στο NBA από τους τραυματίες του ESPN). <b>Προσομοίωση</b>: η διαφορά και το σύνολο κληρώνονται από κανονικές κατανομές με τη δική τους αβεβαιότητα (εκτιμημένη από τα σφάλματα του παρελθόντος), ισοπαλία → παράταση. Όλα επαναϋπολογίζονται κάθε μέρα μόνο με αγώνες που έχουν παιχτεί.</p>
        <div class="tiles">
          ${tile(`${E.params.tau} ημ.`, `Απόσβεση τ (μισή βαρύτητα κάθε ${Math.round(E.params.tau * Math.LN2)} ημέρες)`)}
          ${tile(fmt(E.params.lam, 1), "Ποινή ridge λ")}
          ${tile(fmt(C.sd_m, 1), "σ διαφοράς (π.)")}
          ${tile(fmt(C.sd_t, 1), "σ συνόλου (π.)")}
          ${tile(sgn(C.c, 2), "Πόντοι διαφοράς ανά μονάδα απουσίας")}
          ${tile(isNum(C.n) ? C.n : "–", "Αγώνες βαθμονόμησης")}
        </div>
        ${ha == null ? `<p class="muted" style="margin:0;font-size:13px">Λίγα δεδομένα για βαθμονόμηση· χρησιμοποιούνται προεπιλεγμένες τιμές (σ διαφοράς 12, σ συνόλου 16).</p>` : ""}
      </section>
      <section><div class="sec-head"><h2>Ποιότητα (walk-forward)</h2></div>
        <p class="muted" style="margin:0;font-size:13px">Κάθε αγώνας προβλέφθηκε μόνο με όσα είχαν παιχτεί πριν από την ημέρα του. «Monte Carlo» = το μοντέλο του site (ratings + απουσίες)· «Απλό MC» = η παλιά εκδοχή (μόνο τρέχουσα σεζόν, σταθερή έδρα 3 π. και σ = 10), για σύγκριση. Πράσινο = καλύτερο από τα δύο.</p>
        <div class="grid2">${table("Φετινή σεζόν", ME.current)}${table("Όλες οι σεζόν", ME.all)}</div>
        ${ME.all ? `<div class="grid2">
          <div><h3>Βαθμονόμηση · Monte Carlo</h3><div class="chart" style="max-width:520px">${Charts.calibration(ME.all.ratings.calibration || [])}</div></div>
          <div><h3>Βαθμονόμηση · απλό Monte Carlo</h3><div class="chart" style="max-width:520px">${Charts.calibration(ME.all.mc.calibration || [])}</div></div>
        </div>` : `<div class="empty">Δεν υπάρχουν ακόμα αρκετοί παιγμένοι αγώνες για αξιολόγηση.</div>`}
      </section>
      <section><div class="sec-head"><h2>Ζωντανή καταγραφή</h2></div>
        ${LV.n ? `<div class="tiles">${tile(LV.n, "Αγώνες που κρίθηκαν")}${tile(fmt(LV.brier_model, 3), "Brier (προβλέψεις πριν το ματς)")}${LV.n_mkt ? tile(`${fmt(LV.brier_model_same, 3)} / ${fmt(LV.brier_market, 3)}`, `Brier μοντέλο / αγορά (${LV.n_mkt})`) : ""}</div>`
          : `<div class="empty">Κάθε μέρα αποθηκεύονται οι προβλέψεις πριν από τα ματς${LV.archived ? ` (${LV.archived} σε αναμονή αποτελέσματος)` : ""}. Μόλις παιχτούν, εμφανίζεται εδώ η σύγκριση.</div>`}
      </section>
      <section><div class="sec-head"><h2>Επόμενο: graph neural network</h2></div>
        <p style="margin:0;max-width:75ch">Κάθε αγώνας ως graph: κόμβοι οι παίκτες, ακμές οι συμπαίκτες και οι αντίπαλοι (με τα λεπτά που μοιράζονται στο παρκέ). Θα προβλέπει την απόδοση κάθε παίκτη (box score και συνεισφορά στο σκορ) και, αθροιστικά, το αποτέλεσμα. <a href="gnn.html">Δες τα δεδομένα →</a></p>
      </section>`;
  },

};

App.init();
