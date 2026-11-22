/* =============================================================================
   Μηχανή προσομοίωσης αγώνα (Monte Carlo σε αλυσίδα Markov σε επίπεδο κατοχής).
   Τρέχει ίδια στον browser (ζωντανό play-by-play) και στο Node (50.000 αγώνες στο workflow).

   Ένας αγώνας:
     Α) κατοχές ανά ομάδα ~ Κανονική(μέσος ρυθμός των δύο ομάδων, 3.5), ή όσες δώσεις
     Β) τζάμπολ 50/50: ποιος ξεκινά
     Γ) κάθε φάση: επιθετικός ∝ φάσεις που τελειώνει ανά αγώνα (usage), αμυνόμενος ∝ λεπτά.
        Οι πιθανότητες «κοντράρονται» με log5: παίκτης (επίθεση) ⊗ άμυνα αντιπάλου, ως προς τη λίγκα.
          1. λάθος (μέρος του κλέψιμο, του αμυνόμενου) -> αλλάζει η κατοχή
          2. φάουλ σε σουτ -> 2 βολές (3 σε τρίποντο)
          3. σουτ 2π ή 3π -> τάπα (του αμυνόμενου) / εύστοχο (ίσως ασίστ, ίσως and-one) / άστοχο
          4. άστοχο -> ριμπάουντ: επιθετικό = η κατοχή συνεχίζει, αμυντικό = αλλάζει
     Δ) ισοπαλία -> παράταση με τις κατοχές 5 λεπτών
   Οι ευστοχίες και οι ρυθμοί του κάθε παίκτη συρρικνώνονται προς τη λίγκα ανάλογα με το δείγμα.
   ============================================================================= */
