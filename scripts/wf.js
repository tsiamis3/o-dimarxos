/* Κοινό walk-forward για τα scripts της προσομοίωσης (run_sims.js, fit_re.js).
 * league(L) -> η βάση της λίγκας, όλα τα logs, οι παιγμένοι αγώνες, η βάση «όπως ήταν» πριν από κάθε ημερομηνία (dbAsOf),
 *   το ctx κάθε παιγμένου αγώνα με β μόνο από τους προηγούμενους (WF) και τα β από όλους τους αγώνες (FIT, BETA).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SIM = require(path.join(__dirname, "..", "site", "sim.js"));
const ROOT = path.join(__dirname, "..");
const MIN_PRIOR = 2;

function league(LEAGUE, { quiet = false } = {}) {
const DB0 = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", `${LEAGUE}.json`), "utf8"));
const RE = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sim_re.json"), "utf8")).re; } catch { return null; } })();
if (RE) DB0.re = RE;
const console = quiet ? { log() {} } : global.console;
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
return { DB0, LOGS, PLAYED, WF, dbAsOf, canRun, actualBox, stripHist, seedOf, STATS, FIT, BETA, oos, RIDGE, USE_BETA, RE };
}
module.exports = { league, SIM, ROOT };
