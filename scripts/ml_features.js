/* Χαρακτηριστικά ανά αγώνα για το μοντέλο «δεύτερου επιπέδου» (scripts/ml_model.py), από το Monte Carlo walk-forward.
 *
 * Για κάθε παιγμένο αγώνα μιας λίγκας/σεζόν (μόνο με όσους προηγήθηκαν μέσα στη σεζόν):
 *   Monte Carlo (ίδια μηχανή με το σάιτ: log5 με β, ratings w, αβεβαιότητα) -> πιθανότητα νίκης, διαφορά, σύνολο, ροπές
 *   ratings ομάδων (επίθεση/άμυνα) -> αναμενόμενη διαφορά/σύνολο
 *   πρόγραμμα -> ημέρες ξεκούρασης, αγώνες στις 14 τελευταίες ημέρες, αγώνες που έχουν παίξει
 * Στόχοι: νίκη γηπεδούχου, διαφορά, σύνολο.
 *
 *   node scripts/ml_features.js E 2025          # data/hist/E2025.json -> data/ml/feat_E2025.csv
 *   node scripts/ml_features.js E               # τρέχουσα σεζόν (site/db/E.json)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { league, SIM, ROOT } = require(path.join(__dirname, "wf.js"));
const RT = require(path.join(__dirname, "ratings.js"));

const L = process.argv[2], S = process.argv[3] ? +process.argv[3] : null, N = +(process.env.ML_N || 2000);
const file = S ? path.join(ROOT, "data", "hist", `${L}${S}.json`) : null;
const W = league(L, { quiet: true, file });
const DB = W.DB0, season = DB.season, t0 = Date.now();

// πρόγραμμα κάθε ομάδας (όλοι οι αγώνες της σεζόν, ημερομηνίες)
const sched = {};
for (const g of Object.values(DB.games)) if (g.played) for (const t of [g.home, g.away]) (sched[t] ||= []).push(g.date);
for (const t in sched) sched[t].sort();
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
function restOf(t, date) {
  const prev = (sched[t] || []).filter((d) => d < date);
  return { rest: prev.length ? Math.min(10, days(prev.at(-1), date)) : 10, g14: prev.filter((d) => days(d, date) <= 14).length, gp: prev.length };
}

const rows = [];
for (const w of W.WF.values()) {
  const g = w.g, ctx = { ...w.ctx, beta: w.beta, tAdj: w.tAdj };
  if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
  const r = SIM.many(ctx, N, W.seedOf(g.code) + 21, { raw: true });
  const R = W.ratingsAsOf(g.date), [ph, pa] = RT.predict(R, g.home, g.away), pace = ctx.pace;
  const H = restOf(g.home, g.date), A = restOf(g.away, g.date);
  rows.push({ comp: L, season, code: g.code, date: g.date, home: g.home, away: g.away,
    sim_p: r.p_home, sim_margin: r.margin.mean, sim_margin_sd: r.margin.sd, sim_total: r.total.mean, sim_total_sd: r.total.sd, sim_p_ot: r.p_ot,
    sim_margin_skew: r.margin.skew, sim_total_skew: r.total.skew,
    r_net_home: (R.o[g.home] || 0) + (R.d[g.home] || 0), r_net_away: (R.o[g.away] || 0) + (R.d[g.away] || 0),
    r_margin: ((ph - pa) * pace) / 100, r_total: ((ph + pa) * pace) / 100, r_home_adv: R.h, pace,
    rest_home: H.rest, rest_away: A.rest, g14_home: H.g14, g14_away: A.g14, gp_home: H.gp, gp_away: A.gp,
    y: g.hs > g.as ? 1 : 0, margin: g.hs - g.as, total: g.hs + g.as, hs: g.hs, as: g.as });
}
fs.mkdirSync(path.join(ROOT, "data", "ml"), { recursive: true });
const out = path.join(ROOT, "data", "ml", `feat_${L}${season}.csv`), cols = Object.keys(rows[0] || { code: 0 });
fs.writeFileSync(out, [cols.join(","), ...rows.map((x) => cols.map((c) => (typeof x[c] === "number" ? +x[c].toFixed(5) : x[c])).join(","))].join("\n"));
console.log(`${L}${season}: ${rows.length} αγώνες -> ${path.relative(ROOT, out)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
