/* Προσομοιώσεις για το σάιτ (Node, ίδια μηχανή με τον browser: site/sim.js).
 *
 * Για κάθε αγώνα της λίγκας (όλες οι ομάδες):
 *   1. N προσομοιώσεις (SIM_N, προεπιλογή 50.000).
 *        - παιγμένοι: walk-forward, με στατιστικά ΜΟΝΟ από τους αγώνες πριν από αυτόν, και το πραγματικό box score δίπλα
 *        - επόμενοι: με τα τωρινά στατιστικά (οι 2 επόμενοι κάθε ομάδας)
 *   2. Ροπές κάθε κατανομής (μέσος, διασπορά, ασυμμετρία, κύρτωση), ποσοστημόρια για boxplot, χάντικαπ:
 *        αποτέλεσμα (διαφορά), πόντοι ομάδων, σύνολο, στατιστικά παικτών. Όσες έχουν τεράστια διασπορά σημαίνονται show=false.
 * Βάρη του log5 (β ανά τύπο φάσης): λογιστική παλινδρόμηση στα box scores (παίκτης × αγώνας, walk-forward),
 *   logit p = logit(λίγκα) + β0 + β1·[παίκτης − ομάδα] + β3·[ομάδα − λίγκα] + β2·[άμυνα − λίγκα]
 *   με ήπια ridge προς το κλασικό log5 (0, 1, 1, 1). Κάθε παιγμένος αγώνας χρησιμοποιεί β μόνο από τους προηγούμενους.
 *   SIM_BETA=0: κλασικό log5 παντού (για σύγκριση).
 * Πηγές: ο ίδιος έλεγχος με τα ποσοστά των παικτών να παίρνουν και αγώνες τους σε άλλες λίγκες/σεζόν (DB.sources),
 *   walk-forward, ίδια seeds -> check_sources («βοηθούν οι άλλες λίγκες;»). Οι προσομοιώσεις του σάιτ μένουν μόνο GBL.
 * Έλεγχος βαθμονόμησης: όλοι οι παιγμένοι αγώνες της λίγκας (walk-forward, SIM_CHECK ο καθένας):
 *   πόσο συχνά το πραγματικό πέφτει μέσα στο «κουτί» (25–75%, θέλουμε ~50%) και στις «κεραίες» (5–95%, ~90%).
 *
 *   node scripts/run_sims.js GBL        # -> site/db/sims_GBL.json   (ή E, U)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SIM = require(path.join(__dirname, "..", "site", "sim.js"));

const N = +(process.env.SIM_N || 50000), N_CHECK = +(process.env.SIM_CHECK || 2000), NEXT = 2, EXT_W = 0.5;
const ROOT = path.join(__dirname, "..");
const LEAGUE = process.argv[2] || "GBL";
const OUTF = path.join(ROOT, "site", "db", `sims_${LEAGUE}.json`);
const W = require(path.join(__dirname, "wf.js")).league(LEAGUE);
const { DB0, LOGS, PLAYED, WF, dbAsOf, canRun, actualBox, stripHist, seedOf, STATS, FIT, BETA, oos, RIDGE, USE_BETA, RF, ratingsAsOf, teamAdj } = W;
const RNOW = RF?.w ? ratingsAsOf(null) : null;

// ---------------------------------------------------------------- όλοι οι αγώνες: παιγμένοι (walk-forward) + οι επόμενοι 2 κάθε ομάδας
const RES = {};
const out = { n: N, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", version: SIM.version,
  show_cv: SIM.SHOW_CV, show_min: SIM.SHOW_MIN, beta: BETA,
  beta_fit: { ridge: RIDGE, used: USE_BETA, ...Object.fromEntries(SIM.EVENTS.map((k) => [k, { ...FIT[k], oos_dll: +((oos[k].ll - oos[k].ll0) / oos[k].n).toFixed(5), oos_n: Math.round(oos[k].n) }])) },
  ext_w: EXT_W, re: W.RE || SIM.RE0, re_fit: (() => { try { const f = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sim_re.json"), "utf8"));
    return { fitted: f.fitted, games: f.games, leagues: f.leagues, sims_each: f.sims_each, before: f.before, after: f.after, decomp: f.decomp }; } catch { return null; } })(),
  ratings: (() => { const Rn = RF ? ratingsAsOf(null) : null; if (!Rn) return null;
    const pick = (k) => RF.table?.[k]; const wk = "w" + RF.w;
    return { w: RF.w, hyper: RF.hyper, mu: +Rn.mu.toFixed(2), h: +Rn.h.toFixed(2), fitted: RF.fitted, games: RF.games,
      teams: Object.fromEntries(Object.keys(DB0.teams).map((t) => [t, { o: +Rn.o[t].toFixed(2), d: +Rn.d[t].toFixed(2) }])),
      eval: { players: pick("w0"), blend: pick(wk), ratings: RF.ratings_only, league_players: pick(`${LEAGUE}:w0`), league_blend: pick(`${LEAGUE}:${wk}`) }, rmse: RF.rmse, rmse_flat: RF.rmse_flat }; })(),
  games: {}, check: null, check_sources: null };
const all = Object.values(DB0.games).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
const next = new Set();
for (const c of DB0.demo) all.filter((g) => !g.played && (g.home === c || g.away === c)).slice(0, NEXT).forEach((g) => next.add(g.code));
for (const g of all) {
  if (!g.played && !next.has(g.code)) continue;
  const w = g.played ? WF.get(g.code) : null;
  if (g.played && !w) { console.log(`  · ${g.date}: λίγοι προηγούμενοι αγώνες για walk-forward, παραλείπεται`); continue; }
  const ctx = w ? { ...w.ctx, beta: w.beta, tAdj: w.tAdj } : SIM.prepare(DB0, g.home, g.away, { beta: BETA });
  if (!w) ctx.tAdj = teamAdj(ctx, g.home, g.away, RNOW, seedOf(g.code) + 3);
  if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
  const t0 = Date.now();
  let r = SIM.many(ctx, N, seedOf(g.code));
  if (g.played) RES[g.code] = r = stripHist(r);
  out.games[g.code] = { home: g.home, away: g.away, date: g.date, round: g.round, played: g.played, wf: g.played, tadj: ctx.tAdj ? ctx.tAdj.map((v) => +v.toFixed(4)) : null, ...r,
    ...(g.played ? { actual: { hs: g.hs, as: g.as, box: actualBox(g.code) } } : {}) };
  const nm = (c) => DB0.teams[c]?.name || DB0.opponents[c]?.name || c;
  console.log(`  ${g.played ? "[παιγμ.]" : "[επόμ.] "} ${nm(g.home)} – ${nm(g.away)}: γηπ. ${(100 * r.p_home).toFixed(1)}%, ` +
    `σκορ ${r.score[0].mean}-${r.score[1].mean}${g.played ? ` (πραγματικό ${g.hs}-${g.as})` : ""} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ---------------------------------------------------------------- έλεγχος βαθμονόμησης (όλη η λίγκα, walk-forward)
const pc = (x, m) => +(x / Math.max(m, 1)).toFixed(3);
/** getR(g, w) -> αποτέλεσμα προσομοίωσης για τον παιγμένο αγώνα g (ή null). */
function evaluate(getR, simsEach) {
  const cov = {}; const addCov = (key, d, v) => { const c = (cov[key] ||= { n: 0, box: 0, whisk: 0, below: 0 }); c.n++;
    c.box += v >= d.p25 && v <= d.p75; c.whisk += v >= d.p5 && v <= d.p95; c.below += v < d.p50; };
  let brier = 0, brierBase = 0, hit = 0, errM = 0, errT = 0, n = 0, homeW = 0, seen = 0, errP = 0, nP = 0;
  const perGame = [];
  for (const g of PLAYED) {
    const w = WF.get(g.code), r = w ? getR(g, w) : null, y = g.hs > g.as ? 1 : 0;
    if (!r) { seen++; homeW += y; continue; }
    const hr = seen ? homeW / seen : 0.6;
    perGame.push([g.code, r.p_home, y, +r.margin.mean.toFixed(2), g.hs - g.as, +r.total.mean.toFixed(1), g.hs + g.as]);
    brier += (r.p_home - y) ** 2; brierBase += (hr - y) ** 2; hit += (r.p_home >= 0.5) === (y === 1);
    errM += Math.abs(r.margin.mean - (g.hs - g.as)); errT += Math.abs(r.total.mean - (g.hs + g.as)); n++;
    addCov("score", r.score[0], g.hs); addCov("score", r.score[1], g.as); addCov("margin", r.margin, g.hs - g.as); addCov("total", r.total, g.hs + g.as);
    const box = actualBox(g.code);
    for (const side of r.players) for (const p of side) { const a = box[p.pid]; if (!a) continue;
      errP += Math.abs(p.pts.mean - a.pts); nP++;
      for (const k of ["pts", "reb", "ast", "pir"]) if (p[k].show) addCov(k, p[k], a[k]); }
    seen++; homeW += y;
  }
  return { games: n, sims_each: simsEach, walk_forward: true, brier: pc(brier, n), brier_home_rate: pc(brierBase, n), acc: pc(hit, n),
    mae_margin: +(errM / n).toFixed(2), mae_total: +(errT / n).toFixed(2), mae_player_pts: +(errP / Math.max(nP, 1)).toFixed(3), per_game: perGame,
    coverage: Object.fromEntries(Object.entries(cov).map(([k, c]) => [k, { n: c.n, box: pc(c.box, c.n), whisk: pc(c.whisk, c.n), below_median: pc(c.below, c.n) }])) };
}
out.check = evaluate((g) => RES[g.code], N);
// ποιες πηγές βοηθούν: ίδιοι αγώνες, ίδια seeds, μόνο οι πηγές αλλάζουν (walk-forward και για τις άλλες λίγκες)
const SRC = Object.keys(DB0.sources || {});
const own = (k) => DB0.sources[k].comp === DB0.comp, short = DB0.short || LEAGUE;
const CFG = [[`Μόνο ${short}`, []], [`+ ${short} περσινή`, SRC.filter(own)], ["+ άλλες λίγκες", SRC.filter((k) => !own(k))], ["Όλες", SRC]]
  .filter(([, s], i) => i === 0 || s.length);
