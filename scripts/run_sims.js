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
 *   node scripts/run_sims.js            # -> site/db/sims.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SIM = require(path.join(__dirname, "..", "site", "sim.js"));

const N = +(process.env.SIM_N || 50000), N_CHECK = +(process.env.SIM_CHECK || 2000), NEXT = 2, MIN_PRIOR = 2, EXT_W = 0.5;
const ROOT = path.join(__dirname, "..");
const DB0 = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", "demo.json"), "utf8"));
const K = ["min", "pts", "reb", "oreb", "dreb", "ast", "stl", "blk", "tov", "pf", "pir", "fg2m", "fg2a", "fg3m", "fg3a", "ftm", "fta"];
const STATS = ["pts", "reb", "ast", "pir", "fg3m", "stl", "blk"];
const seedOf = (code) => (Number(code) % 2147483647) || 1;

// ---------------------------------------------------------------- όλα τα logs της λίγκας και οι παιγμένοι αγώνες
const LOGS = [];
for (const p of Object.values(DB0.players)) for (const l of p.log) LOGS.push({ ...l, pid: p.pid });
const PLAYED = [...new Map(LOGS.filter((l) => l.home && l.score).map((l) => [l.g, { code: l.g, date: l.date, home: l.team, away: l.opp,
  hs: +l.score.split("-")[0], as: +l.score.split("-")[1] }])).values()].sort((a, b) => a.date.localeCompare(b.date));

