/* Ratings ομάδων (scripts/ratings.js) και πόσο να τα εμπιστευτεί η προσομοίωση, σε όλες τις λίγκες, walk-forward.
 *
 *  1. Παράμετροι των ratings (ισχύς έλξης λ, πόσο μετράει η περσινή σεζόν, «μνήμη» τ): ό,τι προβλέπει καλύτερα
 *     τους πόντους ανά κατοχή κάθε ομάδας στον επόμενο αγώνα (μόνο με τους προηγούμενους αγώνες).
 *  2. Μείγμα w: ο μέσος όρος της προσομοίωσης μετακινείται κατά w προς τα ratings (SIM.calibrate). Δοκιμάζουμε
 *     w = 0 (μόνο παίκτες), …, 1 (ο μέσος όρος από τα ratings, η διασπορά από την προσομοίωση) και κρατάμε το καλύτερο
 *     σε CRPS διαφοράς + συνόλου. Συγκρίνουμε και με «μόνο ratings» (κανονική κατανομή γύρω από την πρόβλεψη).
 *
 *   node scripts/fit_ratings.js        # -> data/ratings_fit.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { league, SIM, ROOT } = require(path.join(__dirname, "wf.js"));
const R = require(path.join(__dirname, "ratings.js"));

const N = +(process.env.FIT_N || 600), LEAGUES = (process.env.FIT_LEAGUES || "GBL,E,U").split(",");
const t0 = Date.now(), el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

// ---------------------------------------------------------------- δεδομένα ανά λίγκα
const LG = {};
for (const L of LEAGUES) {
  const W = league(L, { quiet: true, ratings: false });
  LG[L] = { W, rows: R.teamGames(W.LOGS), teams: Object.keys(W.DB0.teams), prior: W.DB0.prior_ratings || {} };
  console.log(`  ${L}: ${LG[L].rows.length / 2} αγώνες, ${[...W.WF.values()].length} walk-forward (${el()})`);
}

// ---------------------------------------------------------------- 1. παράμετροι των ratings
function wfErrors(hp) {
  let se = 0, n = 0;
  for (const { W, rows, teams, prior } of Object.values(LG)) {
    for (const w of W.WF.values()) {
      const before = rows.filter((r) => r.date < w.g.date), F = R.fit(before, { asOf: w.g.date, teams, prior, ...hp });
      const [ph, pa] = R.predict(F, w.g.home, w.g.away);
      for (const r of rows.filter((x) => x.g === w.g.code)) { const y = (100 * r.pts) / r.poss, p = r.team === w.g.home ? ph : pa; se += (y - p) ** 2 * (r.poss / 100); n += r.poss / 100; }
    }
  }
  return Math.sqrt(se / n);
}
const GRID = { lam: [2, 4, 8, 16], priorShrink: [0, 0.5, 1], tau: [30, 60, 120, 10000] };
let best = null;
const base = wfErrors({ lam: 1e6, priorShrink: 0, tau: 10000 });          // όλες ίδιες (μόνο μ και έδρα)
for (const lam of GRID.lam) for (const priorShrink of GRID.priorShrink) for (const tau of GRID.tau) {
  const e = wfErrors({ lam, priorShrink, tau });
  if (!best || e < best.rmse) best = { lam, priorShrink, tau, rmse: e };
}
console.log(`  ratings: σφάλμα πόντων/100 κατοχές ${best.rmse.toFixed(2)} (χωρίς ratings ${base.toFixed(2)})  ${JSON.stringify(best)} (${el()})`);
const HP = { lam: best.lam, priorShrink: best.priorShrink, tau: best.tau };

// ---------------------------------------------------------------- 2. μείγμα w με προσομοιώσεις
function crps(arr, y) { const x = Float64Array.from(arr).sort(), n = x.length; let a = 0, b = 0;
  for (let i = 0; i < n; i++) { a += Math.abs(x[i] - y); b += (2 * i - n + 1) * x[i]; } return a / n - b / (n * n); }
const q = (x, p) => x[Math.min(x.length - 1, Math.floor(p * x.length))];
const WS = [0, 0.25, 0.5, 0.75, 1];
const acc = {}; const add = (k, key, v) => { const o = ((acc[k] ||= {})[key] ||= [0, 0]); o[0] += v; o[1]++; };
const resid = [];
for (const [L, { W, rows, teams, prior }] of Object.entries(LG)) {
  for (const w of W.WF.values()) {
    const ctx = { ...w.ctx, beta: w.beta }; if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
    const F = R.fit(rows.filter((r) => r.date < w.g.date), { asOf: w.g.date, teams, prior, ...HP });
    const pp = R.predict(F, w.g.home, w.g.away), tgt = pp.map((x) => (x * ctx.pace) / 100);
    const cal = SIM.calibrate(ctx, tgt, 1, 400, W.seedOf(w.g.code) + 3);
    const y = w.g.hs > w.g.as ? 1 : 0, M = w.g.hs - w.g.as, Tt = w.g.hs + w.g.as;
    resid.push([tgt[0] - tgt[1] - M, tgt[0] + tgt[1] - Tt]);
    for (const wt of WS) {
      ctx.tAdj = cal.tAdj.map((v) => v * wt);
      const r = SIM.many(ctx, N, W.seedOf(w.g.code) + 11, { raw: true }), s0 = r.raw.s0, s1 = r.raw.s1;
      const mg = Int16Array.from(s0, (v, i) => v - s1[i]), tt = Int16Array.from(s0, (v, i) => v + s1[i]);
      const ms = Float64Array.from(mg).sort(), ts = Float64Array.from(tt).sort();
      for (const k of ["w" + wt, L + ":w" + wt]) {
        add(k, "brier", (r.p_home - y) ** 2); add(k, "acc", +((r.p_home >= 0.5) === (y === 1)));
        add(k, "margin", crps(mg, M)); add(k, "total", crps(tt, Tt));
        add(k, "margin_whisk", +(M >= q(ms, 0.05) && M <= q(ms, 0.95))); add(k, "total_whisk", +(Tt >= q(ts, 0.05) && Tt <= q(ts, 0.95)));
        add(k, "margin_box", +(M >= q(ms, 0.25) && M <= q(ms, 0.75))); add(k, "total_box", +(Tt >= q(ts, 0.25) && Tt <= q(ts, 0.75)));
        add(k, "mae_margin", Math.abs(r.margin.mean - M)); add(k, "mae_total", Math.abs(r.total.mean - Tt));
      }
      ctx.tAdj = null;
    }
  }
  console.log(`  ${L}: προσομοιώσεις έτοιμες (${el()})`);
}
// «μόνο ratings»: κανονική κατανομή γύρω από την πρόβλεψη, με τυπική απόκλιση από τα ίδια τα σφάλματα
const sdM = Math.sqrt(resid.reduce((s, r) => s + r[0] ** 2, 0) / resid.length), sdT = Math.sqrt(resid.reduce((s, r) => s + r[1] ** 2, 0) / resid.length);
const Phi = (z) => 0.5 * (1 + Math.tanh(0.7978845608 * (z + 0.044715 * z ** 3)));
const crpsN = (mu, sd, y) => { const z = (y - mu) / sd, pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); return sd * (z * (2 * Phi(z) - 1) + 2 * pdf - 1 / Math.sqrt(Math.PI)); };
const RO = { brier: 0, acc: 0, margin: 0, total: 0, mae_margin: 0, mae_total: 0 };
resid.forEach(([eM, eT]) => { RO.margin += crpsN(0, sdM, eM); RO.total += crpsN(0, sdT, eT); RO.mae_margin += Math.abs(eM); RO.mae_total += Math.abs(eT); });
// (Brier για «μόνο ratings» από την κανονική της διαφοράς)
let bi = 0;
for (const [L, { W, rows, teams, prior }] of Object.entries(LG)) for (const w of W.WF.values()) {
  const ctx = w.ctx; if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
  const [eM] = resid[bi++], M = w.g.hs - w.g.as, pred = eM + M, p = Phi(pred / sdM), y = M > 0 ? 1 : 0;
  RO.brier += (p - y) ** 2; RO.acc += +((p >= 0.5) === (y === 1));
}
for (const k of Object.keys(RO)) RO[k] = +(RO[k] / resid.length).toFixed(4);
RO.sd_margin = +sdM.toFixed(2); RO.sd_total = +sdT.toFixed(2);

const table = Object.fromEntries(Object.entries(acc).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).map(([m, [s, n]]) => [m, +(s / n).toFixed(4)]))]));
const score = (k) => table[k].margin + table[k].total;
const wBest = WS.reduce((b, w) => (score("w" + w) < score("w" + b) ? w : b), 0);
const out = { fitted: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", sims_each: N, games: resid.length,
  hyper: HP, rmse: +best.rmse.toFixed(3), rmse_flat: +base.toFixed(3), w: wBest, ratings_only: RO, table };
fs.writeFileSync(path.join(ROOT, "data", "ratings_fit.json"), JSON.stringify(out, null, 1));
for (const w of WS) console.log(`  w=${w}: ${JSON.stringify(table["w" + w])}`);
console.log(`  μόνο ratings: ${JSON.stringify(RO)}`);
console.log(`  καλύτερο w=${wBest} -> data/ratings_fit.json (${el()})`);
