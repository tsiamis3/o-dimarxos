/* Backtest του κριτηρίου Kelly στους παιγμένους αγώνες, με αποδόσεις κλεισίματος (betexplorer, μέσος όρος bookmakers).
 *
 *  p: η πιθανότητα νίκης γηπεδούχου της προσομοίωσης walk-forward (site/db/sims_<λίγκα>.json, check.per_game):
 *     κάθε αγώνας προβλέφθηκε ΜΟΝΟ με τους προηγούμενους αγώνες (στατιστικά, β, ratings).
 *  Κανόνες (ίδιοι με τη σελίδα «Αξία»): EV = p·απόδοση − 1 ≥ 5%, |p − p_αγοράς| ≤ 15 μονάδες, απόδοση ≤ 5,
 *  ποσό = ¼ Kelly, το πολύ 3% του κεφαλαίου. Κεφάλαιο 100· τα στοιχήματα της ίδιας μέρας από το κεφάλαιο στην αρχή της.
 *
 *   node scripts/backtest_kelly.js        # -> data/predictions/backtest_kelly.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const LEAGUES = ["GBL", "E", "U"];

function readCSV(f) {
  if (!fs.existsSync(f)) return [];
  const [h, ...L] = fs.readFileSync(f, "utf8").trim().split(/\r?\n/), H = h.split(",");
  return L.map((l) => Object.fromEntries(l.split(",").map((v, i) => [H[i], v === "" ? null : isNaN(+v) ? v : +v])));
}

// ---------------------------------------------------------------- δεδομένα: p (walk-forward) + αποδόσεις κλεισίματος
const G = [];
for (const L of LEAGUES) {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", `sims_${L}.json`), "utf8"));
  const P = Object.fromEntries((S.check?.per_game || []).map((r) => [String(r[0]), { p: r[1], y: r[2] }]));
  const C = readCSV(path.join(ROOT, "data", "raw", `${L}${S.season || 2026}_closing.csv`));
  const DB = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", `${L}.json`), "utf8"));
  for (const c of C) {
    const m = P[String(c.gameCode)]; if (!m) continue;
    const q1 = 1 / c.odds_home, q2 = 1 / c.odds_away;
    G.push({ L, code: c.gameCode, date: c.date, home: DB.teams[c.home]?.name || c.home, away: DB.teams[c.away]?.name || c.away,
      p: m.p, y: c.hs > c.as ? 1 : 0, oh: c.odds_home, oa: c.odds_away, mp: q1 / (q1 + q2), margin: q1 + q2 - 1 });
  }
}
G.sort((a, b) => a.date.localeCompare(b.date) || String(a.code).localeCompare(String(b.code)));

// ---------------------------------------------------------------- μοντέλο απέναντι στην αγορά (χωρίς στοιχήματα)
const brier = (k) => G.reduce((s, g) => s + (g[k] - g.y) ** 2, 0) / G.length;
const ll = (k) => -G.reduce((s, g) => s + Math.log(g.y ? Math.max(1e-6, g[k]) : Math.max(1e-6, 1 - g[k])), 0) / G.length;
const vsMarket = { games: G.length, brier_model: +brier("p").toFixed(4), brier_market: +brier("mp").toFixed(4),
  logloss_model: +ll("p").toFixed(4), logloss_market: +ll("mp").toFixed(4), avg_margin: +(G.reduce((s, g) => s + g.margin, 0) / G.length).toFixed(4),
  by_league: Object.fromEntries(LEAGUES.map((L) => { const X = G.filter((g) => g.L === L);
    return [L, { games: X.length, brier_model: +(X.reduce((s, g) => s + (g.p - g.y) ** 2, 0) / X.length).toFixed(4),
      brier_market: +(X.reduce((s, g) => s + (g.mp - g.y) ** 2, 0) / X.length).toFixed(4) }]; })) };

// ---------------------------------------------------------------- στοιχήματα
function run({ minEv = 0.05, gap = 0.15, maxOdds = 5, frac = 0.25, cap = 0.03, flat = false, leagues = LEAGUES } = {}) {
  let bank = 100, peak = 100, maxDD = 0;
  const bets = [], curve = [];
  const days = [...new Set(G.filter((g) => leagues.includes(g.L)).map((g) => g.date))].sort();
  for (const d of days) {
    const start = bank;
    for (const g of G.filter((x) => x.date === d && leagues.includes(x.L))) {
      // η καλύτερη από τις δύο πλευρές (το πολύ μία έχει θετικό EV)
      const sides = [["home", g.p, g.oh, g.mp, g.y === 1], ["away", 1 - g.p, g.oa, 1 - g.mp, g.y === 0]]
        .map(([side, p, o, mp, won]) => ({ side, p, o, mp, won, ev: p * o - 1 })).sort((a, b) => b.ev - a.ev);
      const s = sides[0];
      if (s.ev < minEv || s.o > maxOdds || Math.abs(s.p - s.mp) > gap) continue;
      const b = s.o - 1, f = Math.max(0, (b * s.p - (1 - s.p)) / b), stake = flat ? 1 : start * Math.min(cap, frac * f);
      if (!(stake > 0)) continue;
      const profit = s.won ? stake * b : -stake;
      bank += profit;
      bets.push({ L: g.L, date: d, game: `${g.home} – ${g.away}`, side: s.side, odds: s.o, p: +s.p.toFixed(3), mp: +s.mp.toFixed(3), ev: +s.ev.toFixed(3),
        stake: +stake.toFixed(2), won: s.won, profit: +profit.toFixed(2), bank: +bank.toFixed(2) });
    }
    peak = Math.max(peak, bank); maxDD = Math.max(maxDD, (peak - bank) / peak);
    curve.push([d, +bank.toFixed(2)]);
  }
  const staked = bets.reduce((s, b) => s + b.stake, 0), profit = bets.reduce((s, b) => s + b.profit, 0);
  // 95% διάστημα για το ROI (bootstrap στα στοιχήματα)
  let R = 7, rnd = () => ((R = (R * 1103515245 + 12345) % 2147483648) / 2147483648), boots = [];
  if (bets.length) for (let k = 0; k < 2000; k++) { let st = 0, pr = 0; for (let i = 0; i < bets.length; i++) { const x = bets[Math.floor(rnd() * bets.length)]; st += x.stake; pr += x.profit; } boots.push(pr / st); }
  boots.sort((a, b) => a - b);
  return { n: bets.length, wins: bets.filter((b) => b.won).length, staked: +staked.toFixed(2), profit: +profit.toFixed(2),
    roi: staked ? +(profit / staked).toFixed(4) : null, roi_ci: boots.length ? [+boots[50].toFixed(4), +boots[1949].toFixed(4)] : null,
    final: +bank.toFixed(2), max_dd: +maxDD.toFixed(4), avg_odds: bets.length ? +(bets.reduce((s, b) => s + b.odds, 0) / bets.length).toFixed(2) : null,
    by_league: Object.fromEntries(LEAGUES.map((L) => { const X = bets.filter((b) => b.L === L), st = X.reduce((s, b) => s + b.stake, 0), pr = X.reduce((s, b) => s + b.profit, 0);
      return [L, { n: X.length, wins: X.filter((b) => b.won).length, profit: +pr.toFixed(2), roi: st ? +(pr / st).toFixed(4) : null }]; })),
    bets, curve };
}

const base = run();
const variants = {
  "βασικό (EV≥5%, ¼ Kelly, φίλτρα)": base,
  "χωρίς φίλτρα διαφωνίας/απόδοσης": run({ gap: 1, maxOdds: 1e9 }),
  "EV ≥ 0%": run({ minEv: 0 }),
  "EV ≥ 10%": run({ minEv: 0.1 }),
  "½ Kelly": run({ frac: 0.5, cap: 0.06 }),
  "ολόκληρο Kelly (χωρίς όριο)": run({ frac: 1, cap: 1 }),
  "σταθερό 1 μονάδα": run({ flat: true }),
};
const out = { generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", source: "betexplorer.com (μέσος όρος, κλείσιμο, 1/2 με παράταση)",
  vs_market: vsMarket, variants: Object.fromEntries(Object.entries(variants).map(([k, v]) => [k, { ...v, bets: k.startsWith("βασικό") ? v.bets : undefined, curve: k.startsWith("βασικό") ? v.curve : undefined }])) };
fs.writeFileSync(path.join(ROOT, "data", "predictions", "backtest_kelly.json"), JSON.stringify(out, null, 1));

console.log(`Αγώνες με p και αποδόσεις: ${G.length} · περιθώριο bookmaker ${(100 * vsMarket.avg_margin).toFixed(1)}%`);
console.log(`Μοντέλο / αγορά: Brier ${vsMarket.brier_model} / ${vsMarket.brier_market}, log-loss ${vsMarket.logloss_model} / ${vsMarket.logloss_market}`);
for (const [L, x] of Object.entries(vsMarket.by_league)) console.log(`   ${L}: ${x.games} αγώνες, Brier ${x.brier_model} / ${x.brier_market}`);
for (const [k, v] of Object.entries(variants)) console.log(`${k.padEnd(36)} n=${String(v.n).padStart(3)} κέρδη ${v.wins} ROI ${v.roi == null ? "–" : (100 * v.roi).toFixed(1) + "%"} [${v.roi_ci ? v.roi_ci.map((x) => (100 * x).toFixed(0) + "%").join(", ") : "–"}] κεφάλαιο 100 -> ${v.final} μέγ. πτώση ${(100 * v.max_dd).toFixed(0)}% μέση απόδ. ${v.avg_odds} · ${Object.entries(v.by_league).map(([L, x]) => `${L} ${x.n}/${x.profit}`).join(" ")}`);
