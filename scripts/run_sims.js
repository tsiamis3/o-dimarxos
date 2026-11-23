/* Προσομοιώσεις για το σάιτ (Node, ίδια μηχανή με τον browser: site/sim.js).
 *
 * Για κάθε αγώνα του demo:
 *   1. N προσομοιώσεις (SIM_N, προεπιλογή 50.000).
 *        - παιγμένοι: walk-forward, με στατιστικά ΜΟΝΟ από τους αγώνες πριν από αυτόν, και το πραγματικό box score δίπλα
 *        - επόμενοι: με τα τωρινά στατιστικά (οι 4 επόμενοι κάθε ομάδας)
 *   2. Ροπές κάθε κατανομής (μέσος, διασπορά, ασυμμετρία, κύρτωση), ποσοστημόρια για boxplot, χάντικαπ:
 *        αποτέλεσμα (διαφορά), πόντοι ομάδων, σύνολο, στατιστικά παικτών. Όσες έχουν τεράστια διασπορά σημαίνονται show=false.
 * Βάρη του log5 (β ανά τύπο φάσης): λογιστική παλινδρόμηση στα box scores (παίκτης × αγώνας, walk-forward),
 *   logit p = logit(λίγκα) + β0 + β1·[logit(παίκτης) − logit(λίγκα)] + β2·[logit(άμυνα) − logit(λίγκα)]
 *   με ήπια ridge προς το κλασικό log5 (0, 1, 1). Κάθε παιγμένος αγώνας χρησιμοποιεί β μόνο από τους προηγούμενους.
 *   SIM_BETA=0: κλασικό log5 παντού (για σύγκριση).
 * Έλεγχος βαθμονόμησης: όλοι οι παιγμένοι αγώνες της λίγκας (walk-forward, SIM_CHECK ο καθένας):
 *   πόσο συχνά το πραγματικό πέφτει μέσα στο «κουτί» (25–75%, θέλουμε ~50%) και στις «κεραίες» (5–95%, ~90%).
 *
 *   node scripts/run_sims.js            # -> site/db/sims.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SIM = require(path.join(__dirname, "..", "site", "sim.js"));

const N = +(process.env.SIM_N || 50000), N_CHECK = +(process.env.SIM_CHECK || 2000), NEXT = 4, MIN_PRIOR = 2;
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
/** Από ένα παιγμένο αγώνα: [τύπος, pa, pd, λίγκα, επιτυχίες k, προσπάθειες n] με τις εισόδους που βλέπει η μηχανή. */
function observations(ctx, code) {
  const obs = [], tm = {};
  for (const l of LOGS) if (l.g === code) { const t = (tm[l.team] ||= { oreb: 0, dreb: 0 }); t.oreb += l.oreb; t.dreb += l.dreb; }
  ctx.T.forEach((O, ti) => {
    const Dx = ctx.D[ti], opp = ctx.T[1 - ti].code;
    for (const p of O.pl) { const a = LOGS.find((l) => l.g === code && l.pid === p.pid && l.min > 0); if (!a) continue;
      const plays = a.fg2a + a.fg3a + 0.44 * a.fta + a.tov;
      if (plays > 0) { obs.push(["tov", p.tov, Dx.tov, lgOf(ctx, "tov"), a.tov, plays]); obs.push(["ftrip", p.ftrip, Dx.ftrip, lgOf(ctx, "ftrip"), 0.44 * a.fta, plays]); }
      if (a.fg2a) obs.push(["fg2", p.fg2, Dx.fg2, lgOf(ctx, "fg2"), a.fg2m, a.fg2a]);
      if (a.fg3a) obs.push(["fg3", p.fg3, Dx.fg3, lgOf(ctx, "fg3"), a.fg3m, a.fg3a]); }
    const me = tm[O.code], op = tm[opp];
    if (me && op && me.oreb + op.dreb > 0) obs.push(["orb", Dx.orbO, Dx.orbD, lgOf(ctx, "orb"), me.oreb, me.oreb + op.dreb]);
  });
  return obs;
}
const feat = (o) => { const L = SIM.logit(o[3]); return [L, SIM.logit(o[1]) - L, SIM.logit(o[2]) - L]; };
const loglik = (o, b) => { const [L, xa, xd] = feat(o), mu = 1 / (1 + Math.exp(-(L + b[0] + b[1] * xa + b[2] * xd)));
  return o[4] * Math.log(mu) + (o[5] - o[4]) * Math.log(1 - mu); };