(function (root) {
  "use strict";
  const SIM = { version: 1 };
  const HCA = 0.07;            // πλεονέκτημα έδρας: log-odds στις ευστοχίες (~ +3 πόντοι)
  const PACE_SD = 3.5;
  const MAX_ROSTER = 12;
  SIM.SHOW_CV = 0.8;           // κατανομές με τυπική απόκλιση > 80% του μέσου δεν δείχνονται (πολύς θόρυβος)
  SIM.SHOW_MIN = 1;            // ούτε όσες έχουν μέσο < 1

  // ---------------------------------------------------------------- τυχαίοι αριθμοί (με seed)
  function rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const gauss = (R) => { let u = 0, v = 0; while (u === 0) u = R(); v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const log5 = (pa, pd, pl) => { if (!(pl > 0 && pl < 1)) return pa; const a = (pa * pd) / pl, b = ((1 - pa) * (1 - pd)) / (1 - pl); return a / (a + b); };
  const shrink = (made, att, mean, k) => (made + k * mean) / (att + k);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const logit = (p) => Math.log(p / (1 - p)), inv = (x) => 1 / (1 + Math.exp(-x));
  function pick(R, w, total) { let r = R() * total; for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; } return w.length - 1; }

  // ---------------------------------------------------------------- προετοιμασία: ρόστερ και πιθανότητες
  /** DB: η βάση του σάιτ (db/demo.json). opts: { out: [pid…] εκτός, pace: κατοχές ανά ομάδα } */
  SIM.prepare = function (DB, home, away, opts = {}) {
    const out = new Set(opts.out || []);
    const P = Object.values(DB.players);
    // μέσοι όροι λίγκας ανά φάση / λεπτό (από όλους τους παίκτες)
    const L = { plays: 0, tov: 0, ftrip: 0, fga: 0, fg3a: 0, min: 0, stl: 0, blk: 0, pf: 0 };
    for (const p of P) { const a = p.avg, g = p.gp || 0; if (!g) continue;
      const fga = a.fg2a + a.fg3a; L.plays += g * (fga + 0.44 * a.fta + a.tov); L.tov += g * a.tov; L.ftrip += g * 0.44 * a.fta;
      L.fga += g * fga; L.fg3a += g * a.fg3a; L.min += g * a.min; L.stl += g * a.stl; L.blk += g * a.blk; L.pf += g * a.pf; }
    const lg = { ...DB.lg, tovPlay: L.tov / L.plays, ftripPlay: L.ftrip / L.plays, three: L.fg3a / L.fga, stlMin: L.stl / L.min, blkMin: L.blk / L.min, pfMin: L.pf / L.min };
    const team = (code) => {
      // Διαθεσιμότητα: όποιος έπαιξε σε κάποιον από τους 3 τελευταίους αγώνες της ομάδας μετρά με τους μέσους όρους του
      // (λεπτά/φάσεις όταν παίζει)· όποιος λείπει πρόσφατα, με το 15% αυτών. Μετά όλα κανονικοποιούνται στα 200 λεπτά.
      const dates = [...new Set(P.flatMap((p) => p.log.filter((l) => l.team === code && l.min > 0).map((l) => l.date)))].sort();
      const since = dates[Math.max(0, dates.length - 3)] || "";
      const avail = (p) => p.log.some((l) => l.team === code && l.min > 0 && l.date >= since);
      const per = (p, x) => x * (avail(p) ? 1 : 0.15);
      const ros = P.filter((p) => p.team === code && p.gp > 0 && !out.has(p.pid)).sort((a, b) => per(b, b.avg.min) - per(a, a.avg.min)).slice(0, MAX_ROSTER);
      const totMin = ros.reduce((s, p) => s + per(p, p.avg.min), 0) || 1;
      const pl = ros.map((p) => { const a = p.avg, g = p.gp, fga = a.fg2a + a.fg3a, plays = fga + 0.44 * a.fta + a.tov;
        const T = (x) => x * g;                                         // σύνολα σεζόν
        return { pid: p.pid, name: p.name, num: p.number,
          minShare: per(p, a.min) / totMin,                             // κλάσμα των λεπτών της ομάδας
          wOff: Math.max(0.02, per(p, plays)), wDef: Math.max(0.2, per(p, a.min)),
          wOreb: Math.max(0.01, per(p, a.oreb)), wDreb: Math.max(0.02, per(p, a.dreb)), wAst: Math.max(0.01, per(p, a.ast)),
          tov: shrink(T(a.tov), T(plays), lg.tovPlay, 25),
          ftrip: shrink(T(0.44 * a.fta), T(plays), lg.ftripPlay, 25),
          three: shrink(T(a.fg3a), T(fga), lg.three, 15),
          fg2: shrink(T(a.fg2m), T(a.fg2a), lg.fg2, 30), fg3: shrink(T(a.fg3m), T(a.fg3a), lg.fg3, 50), ft: shrink(T(a.ftm), T(a.fta), lg.ft, 25),
          // αμυντικοί συντελεστές (1 = μέσος όρος), μισοί προς τον μέσο όρο
          stlF: 0.5 + 0.5 * (shrink(T(a.stl), T(a.min), lg.stlMin, 150) / lg.stlMin),
          blkF: 0.5 + 0.5 * (shrink(T(a.blk), T(a.min), lg.blkMin, 150) / lg.blkMin),
          pfF: 0.5 + 0.5 * (shrink(T(a.pf), T(a.min), lg.pfMin, 150) / lg.pfMin) };
      });
      const ts = DB.teamstats[code] || {};
      return { code, name: DB.teams[code]?.name || DB.opponents[code]?.name || code, pl, ts,
        wOffT: pl.reduce((s, p) => s + p.wOff, 0), wDefT: pl.reduce((s, p) => s + p.wDef, 0),
        wOrebT: pl.reduce((s, p) => s + p.wOreb, 0), wDrebT: pl.reduce((s, p) => s + p.wDreb, 0) };
    };
    const H = team(home), A = team(away);
    const pace = opts.pace || ((H.ts.pace || lg.pace) + (A.ts.pace || lg.pace)) / 2;
    return { lg, T: [H, A], pace, paceSd: opts.pace ? 0 : PACE_SD };
  };

  // ---------------------------------------------------------------- ένας αγώνας
  /** ctx από το prepare· R: τυχαίοι· log: αν δοθεί πίνακας, γεμίζει με το play-by-play. Επιστρέφει { s: [σκορ], box, ot } */
  SIM.game = function (ctx, R, log) {
    const { lg } = ctx, T = ctx.T;
    const box = T.map((t) => t.pl.map(() => new Int16Array(16)));        // βλ. SIM.COLS
    const s = [0, 0];
    const ev = log ? (o) => log.push({ ...o, s: [s[0], s[1]] }) : null;
    const names = (ti, i) => T[ti].pl[i].name;

    function possession(o, t, tEnd) {
      const O = T[o], D = T[1 - o], bo = box[o], bd = box[1 - o];
      const adj = o === 0 ? HCA : -HCA;
      let guard = 0;
      while (guard++ < 6) {                                              // όσο υπάρχουν επιθετικά ριμπάουντ
        const tt = t + (tEnd - t) * 0.9 * (1 - 0.5 ** guard);           // χρόνος της φάσης (πάντα μπροστά μέσα στην κατοχή)
        const tr = tt + (tEnd - tt) * 0.25;                               // χρόνος του ριμπάουντ
        const i = pick(R, O.pl.map((p) => p.wOff), O.wOffT), j = pick(R, D.pl.map((p) => p.wDef), D.wDefT);
        const p = O.pl[i], d = D.pl[j];
        // 1. λάθος
        const pT = log5(p.tov, clamp(lg.tovPlay * ((D.ts.opp_tov || lg.tov) / lg.tov), 0.05, 0.4), lg.tovPlay);
        if (R() < pT) {
          bo[i][11]++;
          const stl = R() < clamp(lg.stl_tov * d.stlF, 0, 0.9);
          if (stl) bd[j][12]++;
          ev && ev({ t: tt, team: o, type: "tov", pid: p.pid, pid2: stl ? d.pid : null, text: stl ? `Κλέψιμο ${names(1 - o, j)} από ${names(o, i)}` : `Λάθος ${names(o, i)}` });
          return;
        }
        // 2. φάουλ σε σουτ -> βολές
        const pF = log5(p.ftrip, clamp(lg.ftripPlay * ((D.ts.opp_ftr || lg.ftr) / lg.ftr) * d.pfF, 0.03, 0.4), lg.ftripPlay);
        let missedLast = false;
        if (R() < pF) {
          const n = R() < p.three * 0.15 ? 3 : 2;
          bd[j][14]++; bo[i][15]++;
          let made = 0;
          for (let k = 0; k < n; k++) { const m = R() < p.ft; bo[i][7]++; if (m) { bo[i][6]++; made++; } missedLast = !m; }
          s[o] += made; bo[i][0] += made;
          ev && ev({ t: tt, team: o, type: "ft", pid: p.pid, pid2: d.pid, pts: made, fta: n, text: `${names(o, i)} βολές ${made}/${n} (φάουλ ${names(1 - o, j)})` });
          if (!missedLast) return;
        } else {
          // 3. σουτ
          const three = R() < p.three;
          const blkP = three ? 0.012 * d.blkF : clamp(lg.blk_fg2a * d.blkF, 0, 0.25);
          if (three) bo[i][5]++; else bo[i][3]++;
          if (R() < blkP) {
            bd[j][13]++; bo[i][10]++;
            ev && ev({ t: tt, team: o, type: "blk", pid: p.pid, pid2: d.pid, three, text: `Τάπα ${names(1 - o, j)} σε ${names(o, i)}` });
          } else {
            const lgP = three ? lg.fg3 : lg.fg2;
            const defP = clamp(lgP * ((D.ts.opp_efg || lg.efg) / lg.efg), 0.15, 0.8);
            const base = (three ? p.fg3 : p.fg2) / (1 - (three ? 0.012 : lg.blk_fg2a));   // ευστοχία όταν δεν κόβεται
            const mk = inv(logit(clamp(log5(clamp(base, 0.05, 0.9), defP, lgP), 0.02, 0.97)) + adj);
            if (R() < mk) {
              const pts = three ? 3 : 2;
              s[o] += pts; bo[i][0] += pts; if (three) bo[i][4]++; else bo[i][2]++;
              let ast = null;
              if (O.pl.length > 1 && R() < lg.ast_fgm) {
                const w = O.pl.map((q, k) => (k === i ? 0 : q.wAst)); const a = pick(R, w, w.reduce((x, y) => x + y, 0));
                bo[a][9]++; ast = a;
              }
              let and1 = "", a1 = null;
              if (!three && R() < 0.05) { bo[i][7]++; bd[j][14]++; bo[i][15]++; a1 = 0; if (R() < p.ft) { bo[i][6]++; s[o]++; bo[i][0]++; a1 = 1; and1 = " + βολή (and-one)"; } else and1 = " (άστοχη η βολή του and-one)"; }
              ev && ev({ t: tt, team: o, type: three ? "3pm" : "2pm", pid: p.pid, pid2: ast != null ? O.pl[ast].pid : null, pts, and1: a1, fouler: a1 != null ? d.pid : null,
                text: `${names(o, i)} ${three ? "τρίποντο" : "δίποντο"} εύστοχο${ast != null ? ` (ασίστ ${names(o, ast)})` : ""}${and1}` });
              return;
            }
            ev && ev({ t: tt, team: o, type: three ? "3pa" : "2pa", pid: p.pid, text: `${names(o, i)} ${three ? "τρίποντο" : "δίποντο"} άστοχο` });
          }
        }
        // 4. ριμπάουντ (μετά από άστοχο σουτ, τάπα ή άστοχη τελευταία βολή)
        const orb = log5(O.ts.orb || lg.orb, 1 - (D.ts.drb || 1 - lg.orb), lg.orb) * (missedLast ? 0.55 : 1);
        if (R() < orb) {
          const r = pick(R, O.pl.map((q) => q.wOreb), O.wOrebT); bo[r][8]++;
          ev && ev({ t: tr, team: o, type: "oreb", pid: O.pl[r].pid, text: `Επιθετικό ριμπάουντ ${names(o, r)}` });
          continue;                                                       // η κατοχή συνεχίζει
        }
        const r = pick(R, D.pl.map((q) => q.wDreb), D.wDrebT); bd[r][1]++;
        ev && ev({ t: tr, team: 1 - o, type: "dreb", pid: D.pl[r].pid, text: `Αμυντικό ριμπάουντ ${names(1 - o, r)}` });
        return;
      }
    }

    // Α) κατοχές, Β) τζάμπολ
    const N = Math.max(50, Math.round(ctx.pace + (ctx.paceSd ? gauss(R) * ctx.paceSd : 0)));
    const first = R() < 0.5 ? 0 : 1;
    ev && ev({ t: 0, team: first, type: "tip", text: `Τζάμπολ: την κατοχή παίρνει ${T[first].name}` });
    const run = (n, t0, len) => {                                          // n κατοχές ανά ομάδα στο διάστημα [t0, t0+len]
      const slot = len / (2 * n);
      for (let k = 0; k < 2 * n; k++) { const o = (first + k) % 2; possession(o, t0 + k * slot, t0 + (k + 1) * slot); }
    };
    run(N, 0, 2400);
    let ot = 0;
    while (s[0] === s[1] && ot < 6) {                                     // Δ) παράταση
      ev && ev({ t: 2400 + ot * 300, team: null, type: "ot", text: `Ισοπαλία ${s[0]}-${s[1]}: παράταση ${ot + 1}` });
      run(Math.max(5, Math.round((ctx.pace * 5) / 40)), 2400 + ot * 300, 300); ot++;
    }
    ev && ev({ t: 2400 + ot * 300, team: null, type: "end", text: `Τέλος: ${T[0].name} ${s[0]} – ${s[1]} ${T[1].name}` });
    return { s, box, ot };
  };

  // στήλες του box (Int16Array): πόντοι, αμ.ριμπ, 2πμ, 2πα, 3πμ, 3πα, βολ.μ, βολ.α, επ.ριμπ, ασίστ, τάπες που δέχτηκε, λάθη, κλεψίματα, κοψίματα, φάουλ, φάουλ που κέρδισε
  SIM.COLS = ["pts", "dreb", "fg2m", "fg2a", "fg3m", "fg3a", "ftm", "fta", "oreb", "ast", "blka", "tov", "stl", "blk", "pf", "fd"];
  SIM.line = function (b, minutes) {
    const reb = b[1] + b[8];
    const pir = b[0] + reb + b[9] + b[12] + b[13] + b[15] - (b[3] - b[2] + b[5] - b[4]) - (b[7] - b[6]) - b[11] - b[10] - b[14];
    return { min: minutes, pts: b[0], reb, oreb: b[8], dreb: b[1], ast: b[9], stl: b[12], blk: b[13], tov: b[11], pf: b[14],
      fg2m: b[2], fg2a: b[3], fg3m: b[4], fg3a: b[5], ftm: b[6], fta: b[7], pir };
  };

  // ---------------------------------------------------------------- πολλοί αγώνες -> κατανομές
  SIM.many = function (ctx, n, seed = 1) {
    const R = rng(seed);
    const T = ctx.T, K = ["pts", "reb", "ast", "pir", "fg3m", "stl", "blk"];
    const store = T.map((t) => t.pl.map(() => K.map(() => new Int16Array(n))));
    const sc = [new Int16Array(n), new Int16Array(n)];
    let wins = 0, ots = 0;
    for (let g = 0; g < n; g++) {
      const r = SIM.game(ctx, R, null);
      sc[0][g] = r.s[0]; sc[1][g] = r.s[1];
      if (r.s[0] > r.s[1]) wins++;
      if (r.ot) ots++;
      for (let ti = 0; ti < 2; ti++) for (let i = 0; i < T[ti].pl.length; i++) {
        const l = SIM.line(r.box[ti][i], 0);
        for (let k = 0; k < K.length; k++) store[ti][i][k][g] = l[K[k]];
      }
    }
    // κατανομή -> ροπές (μέσος, διασπορά, τυπική απόκλιση, ασυμμετρία, κύρτωση), ποσοστημόρια για boxplot,
    // συντελεστής μεταβλητότητας και αν «αξίζει» να δειχτεί (όχι τεράστια διασπορά ως προς τον μέσο), προαιρετικά ιστόγραμμα
    const dist = (arr, lo, hi, opts = {}) => {
      const a = Float64Array.from(arr).sort(), m = a.reduce((x, y) => x + y, 0) / n;
      let m2 = 0, m3 = 0, m4 = 0;
      for (const v of a) { const d = v - m, d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
      m2 /= n; m3 /= n; m4 /= n;
      const sd = Math.sqrt(m2), q = (p) => a[Math.min(n - 1, Math.floor(p * n))];
      const cv = Math.abs(m) > 1e-9 ? sd / Math.abs(m) : Infinity;
      const o = { mean: +m.toFixed(2), var: +m2.toFixed(2), sd: +sd.toFixed(2), skew: +(sd ? m3 / sd ** 3 : 0).toFixed(3), kurt: +(sd ? m4 / m2 ** 2 - 3 : 0).toFixed(3),
        cv: Number.isFinite(cv) ? +cv.toFixed(3) : null, p5: q(0.05), p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), p95: q(0.95),
        show: opts.always ? true : Math.abs(m) >= SIM.SHOW_MIN && cv <= SIM.SHOW_CV };
      if (lo != null && opts.hist !== false) { const hist = []; for (let v = lo; v <= hi; v++) hist.push(0);
        for (const v of arr) hist[clamp(v, lo, hi) - lo]++; o.lo = lo; o.hist = hist.map((c) => +(c / n).toFixed(4)); }
      return o;
    };
    const margin = Int16Array.from(sc[0], (v, i) => v - sc[1][i]), total = Int16Array.from(sc[0], (v, i) => v + sc[1][i]);
    const atLeast = (arr, x) => +(arr.reduce((c, v) => c + (v >= x), 0) / n).toFixed(4);
    // χάντικαπ: «δίκαιη» γραμμή (διάμεσος της διαφοράς) και πιθανότητα κάλυψης του γηπεδούχου για μισές γραμμές γύρω της
    // (γραμμή −5.5 = ο γηπεδούχος καλύπτει αν κερδίσει με 6+)
    const hcap = (mg) => { const med = Float64Array.from(mg).sort()[Math.floor(n / 2)], c = Math.round(-med);
      const lines = []; for (let L = c - 8; L <= c + 8; L += 2) lines.push(L - 0.5);
      return { fair: -med, lines: lines.map((L) => [L, +(mg.reduce((k, v) => k + (v + L > 0), 0) / n).toFixed(4)]) }; };
    return {
      n, pace: +ctx.pace.toFixed(1), p_home: +(wins / n).toFixed(4), p_ot: +(ots / n).toFixed(4),
      score: [dist(sc[0], 40, 140), dist(sc[1], 40, 140)], margin: dist(margin, -45, 45, { always: true }), total: dist(total, 110, 230),
      hcap: hcap(margin),
      players: T.map((t, ti) => t.pl.map((p, i) => {
        const st = store[ti][i], o = { pid: p.pid, min: +(p.minShare * 200).toFixed(1) };
        K.forEach((k, j) => { o[k] = dist(st[j], k === "pir" ? -10 : 0, k === "pts" ? 45 : k === "pir" ? 50 : 20, { hist: k === "pts" || k === "reb" || k === "ast" || k === "pir" }); });
        o.p_pts10 = atLeast(st[0], 10); o.p_pts15 = atLeast(st[0], 15); o.p_pts20 = atLeast(st[0], 20);
        o.p_reb10 = atLeast(st[1], 10);
        let dd = 0; for (let g = 0; g < n; g++) dd += ((st[0][g] >= 10) + (st[1][g] >= 10) + (st[2][g] >= 10)) >= 2;
        o.p_dd = +(dd / n).toFixed(4);
        return o;
      })),
    };
  };

  SIM.rng = rng;
  if (typeof module !== "undefined" && module.exports) module.exports = SIM; else root.SIM = SIM;
})(typeof self !== "undefined" ? self : this);
