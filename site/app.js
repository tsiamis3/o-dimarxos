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
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const fmtDate = (d) => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y.slice(2)}`; };
const seasonLabel = (s) => `${s}-${String(s + 1).slice(2)}`;
function niceName(n) {
  if (!n) return "";
  const tc = (s) => s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
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
};
const fmtStat = (k, v) => (STAT[k]?.pct ? fmtPct(v) : fmt(v, STAT[k]?.d ?? 1));

const PLAYER_COLS = ["GP", "GS", "MIN", "PTS", "REB", "OREB", "DREB", "AST", "STL", "BLK", "TOV", "PF", "FD", "PIR", "PM",
  "FG2M", "FG2A", "FG2P", "FG3M", "FG3A", "FG3P", "FTM", "FTA", "FTP", "EFG", "TS", "PTS36", "PIR36"];
const TEAM_COLS = ["GP", "W", "L", "WPCT", "PTS", "OPP", "DIFF", "PACE", "ORTG", "DRTG", "NET", "EFG", "OEFG", "TOVP",
  "OREBP", "FTR", "FG2P", "FG3P", "FTP", "REB", "AST", "STL", "BLK", "TOV", "PIR", "OPIR"];
const TEAM_BASIC = ["GP", "W", "L", "WPCT", "PTS", "OPP", "DIFF"];   // όταν δεν υπάρχουν box scores
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
  static HCA = 3.0;      // πόντοι πλεονέκτημα έδρας
  static SD = 10.0;      // τυπική απόκλιση σκορ ομάδας
  static SHRINK = 4;     // "εικονικά" ματς μέσου όρου (σταθεροποίηση στην αρχή της σεζόν)

  constructor(season) {
    const tg = season.teamGames;
    const poss = sum(tg.map((t) => t.POSS));
    this.lg = tg.length ? 100 * sum(tg.map((t) => t.PTS)) / poss : 110;
    this.lgPace = tg.length ? poss / tg.length : 75;
    this.agg = season.teamAgg;
  }
  rating(code) {
    const a = this.agg.get(code), k = MatchSim.SHRINK;
    if (!a) return { o: this.lg, d: this.lg, p: this.lgPace };
    const sh = (v, lg) => (a.GP * v + k * lg) / (a.GP + k);
    return { o: sh(a.ORTG, this.lg), d: sh(a.DRTG, this.lg), p: sh(a.PACE, this.lgPace) };
  }
  expected(home, away) {
    const h = this.rating(home), a = this.rating(away), pace = (h.p + a.p) / 2;
    return {
      mh: pace * (h.o + a.d - this.lg) / 100 + MatchSim.HCA / 2,
      ma: pace * (a.o + h.d - this.lg) / 100 - MatchSim.HCA / 2,
    };
  }
  once(home, away) {
    const { mh, ma } = this.expected(home, away);
    let hs = Math.round(mh + MatchSim.SD * randn()), as = Math.round(ma + MatchSim.SD * randn()), ot = 0;
    while (hs === as && ot < 5) {           // παράταση 5' ≈ 1/8 του αγώνα
      ot++;
      hs += Math.max(0, Math.round(mh / 8 + 3 * randn()));
      as += Math.max(0, Math.round(ma / 8 + 3 * randn()));
    }
    if (hs === as) hs++;
    return { hs, as, ot };
  }
  run(home, away, n = 5000) {
    let w = 0; const margins = new Array(n); let sh = 0, sa = 0;
    for (let i = 0; i < n; i++) {
      const r = this.once(home, away);
      if (r.hs > r.as) w++;
      margins[i] = r.hs - r.as; sh += r.hs; sa += r.as;
    }
    return { pHome: w / n, margins, avgH: sh / n, avgA: sa / n, ...this.expected(home, away) };
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
  radar({ axes, series, W = 420, H = 380 }) {
    const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) / 2 - 58, n = axes.length;
    const pt = (i, r) => [cx + r * Math.sin((2 * Math.PI * i) / n), cy - r * Math.cos((2 * Math.PI * i) / n)];
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" style="min-width:280px">`;
    [0.25, 0.5, 0.75, 1].forEach((f) => (s += `<polygon class="grid" fill="none" points="${axes.map((_, i) => pt(i, R * f).join(",")).join(" ")}"/>`));
    axes.forEach((a, i) => {
      const [x, y] = pt(i, R), [lx, ly] = pt(i, R + 22);
      s += `<line class="grid" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/>`;
      s += `<text x="${lx}" y="${ly + 4}" text-anchor="${Math.abs(lx - cx) < 8 ? "middle" : lx > cx ? "start" : "end"}">${esc(a)}</text>`;
    });
    series.forEach((se) => {
      const p = se.vals.map((v, i) => pt(i, R * Math.max(0.03, isNum(v) ? v : 0)).join(",")).join(" ");
      s += `<polygon class="area ${se.k}" points="${p}" style="opacity:.18"/><polygon class="line ${se.k}" points="${p}"/>`;
    });
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
const VIEWS = ["home", "teams", "players", "explorer", "predictions"];