/** Η βάση όπως ήταν πριν από την ημερομηνία (παίκτες, ομαδικά, λίγκα): για walk-forward. */
function dbAsOf(date) {
  const prior = LOGS.filter((l) => l.date < date);
  const players = {};
  for (const p of Object.values(DB0.players)) {
    const L = prior.filter((l) => l.pid === p.pid), played = L.filter((l) => l.min > 0);
    const avg = {}; for (const k of K) avg[k] = played.length ? played.reduce((s, l) => s + l[k], 0) / played.length : 0;
    players[p.pid] = { ...p, team: L.length ? L.at(-1).team : p.team, gp: played.length, avg, log: L };
  }
  const by = {};
  for (const l of prior) { const t = (by[l.g + "|" + l.team] ||= { g: l.g, team: l.team, opp: l.opp }); for (const k of K) t[k] = (t[k] || 0) + l[k]; }
  const poss = (v) => v.fg2a + v.fg3a + 0.44 * v.fta - v.oreb + v.tov;
  const acc = {};
  for (const v of Object.values(by)) { const o = by[v.g + "|" + v.opp]; if (!o) continue;
    const s = (acc[v.team] ||= { gp: 0, me: {}, op: {}, poss: 0, oposs: 0 }); s.gp++; s.poss += poss(v); s.oposs += poss(o);
    for (const k of K) { s.me[k] = (s.me[k] || 0) + v[k]; s.op[k] = (s.op[k] || 0) + o[k]; } }
  const teamstats = {};
  for (const [t, s] of Object.entries(acc)) { const me = s.me, op = s.op, ofga = op.fg2a + op.fg3a;
    teamstats[t] = { gp: s.gp, pace: (s.poss + s.oposs) / 2 / s.gp, opp_efg: (op.fg2m + 1.5 * op.fg3m) / ofga, opp_tov: op.tov / s.oposs,
      orb: me.oreb / (me.oreb + op.dreb), drb: me.dreb / (me.dreb + op.oreb), opp_ftr: op.fta / ofga }; }
  const T = {}; for (const k of K) T[k] = Object.values(acc).reduce((x, s) => x + s.me[k], 0);
  const P = Object.values(acc).reduce((x, s) => x + s.poss, 0), G = Object.values(acc).reduce((x, s) => x + s.gp, 0), fga = T.fg2a + T.fg3a;
  const lg = { pace: P / G, efg: (T.fg2m + 1.5 * T.fg3m) / fga, fg2: T.fg2m / T.fg2a, fg3: T.fg3m / T.fg3a, ft: T.ftm / T.fta, tov: T.tov / P,
    orb: T.oreb / (T.oreb + T.dreb), ftr: T.fta / fga, ast_fgm: T.ast / (T.fg2m + T.fg3m), stl_tov: T.stl / T.tov, blk_fg2a: T.blk / T.fg2a };
  return { ...DB0, players, teamstats, lg };
}
// ---------------------------------------------------------------- β: παρατηρήσεις και προσαρμογή
const USE_BETA = process.env.SIM_BETA !== "0", RIDGE = 10, MIN_OBS = 150;
const lgOf = (ctx, k) => ({ tov: ctx.lg.tovPlay, ftrip: ctx.lg.ftripPlay, fg2: ctx.lg.fg2, fg3: ctx.lg.fg3, orb: ctx.lg.orb })[k];
/** Από ένα παιγμένο αγώνα: [τύπος, pa, pd, λίγκα, επιτυχίες k, προσπάθειες n, ομάδα pt] με τις εισόδους που βλέπει η μηχανή. */
function observations(ctx, code) {
  const obs = [], tm = {};
  for (const l of LOGS) if (l.g === code) { const t = (tm[l.team] ||= { oreb: 0, dreb: 0 }); t.oreb += l.oreb; t.dreb += l.dreb; }
  ctx.T.forEach((O, ti) => {
    const Dx = ctx.D[ti], opp = ctx.T[1 - ti].code;
    for (const p of O.pl) { const a = LOGS.find((l) => l.g === code && l.pid === p.pid && l.min > 0); if (!a) continue;
      const plays = a.fg2a + a.fg3a + 0.44 * a.fta + a.tov;
      if (plays > 0) { obs.push(["tov", p.tov, Dx.tov, lgOf(ctx, "tov"), a.tov, plays, O.off.tov]); obs.push(["ftrip", p.ftrip, Dx.ftrip, lgOf(ctx, "ftrip"), 0.44 * a.fta, plays, O.off.ftrip]); }
      if (a.fg2a) obs.push(["fg2", p.fg2, Dx.fg2, lgOf(ctx, "fg2"), a.fg2m, a.fg2a, O.off.fg2]);
      if (a.fg3a) obs.push(["fg3", p.fg3, Dx.fg3, lgOf(ctx, "fg3"), a.fg3m, a.fg3a, O.off.fg3]); }
    const me = tm[O.code], op = tm[opp];
    if (me && op && me.oreb + op.dreb > 0) obs.push(["orb", Dx.orbO, Dx.orbD, lgOf(ctx, "orb"), me.oreb, me.oreb + op.dreb, Dx.orbO]);
  });
  return obs;
}
// χαρακτηριστικά: [offset logit(λίγκα), x = (1, παίκτης−ομάδα, άμυνα−λίγκα, ομάδα−λίγκα)], ίδια σειρά με τα β
const feat = (o) => { const L = SIM.logit(o[3]), T = SIM.logit(o[6]); return [L, [1, SIM.logit(o[1]) - T, SIM.logit(o[2]) - L, T - L]]; };
const eta = (o, b) => { const [L, x] = feat(o); return L + x.reduce((s, v, i) => s + v * (b[i] ?? b[1]), 0); };
const loglik = (o, b) => { const mu = 1 / (1 + Math.exp(-eta(o, b))); return o[4] * Math.log(mu) + (o[5] - o[4]) * Math.log(1 - mu); };
function solve(A, g) { // A x = g, απαλοιφή Gauss με οδήγηση
  const n = g.length, M = A.map((r, i) => [...r, g[i]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } }
  return M.map((r, i) => r[n] / r[i]);
}
/** Newton για binomial logit με offset logit(λίγκα) και ridge προς (0,1,1,1). Επιστρέφει { b, se, n } ανά τύπο. */
function fitBeta(obs) {
  const out = {};
  for (const k of SIM.EVENTS) {
    const O = obs.filter((o) => o[0] === k), b0 = [0, 1, 1, 1], I = [0, 1, 2, 3];
    if (O.length < (k === "orb" ? 30 : MIN_OBS)) { out[k] = { b: b0, se: null, n: O.length }; continue; }
    let b = b0.slice(), H;
    for (let it = 0; it < 25; it++) {
      const g = b.map((v, i) => -RIDGE * (v - b0[i])); H = I.map((i) => I.map((j) => (i === j ? RIDGE : 0)));
      for (const o of O) { const x = feat(o)[1], mu = 1 / (1 + Math.exp(-eta(o, b))), w = o[5] * mu * (1 - mu);
        for (const i of I) { g[i] += x[i] * (o[4] - o[5] * mu); for (const j of I) H[i][j] += w * x[i] * x[j]; } }
      const step = solve(H, g); b = b.map((v, i) => v + step[i]);
      if (Math.max(...step.map(Math.abs)) < 1e-7) break;
    }
    const se = I.map((i) => Math.sqrt(solve(H, I.map((j) => +(i === j)))[i]));
    out[k] = { b: b.map((v) => +v.toFixed(4)), se: se.map((v) => +v.toFixed(4)), n: O.length };
  }
  return out;
}
const betaOnly = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.b]));

// πρώτο πέρασμα: για κάθε παιγμένο αγώνα της λίγκας, η βάση πριν από αυτόν, το ctx και οι παρατηρήσεις του
const WF = new Map();
for (const g of PLAYED) { const DB = dbAsOf(g.date); if (!canRun(DB, g)) continue;
  const ctx = SIM.prepare(DB, g.home, g.away); WF.set(g.code, { g, ctx, obs: observations(ctx, g.code) }); }
const betaBefore = (date) => USE_BETA ? betaOnly(fitBeta([...WF.values()].filter((w) => w.g.date < date).flatMap((w) => w.obs))) : SIM.BETA0;
// εκτός δείγματος: log-likelihood κάθε αγώνα με β από τους προηγούμενους, απέναντι στο κλασικό log5
const oos = {}; for (const w of WF.values()) { const B = betaBefore(w.g.date); w.beta = B;
  for (const o of w.obs) { const c = (oos[o[0]] ||= { n: 0, ll: 0, ll0: 0 }); c.n += o[5]; c.ll += loglik(o, B[o[0]]); c.ll0 += loglik(o, SIM.BETA0[o[0]]); } }
