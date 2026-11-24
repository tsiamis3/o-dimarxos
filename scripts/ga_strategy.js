/* Γενετικός αλγόριθμος για στρατηγική στοιχηματισμού στη φετινή σεζόν (GBL, EuroLeague, EuroCup).
 *
 * Δεδομένα: για κάθε παιγμένο αγώνα η πιθανότητα νίκης γηπεδούχου της προσομοίωσης walk-forward (site/db/sims_*.json,
 * check.per_game: κάθε αγώνας μόνο με τους προηγούμενους) και οι μέσες αποδόσεις κλεισίματος 1/2 (betexplorer).
 *
 * Μια στρατηγική = 15 γονίδια στο [0,1]: όριο αξίας (EV), εύρος αποδόσεων, μέγιστη διαφωνία με την αγορά, διόρθωση
 * κλίμακας του μοντέλου και ανάμειξη με την αγορά, φαβορί/αουτσάιντερ, γηπεδούχος/φιλοξενούμενος, λίγκες,
 * μονά ή παρολί 2–4 επιλογών, κλάσμα Kelly, όριο ανά στοίχημα και ανά ημέρα.
 * Καταλληλότητα: λογάριθμος του τελικού κεφαλαίου (ό,τι μεγιστοποιεί και το Kelly) μείον ποινή για τη μέγιστη πτώση
 * και για πολύ λίγα στοιχήματα.
 *
 * Για να μη μας ξεγελάσει η τύχη:
 *   1. εκπαίδευση στο πρώτο 60% της σεζόν, κρίση στο υπόλοιπο 40% (που ο αλγόριθμος δεν έχει δει)
 *   2. κυλιόμενη δοκιμή: η σεζόν σε 4 τμήματα· κάθε τμήμα με στρατηγική που βρέθηκε μόνο από τα προηγούμενα
 *   3. «ψεύτικες σεζόν»: ίδιοι αγώνες, αποτελέσματα κληρωμένα από τις πιθανότητες της αγοράς (καμία ευκαιρία δεν υπάρχει)·
 *      ό,τι «κέρδος» βρει εκεί ο αλγόριθμος είναι καθαρή τύχη -> μέτρο σύγκρισης για το πραγματικό
 *
 *   node scripts/ga_strategy.js          # -> site/strategy.json
 */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const LEAGUES = ["GBL", "E", "U"];
const t0 = Date.now(), el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

// ---------------------------------------------------------------- δεδομένα
function readCSV(f) {
  if (!fs.existsSync(f)) return [];
  const [h, ...L] = fs.readFileSync(f, "utf8").trim().split(/\r?\n/), H = h.split(",");
  return L.map((l) => Object.fromEntries(l.split(",").map((v, i) => [H[i], v === "" ? null : isNaN(+v) ? v : +v])));
}
const lgt = (p) => Math.log(p / (1 - p)), inv = (x) => 1 / (1 + Math.exp(-x));
const G = [];
for (const L of LEAGUES) {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", `sims_${L}.json`), "utf8"));
  const P = Object.fromEntries((S.check?.per_game || []).map((r) => [String(r[0]), r[1]]));
  const DB = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "db", `${L}.json`), "utf8"));
  for (const c of readCSV(path.join(ROOT, "data", "raw", `${L}${DB.season}_closing.csv`))) {
    const p = P[String(c.gameCode)]; if (p == null) continue;
    const q1 = 1 / c.odds_home, q2 = 1 / c.odds_away;
    G.push({ L, li: LEAGUES.indexOf(L), date: c.date, home: DB.teams[c.home]?.name || c.home, away: DB.teams[c.away]?.name || c.away,
      lp: lgt(Math.min(0.99, Math.max(0.01, p))), lm: lgt(q1 / (q1 + q2)), oh: c.odds_home, oa: c.odds_away, y: c.hs > c.as ? 1 : 0 });
  }
}
G.sort((a, b) => a.date.localeCompare(b.date));
const DAYS = [...new Set(G.map((g) => g.date))];
const byDay = DAYS.map((d) => G.map((g, i) => (g.date === d ? i : -1)).filter((i) => i >= 0));
const cut = DAYS[Math.floor(DAYS.length * 0.6)];
const TRAIN = DAYS.map((d, i) => i).filter((i) => DAYS[i] < cut), TEST = DAYS.map((d, i) => i).filter((i) => DAYS[i] >= cut);
console.log(`  ${G.length} αγώνες σε ${DAYS.length} ημέρες· εκπαίδευση έως ${cut} (${TRAIN.reduce((s, i) => s + byDay[i].length, 0)} αγ.), δοκιμή ${TEST.reduce((s, i) => s + byDay[i].length, 0)} αγ.`);

