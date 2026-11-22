/* Προσομοιώσεις για το σάιτ (Node, ίδια μηχανή με τον browser: site/sim.js).
 *
 *   1. Επόμενοι αγώνες του demo (οι 2 επόμενοι κάθε ομάδας): 50.000 αγώνες ο καθένας
 *      -> πιθανότητα νίκης, κατανομές σκορ/διαφοράς/συνόλου, κατανομές απόδοσης κάθε παίκτη.
 *   2. Έλεγχος: όλοι οι παιγμένοι αγώνες της λίγκας, 2.000 ο καθένας: πρόβλεψη έναντι πραγματικού.
 *      (Προσοχή: τα στατιστικά της σεζόν περιέχουν και αυτούς τους αγώνες, άρα είναι έλεγχος «μέσα στο δείγμα».)
 *
 *   node scripts/run_sims.js            # -> site/db/sims.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const SIM = require(path.join(__dirname, "..", "site", "sim.js"));

const N = +(process.env.SIM_N || 50000), N_CHECK = +(process.env.SIM_CHECK || 2000), NEXT = 2;
const ROOT = path.join(__dirname, "..");
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", "demo.json"), "utf8"));
const seedOf = (code) => (Number(code) % 2147483647) || 1;

const games = Object.values(DB.games).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
const sel = new Map();
for (const c of DB.demo) games.filter((g) => !g.played && (g.home === c || g.away === c)).slice(0, NEXT).forEach((g) => sel.set(g.code, g));

const out = { n: N, generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", version: SIM.version, games: {}, check: null };
for (const g of sel.values()) {
  const t0 = Date.now();
  const ctx = SIM.prepare(DB, g.home, g.away);
  if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) { console.log(`  ! ${g.code}: λίγοι παίκτες, παραλείπεται`); continue; }
  const r = SIM.many(ctx, N, seedOf(g.code));
  out.games[g.code] = { home: g.home, away: g.away, date: g.date, ...r };
  console.log(`  ${DB.teams[g.home]?.name || DB.opponents[g.home]?.name} – ${DB.teams[g.away]?.name || DB.opponents[g.away]?.name}: ` +
    `γηπεδούχος ${(100 * r.p_home).toFixed(1)}%, σκορ ${r.score[0].mean}-${r.score[1].mean}, παράταση ${(100 * r.p_ot).toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

// έλεγχος στους παιγμένους αγώνες της λίγκας (από τη βαθμολογία ξέρουμε όλους; οι αγώνες με σκορ είναι στο demo μόνο για Άρη/ΠΑΟΚ)
const played = [];
for (const p of Object.values(DB.players)) for (const l of p.log) if (l.home && l.score) played.push({ code: l.g, home: l.team, away: l.opp, hs: +l.score.split("-")[0], as: +l.score.split("-")[1] });
const uniq = [...new Map(played.map((g) => [g.code, g])).values()];
let brier = 0, brierBase = 0, errM = 0, errT = 0, sumPred = 0, sumAct = 0, n = 0, hit = 0;
const homeRate = uniq.filter((g) => g.hs > g.as).length / Math.max(uniq.length, 1);
for (const g of uniq) {
  const ctx = SIM.prepare(DB, g.home, g.away);
  if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) continue;
  const r = SIM.many(ctx, N_CHECK, seedOf(g.code));
  const y = g.hs > g.as ? 1 : 0;
  brier += (r.p_home - y) ** 2; brierBase += (homeRate - y) ** 2; hit += (r.p_home >= 0.5) === (y === 1);
  errM += Math.abs(r.margin.mean - (g.hs - g.as)); errT += Math.abs(r.total.mean - (g.hs + g.as));
  sumPred += r.total.mean; sumAct += g.hs + g.as; n++;
}
out.check = { games: n, sims_each: N_CHECK, brier: +(brier / n).toFixed(4), brier_home_rate: +(brierBase / n).toFixed(4), acc: +(hit / n).toFixed(3),
  mae_margin: +(errM / n).toFixed(2), mae_total: +(errT / n).toFixed(2), avg_total_pred: +(sumPred / n).toFixed(1), avg_total_real: +(sumAct / n).toFixed(1) };
console.log("  έλεγχος:", out.check);
fs.writeFileSync(path.join(ROOT, "site", "db", "sims.json"), JSON.stringify(out));
console.log(`-> site/db/sims.json (${Object.keys(out.games).length} αγώνες × ${N})`);