const App = {
  manifest: null, section: "europe", comp: "E", season: null,
  cache: new Map(),       // "E2026" -> Season
  preds: new Map(),       // "E" -> predictions json | null
  ui: {
    team: null, team2: "", players: [], pstat: "PTS",
    ex: { level: "players", all: false, mode: "avg", team: "", minGP: 1, minMIN: 0, q: "", cs: "PTS", co: ">=", cv: "",
          cols: { players: ["GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "PIR", "FG3P", "TS"],
                  teams: ["GP", "W", "L", "PTS", "OPP", "NET", "PACE", "ORTG", "DRTG", "EFG", "TOVP", "OREBP"],
                  logs: ["MIN", "PTS", "REB", "AST", "STL", "TOV", "PIR", "PM"] } },
    predGame: "", predTarget: "PTS",
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
  async loadPreds(comp) {
    if (!this.preds.has(comp)) {
      const c = this.compInfo(comp);
      this.preds.set(comp, c?.predictions ? await this.json(`data/predictions_${comp}.json`).catch(() => null) : null);
    }
    return this.preds.get(comp);
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

  route() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "home"; },
  go(view) { if (this.route() === view) this.render(); else location.hash = view; window.scrollTo(0, 0); },
  goPlayer(pid) { this.ui.players = [pid]; this.go("players"); },
  goTeam(code) { this.ui.team = code; this.ui.team2 = ""; this.go("teams"); },

  async render() {
    const info = this.compInfo();
    const off = { players: info.hasBox === false, predictions: !info.predictions };
    $$("#tabs a").forEach((a) => (a.hidden = !!off[a.getAttribute("href").slice(1)]));
    if (off[this.route()]) { location.hash = "home"; return; }
    const v = this.route();
    $$("#tabs a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === "#" + v ? "page" : "false"));
    const view = $("#view");
    try {
      await this.loadSeason(this.comp, this.season);
      await this.loadPreds(this.comp);
      if (this.preds.get(this.comp)) await this.loadSeason(this.comp, this.latestSeason());
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
const Views = {
  /* ---------------- Αρχική: επερχόμενα + προσομοίωση + αποτελέσματα + βαθμολογία ---------------- */
  home(el, S) {
    const sim = new MatchSim(S);
    const preds = S.season === App.latestSeason() ? App.preds.get(App.comp) : null;
    const nextRound = S.upcoming.length ? S.upcoming[0].round : null;
    const upcoming = S.upcoming.filter((g) => g.round === nextRound).slice(0, 12);
    const lastRound = S.games.length ? Math.max(...S.games.map((g) => g.round || 0)) : null;
    const results = S.games.filter((g) => g.round === lastRound);

    const gameCard = (g, i) => {
      const r = sim.run(g.home, g.away, 3000);
      const ph = Math.round(r.pHome * 100);
      return `<article class="game" data-i="${i}">
        <div class="meta"><span>${fmtDate(g.date)} ${esc(g.time || "")}</span><span>Αγ. ${g.round ?? "–"}</span></div>
        <div class="match">
          <span class="team">${App.teamLink(g.home, S)}</span><span class="score muted">${Math.round(r.mh)}</span>
          <span class="team">${App.teamLink(g.away, S)}</span><span class="score muted">${Math.round(r.ma)}</span>
        </div>
        <div class="probbar" aria-label="Πιθανότητα νίκης"><i style="width:${ph}%"></i><i style="width:${100 - ph}%"></i></div>
        <div class="problabels"><span>${ph}% νίκη έδρας</span><span>${100 - ph}%</span></div>
        <div class="actions"><button class="btn primary" data-sim="${i}">Προσομοίωση</button><button class="btn" data-once="${i}">Παίξε ένα ματς</button></div>
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
        ${upcoming.length ? `<p class="muted" style="margin:0">Οι αριθμοί δίπλα στις ομάδες είναι το αναμενόμενο σκορ ${S.hasBox ? "από ratings επίθεσης/άμυνας και ρυθμού" : "από τους πόντους υπέρ/κατά κάθε ομάδας"}, με +${MatchSim.HCA} πόντους έδρα.</p>
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
      const b = e.target.closest("[data-sim],[data-once]"); if (!b) return;
      const i = +(b.dataset.sim ?? b.dataset.once), g = upcoming[i], box = $(`.game[data-i="${i}"] .simbox`, up);
      box.hidden = false;
      if (b.dataset.once != null) {
        const r = sim.once(g.home, g.away);
        const old = $(".single-result", box);
        const line = `<div class="single-result">${esc(S.teamName(g.home))} ${r.hs} – ${r.as} ${esc(S.teamName(g.away))}${r.ot ? ` (${r.ot > 1 ? r.ot + "×" : ""}παράταση)` : ""}</div>`;
        if (old) old.outerHTML = line; else box.insertAdjacentHTML("afterbegin", line);
        return;
      }
      const r = sim.run(g.home, g.away, 10000);
      const top = (team) => {
        if (!preds) return "";
        const rows = rowsToObjs(preds.next).filter((p) => p.team === team && p.gameCode === g.gameCode).sort((a, b) => b.PIR - a.PIR).slice(0, 3);
        const L = App.cache.get(App.comp + App.latestSeason());
        return `<div><div class="eyebrow">${esc(S.teamName(team))}</div><ol>${rows.map((p) => `<li>${App.playerLink(p.pid, L.playerName(p.pid))} <span class="num muted" style="display:block">${fmt(p.PTS)} π · ${fmt(p.PIR)} PIR</span></li>`).join("") || "<li class='muted'>—</li>"}</ol></div>`;
      };
      const single = $(".single-result", box)?.outerHTML || "";
      box.innerHTML = `${single}
        <div class="row" style="justify-content:space-between"><span class="eyebrow">10.000 προσομοιώσεις</span>
          <span class="num">${fmt(r.avgH)} – ${fmt(r.avgA)}</span></div>
        <div class="chart">${Charts.marginHist(r.margins)}</div>
        <div class="problabels"><span>νίκη έδρας ${fmtPct(r.pHome)}</span><span>διαφορά πόντων (έδρα − φιλοξ.)</span></div>
        ${preds ? `<div class="eyebrow">Κορυφαίοι κατά το μοντέλο (PIR)</div><div class="performers">${top(g.home)}${top(g.away)}</div>` : ""}`;
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
      <section><div class="filters">
        <label>Ομάδα<select id="t1">${opts(App.ui.team)}</select></label>
        <label>Σύγκριση με<select id="t2">${opts(App.ui.team2, true)}</select></label>
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
          <div class="tiles">${(S.hasBox ? ["PTS", "OPP", "NET", "ORTG", "DRTG", "PACE", "EFG", "TOVP"] : ["PTS", "OPP", "DIFF", "WPCT"]).map((k) => tile(k)).join("")}</div></section>
        <section><h3>Πόντοι ανά αγώνα</h3>
          <div class="legend"><span><i class="c1bg"></i>Πέτυχε</span><span><i class="c2bg"></i>Δέχτηκε</span></div>
          <div class="chart">${Charts.line({ series: [
            { k: "k1", dots: true, pts: gs.map((g, i) => [i + 1, g.PTS]) },
            { k: "k2", dots: true, pts: gs.map((g, i) => [i + 1, g.o.PTS]) }],
            xLabel: (x) => "Αγ." + (gs[x - 1]?.round ?? x) })}</div></section>
        ${S.hasBox ? `<section><h3>Ρόστερ (μέσοι όροι)</h3><div id="roster"></div></section>` : ""}
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

  /* ---------------- Παίκτες: προφίλ + σύγκριση έως 4 ---------------- */
  players(el, S) {
    const pa = S.playerAgg;
    if (!pa.length) { el.innerHTML = `<div class="empty">Δεν υπάρχουν στατιστικά παικτών για αυτή τη σεζόν.</div>`; return; }
    const byId = new Map(pa.map((p) => [p.pid, p]));
    App.ui.players = App.ui.players.filter((id) => byId.has(id));
    if (!App.ui.players.length) App.ui.players = [[...pa].filter((p) => p.GP >= 3).sort((a, b) => b.PIR - a.PIR)[0]?.pid || pa[0].pid];
    const sel = App.ui.players.map((id) => byId.get(id));
    const K = ["k1", "k2", "k3", "k4"], BG = ["c1bg", "c2bg", "c3bg", "c4bg"];
    const chartStats = ["PTS", "REB", "AST", "PIR", "MIN", "STL", "TOV", "FG3M", "FTA", "PM"];
    if (!chartStats.includes(App.ui.pstat)) App.ui.pstat = "PTS";

    el.innerHTML = `
      <section>
        <div class="filters">
          <label style="flex:1 1 260px">Αναζήτηση παίκτη (πρόσθεσε έως 4 για σύγκριση)
            <input type="search" id="psearch" placeholder="π.χ. όνομα ή ομάδα" autocomplete="off"></label>
        </div>
        <div class="chips" id="presults"></div>
        <div class="row">${sel.map((p, i) => `<span class="sel-chip" style="border-color:var(--c${i + 1})">${esc(p.player)} <span class="muted">${esc(p.team)}</span><button data-rm="${p.pid}" aria-label="Αφαίρεση ${esc(p.player)}">×</button></span>`).join("")}</div>
      </section>
      <div id="pv" style="display:flex;flex-direction:column;gap:28px"></div>`;

    const search = $("#psearch", el), res = $("#presults", el);
    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { res.innerHTML = ""; return; }
      const hits = pa.filter((p) => p.player.toLowerCase().includes(q) || S.teamName(p.team).toLowerCase().includes(q) || p.team.toLowerCase() === q)
        .sort((a, b) => b.PIR - a.PIR).slice(0, 14);
      res.innerHTML = hits.map((p) => `<button class="chip" data-add="${p.pid}">${esc(p.player)} <span class="muted">${esc(p.team)} · ${fmt(p.PIR)} PIR</span></button>`).join("") || `<span class="muted">Κανένα αποτέλεσμα</span>`;
    };
    res.onclick = (e) => {
      const b = e.target.closest("[data-add]"); if (!b) return;
      const id = b.dataset.add;
      if (!App.ui.players.includes(id)) App.ui.players = [...App.ui.players, id].slice(-4);
      Views.players(el, S);
    };
    el.querySelector(".row").onclick = (e) => {
      const b = e.target.closest("[data-rm]"); if (!b) return;
      App.ui.players = App.ui.players.filter((x) => x !== b.dataset.rm);
      Views.players(el, S);
    };

    const pv = $("#pv", el);
    const logsOf = (pid) => S.logs.filter((r) => r.pid === pid).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    const statSelect = `<label class="muted" style="font-size:12px">Στατιστικό <select id="pstat">${chartStats.map((k) => `<option value="${k}" ${k === App.ui.pstat ? "selected" : ""}>${STAT[k].name}</option>`).join("")}</select></label>`;
    const bindStat = () => { $("#pstat", pv).onchange = (e) => { App.ui.pstat = e.target.value; Views.players(el, S); }; };
    const k = App.ui.pstat;

    if (sel.length === 1) {
      const p = sel[0], lg = logsOf(p.pid);
      const preds = S.season === App.latestSeason() ? App.preds.get(App.comp) : null;
      const bt = preds ? rowsToObjs(preds.backtest).filter((r) => r.pid === p.pid && r.season === S.season) : [];
      const nx = preds ? rowsToObjs(preds.next).find((r) => r.pid === p.pid) : null;
      const idxOf = new Map(lg.map((r, i) => [r.gameCode, i + 1]));
      const series = [
        { k: "k1", dots: true, thin: true, pts: lg.map((r, i) => [i + 1, r[k]]) },
        { k: "k1", pts: lg.map((r, i) => [i + 1, mean(lg.slice(Math.max(0, i - 4), i + 1).map((x) => x[k]))]) },
      ];
      const hasModel = preds && preds.targets.includes(k);
      if (hasModel && bt.length) series.push({ k: "k2", dash: true, dots: true, r: 3, pts: bt.filter((r) => idxOf.has(r.gameCode)).map((r) => [idxOf.get(r.gameCode), r["p_" + k]]) });
      if (hasModel && nx) series.push({ k: "k2", dotsOnly: true, r: 6, pts: [[lg.length + 1, nx[k]]] });
      pv.innerHTML = `
        <section><div class="sec-head"><h2>${esc(p.player)}</h2><span>${App.teamLink(p.team, S)}</span></div>
          <div class="tiles">${["GP", "MIN", "PTS", "REB", "AST", "PIR", "TS", "FG3P"].map((s) => `<div class="tile"><div class="v">${fmtStat(s, p[s])}</div><div class="l">${STAT[s].name}</div></div>`).join("")}</div>
          ${nx ? `<div class="tile" style="border-color:var(--c2)"><div class="eyebrow">Πρόβλεψη μοντέλου · επόμενο ματς ${nx.home ? "vs" : "@"} ${esc(S.teamName(nx.opp))} (${fmtDate(nx.date)})</div>
            <div class="row num" style="margin-top:6px;gap:18px">${preds.targets.map((t) => `<span><b>${fmt(nx[t])}</b> <span class="muted">${STAT[t].label}</span></span>`).join("")}</div></div>` : ""}
        </section>
        <section><div class="sec-head"><h3>Ανά αγώνα</h3>${statSelect}</div>
          <div class="legend"><span><i class="c1bg" style="opacity:.5"></i>Αγώνας</span><span><i class="c1bg"></i>Μ.Ο. 5 αγώνων</span>${hasModel ? `<span><i class="c2bg"></i>Πρόβλεψη μοντέλου (εκτός training)</span>` : ""}</div>
          <div class="chart">${Charts.line({ series, xLabel: (x) => (x <= lg.length ? "Αγ." + (lg[x - 1].round ?? x) : "Επόμ."), yZero: k !== "PM" })}</div></section>
        <section><h3>Game log</h3><div id="plog"></div></section>`;
      bindStat();
      new SortTable($("#plog", pv), {
        cols: [{ key: "round", label: "Αγ.", n: true }, { key: "date", label: "Ημ/νία", fmt: fmtDate },
          { key: "opp", label: "Αντίπ.", html: (r) => (r.home ? "vs " : "@ ") + App.teamLink(r.opp, S) },
          ...LOG_STATS.map(logCol)],
        rows: lg, sortKey: "round", sortDir: -1,
      });
      return;
    }

    // ---- σύγκριση παικτών ----
    const maxGP = Math.max(...pa.map((p) => p.GP));
    const pool = pa.filter((p) => p.GP >= Math.max(2, 0.3 * maxGP) && p.MIN >= 10);
    const RADAR = ["PTS", "REB", "AST", "STL", "BLK", "PIR", "TS", "FG3P", "MIN"];
    const pr = (key, v) => (pool.length > 1 ? pool.filter((x) => x[key] < v).length / (pool.length - 1) : 0.5);
    const CMP = ["GP", "MIN", "PTS", "REB", "OREB", "AST", "STL", "BLK", "TOV", "PF", "FD", "PIR", "PM", "FG2P", "FG3P", "FG3A", "FTP", "FTA", "EFG", "TS", "PTS36", "PIR36"];
    const roll3 = (lg) => lg.map((r, i) => [i + 1, mean(lg.slice(Math.max(0, i - 2), i + 1).map((x) => x[k]))]);
    pv.innerHTML = `
      <section><div class="legend">${sel.map((p, i) => `<span><i class="${BG[i]}"></i>${esc(p.player)} (${esc(p.team)})</span>`).join("")}</div></section>
      <div class="grid2">
        <section><h3>Προφίλ (εκατοστημόριο)</h3>
          <div class="chart">${Charts.radar({ axes: RADAR.map((s) => STAT[s].label), series: sel.map((p, i) => ({ k: K[i], vals: RADAR.map((s) => pr(s, p[s])) })) })}</div>
          <p class="muted" style="margin:0;font-size:13px">Σε σχέση με παίκτες με ≥10' και αρκετά ματς (${pool.length} παίκτες).</p></section>
        <section><h3>Μέσοι όροι</h3><div class="tbl-wrap"><table><thead><tr><th>Στατιστικό</th>${sel.map((p, i) => `<th class="n" style="color:var(--c${i + 1})">${esc(p.player.split(" ").at(-1))}</th>`).join("")}</tr></thead><tbody>
          ${CMP.map((s) => {
            const vals = sel.map((p) => p[s]), best = STAT[s].low ? Math.min(...vals.filter(isNum)) : Math.max(...vals.filter(isNum));
            return `<tr><td>${STAT[s].name}</td>${vals.map((v) => `<td class="n ${v === best && s !== "GP" ? "better" : ""}">${fmtStat(s, v)}</td>`).join("")}</tr>`;
          }).join("")}</tbody></table></div></section>
      </div>
      <section><div class="sec-head"><h3>Πορεία (κυλιόμενος μέσος 3 αγώνων)</h3>${statSelect}</div>
        <div class="chart">${Charts.line({ series: sel.map((p, i) => ({ k: K[i], pts: roll3(logsOf(p.pid)) })), xLabel: (x) => "#" + x, yZero: k !== "PM" })}</div></section>`;
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

  /* ---------------- Προβλέψεις μοντέλου ---------------- */
  predictions(el) {
    const P = App.preds.get(App.comp);
    if (!P) { el.innerHTML = `<div class="empty">Δεν υπάρχει εκπαιδευμένο μοντέλο για αυτή τη διοργάνωση ακόμα. Τρέξε το scripts/train_model.py (το κάνει αυτόματα το GitHub Action).</div>`; return; }
    const L = App.cache.get(App.comp + App.latestSeason());
    const next = rowsToObjs(P.next).map((r) => ({ ...r, player: L.playerName(r.pid), match: r.gameCode }));
    const games = [...new Map(next.map((r) => [r.gameCode, r])).values()]
      .map((r) => ({ gc: r.gameCode, date: r.date, h: r.home ? r.team : r.opp, a: r.home ? r.opp : r.team }))
      .filter((g, i, arr) => arr.findIndex((x) => x.gc === g.gc) === i).sort((a, b) => a.date.localeCompare(b.date) || a.gc - b.gc);
    if (!P.targets.includes(App.ui.predTarget)) App.ui.predTarget = P.targets[0];
    const t = App.ui.predTarget;
    const bt = rowsToObjs(P.backtest);
    const imp = (m) => (m.last10 ? (100 * (m.last10 - m.model)) / m.last10 : NaN);

    el.innerHTML = `
      <section><div class="sec-head"><h2>Μοντέλο πρόβλεψης παίκτη</h2><span class="muted">εκπαίδευση ${esc(P.trained)}</span></div>
        <p style="margin:0;max-width:70ch">Feed-forward νευρωνικό δίκτυο (Keras, <span class="num">${esc(P.arch)}</span>) που προβλέπει τα ${P.targets.map((x) => STAT[x].label).join(", ")} του επόμενου αγώνα από ${P.n_features} χαρακτηριστικά: κυλιόμενους μέσους 3/5/10 αγώνων, εκθετικό μέσο, μέσο σεζόν, ξεκούραση, έδρα και την αμυντική απόδοση του αντιπάλου. Αξιολογείται σε αγώνες που δεν είδε στην εκπαίδευση (τελευταίο ${Math.round(100 * P.n_test / (P.n_test + P.n_train))}% χρονικά).</p>
        <div class="grid2">
          <div class="tbl-wrap"><table><thead><tr><th>Στατιστικό</th><th class="n">MAE μοντέλου</th><th class="n">Μ.Ο. 10</th><th class="n">Μ.Ο. σεζόν</th><th class="n">Βελτίωση</th></tr></thead><tbody>
            ${P.targets.map((x) => { const m = P.metrics[x]; const i = imp(m); return `<tr><td>${STAT[x].name}</td><td class="n"><b>${fmt(m.model, 2)}</b></td><td class="n">${fmt(m.last10, 2)}</td><td class="n">${fmt(m.season, 2)}</td><td class="n ${i > 0 ? "better" : ""}">${i > 0 ? "+" : ""}${fmt(i)}%</td></tr>`; }).join("")}
          </tbody></table></div>
          <div><div class="legend"><span><i class="c1bg"></i>Training loss</span><span><i class="c2bg"></i>Validation loss</span></div>
            <div class="chart">${P.loss ? Charts.line({ series: [{ k: "k1", pts: P.loss.train.map((v, i) => [i + 1, v]) }, { k: "k2", pts: P.loss.val.map((v, i) => [i + 1, v]) }], xLabel: (x) => "ep " + x, yFmt: (v) => v.toFixed(2), H: 200 }) : ""}</div></div>
        </div>
        <p class="muted" style="margin:0;font-size:13px">MAE = μέσο απόλυτο σφάλμα (μικρότερο = καλύτερο). «Βελτίωση» = σε σχέση με τον απλό μέσο όρο των 10 τελευταίων αγώνων.</p>
      </section>
      <section><div class="sec-head"><h2>Προβλέψεις επόμενου αγώνα</h2>
          <label class="muted" style="font-size:12px">Αγώνας <select id="pg"><option value="">Όλοι (${games.length})</option>${games.map((g) => `<option value="${g.gc}" ${String(g.gc) === String(App.ui.predGame) ? "selected" : ""}>${fmtDate(g.date)} ${esc(L.teamName(g.h))} – ${esc(L.teamName(g.a))}</option>`).join("")}</select></label></div>
        ${next.length ? `<div id="ptab"></div>` : `<div class="empty">Δεν υπάρχουν προγραμματισμένα ματς για νέες προβλέψεις.</div>`}
      </section>
      <section><div class="sec-head"><h2>Πρόβλεψη vs πραγματικό</h2>
          <label class="muted" style="font-size:12px">Στατιστικό <select id="pt">${P.targets.map((x) => `<option value="${x}" ${x === t ? "selected" : ""}>${STAT[x].name}</option>`).join("")}</select></label></div>
        <p class="muted" style="margin:0;font-size:13px">${bt.length} αγώνες της τρέχουσας σεζόν εκτός training. Όσο πιο κοντά στη διαγώνιο, τόσο καλύτερα.</p>
        <div class="chart" style="max-width:620px">${Charts.scatter({ pts: bt.map((r) => [r["p_" + t], r[t]]), xLabel: "Πρόβλεψη " + STAT[t].label, yLabel: "Πραγματικό " + STAT[t].label })}</div>
      </section>`;

    if (next.length) {
      const tab = new SortTable($("#ptab", el), {
        cols: [{ key: "player", label: "Παίκτης", html: (r) => App.playerLink(r.pid, r.player) }, { key: "team", label: "Ομάδα" },
          { key: "opp", label: "Αντίπ.", fmt: (v, r) => (r.home ? "vs " : "@ ") + esc(v) }, { key: "date", label: "Ημ/νία", fmt: fmtDate },
          ...P.targets.map(statCol)],
        rows: next.filter((r) => !App.ui.predGame || String(r.gameCode) === String(App.ui.predGame)), sortKey: "PIR", pageSize: 40,
      });
      $("#pg", el).onchange = (e) => { App.ui.predGame = e.target.value; tab.setRows(next.filter((r) => !App.ui.predGame || String(r.gameCode) === App.ui.predGame)); };
    }
    $("#pt", el).onchange = (e) => { App.ui.predTarget = e.target.value; Views.predictions(el); };
  },
};

App.init();