// ---------------------------------------------------------------- στρατηγική: αποκωδικοποίηση και προσομοίωση
const NG = 15;
function decode(g) {
  const minOdds = 1.05 + 2.95 * g[1];
  return { minEv: -0.05 + 0.4 * g[0], minOdds, maxOdds: minOdds + (8 - minOdds) * g[2], maxGap: 0.02 + 0.48 * g[3],
    k: 0.8 + 1.7 * g[4], alpha: g[5], frac: 0.05 + 0.95 * g[6], cap: 0.005 + 0.095 * g[7], legs: 1 + Math.min(3, Math.floor(g[8] * 4)),
    fav: g[9] < 1 / 3 ? "όλα" : g[9] < 2 / 3 ? "φαβορί" : "αουτσάιντερ", ha: g[10] < 1 / 3 ? "όλα" : g[10] < 2 / 3 ? "γηπεδούχος" : "φιλοξενούμενος",
    leagues: LEAGUES.filter((_, i) => g[11 + i] >= 0.5), dayCap: 0.05 + 0.45 * g[14] };
}
/** Παίζει τη στρατηγική s στις ημέρες days με αποτελέσματα Y (πίνακας 0/1 ανά αγώνα). */
function play(s, days, Y, keep = false) {
  let bank = 100, peak = 100, maxDD = 0, n = 0, wins = 0, staked = 0, profit = 0;
  const curve = keep ? [] : null, bets = keep ? [] : null, lm = new Set(s.leagues.map((L) => LEAGUES.indexOf(L)));
  for (const di of days) {
    const cand = [];
    for (const i of byDay[di]) {
      const g = G[i]; if (!lm.has(g.li)) continue;
      const pH = inv((1 - s.alpha) * s.k * g.lp + s.alpha * g.lm), mH = inv(g.lm);
      for (const [side, p, o, mp, won] of [["home", pH, g.oh, mH, Y[i] === 1], ["away", 1 - pH, g.oa, 1 - mH, Y[i] === 0]]) {
        if (s.ha === "γηπεδούχος" && side !== "home") continue;
        if (s.ha === "φιλοξενούμενος" && side !== "away") continue;
        if (s.fav === "φαβορί" && mp < 0.5) continue;
        if (s.fav === "αουτσάιντερ" && mp >= 0.5) continue;
        const ev = p * o - 1;
        if (ev < s.minEv || o < s.minOdds || o > s.maxOdds || Math.abs(p - mp) > s.maxGap) continue;
        cand.push({ i, side, p, o, won, ev });
      }
    }
    if (!cand.length) { if (keep) curve.push([DAYS[di], +bank.toFixed(2)]); continue; }
    cand.sort((a, b) => b.ev - a.ev);
    // μονά ή παρολί: κατά σειρά EV, ομάδες των legs επιλογών (διαφορετικοί αγώνες)
    const slips = [];
    if (s.legs === 1) for (const c of cand) slips.push([c]);
    else { const used = new Set(), pool = cand.filter((c) => (used.has(c.i) ? false : (used.add(c.i), true)));
      for (let k = 0; k + s.legs <= pool.length; k += s.legs) slips.push(pool.slice(k, k + s.legs)); }
    const start = bank; let dayStake = 0;
    for (const sl of slips) {
      const P = sl.reduce((a, c) => a * c.p, 1), O = sl.reduce((a, c) => a * c.o, 1), b = O - 1;
      if (P * O - 1 < s.minEv) continue;
      const f = Math.max(0, (b * P - (1 - P)) / b); let st = start * Math.min(s.cap, s.frac * f);
      st = Math.min(st, start * s.dayCap - dayStake); if (!(st > 0.01)) continue;
      dayStake += st;
      const won = sl.every((c) => c.won), pr = won ? st * b : -st;
      bank += pr; n++; wins += won; staked += st; profit += pr;
      if (keep) bets.push({ date: DAYS[di], legs: sl.map((c) => `${G[c.i].home} – ${G[c.i].away}: ${c.side === "home" ? "1" : "2"} @${c.o}`), odds: +O.toFixed(2), p: +P.toFixed(3), stake: +st.toFixed(2), won, bank: +bank.toFixed(2) });
    }
    peak = Math.max(peak, bank); maxDD = Math.max(maxDD, (peak - bank) / peak);
    if (keep) curve.push([DAYS[di], +bank.toFixed(2)]);
    if (bank < 1) break;
  }
  return { final: bank, n, wins, staked, profit, roi: staked ? profit / staked : 0, maxDD, curve, bets };
}
// «ελεύθερος»: όσο περισσότερο κέρδος· «συντηρητικός»: βαριά ποινή στη μέγιστη πτώση και τουλάχιστον 30 στοιχήματα
const FIT = {
  free: (r) => Math.log(Math.max(r.final, 0.5) / 100) - 0.5 * r.maxDD - (r.n < 10 ? 0.05 * (10 - r.n) : 0),
  safe: (r) => Math.log(Math.max(r.final, 0.5) / 100) - 2 * r.maxDD - (r.n < 30 ? 0.03 * (30 - r.n) : 0),
};
let fitness = FIT.free;