out.check_sources = CFG.map(([label, sources]) => {
  const t0 = Date.now();
  const c = evaluate((g, w) => { const ctx = sources.length ? SIM.prepare(dbAsOf(g.date), g.home, g.away, { beta: w.beta, sources, extW: EXT_W, asOf: g.date }) : { ...w.ctx, beta: w.beta };
    ctx.tAdj = w.tAdj;
    return ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5 ? null : SIM.many(ctx, N_CHECK, seedOf(g.code) + 1); }, N_CHECK);
  console.log(`  πηγές «${label}»: brier ${c.brier} · σωστός ${c.acc} · σφάλμα διαφοράς ${c.mae_margin} · συνόλου ${c.mae_total} · πόντων παίκτη ${c.mae_player_pts} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  delete c.per_game; return { label, sources, ...c };
});
console.log("  έλεγχος (walk-forward):", JSON.stringify(out.check));
// ---------------------------------------------------------------- Αξία: μοντέλο απέναντι στις αποδόσεις (αν υπάρχουν)
// data/raw/<λίγκα><σεζόν>_odds.csv (scripts/scrapers/odds_api.py, θέλει GitHub secret ODDS_API_KEY).
// Για κάθε επόμενο αγώνα και αγορά: πιθανότητα του μοντέλου, δίκαιη πιθανότητα της αγοράς (χωρίς περιθώριο),
// καλύτερη απόδοση, αναμενόμενη απόδοση (EV) και ποσό με ¼ Kelly. Ημερολόγιο εικονικών στοιχημάτων στο data/predictions.
const VALUE = { min_ev: 0.05, kelly: 0.25, cap: 0.03, max_gap: 0.15, max_odds: 5 };
function readCSV(f) {
  if (!fs.existsSync(f)) return [];
  const [h, ...L] = fs.readFileSync(f, "utf8").trim().split(/\r?\n/), H = h.split(",");
  return L.map((l) => Object.fromEntries(l.split(",").map((v, i) => [H[i], v === "" ? null : isNaN(+v) ? v : +v])));
}
const ODDS = readCSV(path.join(ROOT, "data", "raw", `${LEAGUE}${DB0.season}_odds.csv`));
const LEDF = path.join(ROOT, "data", "predictions", `value_${LEAGUE}.json`);
const ledger = (() => { try { return JSON.parse(fs.readFileSync(LEDF, "utf8")); } catch { return { bets: {}, games: {} }; } })();
const devig = (a, b) => (a > 1 && b > 1 ? (1 / a) / (1 / a + 1 / b) : null);
const mode = (arr) => { const c = {}; for (const x of arr) if (x != null) c[x] = (c[x] || 0) + 1; const e = Object.entries(c).sort((x, y) => y[1] - x[1])[0]; return e ? +e[0] : null; };
function marketsFor(code, G) {
  const B = ODDS.filter((o) => String(o.gameCode) === String(code)); if (!B.length) return null;
  const M = [], add = (market, side, line, pm, odds, mp, books) => {
    if (!pm || !(odds > 1)) return;
    const ev = pm.win * odds + pm.push - 1, b = odds - 1, f = Math.max(0, (pm.win * b - (1 - pm.win - pm.push)) / b);
    M.push({ market, side, line, p: +pm.win.toFixed(4), push: +pm.push.toFixed(4), odds, market_p: mp != null ? +mp.toFixed(4) : null, ev: +ev.toFixed(4),
      stake: +Math.min(VALUE.cap, VALUE.kelly * f).toFixed(4), books,
      // μεγάλη διαφωνία με την αγορά ή πολύ μεγάλη απόδοση: πιθανότατα λάθος του μοντέλου (απουσία κ.λπ.), όχι ευκαιρία
      check: (mp != null && Math.abs(pm.win - mp) > VALUE.max_gap) || odds > VALUE.max_odds,
      value: ev >= VALUE.min_ev && !((mp != null && Math.abs(pm.win - mp) > VALUE.max_gap) || odds > VALUE.max_odds) }); };
  const best = (rows, k) => Math.max(...rows.map((r) => r[k] || 0));
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, c) => a + c, 0) / v.length : null; };
  // νίκη (μετρά και η παράταση: p_home της προσομοίωσης)
  const ml = B.filter((r) => r.ml_home > 1 && r.ml_away > 1);
  if (ml.length) { const mp = avg(ml.map((r) => devig(r.ml_home, r.ml_away)));
    add("ml", "home", null, { win: G.p_home, push: 0 }, best(ml, "ml_home"), mp, ml.length); add("ml", "away", null, { win: 1 - G.p_home, push: 0 }, best(ml, "ml_away"), mp != null ? 1 - mp : null, ml.length); }
  // χάντικαπ: η πιο συνηθισμένη γραμμή, η καλύτερη απόδοση σε αυτήν
  const sl = mode(B.map((r) => r.spread)), sp = B.filter((r) => r.spread === sl && r.spread_home_odds > 1 && r.spread_away_odds > 1);
  if (sp.length) { const mp = avg(sp.map((r) => devig(r.spread_home_odds, r.spread_away_odds)));
    add("spread", "home", sl, SIM.lineProb(G.margin, sl, 1), best(sp, "spread_home_odds"), mp, sp.length);
    add("spread", "away", -sl, SIM.lineProb(G.margin, sl, -1), best(sp, "spread_away_odds"), mp != null ? 1 - mp : null, sp.length); }
  // σύνολο
  const tl = mode(B.map((r) => r.total)), to = B.filter((r) => r.total === tl && r.over_odds > 1 && r.under_odds > 1);
  if (to.length) { const mp = avg(to.map((r) => devig(r.over_odds, r.under_odds)));
    add("total", "over", tl, SIM.lineProb(G.total, -tl, 1), best(to, "over_odds"), mp, to.length);
    add("total", "under", tl, SIM.lineProb(G.total, -tl, -1), best(to, "under_odds"), mp != null ? 1 - mp : null, to.length); }
  return M;
}
const now = new Date().toISOString().slice(0, 16).replace("T", " ");
const valueUp = [];
for (const [code, G] of Object.entries(out.games)) {
  if (G.played) continue;
  const M = marketsFor(code, G); if (!M) continue;
  valueUp.push({ code, date: G.date, home: G.home, away: G.away, markets: M });
  const gm = M.find((m) => m.market === "ml" && m.side === "home");
  if (gm) ledger.games[code] = { date: G.date, home: G.home, away: G.away, p: gm.p, market_p: gm.market_p, at: now };
  for (const m of M) if (m.value) { const k = `${code}|${m.market}|${m.side}|${m.line ?? ""}`, o = ledger.bets[k];
    ledger.bets[k] = { ...(o || { first_seen: now }), code, date: G.date, home: G.home, away: G.away, ...m, last_seen: now, result: null }; }
}
// τακτοποίηση: ό,τι παίχτηκε -> κέρδος/ζημιά (μονάδες: ποσοστό του ταμείου)
for (const b of Object.values(ledger.bets)) {
  const g = DB0.games[b.code]; if (!g?.played || b.result) continue;
  const M = g.hs - g.as, T = g.hs + g.as;
  const v = b.market === "ml" ? (b.side === "home" ? M : -M) : b.market === "spread" ? (b.side === "home" ? M + b.line : -M + b.line) : (b.side === "over" ? T - b.line : b.line - T);
  b.result = v > 0 ? "win" : v < 0 ? "loss" : "push"; b.profit = +(b.result === "win" ? b.stake * (b.odds - 1) : b.result === "loss" ? -b.stake : 0).toFixed(4);
}
for (const [code, x] of Object.entries(ledger.games)) { const g = DB0.games[code]; if (g?.played && x.y == null) x.y = g.hs > g.as ? 1 : 0; }
const settled = Object.values(ledger.bets).filter((b) => b.result), staked = settled.reduce((a, b) => a + b.stake, 0), profit = settled.reduce((a, b) => a + b.profit, 0);
const gs = Object.values(ledger.games).filter((x) => x.y != null && x.market_p != null);
out.value = { has_odds: ODDS.length > 0, rules: VALUE, upcoming: valueUp,
  ledger: { n: settled.length, open: Object.values(ledger.bets).filter((b) => !b.result).length, wins: settled.filter((b) => b.result === "win").length,
    staked: +staked.toFixed(4), profit: +profit.toFixed(4), roi: staked ? +(profit / staked).toFixed(4) : null,
    by_market: Object.fromEntries(["ml", "spread", "total"].map((k) => { const S = settled.filter((b) => b.market === k), st = S.reduce((a, b) => a + b.stake, 0), pr = S.reduce((a, b) => a + b.profit, 0);
      return [k, { n: S.length, roi: st ? +(pr / st).toFixed(4) : null, profit: +pr.toFixed(4) }]; })),
    recent: Object.values(ledger.bets).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 40),
    vs_market: gs.length ? { n: gs.length, brier_model: +(gs.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / gs.length).toFixed(4),
      brier_market: +(gs.reduce((a, x) => a + (x.market_p - x.y) ** 2, 0) / gs.length).toFixed(4) } : null } };
fs.mkdirSync(path.dirname(LEDF), { recursive: true });
if (ODDS.length || fs.existsSync(LEDF)) fs.writeFileSync(LEDF, JSON.stringify(ledger));
console.log(`  αξία: ${ODDS.length ? `${valueUp.length} αγώνες με αποδόσεις, ${valueUp.flatMap((x) => x.markets).filter((m) => m.value).length} με αξία` : "χωρίς αποδόσεις (ODDS_API_KEY)"}`);

fs.writeFileSync(OUTF, JSON.stringify(out));
const sz = fs.statSync(OUTF).size / 1024;
console.log(`-> site/db/sims_${LEAGUE}.json (${Object.keys(out.games).length} αγώνες × ${N}, ${sz.toFixed(0)} KB)`);
