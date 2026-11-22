/* =============================================================================
   o-dimarxos v2 · Stoiximan GBL (demo: Άρης, ΠΑΟΚ)

   Μία βάση (db/demo.json, από scripts/build_demo.py) και σελίδες-πρότυπα, όλες συνδεδεμένες:
     #/                 αρχική: ομάδες, επόμενοι αγώνες, βαθμολογία, κορυφαίοι παίκτες
     #/standings        βαθμολογία
     #/teams            ομάδες          #/team/<κωδικός>     σελίδα ομάδας
     #/players          παίκτες         #/player/<κωδικός>   σελίδα παίκτη
     #/games            αγώνες          #/game/<κωδικός>     σελίδα αγώνα
   Κλικ σε όνομα παίκτη οπουδήποτε: pop-up με συνοπτικά, και από εκεί η σελίδα του.
   ============================================================================= */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (v) => v != null && v !== "" && Number.isFinite(+v);
const f1 = (v) => (isNum(v) ? (+v).toFixed(1) : "–");
const pct = (v) => (isNum(v) ? Math.round(100 * v) + "%" : "–");
const sgn = (v) => (isNum(v) ? (v > 0 ? "+" : "") + v : "–");
const MONTHS = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
const DAYS = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];
const dateGR = (d, withDay = false) => { if (!d) return ""; const x = new Date(d + "T12:00:00"); return `${withDay ? DAYS[x.getDay()] + " " : ""}${x.getDate()} ${MONTHS[x.getMonth()]}`; };
const age = (b) => (b ? Math.floor((Date.now() - Date.parse(b)) / 3.15576e10) : null);
const POS = { Guard: "Γκαρντ", Forward: "Φόργουορντ", Center: "Σέντερ" };
const LS = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* - */ } } };

let DB = null, SIMS = null;

// ----------------------------------------------------------------------------- βασικά εξαρτήματα
const team = (c) => DB.teams[c] || DB.opponents[c] || { code: c, name: c, abbr: "?", c1: "#888", fg: "#fff" };
const isDemo = (c) => !!DB.teams[c];
const badge = (c, s = 22) => { const t = team(c); return `<span class="badge" style="width:${s}px;height:${s}px;background:${t.c1};color:${t.fg};font-size:${Math.max(7, s * 0.34)}px" aria-hidden="true">${esc(String(t.abbr).slice(0, 4))}</span>`; };
const tlink = (c, s = 22) => isDemo(c) ? `<a class="team" href="#/team/${c}">${badge(c, s)}<span>${esc(team(c).name)}</span></a>`
  : `<span class="team out" title="Εκτός demo">${badge(c, s)}<span>${esc(team(c).name)}</span></span>`;
const pbtn = (pid) => { const p = DB.players[pid]; return p ? `<button class="plink" data-pop="${esc(pid)}">${esc(p.name)}</button>` : esc(pid); };
const initials = (n) => String(n).split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatar = (p, cls = "", size = null) => { const t = team(p.team);
  return `<span class="avatar ${cls}" style="background:${t.c1};color:${t.fg}${size ? `;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px` : ""}">${esc(initials(p.name))}${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}</span>`; };
const form = (arr) => `<span class="form">${(arr || []).map((r) => `<i class="${r}">${r === "W" ? "Ν" : "Η"}</i>`).join("")}</span>`;
const rec = (c) => { const s = DB.standings.find((x) => x.code === c); return s ? `${s.w}-${s.l}` : ""; };
const tile = (v, l) => `<div class="tile"><div class="v">${v}</div><div class="l">${l}</div></div>`;

// γραμμή αγώνα (λίστες): σκορ ή ώρα, πάντα σύνδεσμος στη σελίδα του αγώνα
function gameRow(g) {
  const hw = g.played && g.hs > g.as;
  return `<a class="game-row" href="#/game/${g.code}">
    <span class="d">${dateGR(g.date, true)}${g.time ? " · " + esc(g.time) : ""}<br>${g.round}η αγων.</span>
    <span class="h" style="${g.played && !hw ? "opacity:.65" : ""}">${esc(team(g.home).name)} ${badge(g.home, 20)}</span>
    <span class="sc">${g.played ? `${g.hs} – ${g.as}` : "vs"}</span>
    <span style="${g.played && hw ? "opacity:.65" : ""}">${badge(g.away, 20)} ${esc(team(g.away).name)}</span>
    <span class="go">›</span></a>`;
}
const gamesList = (list, empty = "Κανένας αγώνας.") => list.length ? `<div class="card" style="padding:0">${list.map(gameRow).join("")}</div>` : `<div class="empty">${empty}</div>`;
const demoGames = () => Object.values(DB.games).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