// ---------------------------------------------------------------- γενετικός αλγόριθμος
function rngOf(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function ga(days, Y, { pop = 120, gens = 80, seed = 1, elite = 6, fit = "free" } = {}) {
  fitness = FIT[fit];
  const R = rngOf(seed), gauss = () => Math.sqrt(-2 * Math.log(R() || 1e-9)) * Math.cos(2 * Math.PI * R());
  const ev = (g) => { const s = decode(g); if (!s.leagues.length) return { g, f: -9 }; const r = play(s, days, Y); return { g, f: fitness(r), r }; };
  let P = Array.from({ length: pop }, () => ev(Array.from({ length: NG }, R)));
  const hist = [];
  for (let gen = 0; gen < gens; gen++) {
    P.sort((a, b) => b.f - a.f);
    hist.push([+P[0].f.toFixed(4), +(P.reduce((s, x) => s + x.f, 0) / pop).toFixed(4)]);
    const next = P.slice(0, elite);
    const pick = () => { let b = P[Math.floor(R() * pop)]; for (let k = 0; k < 2; k++) { const c = P[Math.floor(R() * pop)]; if (c.f > b.f) b = c; } return b.g; };
    while (next.length < pop) {
      const a = pick(), b = pick();
      const c = a.map((x, i) => (R() < 0.5 ? x : b[i]));                                   // ομοιόμορφη διασταύρωση
      for (let i = 0; i < NG; i++) if (R() < 2 / NG) c[i] = Math.min(1, Math.max(0, c[i] + 0.15 * gauss()));   // μετάλλαξη
      next.push(ev(c));
    }
    P = next;
  }
  P.sort((a, b) => b.f - a.f);
  return { best: P[0], hist, pop: P };
}

// ---------------------------------------------------------------- 1. εκπαίδευση / δοκιμή
const Yreal = G.map((g) => g.y), ALL = DAYS.map((_, i) => i);
const runs = [1, 2, 3, 4, 5].map((seed) => ga(TRAIN, Yreal, { seed }));
runs.sort((a, b) => b.best.f - a.best.f);
const best = runs[0].best, S = decode(best.g);
const trainR = play(S, TRAIN, Yreal, true), testR = play(S, TEST, Yreal, true), fullR = play(S, ALL, Yreal, true);
console.log(`  καλύτερη (εκπαίδευση): ${JSON.stringify(S)}`);
console.log(`  εκπαίδευση: n=${trainR.n} ROI ${(100 * trainR.roi).toFixed(1)}% κεφάλαιο ${trainR.final.toFixed(1)} · δοκιμή: n=${testR.n} ROI ${(100 * testR.roi).toFixed(1)}% κεφάλαιο ${testR.final.toFixed(1)} (${el()})`);
// οι 10 καλύτερες διαφορετικές της εκπαίδευσης, πώς πήγαν στη δοκιμή
const seen = new Set(), top = [];
for (const x of runs.flatMap((r) => r.pop).sort((a, b) => b.f - a.f)) {
  const s = decode(x.g), key = JSON.stringify([s.legs, s.fav, s.ha, s.leagues, Math.round(s.minEv * 20), Math.round(s.minOdds * 2), Math.round(s.alpha * 4)]);
  if (seen.has(key)) continue; seen.add(key);
  const a = play(s, TRAIN, Yreal), b = play(s, TEST, Yreal);
  top.push({ s, train: { n: a.n, roi: a.roi, final: a.final }, test: { n: b.n, roi: b.roi, final: b.final } });
  if (top.length >= 10) break;
}

// ---------------------------------------------------------------- 2. κυλιόμενη δοκιμή (4 τμήματα)
const blocks = 4, b0 = Math.floor(DAYS.length * 0.4), step = Math.ceil((DAYS.length - b0) / blocks), roll = [];
let rollBank = 100; const rollCurve = [];
for (let k = 0; k < blocks; k++) {
  const tr = ALL.slice(0, b0 + k * step), te = ALL.slice(b0 + k * step, b0 + (k + 1) * step); if (!te.length) break;
  const r = ga(tr, Yreal, { seed: 11 + k, pop: 100, gens: 60 }), s = decode(r.best.g), res = play(s, te, Yreal, true);
  const f = rollBank / 100; for (const [d, v] of res.curve) rollCurve.push([d, +(v * f).toFixed(2)]); rollBank *= res.final / 100;
  roll.push({ from: DAYS[te[0]], to: DAYS[te.at(-1)], legs: s.legs, minEv: s.minEv, n: res.n, roi: res.roi, mult: res.final / 100 });
}
console.log(`  κυλιόμενη δοκιμή: κεφάλαιο 100 -> ${rollBank.toFixed(1)} (${roll.map((x) => `${x.n} στ., ×${x.mult.toFixed(2)}`).join(" · ")}) (${el()})`);

// ---------------------------------------------------------------- 2β. συντηρητική εκδοχή (ίδια διαδικασία, άλλη καταλληλότητα)
const runsC = [1, 2, 3, 4, 5].map((seed) => ga(TRAIN, Yreal, { seed: 100 + seed, fit: "safe" })).sort((a, b) => b.best.f - a.best.f);
const SC = decode(runsC[0].best.g), trainC = play(SC, TRAIN, Yreal, true), testC = play(SC, TEST, Yreal, true);
let rollBankC = 100; const rollC = [], rollCurveC = [];
for (let k = 0; k < blocks; k++) {
  const tr = ALL.slice(0, b0 + k * step), te = ALL.slice(b0 + k * step, b0 + (k + 1) * step); if (!te.length) break;
  const r = ga(tr, Yreal, { seed: 211 + k, pop: 100, gens: 60, fit: "safe" }), s = decode(r.best.g), res = play(s, te, Yreal, true);
  const f = rollBankC / 100; for (const [d, v] of res.curve) rollCurveC.push([d, +(v * f).toFixed(2)]); rollBankC *= res.final / 100;
  rollC.push({ from: DAYS[te[0]], to: DAYS[te.at(-1)], legs: s.legs, minEv: +s.minEv.toFixed(3), n: res.n, roi: +res.roi.toFixed(4), mult: +(res.final / 100).toFixed(3) });
}
console.log(`  συντηρητική: ${JSON.stringify(SC)}`);
console.log(`     εκπαίδευση n=${trainC.n} ROI ${(100 * trainC.roi).toFixed(1)}% κεφ. ${trainC.final.toFixed(1)} · δοκιμή n=${testC.n} ROI ${(100 * testC.roi).toFixed(1)}% κεφ. ${testC.final.toFixed(1)} · κυλιόμενη 100 -> ${rollBankC.toFixed(1)} (${el()})`);

// ---------------------------------------------------------------- 3. ψεύτικες σεζόν (η αγορά έχει πάντα δίκιο)
const NULLS = +(process.env.GA_NULLS || 100), nulls = [];
for (let k = 0; k < NULLS; k++) {
  const R = rngOf(1000 + k), Y = G.map((g) => (R() < inv(g.lm) ? 1 : 0));
  const r = ga(TRAIN, Y, { seed: 500 + k, pop: 80, gens: 50 }), s = decode(r.best.g), a = play(s, TRAIN, Y), b = play(s, TEST, Y);
  nulls.push({ trainFinal: a.final, trainRoi: a.roi, testFinal: b.final, testRoi: b.roi, f: r.best.f });
}
const realPct = nulls.filter((x) => x.f >= best.f).length / NULLS;
console.log(`  ψεύτικες σεζόν: ${NULLS}· η πραγματική εκπαίδευση ξεπερνά το ${(100 * (1 - realPct)).toFixed(0)}% (${el()})`);

// ---------------------------------------------------------------- σημεία αναφοράς στη δοκιμή
const base = (o) => ({ minEv: -1, minOdds: 1, maxOdds: 99, maxGap: 1, k: 1, alpha: 0, frac: 0, cap: 0, legs: 1, fav: "όλα", ha: "όλα", leagues: LEAGUES, dayCap: 1, ...o });
const flatPlay = (s, days) => { // σταθερό 1 μονάδα ανά επιλογή
  let n = 0, pr = 0; for (const di of days) for (const i of byDay[di]) { const g = G[i], mH = inv(g.lm);
    const fav = mH >= 0.5 ? ["home", g.oh, g.y === 1] : ["away", g.oa, g.y === 0], dog = mH >= 0.5 ? ["away", g.oa, g.y === 0] : ["home", g.oh, g.y === 1];
    const [, o, won] = s === "fav" ? fav : dog; n++; pr += won ? o - 1 : -1; } return { n, roi: pr / n }; };
const ourRule = base({ minEv: 0.05, maxOdds: 5, maxGap: 0.15, frac: 0.25, cap: 0.03, dayCap: 1 });
const refs = {
  ours: { train: play(ourRule, TRAIN, Yreal, true), test: play(ourRule, TEST, Yreal, true), full: play(ourRule, ALL, Yreal, true) },
  favFlat: { train: flatPlay("fav", TRAIN), test: flatPlay("fav", TEST) }, dogFlat: { train: flatPlay("dog", TRAIN), test: flatPlay("dog", TEST) },
};
const margin = G.reduce((s, g) => s + 1 / g.oh + 1 / g.oa - 1, 0) / G.length;

const pack = (r) => ({ n: r.n, wins: r.wins, roi: +r.roi.toFixed(4), final: +r.final.toFixed(2), max_dd: +r.maxDD.toFixed(4) });
const out = { generated: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", games: G.length, days: DAYS.length, cut, margin: +margin.toFixed(4),
  split: { train_games: TRAIN.reduce((s, i) => s + byDay[i].length, 0), test_games: TEST.reduce((s, i) => s + byDay[i].length, 0), from: DAYS[0], to: DAYS.at(-1) },
  ga: { pop: 120, gens: 80, seeds: 5, genes: NG, hist: runs[0].hist },
  best: { strategy: { ...S, minEv: +S.minEv.toFixed(3), minOdds: +S.minOdds.toFixed(2), maxOdds: +S.maxOdds.toFixed(2), maxGap: +S.maxGap.toFixed(3), k: +S.k.toFixed(2), alpha: +S.alpha.toFixed(2), frac: +S.frac.toFixed(2), cap: +S.cap.toFixed(3), dayCap: +S.dayCap.toFixed(2) },
    train: pack(trainR), test: pack(testR), full: pack(fullR), curve_train: trainR.curve, curve_test: testR.curve, bets_test: testR.bets.slice(-40) },
  top: top.map((t) => ({ legs: t.s.legs, fav: t.s.fav, ha: t.s.ha, leagues: t.s.leagues, minEv: +t.s.minEv.toFixed(3), minOdds: +t.s.minOdds.toFixed(2), maxOdds: +t.s.maxOdds.toFixed(2), alpha: +t.s.alpha.toFixed(2), frac: +t.s.frac.toFixed(2), cap: +t.s.cap.toFixed(3), k: +t.s.k.toFixed(2),
    train: { n: t.train.n, roi: +t.train.roi.toFixed(4), final: +t.train.final.toFixed(1) }, test: { n: t.test.n, roi: +t.test.roi.toFixed(4), final: +t.test.final.toFixed(1) } })),
  safe: { strategy: { ...SC, minEv: +SC.minEv.toFixed(3), minOdds: +SC.minOdds.toFixed(2), maxOdds: +SC.maxOdds.toFixed(2), maxGap: +SC.maxGap.toFixed(3), k: +SC.k.toFixed(2), alpha: +SC.alpha.toFixed(2), frac: +SC.frac.toFixed(2), cap: +SC.cap.toFixed(3), dayCap: +SC.dayCap.toFixed(2) },
    train: pack(trainC), test: pack(testC), curve_train: trainC.curve, curve_test: testC.curve, hist: runsC[0].hist,
    rolling: { final: +rollBankC.toFixed(2), blocks: rollC, curve: rollCurveC } },
  rolling: { final: +rollBank.toFixed(2), blocks: roll.map((x) => ({ ...x, roi: +x.roi.toFixed(4), mult: +x.mult.toFixed(3), minEv: +x.minEv.toFixed(3) })), curve: rollCurve },
  nulls: { n: NULLS, share_better_or_equal: +realPct.toFixed(3), train_final: nulls.map((x) => +x.trainFinal.toFixed(1)), test_final: nulls.map((x) => +x.testFinal.toFixed(1)),
    real_train_final: +trainR.final.toFixed(1), real_test_final: +testR.final.toFixed(1) },
  refs: { ours: { train: pack(refs.ours.train), test: pack(refs.ours.test), full: pack(refs.ours.full), curve_test: refs.ours.test.curve },
    fav_flat: { train: { n: refs.favFlat.train.n, roi: +refs.favFlat.train.roi.toFixed(4) }, test: { n: refs.favFlat.test.n, roi: +refs.favFlat.test.roi.toFixed(4) } },
    dog_flat: { train: { n: refs.dogFlat.train.n, roi: +refs.dogFlat.train.roi.toFixed(4) }, test: { n: refs.dogFlat.test.n, roi: +refs.dogFlat.test.roi.toFixed(4) } } } };
fs.writeFileSync(path.join(ROOT, "site", "strategy.json"), JSON.stringify(out));
console.log(`-> site/strategy.json (${el()})`);
