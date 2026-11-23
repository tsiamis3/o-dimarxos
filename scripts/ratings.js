/* Ratings ομάδων με δύο νούμερα: επίθεση (o) και άμυνα (d), σε πόντους ανά 100 κατοχές ως προς μέσο αντίπαλο.
 *
 *   πόντοι/100 κατοχές της A απέναντι στη B = μ + h·[A γηπεδούχος] + o_A − d_B + θόρυβος
 *
 * Ridge regression με βάρος ανά αγώνα = κατοχές/100 × 0.5^(ηλικία/τ) (οι πρόσφατοι μετράνε περισσότερο) και έλξη
 * των o, d προς την αρχική τιμή (περσινή σεζόν, συρρικνωμένη) με ισχύ λ (σε «αγώνες»). Ουσιαστικά ένα Elo με δύο
 * νούμερα, που λύνεται ακριβώς κάθε φορά αντί να ενημερώνεται αγώνα-αγώνα.
 */
"use strict";

/** Ανά αγώνα και ομάδα: { g, date, team, opp, home, pts, poss } από τα logs των παικτών. */
function teamGames(LOGS) {
  const by = {};
  for (const l of LOGS) {
    const k = l.g + "|" + l.team, t = (by[k] ||= { g: l.g, date: l.date, team: l.team, opp: l.opp, home: !!l.home, pts: 0, fga: 0, fta: 0, oreb: 0, tov: 0 });
    t.pts += l.pts; t.fga += l.fg2a + l.fg3a; t.fta += l.fta; t.oreb += l.oreb; t.tov += l.tov;
  }
  const rows = Object.values(by).filter((t) => by[t.g + "|" + t.opp]);
  for (const t of rows) { const o = by[t.g + "|" + t.opp];
    t.poss = ((t.fga + 0.44 * t.fta - t.oreb + t.tov) + (o.fga + 0.44 * o.fta - o.oreb + o.tov)) / 2; }   // κοινές κατοχές του αγώνα
  return rows.filter((t) => t.poss > 40);
}

function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => (Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]));
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;

/**
 * rows: teamGames(...) (μόνο όσα θέλουμε να μετρήσουν, π.χ. πριν από μια ημερομηνία)
 * opts: { asOf, teams: [κωδικοί], prior: { team: {o, d} }, lam: ισχύς έλξης (αγώνες), priorShrink: 0..1, tau: ημέρες }
 * -> { mu, h, o: {team}, d: {team}, n }
 */
function fit(rows, { asOf, teams, prior = {}, lam = 5, priorShrink = 0.5, tau = 60 } = {}) {
  const T = teams || [...new Set(rows.flatMap((r) => [r.team, r.opp]))], ix = Object.fromEntries(T.map((t, i) => [t, i])), nT = T.length;
  const n = 2 + 2 * nT, A = Array.from({ length: n }, () => new Float64Array(n)), b = new Float64Array(n);
  // ridge προς την αρχική τιμή: λ (o − o0)², λ (d − d0)²
  for (const t of T) { const i = ix[t], p = prior[t] || { o: 0, d: 0 };
    A[2 + i][2 + i] += lam; b[2 + i] += lam * priorShrink * p.o;
    A[2 + nT + i][2 + nT + i] += lam; b[2 + nT + i] += lam * priorShrink * p.d; }
  A[0][0] += 1e-6; A[1][1] += 1e-3;
  let used = 0;
  for (const r of rows) {
    if (!(r.team in ix) || !(r.opp in ix)) continue;
    const age = asOf ? Math.max(0, days(r.date, asOf)) : 0, w = (r.poss / 100) * Math.pow(0.5, age / tau);
    const y = (100 * r.pts) / r.poss, x = [[0, 1], [1, r.home ? 1 : 0], [2 + ix[r.team], 1], [2 + nT + ix[r.opp], -1]];
    for (const [i, xi] of x) { b[i] += w * xi * y; for (const [j, xj] of x) A[i][j] += w * xi * xj; }
    used++;
  }
  const s = solve(A.map((r) => [...r]), [...b]);
  return { mu: s[0], h: s[1], o: Object.fromEntries(T.map((t) => [t, s[2 + ix[t]]])), d: Object.fromEntries(T.map((t) => [t, s[2 + nT + ix[t]]])), n: used };
}

/** Πρόβλεψη πόντων ανά 100 κατοχές για γηπεδούχο/φιλοξενούμενο. */
function predict(R, home, away) {
  return [R.mu + R.h + (R.o[home] || 0) - (R.d[away] || 0), R.mu + (R.o[away] || 0) - (R.d[home] || 0)];
}

module.exports = { teamGames, fit, predict };