const FIT = fitBeta([...WF.values()].flatMap((w) => w.obs)), BETA = USE_BETA ? betaOnly(FIT) : SIM.BETA0;
console.log("  β (όλοι οι αγώνες):"); for (const k of SIM.EVENTS) console.log(`    ${k.padEnd(5)} n=${String(FIT[k].n).padStart(4)}  β0=${FIT[k].b[0]}  β1(παίκτ.−ομ.)=${FIT[k].b[1]} ±${FIT[k].se?.[1]}  β3(ομ.−λίγκα)=${FIT[k].b[3]} ±${FIT[k].se?.[3]}  β2(άμυνα)=${FIT[k].b[2]} ±${FIT[k].se?.[2]}` +
  `   εκτός δείγματος Δlog-lik/προσπ. ${(1000 * (oos[k].ll - oos[k].ll0) / oos[k].n).toFixed(2)}‰`);

function canRun(DB, g) { return (DB.teamstats[g.home]?.gp || 0) >= MIN_PRIOR && (DB.teamstats[g.away]?.gp || 0) >= MIN_PRIOR; }
const actualBox = (code) => { const o = {}; for (const l of LOGS) if (l.g === code && l.min > 0) o[l.pid] = Object.fromEntries(["min", ...STATS].map((k) => [k, l[k]])); return o; };
const stripHist = (r) => { for (const d of [r.score[0], r.score[1], r.total]) delete d.hist; for (const side of r.players) for (const p of side) for (const k of STATS) delete p[k].hist; return r; };

// ---------------------------------------------------------------- όλοι οι αγώνες: παιγμένοι (walk-forward) + οι επόμενοι 2 κάθε ομάδας
const RES = {};
const out = { n: N, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", version: SIM.version,
  show_cv: SIM.SHOW_CV, show_min: SIM.SHOW_MIN, beta: BETA,
  beta_fit: { ridge: RIDGE, used: USE_BETA, ...Object.fromEntries(SIM.EVENTS.map((k) => [k, { ...FIT[k], oos_dll: +((oos[k].ll - oos[k].ll0) / oos[k].n).toFixed(5), oos_n: Math.round(oos[k].n) }])) },
  ext_w: EXT_W, games: {}, check: null, check_sources: null };
const all = Object.values(DB0.games).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
const next = new Set();
for (const c of DB0.demo) all.filter((g) => !g.played && (g.home === c || g.away === c)).slice(0, NEXT).forEach((g) => next.add(g.code));
for (const g of all) {
  if (!g.played && !next.has(g.code)) continue;
  const w = g.played ? WF.get(g.code) : null;
  if (g.played && !w) { console.log(`  · ${g.date}: λίγοι προηγούμενοι αγώνες για walk-forward, παραλείπεται`); continue; }
  const ctx = w ? { ...w.ctx, beta: w.beta } : SIM.prepare(DB0, g.home, g.away, { beta: BETA });
  if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
  const t0 = Date.now();
  let r = SIM.many(ctx, N, seedOf(g.code));
  if (g.played) RES[g.code] = r = stripHist(r);
  out.games[g.code] = { home: g.home, away: g.away, date: g.date, round: g.round, played: g.played, wf: g.played, ...r,
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
const CFG = [["Μόνο GBL", []], ["+ GBL περσινή", SRC.filter((k) => k.startsWith("GBL"))], ["+ EuroLeague/EuroCup", SRC.filter((k) => !k.startsWith("GBL"))], ["Όλες", SRC]]
  .filter(([, s], i) => i === 0 || s.length);
out.check_sources = CFG.map(([label, sources]) => {
  const t0 = Date.now();
  const c = evaluate((g, w) => { const ctx = sources.length ? SIM.prepare(dbAsOf(g.date), g.home, g.away, { beta: w.beta, sources, extW: EXT_W, asOf: g.date }) : { ...w.ctx, beta: w.beta };
    return ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5 ? null : SIM.many(ctx, N_CHECK, seedOf(g.code) + 1); }, N_CHECK);
  console.log(`  πηγές «${label}»: brier ${c.brier} · σωστός ${c.acc} · σφάλμα διαφοράς ${c.mae_margin} · συνόλου ${c.mae_total} · πόντων παίκτη ${c.mae_player_pts} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  delete c.per_game; return { label, sources, ...c };
});
console.log("  έλεγχος (walk-forward):", JSON.stringify(out.check));
fs.writeFileSync(path.join(ROOT, "site", "db", "sims.json"), JSON.stringify(out));
const sz = fs.statSync(path.join(ROOT, "site", "db", "sims.json")).size / 1024;
console.log(`-> site/db/sims.json (${Object.keys(out.games).length} αγώνες × ${N}, ${sz.toFixed(0)} KB)`);