function solve3(A, g) { // A x = g (3×3, Cramer)
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A); return [0, 1, 2].map((c) => det(A.map((r, i) => r.map((v, j) => (j === c ? g[i] : v)))) / D);
}
/** Newton για binomial logit με offset logit(λίγκα) και ridge προς (0,1,1). Επιστρέφει { b, se, n } ανά τύπο. */
function fitBeta(obs) {
  const out = {};
  for (const k of SIM.EVENTS) {
    const O = obs.filter((o) => o[0] === k), b0 = [0, 1, 1];
    if (O.length < (k === "orb" ? 30 : MIN_OBS)) { out[k] = { b: b0, se: null, n: O.length }; continue; }
    let b = b0.slice(), H;
    for (let it = 0; it < 25; it++) {
      const g = b.map((v, i) => -RIDGE * (v - b0[i])); H = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? RIDGE : 0)));
      for (const o of O) { const [L, xa, xd] = feat(o), x = [1, xa, xd], mu = 1 / (1 + Math.exp(-(L + b[0] + b[1] * xa + b[2] * xd))), w = o[5] * mu * (1 - mu);
        for (let i = 0; i < 3; i++) { g[i] += x[i] * (o[4] - o[5] * mu); for (let j = 0; j < 3; j++) H[i][j] += w * x[i] * x[j]; } }
      const step = solve3(H, g); b = b.map((v, i) => v + step[i]);
      if (Math.max(...step.map(Math.abs)) < 1e-7) break;
    }
    const se = [0, 1, 2].map((i) => Math.sqrt(solve3(H, [0, 1, 2].map((j) => +(i === j)))[i]));
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
console.log("  β (όλοι οι αγώνες):"); for (const k of SIM.EVENTS) console.log(`    ${k.padEnd(5)} n=${String(FIT[k].n).padStart(4)}  β0=${FIT[k].b[0]}  β1(επίθ.)=${FIT[k].b[1]} ±${FIT[k].se?.[1]}  β2(άμυνα)=${FIT[k].b[2]} ±${FIT[k].se?.[2]}` +
  `   εκτός δείγματος Δlog-lik/προσπ. ${(1000 * (oos[k].ll - oos[k].ll0) / oos[k].n).toFixed(2)}‰`);

function canRun(DB, g) { return (DB.teamstats[g.home]?.gp || 0) >= MIN_PRIOR && (DB.teamstats[g.away]?.gp || 0) >= MIN_PRIOR; }
const actualBox = (code) => { const o = {}; for (const l of LOGS) if (l.g === code && l.min > 0) o[l.pid] = Object.fromEntries(["min", ...STATS].map((k) => [k, l[k]])); return o; };
const stripHist = (r) => { for (const d of [r.score[0], r.score[1], r.total]) delete d.hist; for (const side of r.players) for (const p of side) for (const k of STATS) delete p[k].hist; return r; };

