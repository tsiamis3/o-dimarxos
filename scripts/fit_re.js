/* Προσαρμογή της τυχαιότητας «πέρα από τα ζάρια» της προσομοίωσης (site/sim.js, SIM.RE0):
 *   pace (κατοχές), g (κοινός παράγοντας αγώνα), t (ομάδα), p («βραδιά» παίκτη στο σουτ), m (λεπτά/ρόλος παίκτη).
 *
 * Σε όλους τους παιγμένους αγώνες GBL, EuroLeague, EuroCup (walk-forward: κάθε αγώνας με στατιστικά και β μόνο από
 * τους προηγούμενους), ψάχνουμε τις τιμές που δίνουν τις καλύτερες κατανομές, με κριτήριο το CRPS (μετρά όλη την
 * κατανομή, όχι μόνο τον μέσο): διαφορά + σύνολο + 4 × πόντοι παίκτη. Αναζήτηση ανά συντεταγμένη (δύο περάσματα).
 * Μετά: κάλυψη κουτιού/κεραιών πριν και μετά, και από πού έρχεται η διασπορά (ζάρια, ρυθμός, αγώνας, ομάδα, λεπτά, σουτ).
 *
 *   node scripts/fit_re.js            # -> data/sim_re.json   (FIT_N=600 προσομοιώσεις ανά αγώνα και ρύθμιση)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { league, SIM, ROOT } = require(path.join(__dirname, "wf.js"));

const N = +(process.env.FIT_N || 600);
const LEAGUES = (process.env.FIT_LEAGUES || "GBL,E,U").split(",");
const t0 = Date.now(), el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

// ---------------------------------------------------------------- οι αγώνες (walk-forward) όλων των λιγκών
const GAMES = [];
for (const L of LEAGUES) {
  const W = league(L, { quiet: true });
  for (const w of W.WF.values()) {
    const ctx = { ...w.ctx, beta: w.beta };
    if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
    const box = W.actualBox(w.g.code);
    GAMES.push({ L, code: w.g.code, seed: W.seedOf(w.g.code) + 7, ctx, hs: w.g.hs, as: w.g.as, box });
  }
  console.log(`  ${L}: ${[...W.WF.values()].length} αγώνες walk-forward (${el()})`);
}
console.log(`  σύνολο ${GAMES.length} αγώνες × ${N} προσομοιώσεις ανά ρύθμιση`);

// ---------------------------------------------------------------- CRPS και κάλυψη από δείγμα
function crps(arr, y) {
  const x = Float64Array.from(arr).sort(), n = x.length;
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) { a += Math.abs(x[i] - y); b += (2 * i - n + 1) * x[i]; }
  return a / n - b / (n * n);
}
const q = (x, p) => x[Math.min(x.length - 1, Math.floor(p * x.length))];
function cover(arr, y) { const x = Float64Array.from(arr).sort(); return [y >= q(x, 0.25) && y <= q(x, 0.75), y >= q(x, 0.05) && y <= q(x, 0.95)]; }

function evaluate(re, { coverage = false } = {}) {
  const M = {}, add = (L, k, v) => { const o = ((M[L] ||= {})[k] ||= [0, 0]); o[0] += v; o[1]++; };
  for (const G of GAMES) {
    G.ctx.re = re;
    const r = SIM.many(G.ctx, N, G.seed, { raw: true }), s0 = r.raw.s0, s1 = r.raw.s1;
    const mg = Int16Array.from(s0, (v, i) => v - s1[i]), tot = Int16Array.from(s0, (v, i) => v + s1[i]);
    for (const L of [G.L, "ALL"]) {
      add(L, "margin", crps(mg, G.hs - G.as)); add(L, "total", crps(tot, G.hs + G.as));
      add(L, "score", (crps(s0, G.hs) + crps(s1, G.as)) / 2);
      for (const [pid, arr] of Object.entries(r.raw.pts)) { const a = G.box[pid]; if (a) add(L, "pts", crps(arr, a.pts)); }
      if (coverage) {
        const c = [["margin", mg, G.hs - G.as], ["total", tot, G.hs + G.as]];
        for (const [k, arr, y] of c) { const [bx, wh] = cover(arr, y); add(L, k + "_box", +bx); add(L, k + "_whisk", +wh); }
        for (const [pid, arr] of Object.entries(r.raw.pts)) { const a = G.box[pid]; if (!a) continue; const [bx, wh] = cover(arr, a.pts); add(L, "pts_box", +bx); add(L, "pts_whisk", +wh); }
      }
    }
  }
  const out = {};
  for (const [L, o] of Object.entries(M)) out[L] = Object.fromEntries(Object.entries(o).map(([k, [s, n]]) => [k, +(s / n).toFixed(4)]));
  for (const o of Object.values(out)) o.J = +(o.margin + o.total + 4 * o.pts).toFixed(4);
  return out;
}

// ---------------------------------------------------------------- αναζήτηση ανά συντεταγμένη
const GRID = { m: [0, 0.1, 0.2, 0.3, 0.4], g: [0, 0.05, 0.1, 0.15, 0.2], t: [0, 0.05, 0.1, 0.15], pace: [3.5, 5, 6.5, 8], p: [0, 0.1, 0.2] };
let best = { ...SIM.RE0 }, bestM = evaluate(best), history = [{ re: { ...best }, J: bestM.ALL.J }];
console.log(`  RE0 ${JSON.stringify(best)} J=${bestM.ALL.J} (${el()})`);
for (let pass = 0; pass < 2; pass++) {
  let changed = false;
  for (const k of Object.keys(GRID)) for (const v of GRID[k]) {
    if (v === best[k]) continue;
    const re = { ...best, [k]: v }, m = evaluate(re);
    history.push({ re, J: m.ALL.J });
    if (m.ALL.J < bestM.ALL.J - 1e-4) { best = re; bestM = m; changed = true; }
    console.log(`  [${pass + 1}] ${k}=${v}: J=${m.ALL.J}  καλύτερο ${JSON.stringify(best)} J=${bestM.ALL.J} (${el()})`);
  }
  if (!changed) break;
}

// ---------------------------------------------------------------- πριν / μετά (με κάλυψη) και από πού έρχεται η διασπορά
const before = evaluate({ ...SIM.RE0 }, { coverage: true }), after = evaluate(best, { coverage: true });
const steps = [["ζάρια", { pace: 0, g: 0, t: 0, p: 0, m: 0 }], ["ρυθμός", { pace: best.pace }], ["κοινός παράγοντας αγώνα", { g: best.g }],
  ["ομάδα", { t: best.t }], ["λεπτά/ρόλος παίκτη", { m: best.m }], ["σουτ παίκτη", { p: best.p }]];
const sample = GAMES.filter((_, i) => i % 3 === 0), V = [];
let cur = {};
for (const [, add] of steps) {
  cur = { ...cur, ...add };
  let vm = 0, vt = 0, vp = 0, np = 0;
  for (const G of sample) {
    G.ctx.re = cur; const r = SIM.many(G.ctx, N, G.seed + 1);
    vm += r.margin.var; vt += r.total.var;
    for (const side of r.players) for (const p of side) if (p.min >= 15) { vp += p.pts.var; np++; }
  }
  V.push({ margin: vm / sample.length, total: vt / sample.length, pts: vp / Math.max(np, 1) });
}
const decomp = {};
for (const k of ["margin", "total", "pts"]) decomp[k] = steps.map(([lab], i) => [lab, +(((V[i][k] - (i ? V[i - 1][k] : 0)) / V.at(-1)[k])).toFixed(3)]);

const out = { re: best, fitted: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", sims_each: N, games: GAMES.length,
  leagues: Object.fromEntries(LEAGUES.map((L) => [L, GAMES.filter((g) => g.L === L).length])), grid: GRID, before, after, decomp, history };
fs.writeFileSync(path.join(ROOT, "data", "sim_re.json"), JSON.stringify(out, null, 1));
console.log("  καλύτερο:", JSON.stringify(best));
console.log("  πριν:", JSON.stringify(before.ALL)); console.log("  μετά:", JSON.stringify(after.ALL));
console.log("  διασπορά:", JSON.stringify(decomp));
console.log(`-> data/sim_re.json (${el()})`);