// πίνακας με ταξινόμηση (κλικ στην κεφαλίδα)
function table(id, cols, rows, sort) {
  const st = (table.state[id] ||= { key: sort, dir: -1 });
  const c = cols.find((x) => x.key === st.key);
  const R = c ? [...rows].sort((a, b) => { const va = c.sv ? c.sv(a) : a[c.key], vb = c.sv ? c.sv(b) : b[c.key];
    return (typeof va === "string" ? va.localeCompare(vb) : (va ?? -1e9) - (vb ?? -1e9)) * st.dir; }) : rows;
  return `<div class="tbl"><table data-tbl="${id}"><thead><tr>${cols.map((x) => `<th class="${x.n ? "n" : ""}" ${x.sortable === false ? "" : `data-sort="${x.key}" style="cursor:pointer"`}>${x.label}${st.key === x.key ? (st.dir < 0 ? " ↓" : " ↑") : ""}</th>`).join("")}</tr></thead>
    <tbody>${R.map((r) => `<tr class="${r._hl ? "hl" : ""}">${cols.map((x) => `<td class="${x.n ? "n" : ""}">${x.html ? x.html(r) : esc(r[x.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
table.state = {};

// ----------------------------------------------------------------------------- σελίδες
const Views = {};

Views.home = () => {
  const up = demoGames().filter((g) => !g.played).slice(0, 6);
  const last = demoGames().filter((g) => g.played).slice(-4).reverse();
  const top = Object.values(DB.players).filter((p) => isDemo(p.team) && p.gp >= 2).sort((a, b) => b.avg.pir - a.avg.pir).slice(0, 5);
  return `
  <section><div class="grid">${DB.demo.map(teamCard).join("")}</div></section>
  <section><div class="section-head"><h2>Επόμενοι αγώνες</h2><a href="#/games">όλοι οι αγώνες →</a></div>${gamesList(up, "Δεν υπάρχουν επόμενοι αγώνες.")}</section>
  <section class="grid">
    <div><div class="section-head"><h2>Βαθμολογία</h2><a href="#/standings">πλήρης →</a></div>${standingsTable(true)}</div>
    <div style="display:flex;flex-direction:column;gap:20px">
      <div><h2>Τελευταία αποτελέσματα</h2>${gamesList(last)}</div>
      <div><h2>Κορυφαίοι παίκτες (PIR)</h2><div class="card" style="padding:4px 0">${top.map((p, i) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 12px">
        <span class="muted num" style="width:16px">${i + 1}</span>${avatar(p, "", 32)}
        <span style="flex:1;min-width:0">${pbtn(p.pid)}<div class="muted" style="font-size:12px">${esc(team(p.team).name)}</div></span>
        <b class="num">${f1(p.avg.pir)}</b></div>`).join("")}</div></div>
    </div></section>`;
};

function teamCard(c) {
  const t = DB.teams[c], r = t.record, next = demoGames().find((g) => !g.played && (g.home === c || g.away === c));
  return `<a class="card" href="#/team/${c}" style="color:inherit;text-decoration:none;border-top:5px solid ${t.c1}">
    <div style="display:flex;align-items:center;gap:12px">${badge(c, 46)}<div><h2 style="margin:0">${esc(t.name)}</h2>
      <div class="muted">${r.pos}η θέση · ${r.w}-${r.l}</div></div><span style="margin-left:auto">${form(r.form)}</span></div>
    ${next ? `<div class="muted" style="margin-top:10px;font-size:13px">Επόμενος: ${next.home === c ? "vs" : "@"} <b style="color:var(--fg)">${esc(team(next.home === c ? next.away : next.home).name)}</b> · ${dateGR(next.date, true)}${next.time ? " " + next.time : ""}</div>` : ""}</a>`;
}

function standingsTable(compact = false) {
  const rows = DB.standings.map((s) => ({ ...s, diff: s.pf - s.pa, _hl: isDemo(s.code) }));
  const cols = [{ key: "pos", label: "#", n: true }, { key: "code", label: "Ομάδα", html: (r) => tlink(r.code, 20), sv: (r) => team(r.code).name },
    { key: "gp", label: "Αγ.", n: true }, { key: "w", label: "Ν", n: true }, { key: "l", label: "Η", n: true }];
  if (!compact) cols.push({ key: "pf", label: "Υπέρ", n: true }, { key: "pa", label: "Κατά", n: true },
    { key: "home", label: "Έδρα", n: true, html: (r) => `${r.hw}-${r.hl}`, sv: (r) => r.hw - r.hl }, { key: "away", label: "Εκτός", n: true, html: (r) => `${r.aw}-${r.al}`, sv: (r) => r.aw - r.al },
    { key: "form", label: "Φόρμα", sortable: false, html: (r) => form(r.form) });
  cols.push({ key: "diff", label: "Διαφ.", n: true, html: (r) => sgn(r.diff) });
  table.state["st" + compact] ||= { key: "pos", dir: 1 };
  return table("st" + compact, cols, rows, "pos");
}

Views.standings = () => `<section><h2>Βαθμολογία ${esc(DB.league)}</h2>${standingsTable(false)}
  <p class="muted" style="font-size:13px">Με μπλε οι ομάδες του demo (πάτα για τη σελίδα τους). Ισοβαθμίες με τη διαφορά πόντων.</p></section>`;

Views.teams = () => `<section><h2>Ομάδες</h2><div class="grid">${DB.demo.map(teamCard).join("")}</div>
  <p class="muted" style="font-size:13px">Demo με δύο ομάδες. Οι υπόλοιπες εμφανίζονται ως αντίπαλοι.</p></section>`;

Views.team = (c) => {
  const t = DB.teams[c];
  if (!t) return `<div class="empty">Η ομάδα δεν είναι στο demo. <a href="#/teams">Ομάδες →</a></div>`;
  const r = t.record, roster = t.roster.map((pid) => DB.players[pid]);
  const G = t.games.map((g) => DB.games[g]).sort((a, b) => a.date.localeCompare(b.date));
  const played = G.filter((g) => g.played).reverse(), up = G.filter((g) => !g.played);
  const ppg = r.gp ? r.pf / r.gp : null, oppg = r.gp ? r.pa / r.gp : null;
  return `<section class="team-hero" style="background:${t.c1};color:${t.fg}"><span style="border-radius:50%;box-shadow:0 0 0 3px ${t.fg}">${badge(c, 64)}</span><div><h1>${esc(t.name)}</h1>
      <div style="opacity:.85">${esc(DB.league)} · ${r.pos}η θέση · ${r.w} νίκες, ${r.l} ήττες</div></div>
      <span style="margin-left:auto">${form(r.form)}</span></section>
    <section class="tiles">${tile(`${r.w}-${r.l}`, "ρεκόρ")}${tile(`${r.hw}-${r.hl}`, "στην έδρα")}${tile(`${r.aw}-${r.al}`, "εκτός")}
      ${tile(f1(ppg), "πόντοι/αγ.")}${tile(f1(oppg), "δέχεται/αγ.")}${tile(sgn(r.pf - r.pa), "διαφορά")}</section>
    <section><h2>Ρόστερ</h2>${table("ro" + c, [
      { key: "number", label: "#", n: true, sv: (p) => +p.number || 99, html: (p) => esc(p.number ?? "") },
      { key: "name", label: "Παίκτης", html: (p) => `${pbtn(p.pid)} <a href="#/player/${p.pid}" class="muted" title="Σελίδα παίκτη" style="font-size:12px">↗</a>`, sv: (p) => p.name },
      { key: "pos", label: "Θέση", html: (p) => esc(POS[p.pos] || p.pos || "") },
      { key: "height", label: "Ύψος", n: true, html: (p) => (p.height ? p.height : "") },
      { key: "gp", label: "Αγ.", n: true }, { key: "min", label: "Λεπτά", n: true, sv: (p) => p.avg.min, html: (p) => f1(p.avg.min) },
      { key: "pts", label: "Πόντοι", n: true, sv: (p) => p.avg.pts, html: (p) => f1(p.avg.pts) }, { key: "reb", label: "Ριμπ.", n: true, sv: (p) => p.avg.reb, html: (p) => f1(p.avg.reb) },
      { key: "ast", label: "Ασίστ", n: true, sv: (p) => p.avg.ast, html: (p) => f1(p.avg.ast) }, { key: "pir", label: "PIR", n: true, sv: (p) => p.avg.pir, html: (p) => `<b>${f1(p.avg.pir)}</b>` }],
      roster, "min")}</section>
    <section class="grid"><div><h2>Αποτελέσματα</h2>${gamesList(played)}</div><div><h2>Επόμενοι αγώνες</h2>${gamesList(up.slice(0, 8))}</div></section>`;
};

Views.players = () => {
  const ui = Views.players.ui ||= { team: "", q: "" };
  const all = Object.values(DB.players).filter((p) => isDemo(p.team) && (!ui.team || p.team === ui.team) && (!ui.q || p.name.toLowerCase().includes(ui.q.toLowerCase())));
  return `<section><div class="section-head"><h2>Παίκτες</h2>
    <div class="filters"><label>Ομάδα<select id="f-team"><option value="">Όλες</option>${DB.demo.map((c) => `<option value="${c}" ${ui.team === c ? "selected" : ""}>${esc(team(c).name)}</option>`).join("")}</select></label>
      <label>Αναζήτηση<input id="f-q" value="${esc(ui.q)}" placeholder="όνομα"></label></div></div>
    ${table("pl", [{ key: "name", label: "Παίκτης", html: (p) => `${pbtn(p.pid)} <a href="#/player/${p.pid}" class="muted" title="Σελίδα παίκτη" style="font-size:12px">↗</a>`, sv: (p) => p.name },
      { key: "team", label: "Ομάδα", html: (p) => tlink(p.team, 18), sv: (p) => team(p.team).name },
      { key: "gp", label: "Αγ.", n: true }, { key: "min", label: "Λεπτά", n: true, sv: (p) => p.avg.min, html: (p) => f1(p.avg.min) },
      { key: "pts", label: "Πόντοι", n: true, sv: (p) => p.avg.pts, html: (p) => f1(p.avg.pts) }, { key: "reb", label: "Ριμπ.", n: true, sv: (p) => p.avg.reb, html: (p) => f1(p.avg.reb) },
      { key: "ast", label: "Ασίστ", n: true, sv: (p) => p.avg.ast, html: (p) => f1(p.avg.ast) }, { key: "fg3", label: "3π%", n: true, sv: (p) => p.pct.fg3 ?? -1, html: (p) => pct(p.pct.fg3) },
      { key: "pir", label: "PIR", n: true, sv: (p) => p.avg.pir, html: (p) => `<b>${f1(p.avg.pir)}</b>` }], all, "pir")}
    <p class="muted" style="font-size:13px">Μέσοι όροι ανά αγώνα. Πάτα ένα όνομα για σύνοψη, ή το ↗ για τη σελίδα του παίκτη.</p></section>`;
};
Views.players.bind = (el) => {
  $("#f-team", el)?.addEventListener("change", (e) => { Views.players.ui.team = e.target.value; render(); });
  $("#f-q", el)?.addEventListener("input", (e) => { Views.players.ui.q = e.target.value; const pos = e.target.selectionStart; render(); const i = $("#f-q"); i.focus(); i.setSelectionRange(pos, pos); });
};

Views.player = (pid) => {
  const p = DB.players[pid];
  if (!p) return `<div class="empty">Ο παίκτης δεν βρέθηκε. <a href="#/players">Παίκτες →</a></div>`;
  const a = p.avg, log = [...p.log].reverse();
  const facts = [["Ομάδα", tlink(p.team, 18)], ["Θέση", esc(POS[p.pos] || p.pos || "")], ["Ηλικία", age(p.birth)], ["Ύψος", p.height ? p.height + " cm" : ""],
    ["Βάρος", p.weight ? p.weight + " kg" : ""], ["Χώρα", esc(p.country || "")]].filter(([, v]) => v != null && v !== "");
  return `<section class="player-hero">${avatar(p, "xl")}<div style="min-width:0"><div class="muted">${p.number ? "#" + esc(p.number) + " · " : ""}${esc(DB.league)}</div>
      <h1>${esc(p.name)}</h1><div class="facts">${facts.map(([k, v]) => `<span>${k}: <b>${v}</b></span>`).join("")}</div></div></section>
    <section><h2>Μέσοι όροι (${p.gp} αγ.)</h2><div class="tiles">${tile(f1(a.min), "λεπτά")}${tile(f1(a.pts), "πόντοι")}${tile(f1(a.reb), "ριμπάουντ")}
      ${tile(f1(a.ast), "ασίστ")}${tile(f1(a.stl), "κλεψίματα")}${tile(f1(a.blk), "κοψίματα")}${tile(f1(a.tov), "λάθη")}${tile(`<b>${f1(a.pir)}</b>`, "PIR")}</div></section>
    <section class="grid">
      <div class="card"><h3>Σουτ</h3><div class="tiles">${tile(pct(p.pct.fg2), `2π (${f1(a.fg2m)}/${f1(a.fg2a)})`)}${tile(pct(p.pct.fg3), `3π (${f1(a.fg3m)}/${f1(a.fg3a)})`)}${tile(pct(p.pct.ft), `βολές (${f1(a.ftm)}/${f1(a.fta)})`)}</div></div>
      <div class="card"><h3>Πόντοι ανά αγώνα</h3>${spark(p.log)}</div></section>
    ${nextDist(pid, false)}
    <section><h2>Αγώνας-αγώνας</h2>${log.length ? `<div class="tbl"><table><thead><tr><th>Ημ/νία</th><th>Αντίπαλος</th><th>Αποτ.</th><th class="n">Λεπ.</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">Κλ</th><th class="n">Κοψ</th><th class="n">Λάθ</th><th class="n">2π</th><th class="n">3π</th><th class="n">Βολ</th><th class="n">PIR</th></tr></thead><tbody>
      ${log.map((g) => `<tr><td><a href="#/game/${g.g}">${dateGR(g.date)}</a></td><td>${g.home ? "vs" : "@"} ${tlink(g.opp, 18)}</td>
        <td><a href="#/game/${g.g}" style="color:var(--${g.res === "W" ? "good" : "bad"});font-weight:700">${g.res === "W" ? "Ν" : g.res === "L" ? "Η" : ""} ${esc(g.score || "")}</a></td>
        ${g.min > 0 ? `<td class="n">${f1(g.min)}</td><td class="n"><b>${g.pts}</b></td><td class="n">${g.reb}</td><td class="n">${g.ast}</td><td class="n">${g.stl}</td><td class="n">${g.blk}</td><td class="n">${g.tov}</td>
        <td class="n">${g.fg2m}/${g.fg2a}</td><td class="n">${g.fg3m}/${g.fg3a}</td><td class="n">${g.ftm}/${g.fta}</td><td class="n"><b>${g.pir}</b></td>` : `<td colspan="11" class="muted">δεν αγωνίστηκε</td>`}</tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">Χωρίς αγώνες.</div>`}</section>`;
};

// μικρό διάγραμμα: πόντοι ανά αγώνα
function spark(log) {
  const L = log.filter((g) => g.min > 0);
  if (!L.length) return `<div class="muted">–</div>`;
  const W = 420, H = 120, n = L.length, bw = Math.min(34, (W - 10) / n - 4), mx = Math.max(...L.map((g) => g.pts), 10);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Πόντοι ανά αγώνα">
    ${L.map((g, i) => { const x = 5 + i * ((W - 10) / n), h = (g.pts / mx) * (H - 34);
      return `<a href="#/game/${g.g}"><rect x="${x}" y="${H - 18 - h}" width="${bw}" height="${Math.max(1, h)}" rx="2" style="${g.res === "L" ? "opacity:.55" : ""}"><title>${dateGR(g.date)} ${g.home ? "vs" : "@"} ${team(g.opp).name}: ${g.pts} πόντοι</title></rect>
        <text x="${x + bw / 2}" y="${H - 22 - h}" text-anchor="middle">${g.pts}</text><text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${esc(team(g.opp).abbr).slice(0, 3)}</text></a>`; }).join("")}</svg>`;
}

Views.games = () => {
  const G = demoGames(), up = G.filter((g) => !g.played), pl = G.filter((g) => g.played).reverse();
  const byRound = {};
  for (const g of up) (byRound[g.round] ||= []).push(g);
  return `<section><h2>Επόμενοι αγώνες</h2>${Object.keys(byRound).length ? Object.entries(byRound).slice(0, 4).map(([r, L]) => `<h3 class="muted" style="margin:12px 0 6px">${r}η αγωνιστική</h3>${gamesList(L)}`).join("") : `<div class="empty">Κανένας.</div>`}</section>
    <section><h2>Αποτελέσματα</h2>${gamesList(pl)}</section>`;
};

Views.game = (code) => {
  const g = DB.games[code];
  if (!g) return `<div class="empty">Ο αγώνας δεν βρέθηκε. <a href="#/games">Αγώνες →</a></div>`;
  const side = (c) => `<div class="side">${isDemo(c) ? `<a href="#/team/${c}">${badge(c, 56)}</a>` : badge(c, 56)}
    <b>${isDemo(c) ? `<a href="#/team/${c}">${esc(team(c).name)}</a>` : esc(team(c).name)}</b><span class="muted">${rec(c)}</span></div>`;
  const head = `<section class="card"><div class="muted" style="text-align:center;margin-bottom:8px">${g.round}η αγωνιστική · ${dateGR(g.date, true)}${g.time ? " · " + esc(g.time) : ""}</div>
    <div class="matchup">${side(g.home)}<div><div class="score">${g.played ? `${g.hs} – ${g.as}` : "vs"}</div><div class="muted">${g.played ? "Τελικό" : "Επερχόμενος"}</div></div>${side(g.away)}</div>
    ${!g.played && g.model ? `<div style="margin-top:14px"><div class="bar2"><i style="width:${100 * g.model.p_home}%;background:${team(g.home).c1}"></i><i style="width:${100 * (1 - g.model.p_home)}%;background:${team(g.away).c1}"></i></div>
      <div class="muted" style="display:flex;justify-content:space-between;font-size:13px;margin-top:4px"><span>${pct(g.model.p_home)}</span><span>μοντέλο · αναμενόμενη διαφορά ${f1(Math.abs(g.model.line))} · σύνολο ${Math.round(g.model.total)}</span><span>${pct(1 - g.model.p_home)}</span></div></div>` : ""}
    </section><section class="card" id="live" data-game="${g.code}"></section>${simSection(g.code)}`;
  if (g.played) {
    const box = (c) => { const R = g.box?.[c] || []; const tot = R.reduce((s, r) => ({ pts: s.pts + r.pts, reb: s.reb + r.reb, ast: s.ast + r.ast }), { pts: 0, reb: 0, ast: 0 });
      return `<div><h3>${tlink(c, 20)}</h3>${R.length ? `<div class="tbl"><table><thead><tr><th>Παίκτης</th><th class="n">Λεπ.</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">2π</th><th class="n">3π</th><th class="n">Βολ</th><th class="n">PIR</th></tr></thead><tbody>
        ${R.map((r) => `<tr><td>${pbtn(r.pid)}</td>${r.min > 0 ? `<td class="n">${f1(r.min)}</td><td class="n"><b>${r.pts}</b></td><td class="n">${r.reb}</td><td class="n">${r.ast}</td><td class="n">${r.fg2m}/${r.fg2a}</td><td class="n">${r.fg3m}/${r.fg3a}</td><td class="n">${r.ftm}/${r.fta}</td><td class="n">${r.pir}</td>` : `<td colspan="8" class="muted">δεν αγωνίστηκε</td>`}</tr>`).join("")}
        <tr><td><b>Σύνολο</b></td><td></td><td class="n"><b>${tot.pts}</b></td><td class="n">${tot.reb}</td><td class="n">${tot.ast}</td><td colspan="4"></td></tr></tbody></table></div>` : `<div class="empty">Χωρίς box score.</div>`}</div>`; };
    return head + `<section><h2>Box score</h2><div style="display:flex;flex-direction:column;gap:18px">${box(g.home)}${box(g.away)}</div></section>`;
  }
  // επερχόμενος: πιθανά ρόστερ (με σειρά λεπτών) και προηγούμενη συνάντηση
  const roster = (c) => { const L = (DB.teams[c]?.roster || Object.values(DB.players).filter((p) => p.team === c).sort((a, b) => b.avg.min - a.avg.min).map((p) => p.pid)).slice(0, 9).map((pid) => DB.players[pid]);
    return `<div class="card"><h3>${tlink(c, 20)}</h3>${L.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Παίκτης</th><th class="n">Λεπ.</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">PIR</th></tr></thead><tbody>
      ${L.map((p) => `<tr><td>${pbtn(p.pid)}</td><td class="n">${f1(p.avg.min)}</td><td class="n">${f1(p.avg.pts)}</td><td class="n">${f1(p.avg.reb)}</td><td class="n">${f1(p.avg.ast)}</td><td class="n"><b>${f1(p.avg.pir)}</b></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="muted">Δεν υπάρχουν στοιχεία για τους παίκτες (εκτός demo).</div>`}</div>`; };
  const h2h = demoGames().filter((x) => x.played && [x.home, x.away].sort().join() === [g.home, g.away].sort().join());
  return head + `<section><h2>Ρόστερ (με σειρά λεπτών)</h2><div class="grid">${roster(g.home)}${roster(g.away)}</div></section>
    ${h2h.length ? `<section><h2>Φετινές συναντήσεις</h2>${gamesList(h2h)}</section>` : ""}`;
};

// ============================================================================= προσομοιώσεις
// ιστόγραμμα από κατανομή {lo, hist[]}: μπάρες, με τη διάμεσο τονισμένη
function histo(d, { W = 520, H = 120, label = (v) => v, color = "var(--accent)", mark = null } = {}) {
  if (!d) return "";
  const n = d.hist.length, mx = Math.max(...d.hist, 1e-9), bw = (W - 20) / n;
  let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img">`;
  d.hist.forEach((v, i) => { const x = 10 + i * bw, h = (v / mx) * (H - 26), val = d.lo + i;
    s += `<rect x="${x.toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${mark != null && (mark(val)) ? color : "var(--line)"}" ${mark ? "" : `style="fill:${color};opacity:${val >= d.p25 && val <= d.p75 ? 1 : 0.45}"`}><title>${label(val)}: ${(100 * v).toFixed(1)}%</title></rect>`; });
  const tick = (v) => { const x = 10 + (v - d.lo + 0.5) * bw; return `<text x="${x.toFixed(1)}" y="${H - 4}" text-anchor="middle" style="fill:var(--muted);font:10px var(--font-num)">${label(v)}</text>`; };
  [d.p10, d.p50, d.p90].forEach((v) => (s += tick(v)));
  return s + "</svg>";
}
const rangeTxt = (d) => `${d.p10}–${d.p90}`;
function simFor(pid) {                                   // ο επόμενος προσομοιωμένος αγώνας του παίκτη
  if (!SIMS) return null;
  const G = Object.entries(SIMS.games).sort((a, b) => a[1].date.localeCompare(b[1].date));
  for (const [code, g] of G) for (const side of [0, 1]) { const p = g.players[side].find((x) => x.pid === pid); if (p) return { code, g, p, side }; }
  return null;
}
function nextDist(pid, compact) {
  const r = simFor(pid); if (!r) return "";
  const { g, p, code } = r, opp = r.side === 0 ? g.away : g.home;
  const head = `${r.side === 0 ? "vs" : "@"} ${esc(team(opp).name)} · ${dateGR(g.date, true)}`;
  const probs = `<div class="tiles">${tile(f1(p.pts.mean), `πόντοι (${rangeTxt(p.pts)})`)}${tile(pct(p.p_pts10), "10+ πόντοι")}${tile(pct(p.p_pts20), "20+ πόντοι")}${tile(f1(p.reb.mean), `ριμπ. (${rangeTxt(p.reb)})`)}${tile(f1(p.pir.mean), `PIR (${rangeTxt(p.pir)})`)}${tile(pct(p.p_dd), "double-double")}</div>`;
  if (compact) return `<div class="card" style="padding:10px 12px"><div style="font-size:13px"><b>Επόμενος αγώνας</b> <span class="muted">${head} · ${SIMS.n.toLocaleString("el-GR")} προσομοιώσεις</span></div>
    ${histo(p.pts, { H: 80, label: (v) => v })}<div class="muted" style="font-size:12px">Πόντοι: μέσος ${f1(p.pts.mean)}, 80% των αγώνων ${rangeTxt(p.pts)} · 20+: ${pct(p.p_pts20)}</div>
    <a href="#/game/${code}" data-close style="font-size:13px">Όλη η προσομοίωση →</a></div>`;
  return `<section><div class="section-head"><h2>Επόμενος αγώνας: κατανομή απόδοσης</h2><a href="#/game/${code}">${head} →</a></div>
    <div class="grid"><div class="card"><h3>Πόντοι</h3>${histo(p.pts)}<div class="muted" style="font-size:12px">Οι πιο σκούρες μπάρες: το μεσαίο 50% των ${SIMS.n.toLocaleString("el-GR")} αγώνων. Κάτω: 10%, διάμεσος, 90%.</div></div>
    <div class="card"><h3>Ριμπάουντ, ασίστ, PIR</h3>
      ${[["Ριμπάουντ", p.reb, "var(--accent)"], ["Ασίστ", p.ast, "var(--c2)"], ["PIR", p.pir, "var(--c3)"]].map(([l, d, c]) => `<div class="muted" style="font-size:12px;margin-top:4px">${l}: μέσος ${f1(d.mean)} · 80% ${rangeTxt(d)}</div>${histo(d, { H: 60, color: c })}`).join("")}</div></div>
    ${probs}</section>`;
}

function simSection(code) {
  const S = SIMS?.games?.[code]; if (!S) return "";
  const g = DB.games[code], H = team(g.home), A = team(g.away);
  const tbl = (side, c) => `<div><h3>${tlink(c, 20)}</h3><div class="tbl"><table><thead><tr><th>Παίκτης</th><th class="n">Λεπ.</th><th class="n">Πόντοι</th><th class="n">80%</th><th>κατανομή πόντων</th><th class="n">Ριμπ.</th><th class="n">Ασίστ</th><th class="n">PIR</th><th class="n">10+</th><th class="n">20+</th><th class="n">DD</th></tr></thead><tbody>
    ${S.players[side].map((p) => `<tr><td>${pbtn(p.pid)}</td><td class="n">${f1(p.min)}</td><td class="n"><b>${f1(p.pts.mean)}</b></td><td class="n muted">${rangeTxt(p.pts)}</td>
      <td style="width:140px;padding-block:2px">${histo({ ...p.pts, hist: p.pts.hist.slice(0, 31) }, { W: 140, H: 30, label: () => "" })}</td>
      <td class="n">${f1(p.reb.mean)}</td><td class="n">${f1(p.ast.mean)}</td><td class="n">${f1(p.pir.mean)}</td><td class="n">${pct(p.p_pts10)}</td><td class="n">${pct(p.p_pts20)}</td><td class="n">${pct(p.p_dd)}</td></tr>`).join("")}</tbody></table></div></div>`;
  return `<section><div class="section-head"><h2>${S.n.toLocaleString("el-GR")} προσομοιώσεις</h2><span class="muted" style="font-size:12px">ενημέρωση ${esc(SIMS.generated)} · <a href="#/sims">πώς δουλεύει</a></span></div>
    <div class="card"><div class="bar2" style="height:14px"><i style="width:${100 * S.p_home}%;background:${H.c1}"></i><i style="width:${100 * (1 - S.p_home)}%;background:${A.c1}"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px"><b>${esc(H.name)} ${pct(S.p_home)}</b><span class="muted">παράταση ${pct(S.p_ot)} · ρυθμός ${S.pace} κατοχές</span><b>${pct(1 - S.p_home)} ${esc(A.name)}</b></div></div>
    <div class="tiles" style="margin-top:10px">${tile(`${Math.round(S.score[0].mean)}–${Math.round(S.score[1].mean)}`, "μέσο σκορ")}${tile(rangeTxt(S.score[0]), `${esc(H.abbr)}: 80% των αγώνων`)}${tile(rangeTxt(S.score[1]), `${esc(A.abbr)}: 80% των αγώνων`)}
      ${tile(sgn(Math.round(S.margin.mean)), "μέση διαφορά (γηπ.)")}${tile(Math.round(S.total.mean), `σύνολο (${rangeTxt(S.total)})`)}</div>
    <div class="grid" style="margin-top:10px"><div class="card"><h3>Διαφορά πόντων (γηπεδούχος − φιλοξενούμενος)</h3>${histo(S.margin, { label: (v) => (v > 0 ? "+" : "") + v, color: H.c1, mark: (v) => v > 0 })}
        <div class="muted" style="font-size:12px">Χρωματιστές οι νίκες του γηπεδούχου.</div></div>
      <div class="card"><h3>Σύνολο πόντων</h3>${histo(S.total, { color: "var(--c3)" })}</div></div>
    <h3 style="margin-top:14px">Κατανομές απόδοσης παικτών</h3>
    <div style="display:flex;flex-direction:column;gap:14px">${tbl(0, g.home)}${tbl(1, g.away)}</div>
    <p class="muted" style="font-size:12px">«80%»: το 80% των προσομοιωμένων αγώνων πέφτει σε αυτό το διάστημα. 10+/20+: πιθανότητα για τόσους πόντους. DD: double-double.</p></section>`;
}

Views.sims = () => {
  const G = SIMS ? Object.entries(SIMS.games).sort((a, b) => a[1].date.localeCompare(b[1].date)) : [];
  const C = SIMS?.check;
  return `<section><h2>Προσομοιώσεις</h2>
    ${G.length ? `<div class="card" style="padding:0">${G.map(([code, S]) => { const g = DB.games[code];
      return `<a class="game-row" href="#/game/${code}"><span class="d">${dateGR(S.date, true)}<br>${S.n.toLocaleString("el-GR")} αγώνες</span>
        <span class="h">${esc(team(S.home).name)} ${badge(S.home, 20)} <b class="num">${pct(S.p_home)}</b></span><span class="sc">${Math.round(S.score[0].mean)} – ${Math.round(S.score[1].mean)}</span>
        <span><b class="num">${pct(1 - S.p_home)}</b> ${badge(S.away, 20)} ${esc(team(S.away).name)}</span><span class="go">›</span></a>`; }).join("")}</div>`
      : `<div class="empty">Δεν υπάρχουν ακόμα προσομοιώσεις.</div>`}
  </section>
  <section class="card"><h2>Πώς δουλεύει</h2>
    <p style="margin:0 0 8px;max-width:80ch">Μοντέλο κατοχής (αλυσίδα Markov) και Monte Carlo: κάθε αγώνας «παίζεται» φάση-φάση, με τα ζάρια να ρίχνονται από τα στατιστικά των παικτών, και επαναλαμβάνεται ${SIMS ? SIMS.n.toLocaleString("el-GR") : "50.000"} φορές.</p>
    <ol style="margin:0;max-width:80ch">
      <li><b>Κατοχές:</b> από τον μέσο ρυθμό των δύο ομάδων (± 3.5). <b>Τζάμπολ:</b> 50/50.</li>
      <li><b>Ποιος παίζει τη φάση:</b> επιθετικός ανάλογα με τις φάσεις που τελειώνει ανά αγώνα (σουτ, βολές, λάθη), αμυνόμενος ανάλογα με τα λεπτά. Όσοι δεν έπαιξαν στους 3 τελευταίους αγώνες μετρούν ελάχιστα.</li>
      <li><b>Κοντράρισμα (log5):</b> η πιθανότητα του επιθετικού συνδυάζεται με την άμυνα του αντιπάλου, ως προς τον μέσο όρο της λίγκας. Η άμυνα της ομάδας επηρεάζει ευστοχία, λάθη, φάουλ· ο αμυνόμενος παίκτης κλεψίματα, τάπες, φάουλ.</li>
      <li><b>Φάση:</b> λάθος (ίσως κλέψιμο) → αλλάζει η κατοχή · φάουλ → βολές · σουτ 2π/3π → τάπα / εύστοχο (ίσως ασίστ, and-one) / άστοχο → ριμπάουντ (επιθετικό: η κατοχή συνεχίζει).</li>
      <li><b>Παράταση:</b> με τις κατοχές 5 λεπτών, όσο υπάρχει ισοπαλία. <b>Έδρα:</b> μικρή ώθηση στις ευστοχίες του γηπεδούχου.</li>
    </ol>
    ${C ? `<h3 style="margin-top:14px">Έλεγχος σε ${C.games} παιγμένους αγώνες (${C.sims_each.toLocaleString("el-GR")} προσομοιώσεις ο καθένας)</h3>
      <div class="tiles">${tile(pct(C.acc), "σωστός νικητής")}${tile(C.brier.toFixed(3), `Brier (απλό «κερδίζει ο γηπεδούχος»: ${C.brier_home_rate.toFixed(3)})`)}${tile("±" + C.mae_margin, "σφάλμα στη διαφορά")}${tile(`${C.avg_total_pred} / ${C.avg_total_real}`, "μέσο σύνολο: πρόβλεψη / πραγματικό")}</div>
      <p class="muted" style="font-size:12px">Προσοχή: τα στατιστικά της σεζόν περιέχουν και αυτούς τους αγώνες, άρα ο έλεγχος είναι «μέσα στο δείγμα» και ελαφρά αισιόδοξος.</p>` : ""}
    <p class="muted" style="font-size:12px;margin-bottom:0">Απλοποιήσεις: χωρίς ρολόι και πεντάδες, οι παίκτες θεωρούνται ανεξάρτητοι, χωρίς αποβολές με 5 φάουλ και απουσίες. Ποσοστά από μικρό δείγμα τραβιούνται προς τον μέσο όρο της λίγκας, γι' αυτό οι πρωταγωνιστές βγαίνουν λίγο πιο «συντηρητικοί» από τους μέσους όρους τους.</p></section>`;
};

// ----------------------------------------------------------------------------- ζωντανός αγώνας (play-by-play)
const Live = {
  stop: null,
  mount(el, g) {
    if (!g || !window.SIM) { el.remove(); return; }
    const H = team(g.home), A = team(g.away);
    let ctx;
    try { ctx = SIM.prepare(DB, g.home, g.away); } catch (e) { el.innerHTML = `<div class="muted">Δεν γίνεται προσομοίωση: ${esc(e.message)}</div>`; return; }
    if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) { el.innerHTML = `<div class="muted">Δεν υπάρχουν αρκετοί παίκτες για προσομοίωση.</div>`; return; }
    const SPEEDS = [["×10", 10], ["×60", 60], ["×240", 240], ["άμεσα", 1e9]];
    let speed = 60, log = [], idx = 0, clock = 0, raf = 0, last = 0, running = false, box = {};
    el.innerHTML = `<div class="section-head"><h2 style="margin:0">Ζωντανή προσομοίωση</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap" id="lv-ctl"><button class="btn primary" id="lv-go">▶ Παίξε έναν αγώνα</button>
          ${SPEEDS.map(([l, v]) => `<button class="btn" data-sp="${v}" style="${v === speed ? "border-color:var(--accent)" : ""}">${l}</button>`).join("")}</div></div>
      <div class="muted" style="font-size:12px;margin:4px 0 10px">Ένας τυχαίος αγώνας με την ίδια μηχανή που τρέχει τις ${SIMS ? SIMS.n.toLocaleString("el-GR") : ""} προσομοιώσεις. Κάθε φορά βγαίνει διαφορετικός.</div>
      <div class="matchup" style="margin-bottom:8px"><div class="side">${badge(g.home, 36)}<b>${esc(H.name)}</b></div>
        <div><div class="score" id="lv-sc">0 – 0</div><div class="muted" id="lv-clk">–</div></div><div class="side">${badge(g.away, 36)}<b>${esc(A.name)}</b></div></div>
      <svg id="lv-mg" viewBox="0 0 600 90" style="width:100%;height:auto;display:block"></svg>
      <div class="grid" style="margin-top:10px"><div><h3>Play-by-play</h3><div id="lv-feed" style="max-height:340px;overflow:auto;font-size:13px" class="tbl"></div></div>
        <div><h3>Box score</h3><div id="lv-box"></div></div></div>`;
    const fmtClock = (t) => { const ot = t >= 2400, q = ot ? Math.floor((t - 2400) / 300) : Math.min(3, Math.floor(t / 600)), qlen = ot ? 300 : 600, base = ot ? 2400 + q * 300 : q * 600;
      const left = Math.max(0, qlen - (t - base)); return `${ot ? "Παράταση " + (q + 1) : q + 1 + "η περίοδος"} · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")}`; };
    const add = (pid, k, v = 1) => { const b = (box[pid] ||= { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, f3m: 0, f3a: 0, ftm: 0, fta: 0 }); b[k] += v; };
    const apply = (e) => {
      if (e.type === "2pm" || e.type === "3pm") { add(e.pid, "pts", e.pts + (e.and1 || 0)); add(e.pid, "fgm"); add(e.pid, "fga"); if (e.type === "3pm") { add(e.pid, "f3m"); add(e.pid, "f3a"); }
        if (e.pid2) add(e.pid2, "ast"); if (e.and1 != null) { add(e.pid, "fta"); add(e.pid, "ftm", e.and1); add(e.fouler, "pf"); } }
      if (e.type === "2pa" || e.type === "3pa") { add(e.pid, "fga"); if (e.type === "3pa") add(e.pid, "f3a"); }
      if (e.type === "blk") { add(e.pid, "fga"); if (e.three) add(e.pid, "f3a"); add(e.pid2, "blk"); }
      if (e.type === "ft") { add(e.pid, "pts", e.pts); add(e.pid, "ftm", e.pts); add(e.pid, "fta", e.fta); add(e.pid2, "pf"); }
      if (e.type === "tov") { add(e.pid, "tov"); if (e.pid2) add(e.pid2, "stl"); }
      if (e.type === "oreb" || e.type === "dreb") add(e.pid, "reb");
    };
    const drawMargin = () => {
      const pts = log.slice(0, idx).filter((e) => e.s), tmax = Math.max(2400, log.at(-1)?.t || 2400), mx = Math.max(10, ...pts.map((e) => Math.abs(e.s[0] - e.s[1])));
      const X = (t) => 5 + (t / tmax) * 590, Y = (m) => 45 - (m / mx) * 40;
      let s = `<line x1="5" x2="595" y1="45" y2="45" stroke="var(--line)"/>`;
      for (let q = 1; q < 4; q++) s += `<line x1="${X(q * 600)}" x2="${X(q * 600)}" y1="3" y2="87" stroke="var(--line)" stroke-dasharray="2 3"/>`;
      s += `<text x="8" y="12" style="fill:${H.c1};font:10px var(--font-num)">${esc(H.abbr)} μπροστά</text><text x="8" y="86" style="fill:var(--muted);font:10px var(--font-num)">${esc(A.abbr)} μπροστά</text>`;
      if (pts.length) s += `<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${pts.map((e) => `${X(e.t).toFixed(1)},${Y(e.s[0] - e.s[1]).toFixed(1)}`).join(" ")}"/>`;
      $("#lv-mg", el).innerHTML = s;
    };
    const drawBox = () => {
      const side = (ti) => `<div class="tbl" style="margin-bottom:8px"><table><thead><tr><th>${esc(ti ? A.abbr : H.abbr)}</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">Σουτ</th><th class="n">3π</th><th class="n">Βολ</th></tr></thead><tbody>
        ${ctx.T[ti].pl.map((p) => { const b = box[p.pid] || {}; return `<tr><td>${pbtn(p.pid)}</td><td class="n"><b>${b.pts || 0}</b></td><td class="n">${b.reb || 0}</td><td class="n">${b.ast || 0}</td><td class="n">${b.fgm || 0}/${b.fga || 0}</td><td class="n">${b.f3m || 0}/${b.f3a || 0}</td><td class="n">${b.ftm || 0}/${b.fta || 0}</td></tr>`; }).join("")}</tbody></table></div>`;
      $("#lv-box", el).innerHTML = side(0) + side(1);
    };
    const step = (now) => {
      const dt = last ? (now - last) / 1000 : 0; last = now; clock += dt * speed;
      const feed = $("#lv-feed", el); let added = "";
      while (idx < log.length && log[idx].t <= clock) {
        const e = log[idx++]; apply(e);
        const col = e.team == null ? "var(--fg)" : team(e.team === 0 ? g.home : g.away).c1;
        const big = ["2pm", "3pm", "ft"].includes(e.type) && e.pts;
        added = `<div style="display:grid;grid-template-columns:64px 1fr 58px;gap:8px;padding:5px 10px;border-bottom:1px solid var(--line);${big ? "font-weight:600" : ""}">
          <span class="muted num">${e.type === "end" || e.type === "ot" ? "" : fmtClock(e.t).split(" · ")[1]}</span><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></i>${esc(e.text)}</span><span class="num" style="text-align:right">${e.s[0]}–${e.s[1]}</span></div>` + added;
        $("#lv-sc", el).textContent = `${e.s[0]} – ${e.s[1]}`;
      }
      if (added) { feed.insertAdjacentHTML("afterbegin", added); drawMargin(); drawBox(); }
      $("#lv-clk", el).textContent = idx >= log.length ? "Τελικό" : fmtClock(Math.min(clock, log.at(-1).t));
      if (idx < log.length && running) raf = requestAnimationFrame(step); else { running = false; $("#lv-go", el).textContent = "▶ Νέος αγώνας"; }
    };
    const start = () => {
      log = []; SIM.game(ctx, SIM.rng((Math.random() * 2 ** 31) | 0), log);
      idx = 0; clock = 0; last = 0; box = {}; running = true;
      $("#lv-feed", el).innerHTML = ""; $("#lv-sc", el).textContent = "0 – 0"; drawMargin(); drawBox();
      $("#lv-go", el).textContent = "⏸ Παύση";
      raf = requestAnimationFrame(step);
    };
    $("#lv-go", el).addEventListener("click", () => {
      if (running) { running = false; cancelAnimationFrame(raf); $("#lv-go", el).textContent = "▶ Συνέχεια"; return; }
      if (log.length && idx < log.length) { running = true; last = 0; $("#lv-go", el).textContent = "⏸ Παύση"; raf = requestAnimationFrame(step); return; }
      start();
    });
    $("#lv-ctl", el).addEventListener("click", (e) => { const b = e.target.closest("[data-sp]"); if (!b) return; speed = +b.dataset.sp;
      $("#lv-ctl", el).querySelectorAll("[data-sp]").forEach((x) => (x.style.borderColor = x === b ? "var(--accent)" : "")); });
    drawMargin(); drawBox();
    Live.stop = () => { running = false; cancelAnimationFrame(raf); Live.stop = null; };
  },
};

// ----------------------------------------------------------------------------- pop-up παίκτη
function popup(pid) {
  const p = DB.players[pid]; if (!p) return;
  const a = p.avg, last = p.log.filter((g) => g.min > 0).slice(-5).reverse();
  const meta = [p.number ? "#" + p.number : "", POS[p.pos] || p.pos || "", age(p.birth) ? age(p.birth) + " ετών" : "", p.height ? p.height + " cm" : ""].filter(Boolean).join(" · ");
  const d = $("#pop");
  d.innerHTML = `<div class="pop-in">
    <div class="pop-head">${avatar(p)}<div style="min-width:0"><div style="font:700 18px var(--font-display)">${esc(p.name)}</div>
      <div style="font-size:13px">${tlink(p.team, 16)}</div><div class="muted" style="font-size:12px">${esc(meta)}</div></div>
      <button class="icon-btn x" data-close aria-label="Κλείσιμο">✕</button></div>
    <div class="tiles">${tile(f1(a.min), "λεπτά")}${tile(f1(a.pts), "πόντοι")}${tile(f1(a.reb), "ριμπ.")}${tile(f1(a.ast), "ασίστ")}${tile(pct(p.pct.fg3), "3π%")}${tile(`<b>${f1(a.pir)}</b>`, "PIR")}</div>
    <div class="muted" style="font-size:12px">${p.gp} αγώνες · μέσοι όροι ανά αγώνα</div>
    ${last.length ? `<div class="tbl"><table><thead><tr><th>Τελευταίοι</th><th class="n">Λεπ.</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">PIR</th></tr></thead><tbody>
      ${last.map((g) => `<tr><td><a href="#/game/${g.g}" data-close>${dateGR(g.date)} ${g.home ? "vs" : "@"} ${esc(team(g.opp).abbr)}</a> <span style="color:var(--${g.res === "W" ? "good" : "bad"})">${g.res === "W" ? "Ν" : "Η"}</span></td><td class="n">${f1(g.min)}</td><td class="n">${g.pts}</td><td class="n">${g.reb}</td><td class="n">${g.ast}</td><td class="n"><b>${g.pir}</b></td></tr>`).join("")}</tbody></table></div>` : ""}
    ${nextDist(pid, true)}
    <div style="display:flex;justify-content:space-between;gap:8px"><button class="btn" data-close>Κλείσιμο</button><a class="btn primary" href="#/player/${esc(pid)}" data-close>Σελίδα παίκτη →</a></div></div>`;
  d.showModal();
}
$("#pop").addEventListener("click", (e) => { if (e.target.id === "pop" || e.target.closest("[data-close]")) $("#pop").close(); });

// ----------------------------------------------------------------------------- δρομολόγηση
function route() {
  const [, view = "", arg = ""] = (location.hash || "#/").split("/");
  return { view: view || "home", arg: decodeURIComponent(arg) };
}
const NAV = { sims: "#/sims", home: "#/", standings: "#/standings", teams: "#/teams", team: "#/teams", players: "#/players", player: "#/players", games: "#/games", game: "#/games" };
function render() {
  const { view, arg } = route(), V = Views[view] || Views.home, el = $("#view");
  if (Live.stop) Live.stop();
  el.innerHTML = V(arg);
  V.bind?.(el, arg);
  const lv = $("#live", el); if (lv) Live.mount(lv, DB.games[lv.dataset.game]);
  document.querySelectorAll("#nav a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === (NAV[view] || "#/") ? "page" : "false"));
  const titles = { team: () => DB.teams[arg]?.name, player: () => DB.players[arg]?.name, game: () => { const g = DB.games[arg]; return g && `${team(g.home).name} – ${team(g.away).name}`; } };
  document.title = [titles[view]?.(), "o-dimarxos"].filter(Boolean).join(" · ");
}
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pop]"); if (p) { e.preventDefault(); popup(p.dataset.pop); return; }
  const th = e.target.closest("th[data-sort]");
  if (th) { const id = th.closest("table").dataset.tbl, st = table.state[id]; st.dir = st.key === th.dataset.sort ? -st.dir : -1; st.key = th.dataset.sort; render(); }
});
window.addEventListener("hashchange", () => { if ($("#pop").open) $("#pop").close(); render(); window.scrollTo(0, 0); });
$("#theme").addEventListener("click", () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; LS.set("theme", next);
});

(async () => {
  try {
    DB = await fetch("db/demo.json?v=__BUILD__").then((r) => { if (!r.ok) throw new Error("db/demo.json"); return r.json(); });
    SIMS = await fetch("db/sims.json?v=__BUILD__").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    $("#sub").textContent = `${DB.league} ${DB.season}-${String((DB.season + 1) % 100).padStart(2, "0")} · demo: ${DB.demo.map((c) => team(c).name).join(", ")}`;
    $("#foot").textContent = `Δεδομένα: esake.gr (box scores), EuroLeague API/ESPN (βιογραφικά) · ενημέρωση ${DB.updated}`;
    render();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">Σφάλμα φόρτωσης: ${esc(e.message)}</div>`;
  }
})();