// ---------------------------------------------------------------- αγώνες του demo
const out = { n: N, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", version: SIM.version,
  show_cv: SIM.SHOW_CV, show_min: SIM.SHOW_MIN, beta: BETA,
  beta_fit: { ridge: RIDGE, used: USE_BETA, ...Object.fromEntries(SIM.EVENTS.map((k) => [k, { ...FIT[k], oos_dll: +((oos[k].ll - oos[k].ll0) / oos[k].n).toFixed(5), oos_n: Math.round(oos[k].n) }])) },
  games: {}, check: null };
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
  if (g.played) r = stripHist(r);
  out.games[g.code] = { home: g.home, away: g.away, date: g.date, round: g.round, played: g.played, wf: g.played, ...r,
    ...(g.played ? { actual: { hs: g.hs, as: g.as, box: actualBox(g.code) } } : {}) };
  const nm = (c) => DB0.teams[c]?.name || DB0.opponents[c]?.name || c;
  console.log(`  ${g.played ? "[παιγμ.]" : "[επόμ.] "} ${nm(g.home)} – ${nm(g.away)}: γηπ. ${(100 * r.p_home).toFixed(1)}%, ` +
    `σκορ ${r.score[0].mean}-${r.score[1].mean}${g.played ? ` (πραγματικό ${g.hs}-${g.as})` : ""} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// ---------------------------------------------------------------- έλεγχος βαθμονόμησης (όλη η λίγκα, walk-forward)
const cov = {}; const addCov = (key, d, v) => { const c = (cov[key] ||= { n: 0, box: 0, whisk: 0, below: 0 }); c.n++;
  c.box += v >= d.p25 && v <= d.p75; c.whisk += v >= d.p5 && v <= d.p95; c.below += v < d.p50; };
let brier = 0, brierBase = 0, hit = 0, errM = 0, errT = 0, n = 0, homeW = 0, seen = 0;
const perGame = [];
for (const g of PLAYED) {
  const w = WF.get(g.code);
  if (!w) { seen++; homeW += g.hs > g.as; continue; }
  const ctx = { ...w.ctx, beta: w.beta };
  if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
  const r = SIM.many(ctx, N_CHECK, seedOf(g.code) + 1), y = g.hs > g.as ? 1 : 0, hr = seen ? homeW / seen : 0.6;
  perGame.push([g.code, r.p_home, y, +r.margin.mean.toFixed(2), g.hs - g.as, +r.total.mean.toFixed(1), g.hs + g.as]);
  brier += (r.p_home - y) ** 2; brierBase += (hr - y) ** 2; hit += (r.p_home >= 0.5) === (y === 1);
  errM += Math.abs(r.margin.mean - (g.hs - g.as)); errT += Math.abs(r.total.mean - (g.hs + g.as)); n++;
  addCov("score", r.score[0], g.hs); addCov("score", r.score[1], g.as); addCov("margin", r.margin, g.hs - g.as); addCov("total", r.total, g.hs + g.as);
  const box = actualBox(g.code);
  for (const side of r.players) for (const p of side) { const a = box[p.pid]; if (!a) continue;
    for (const k of ["pts", "reb", "ast", "pir"]) if (p[k].show) addCov(k, p[k], a[k]); }
  seen++; homeW += y;
}
const pc = (x, m) => +(x / Math.max(m, 1)).toFixed(3);
out.check = { games: n, sims_each: N_CHECK, walk_forward: true, brier: pc(brier, n), brier_home_rate: pc(brierBase, n), acc: pc(hit, n),
  mae_margin: +(errM / n).toFixed(2), mae_total: +(errT / n).toFixed(2), per_game: perGame,
  coverage: Object.fromEntries(Object.entries(cov).map(([k, c]) => [k, { n: c.n, box: pc(c.box, c.n), whisk: pc(c.whisk, c.n), below_median: pc(c.below, c.n) }])) };
console.log("  έλεγχος (walk-forward):", JSON.stringify(out.check));
fs.writeFileSync(path.join(ROOT, "site", "db", "sims.json"), JSON.stringify(out));
const sz = fs.statSync(path.join(ROOT, "site", "db", "sims.json")).size / 1024;
console.log(`-> site/db/sims.json (${Object.keys(out.games).length} αγώνες × ${N}, ${sz.toFixed(0)} KB)`);
