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
fs.writeFileSync(OUTF, JSON.stringify(out));
const sz = fs.statSync(OUTF).size / 1024;
console.log(`-> site/db/sims_${LEAGUE}.json (${Object.keys(out.games).length} αγώνες × ${N}, ${sz.toFixed(0)} KB)`);
