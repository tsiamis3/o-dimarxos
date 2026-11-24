/* =============================================================================
   o-dimarxos v2 · Stoiximan GBL, EuroLeague, EuroCup (μία βάση ανά λίγκα: db/{GBL,E,U}.json, επιλογή με ?l=)

   Μία βάση ανά λίγκα (db/<λίγκα>.json, από scripts/build_demo.py) και σελίδες-πρότυπα, όλες συνδεδεμένες:
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
  const UP = demoGames().filter((g) => !g.played), rnd = UP[0]?.round, up = UP.filter((g) => g.round === rnd);
  const last = demoGames().filter((g) => g.played).slice(-6).reverse();
  const top = Object.values(DB.players).filter((p) => isDemo(p.team) && p.gp >= 2).sort((a, b) => b.avg.pir - a.avg.pir).slice(0, 5);
  return `
  <section><div class="section-head"><h2>Επόμενη αγωνιστική${rnd ? ` (${rnd}η)` : ""}</h2><a href="#/games">όλοι οι αγώνες →</a></div>${gamesList(up, "Δεν υπάρχουν επόμενοι αγώνες.")}</section>
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
  const G = [...new Set(DB.standings.map((s) => s.group).filter(Boolean))].sort();
  if (G.length > 1) return G.map((g) => `<h3 style="margin:10px 0 6px">Όμιλος ${esc(g)}</h3>${standingsOne(compact, g)}`).join("");
  return standingsOne(compact);
}
function standingsOne(compact, grp) {
  const rows = DB.standings.filter((s) => !grp || s.group === grp).map((s, i) => ({ ...s, pos: grp ? i + 1 : s.pos, diff: s.pf - s.pa, _hl: false }));
  const cols = [{ key: "pos", label: "#", n: true }, { key: "code", label: "Ομάδα", html: (r) => tlink(r.code, 20), sv: (r) => team(r.code).name },
    { key: "gp", label: "Αγ.", n: true }, { key: "w", label: "Ν", n: true }, { key: "l", label: "Η", n: true }];
  if (!compact) cols.push({ key: "pf", label: "Υπέρ", n: true }, { key: "pa", label: "Κατά", n: true },
    { key: "home", label: "Έδρα", n: true, html: (r) => `${r.hw}-${r.hl}`, sv: (r) => r.hw - r.hl }, { key: "away", label: "Εκτός", n: true, html: (r) => `${r.aw}-${r.al}`, sv: (r) => r.aw - r.al },
    { key: "form", label: "Φόρμα", sortable: false, html: (r) => form(r.form) });
  cols.push({ key: "diff", label: "Διαφ.", n: true, html: (r) => sgn(r.diff) });
  const id = "st" + compact + (grp || "");
  table.state[id] ||= { key: "pos", dir: 1 };
  return table(id, cols, rows, "pos");
}

Views.standings = () => `<section><h2>Βαθμολογία ${esc(DB.league)}</h2>${standingsTable(false)}
  <p class="muted" style="font-size:13px">Πάτα μια ομάδα για τη σελίδα της. Ισοβαθμίες με τη διαφορά πόντων.</p></section>`;

Views.teams = () => `<section><h2>Ομάδες</h2><div class="grid">${DB.demo.map(teamCard).join("")}</div></section>`;

Views.team = (c) => {
  const t = DB.teams[c];
  if (!t) return `<div class="empty">Η ομάδα δεν βρέθηκε. <a href="#/teams">Ομάδες →</a></div>`;
  const r = t.record, roster = t.roster.map((pid) => DB.players[pid]);
  const G = t.games.map((g) => DB.games[g]).sort((a, b) => a.date.localeCompare(b.date));
  const played = G.filter((g) => g.played).reverse(), up = G.filter((g) => !g.played);
  const ppg = r.gp ? r.pf / r.gp : null, oppg = r.gp ? r.pa / r.gp : null;
  return `<section class="team-hero" style="background:${t.c1};color:${t.fg}"><span style="border-radius:50%;box-shadow:0 0 0 3px ${t.fg}">${badge(c, 64)}</span><div><h1>${esc(t.name)}</h1>
      <div style="opacity:.85">${esc(DB.league)} · ${r.pos}η θέση · ${r.w} νίκες, ${r.l} ήττες</div></div>
      <span style="margin-left:auto">${form(r.form)}</span></section>
    <section class="tiles">${tile(`${r.w}-${r.l}`, "ρεκόρ")}${tile(`${r.hw}-${r.hl}`, "στην έδρα")}${tile(`${r.aw}-${r.al}`, "εκτός")}
      ${tile(f1(ppg), "πόντοι/αγ.")}${tile(f1(oppg), "δέχεται/αγ.")}${tile(sgn(r.pf - r.pa), "διαφορά")}
      ${SIMS?.ratings?.teams?.[c] ? (() => { const x = SIMS.ratings.teams[c], sg = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
        return tile(sg(x.o), "rating επίθεσης") + tile(sg(x.d), "rating άμυνας") + tile(`<a href="#/sims">${sg(x.o + x.d)}</a>`, "rating (ανά 100 κατ.)"); })() : ""}</section>
    ${teamRadars(c)}
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
    ${radarSection(pid)}
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

// ----------------------------------------------------------------------------- αξιολόγηση παικτών (radar)
// 7 άξονες, εκατοστημόρια μέσα στη λίγκα (παίκτες με ≥3 αγώνες και ≥10′): ανά 36′ για τον όγκο, ποσοστά για την ευστοχία.
const RADAR = [
  ["pts36", "Σκοράρισμα", "πόντοι/36′", (v) => f1(v)], ["ts", "Ευστοχία", "TS%", (v) => pct(v)], ["fg3", "Τρίποντο", "3π% (σταθμ.)", (v) => pct(v)],
  ["ast36", "Δημιουργία", "ασίστ/36′", (v) => f1(v)], ["reb36", "Ριμπάουντ", "ριμπ./36′", (v) => f1(v)], ["def36", "Άμυνα", "κλεψ.+τάπες/36′", (v) => f1(v)],
  ["care", "Προσοχή", "λάθη/100 φάσεις (λιγότερα = καλύτερα)", (v) => f1(-v)]];
let EVAL = null;
function evalPool() {
  if (EVAL && EVAL.db === DB) return EVAL;
  const lg3 = DB.lg?.fg3 || 0.33, raw = {};
  for (const p of Object.values(DB.players)) {
    const a = p.avg, g = p.gp || 0; if (g < 1 || !(a.min > 0)) continue;
    const per36 = (x) => (36 * x) / a.min, fga = a.fg2a + a.fg3a, plays = fga + 0.44 * a.fta + a.tov;
    raw[p.pid] = { pool: g >= 3 && a.min >= 10, pts36: per36(a.pts), ts: fga + 0.44 * a.fta > 0 ? a.pts / (2 * (fga + 0.44 * a.fta)) : 0,
      fg3: (a.fg3m * g + 30 * lg3) / (a.fg3a * g + 30), ast36: per36(a.ast), reb36: per36(a.reb), def36: per36(a.stl + a.blk), care: plays > 0 ? (-100 * a.tov) / plays : 0 };
  }
  const pool = Object.values(raw).filter((r) => r.pool), sorted = {};
  for (const [k] of RADAR) sorted[k] = pool.map((r) => r[k]).sort((x, y) => x - y);
  const pctl = (k, v) => { const A = sorted[k]; if (!A.length) return 0.5; let lo = 0, hi = A.length; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < v) lo = m + 1; else hi = m; } return lo / A.length; };
  const med = Object.fromEntries(RADAR.map(([k]) => [k, sorted[k][Math.floor(sorted[k].length / 2)] ?? 0]));
  return (EVAL = { db: DB, raw, pctl, med, n: pool.length });
}
/** Τιμές και εκατοστημόρια ενός παίκτη (null αν δεν έχει παίξει). */
function playerEval(pid) { const E = evalPool(), r = E.raw[pid]; if (!r) return null;
  return { pool: r.pool, vals: RADAR.map(([k]) => r[k]), pcts: RADAR.map(([k]) => E.pctl(k, r[k])) }; }
/** series: [{ pcts: [0..1], color, label, dash }] */
function radarSVG(series, { size = 360, labels = true } = {}) {
  const n = RADAR.length, cx = size / 2, cy = size / 2 + (labels ? 4 : 0), R = size / 2 - (labels ? 62 : 10);
  const pt = (i, r) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  let g = "";
  for (const q of [0.25, 0.5, 0.75, 1]) g += `<polygon points="${RADAR.map((_, i) => pt(i, R * q).join(",")).join(" ")}" fill="none" stroke="var(--line)" ${q === 0.5 ? 'stroke-dasharray="3 3"' : ""}/>`;
  RADAR.forEach((_, i) => { const [x, y] = pt(i, R); g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--line)"/>`; });
  for (const S of series) g += `<polygon points="${S.pcts.map((v, i) => pt(i, R * Math.max(0.03, v)).join(",")).join(" ")}" fill="${S.color}" fill-opacity="${S.dash ? 0.06 : 0.22}" stroke="${S.color}" stroke-width="2" ${S.dash ? 'stroke-dasharray="5 4"' : ""}><title>${esc(S.label)}</title></polygon>`;
  if (series[0]) series[0].pcts.forEach((v, i) => { const [x, y] = pt(i, R * Math.max(0.03, v)); g += `<circle cx="${x}" cy="${y}" r="3" fill="${series[0].color}"/>`; });
  if (labels) RADAR.forEach(([, lab], i) => { const [x, y] = pt(i, R + 16), anc = Math.abs(x - cx) < 8 ? "middle" : x > cx ? "start" : "end";
    const v = series[0] ? Math.round(100 * series[0].pcts[i]) : null;
    g += `<text x="${x}" y="${y}" text-anchor="${anc}" style="font:600 12px var(--font-body);fill:var(--fg)">${lab}</text>${v != null ? `<text x="${x}" y="${y + 14}" text-anchor="${anc}" style="font:11px var(--font-num);fill:var(--muted)">${v}ο εκ.</text>` : ""}`; });
  const pad = labels ? 34 : 0;
  return `<svg viewBox="${-pad} 0 ${size + 2 * pad} ${size + (labels ? 8 : 0)}" style="width:100%;max-width:${size + 2 * pad}px;height:auto;display:block;margin:auto" role="img" aria-label="Radar αξιολόγησης">${g}</svg>`;
}
const RD_CMP = { pid: "" };
/** Πλέγμα με μικρά radar για τους 8 παίκτες της ομάδας με τα περισσότερα λεπτά. */
function teamRadars(c) {
  const t = DB.teams[c]; if (!t) return "";
  const col = t.c1 || "var(--accent)", L = (t.roster || []).map((pid) => [pid, playerEval(pid)]).filter(([, e]) => e?.pool).slice(0, 8);
  if (!L.length) return "";
  return `<section><h2>Αξιολόγηση ρόστερ</h2><div class="rd-grid">${L.map(([pid, e]) => { const best = RADAR.map(([, lab], i) => [lab, e.pcts[i]]).sort((x, y) => y[1] - x[1]).slice(0, 2);
    return `<button class="card rd-card" data-pop="${esc(pid)}">${radarSVG([{ pcts: e.pcts, color: col, label: DB.players[pid].name }, { pcts: RADAR.map(() => 0.5), color: "#d9a227", label: "μέσος όρος", dash: true }], { size: 130, labels: false })}
      <b style="font-size:13px">${esc(DB.players[pid].name)}</b><span class="muted" style="font-size:11px">${best.map(([l, v]) => `${l} ${Math.round(100 * v)}`).join(" · ")}</span></button>`; }).join("")}</div>
    <p class="muted" style="font-size:12px">Άξονες (δεξιόστροφα από πάνω): ${RADAR.map(([, l]) => l).join(", ")}. Κίτρινος διακεκομμένος: ο μέσος όρος της λίγκας. Πάτα έναν παίκτη για λεπτομέρειες.</p></section>`;
}
function radarSection(pid) {
  const me = playerEval(pid); if (!me) return "";
  const p = DB.players[pid], col = team(p.team).c1 || "var(--accent)", E = evalPool();
  const other = RD_CMP.pid && RD_CMP.pid !== pid ? playerEval(RD_CMP.pid) : null, oname = other ? DB.players[RD_CMP.pid].name : "Μέσος όρος λίγκας";
  const cmpCol = "#d9a227", cmpP = other ? other.pcts : RADAR.map(() => 0.5), cmpV = other ? other.vals : RADAR.map(([k]) => E.med[k]);
  const opts = DB.demo.map((t) => `<optgroup label="${esc(team(t).name)}">${(DB.teams[t]?.roster || []).filter((x) => x !== pid && E.raw[x]?.pool).map((x) => `<option value="${esc(x)}" ${x === RD_CMP.pid ? "selected" : ""}>${esc(DB.players[x].name)}</option>`).join("")}</optgroup>`).join("");
  return `<section class="card" id="radar"><div class="section-head"><h2>Αξιολόγηση</h2>
      <label class="muted" style="font-size:13px">σύγκριση με <select id="rd-cmp" data-pid="${esc(pid)}"><option value="">Μέσος όρος λίγκας</option>${opts}</select></label></div>
    <div class="grid" style="align-items:center"><div>${radarSVG([{ pcts: me.pcts, color: col, label: p.name }, { pcts: cmpP, color: cmpCol, label: oname, dash: true }])}
      <div class="muted" style="font-size:12px;text-align:center"><span style="color:${col}">━</span> ${esc(p.name)} &nbsp; <span style="color:${cmpCol}">╍</span> ${esc(oname)}</div></div>
    <div class="tbl"><table><thead><tr><th>Άξονας</th><th class="n">${esc(p.name.split(" ").at(-1))}</th><th class="n">εκατ.</th><th class="n">${other ? esc(oname.split(" ").at(-1)) : "διάμεσος"}</th></tr></thead><tbody>
      ${RADAR.map(([, lab, unit, fmt], i) => `<tr><td>${lab}<div class="muted" style="font-size:11px">${unit}</div></td><td class="n"><b>${fmt(me.vals[i])}</b></td>
        <td class="n" style="color:var(--${me.pcts[i] >= 0.67 ? "good" : me.pcts[i] <= 0.33 ? "bad" : "fg"})">${Math.round(100 * me.pcts[i])}</td><td class="n">${fmt(cmpV[i])}</td></tr>`).join("")}</tbody></table>
      <p class="muted" style="font-size:12px">Εκατοστημόριο: πόσοι από τους ${E.n} παίκτες της λίγκας (≥3 αγώνες, ≥10′) έχουν χαμηλότερη τιμή. 50 = μέση τιμή (διακεκομμένος κύκλος).${me.pool ? "" : " Ο παίκτης έχει λίγους αγώνες ή λεπτά: δες το ως ένδειξη."} Τρίποντο: σταθμισμένο προς τον μέσο όρο όταν έχει λίγες προσπάθειες.</p></div></div></section>`;
}

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
  const byRoundP = {};
  for (const g of pl) (byRoundP[g.round] ||= []).push(g);
  const rounds = (R, openFirst) => Object.entries(R).sort((x, y) => (openFirst ? +x[0] - +y[0] : +y[0] - +x[0])).map(([r, L], i) =>
    `<details class="tree" ${i === 0 ? "open" : ""}><summary><b>${r}η αγωνιστική</b> <span class="muted" style="font-size:12px">${dateGR(L[0].date, true)} · ${L.length} αγώνες</span></summary>${gamesList(L)}</details>`).join("");
  return `<section><h2>Επόμενοι αγώνες</h2>${Object.keys(byRound).length ? rounds(byRound, true) : `<div class="empty">Κανένας.</div>`}</section>
    <section><h2>Αποτελέσματα</h2>${rounds(byRoundP, false)}</section>`;
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
    </section>${!g.played && SIMS?.games?.[g.code]?.margin?.hist ? `<section class="card"><h2>Έχει αξία; <span class="muted" style="font:13px var(--font-body)">βάλε την απόδοση του bookmaker · <a href="#/value">πώς υπολογίζεται</a></span></h2><div id="val-form" data-fixed="${g.code}">${valForm(String(g.code))}</div></section>` : ""}<section class="card" id="live" data-game="${g.code}"></section>${simSection(g.code)}`;
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
      : `<div class="muted">Δεν υπάρχουν στοιχεία για τους παίκτες .</div>`}</div>`; };
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
  for (const [code, g] of G) { if (g.played) continue; for (const side of [0, 1]) { const p = g.players[side].find((x) => x.pid === pid); if (p) return { code, g, p, side }; } }
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

// boxplot σε σειρές: κάθε σειρά {label (html), d (κατανομή), actual (πραγματικό ή null)}. Κουτί 25–75%, κεραίες 5–95%, γραμμή διάμεσος, ◆ μέσος.
function boxRows(rows, { fmt = (v) => v, color = "var(--accent)" } = {}) {
  if (!rows.length) return "";
  const vals = rows.flatMap((r) => [r.d.p5, r.d.p95, ...(r.actual != null ? [r.actual] : [])]);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = Math.max(1, (hi - lo) * 0.06); lo -= pad; hi += pad;
  const W = 520, X = (v) => (((v - lo) / (hi - lo)) * (W - 12) + 6).toFixed(1);
  const ticks = []; const st = Math.max(1, Math.pow(10, Math.floor(Math.log10((hi - lo) / 4))) * ([1, 2, 5].find((k) => (hi - lo) / (k * Math.pow(10, Math.floor(Math.log10((hi - lo) / 4)))) <= 6) || 10));
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) ticks.push(v);
  const row = (r) => { const d = r.d, a = r.actual, inBox = a != null && a >= d.p25 && a <= d.p75, inW = a != null && a >= d.p5 && a <= d.p95;
    const ac = a == null ? "" : `<g><title>Πραγματικό: ${fmt(a)}${inBox ? " (μέσα στο κουτί)" : inW ? " (μέσα στις κεραίες)" : " (εκτός)"}</title>
      <circle cx="${X(a)}" cy="11" r="5.5" fill="${inBox ? "var(--good)" : inW ? "#d9a227" : "var(--bad)"}" stroke="var(--surface)" stroke-width="1.5"/></g>`;
    return `<div class="bx-row"><div class="bx-l">${r.label}</div><svg viewBox="0 0 ${W} 22" preserveAspectRatio="none" class="bx" role="img">
      <title>${esc(r.title || "")} 5%: ${fmt(d.p5)} · 25%: ${fmt(d.p25)} · διάμεσος ${fmt(d.p50)} · 75%: ${fmt(d.p75)} · 95%: ${fmt(d.p95)} · μέσος ${d.mean}</title>
      ${ticks.map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="0" y2="22" stroke="var(--line)"/>`).join("")}
      <line x1="${X(d.p5)}" x2="${X(d.p95)}" y1="11" y2="11" stroke="${color}" stroke-width="1.5"/>
      <line x1="${X(d.p5)}" x2="${X(d.p5)}" y1="6" y2="16" stroke="${color}" stroke-width="1.5"/><line x1="${X(d.p95)}" x2="${X(d.p95)}" y1="6" y2="16" stroke="${color}" stroke-width="1.5"/>
      <rect x="${X(d.p25)}" y="4" width="${Math.max(1.5, X(d.p75) - X(d.p25))}" height="14" fill="${color}" fill-opacity=".22" stroke="${color}" stroke-width="1.5" rx="2"/>
      <line x1="${X(d.p50)}" x2="${X(d.p50)}" y1="4" y2="18" stroke="${color}" stroke-width="2.5"/>
      <path d="M${X(d.mean)} 7 l3 4 l-3 4 l-3 -4 z" fill="var(--fg)" opacity=".7"/>${ac}</svg>
      <div class="bx-v num">${a != null ? `<b>${fmt(a)}</b> <span class="muted">/ ${fmt(d.p50)}</span>` : `<span class="muted">${fmt(d.p25)}–${fmt(d.p75)}</span>`}</div></div>`; };
  return `<div class="bx-wrap">${rows.map(row).join("")}<div class="bx-row"><div></div><div class="bx-axis">${ticks.map((v) => `<span style="left:${((v - lo) / (hi - lo)) * 100}%">${fmt(v)}</span>`).join("")}</div><div></div></div></div>`;
}
const momTable = (rows) => `<div class="tbl"><table><thead><tr><th></th><th class="n">μέσος</th><th class="n">διασπορά</th><th class="n">τυπ. απόκλ.</th><th class="n">ασυμμετρία</th><th class="n">κύρτωση</th><th class="n">CV</th><th class="n">5%</th><th class="n">25%</th><th class="n">διάμεσος</th><th class="n">75%</th><th class="n">95%</th></tr></thead><tbody>
  ${rows.map((r) => `<tr><td>${r.label}</td><td class="n"><b>${r.d.mean}</b></td><td class="n">${r.d.var}</td><td class="n">${r.d.sd}</td><td class="n">${r.d.skew}</td><td class="n">${r.d.kurt}</td><td class="n">${r.d.cv ?? "–"}</td><td class="n">${r.d.p5}</td><td class="n">${r.d.p25}</td><td class="n">${r.d.p50}</td><td class="n">${r.d.p75}</td><td class="n">${r.d.p95}</td></tr>`).join("")}</tbody></table></div>`;
const SIM_STATS = [["pts", "Πόντοι"], ["reb", "Ριμπάουντ"], ["ast", "Ασίστ"], ["pir", "PIR"], ["fg3m", "Τρίποντα"], ["stl", "Κλεψίματα"], ["blk", "Κοψίματα"]];
const simUI = { stat: "pts", moments: false };

function simSection(code) {
  const S = SIMS?.games?.[code]; if (!S) return "";
  const g = DB.games[code], H = team(g.home), A = team(g.away), act = S.actual;
  const sgnF = (v) => (v > 0 ? "+" : "") + v;
  const teamRows = [
    { label: `${badge(g.home, 16)} πόντοι ${esc(H.abbr)}`, d: S.score[0], actual: act?.hs, title: `Πόντοι ${H.name}.` },
    { label: `${badge(g.away, 16)} πόντοι ${esc(A.abbr)}`, d: S.score[1], actual: act?.as, title: `Πόντοι ${A.name}.` },
    { label: `Διαφορά (${esc(H.abbr)} − ${esc(A.abbr)})`, d: S.margin, actual: act ? act.hs - act.as : null, title: "Διαφορά γηπεδούχου." },
    { label: "Σύνολο πόντων", d: S.total, actual: act ? act.hs + act.as : null, title: "Σύνολο." } ];
  const fair = S.hcap?.fair;
  const hc = S.hcap ? `<div class="tbl"><table><thead><tr><th>Χάντικαπ ${esc(H.abbr)}</th>${S.hcap.lines.map(([L]) => `<th class="n">${sgnF(L)}</th>`).join("")}</tr></thead><tbody>
      <tr><td>καλύπτει ${esc(H.abbr)}</td>${S.hcap.lines.map(([L, p]) => `<td class="n" style="${Math.abs(p - 0.5) < 0.06 ? "font-weight:700" : ""}">${pct(p)}</td>`).join("")}</tr>
      <tr><td>καλύπτει ${esc(A.abbr)}</td>${S.hcap.lines.map(([, p]) => `<td class="n">${pct(1 - p)}</td>`).join("")}</tr>
      ${act ? `<tr><td class="muted">πραγματικό</td>${S.hcap.lines.map(([L]) => `<td class="n" style="color:var(--${act.hs - act.as + L > 0 ? "good" : "bad"})">${act.hs - act.as + L > 0 ? esc(H.abbr) : esc(A.abbr)}</td>`).join("")}</tr>` : ""}</tbody></table></div>` : "";
  const st = simUI.stat, stLabel = SIM_STATS.find(([k]) => k === st)[1];
  const playerBlock = (side, c) => {
    const P = S.players[side], shown = P.filter((p) => p[st].show), hidden = P.filter((p) => !p[st].show);
    const rows = shown.map((p) => ({ label: `${pbtn(p.pid)} <span class="muted" style="font-size:11px">${f1(p.min)}′</span>`, d: p[st],
      actual: act ? (act.box[p.pid]?.[st] ?? null) : null, title: `${DB.players[p.pid]?.name}: ${stLabel}.` }));
    const dnp = act ? P.filter((p) => !act.box[p.pid]).map((p) => DB.players[p.pid]?.name) : [];
    return `<div><h3 style="margin-bottom:6px">${tlink(c, 20)}</h3>${rows.length ? (simUI.moments ? momTable(rows) : boxRows(rows, { color: team(c).c1 === "#ffffff" ? "var(--accent)" : team(c).c1 }))
      : `<div class="muted">Καμία κατανομή αρκετά «σφιχτή» για να δειχτεί.</div>`}
      ${hidden.length ? `<div class="muted" style="font-size:12px;margin-top:4px">Δεν δείχνονται (μεγάλη διασπορά ή μέσος &lt; ${SIMS.show_min ?? 1}): ${hidden.map((p) => esc(DB.players[p.pid]?.name)).join(", ")}</div>` : ""}
      ${dnp.length ? `<div class="muted" style="font-size:12px">Δεν αγωνίστηκαν: ${dnp.map(esc).join(", ")}</div>` : ""}</div>`;
  };
  return `<section id="simsec"><div class="section-head"><h2>${S.played ? "Προσομοίωση πριν από τον αγώνα, απέναντι στο αποτέλεσμα" : `${S.n.toLocaleString("el-GR")} προσομοιώσεις`}</h2>
      <span class="muted" style="font-size:12px">${S.n.toLocaleString("el-GR")} αγώνες${S.wf ? " · μόνο με όσα ήταν γνωστά πριν (walk-forward)" : ""} · <a href="#/sims">πώς δουλεύει</a></span></div>
    <div class="card"><div class="bar2" style="height:14px"><i style="width:${100 * S.p_home}%;background:${H.c1}"></i><i style="width:${100 * (1 - S.p_home)}%;background:${A.c1}"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;gap:8px;flex-wrap:wrap"><b>${esc(H.name)} ${pct(S.p_home)}</b>
        <span class="muted">«δίκαιο» χάντικαπ: ${esc(H.abbr)} ${sgnF(fair)} · παράταση ${pct(S.p_ot)} · ρυθμός ${S.pace}</span><b>${pct(1 - S.p_home)} ${esc(A.name)}</b></div>
      ${act ? `<div style="margin-top:6px">Αποτέλεσμα: <b>${act.hs}–${act.as}</b> · νικητής ${esc(team(act.hs > act.as ? g.home : g.away).name)}, με πιθανότητα ${pct(act.hs > act.as ? S.p_home : 1 - S.p_home)} πριν από τον αγώνα</div>` : ""}</div>
    <div class="grid" style="margin-top:12px"><div class="card"><h3>Αποτέλεσμα και πόντοι</h3>
        <div class="muted" style="font-size:12px">Πόντοι ομάδων</div>${boxRows(teamRows.slice(0, 2))}
        <div class="muted" style="font-size:12px;margin-top:8px">Διαφορά (χάντικαπ)</div>${boxRows(teamRows.slice(2, 3), { fmt: (v) => (v > 0 ? "+" : "") + v })}
        <div class="muted" style="font-size:12px;margin-top:8px">Σύνολο πόντων</div>${boxRows(teamRows.slice(3), { color: "var(--c3)" })}
        <div class="muted" style="font-size:12px;margin-top:6px">Κουτί: το μεσαίο 50% των προσομοιώσεων · κεραίες: 5%–95% · γραμμή: διάμεσος · ◆ μέσος.${act ? ` Κουκκίδα: πραγματικό (<span style="color:var(--good)">●</span> στο κουτί, <span style="color:#d9a227">●</span> στις κεραίες, <span style="color:var(--bad)">●</span> εκτός).` : ""}</div></div>
      <div class="card"><h3>Ροπές</h3>${momTable(teamRows)}</div></div>
    <div class="card" style="margin-top:12px"><h3>Χάντικαπ</h3>${hc}<div class="muted" style="font-size:12px;margin-top:4px">Γραμμή −5.5: ο ${esc(H.abbr)} καλύπτει αν κερδίσει με 6+. Με έντονα: οι γραμμές κοντά στο 50%.</div></div>
    ${!S.played && S.margin.hist ? `<div class="grid" style="margin-top:12px"><div class="card"><h3>Διαφορά πόντων</h3>${histo(S.margin, { label: (v) => (v > 0 ? "+" : "") + v, color: H.c1, mark: (v) => v > 0 })}</div>
      <div class="card"><h3>Σύνολο πόντων</h3>${histo(S.total, { color: "var(--c3)" })}</div></div>` : ""}
    <div class="section-head" style="margin-top:16px"><h3 style="margin:0">Παίκτες: ${esc(stLabel)}</h3>
      <div style="display:flex;gap:4px;flex-wrap:wrap">${SIM_STATS.map(([k, l]) => `<button class="btn" data-simstat="${k}" style="${k === st ? "border-color:var(--accent);color:var(--accent)" : ""}">${l}</button>`).join("")}
        <button class="btn" data-simmom style="${simUI.moments ? "border-color:var(--accent);color:var(--accent)" : ""}">${simUI.moments ? "boxplots" : "ροπές"}</button></div></div>
    <div style="display:flex;flex-direction:column;gap:16px;margin-top:8px">${playerBlock(0, g.home)}${playerBlock(1, g.away)}</div>
    <p class="muted" style="font-size:12px">Δείχνονται μόνο οι κατανομές με τυπική απόκλιση έως ${Math.round(100 * (SIMS.show_cv ?? 0.8))}% του μέσου (CV ≤ ${SIMS.show_cv ?? 0.8}) και μέσο ≥ ${SIMS.show_min ?? 1}: οι υπόλοιπες είναι κυρίως θόρυβος.${act ? " Δεξιά: πραγματικό / διάμεσος της προσομοίωσης." : " Δεξιά: το μεσαίο 50%."}</p></section>`;
}

/** Ratings ομάδων (επίθεση/άμυνα) και πόσο βοηθούν την προσομοίωση. */
function ratingsCard(Rt) {
  const sg = (v) => (v > 0 ? "+" : "") + v.toFixed(1), rows = Object.entries(Rt.teams).map(([t, x]) => ({ t, ...x, net: x.o + x.d })).sort((a, b) => b.net - a.net);
  const E = Rt.eval || {}, P = E.players, B = E.blend, O = E.ratings;
  const cell = (v, f, best) => `<td class="n" style="${best ? "color:var(--good);font-weight:700" : ""}">${v == null ? "–" : f(v)}</td>`;
  const evalRow = (lab, x, all) => x ? `<tr><td>${lab}</td>${["brier", "acc", "margin", "total"].map((k) => { const vals = all.filter(Boolean).map((y) => y[k]), best = k === "acc" ? Math.max(...vals) : Math.min(...vals);
    return cell(x[k], k === "acc" ? pct : (v) => v.toFixed(k === "brier" ? 3 : 2), x[k] === best); }).join("")}</tr>` : "";
  return `<section class="card"><h2>Ratings ομάδων</h2>
    <p style="margin:0 0 8px;max-width:80ch">Δύο νούμερα ανά ομάδα, σε πόντους ανά 100 κατοχές απέναντι σε μέσο αντίπαλο: <b>επίθεση</b> (πόσους βάζει πάνω από τον μέσο όρο) και <b>άμυνα</b> (πόσους λιγότερους δέχεται).
    Βγαίνουν από όλους τους αγώνες της σεζόν, προσαρμοσμένους στον αντίπαλο και την έδρα, με αρχική τιμή την περσινή σεζόν (ένα «Elo» με δύο νούμερα). Έδρα: ${sg(Rt.h)} ανά 100 κατοχές.
    Στις προσομοιώσεις ο μέσος όρος κάθε ομάδας μετακινείται κατά <b>${Math.round(100 * Rt.w)}%</b> προς ό,τι λένε τα ratings (όλοι οι παίκτες της μαζί), ενώ οι απουσίες και οι αλλαγές στους παίκτες συνεχίζουν να μετράνε.</p>
    <div class="grid"><div class="tbl" style="max-height:420px"><table><thead><tr><th>#</th><th>Ομάδα</th><th class="n">επίθεση</th><th class="n">άμυνα</th><th class="n">σύνολο</th></tr></thead><tbody>
      ${rows.map((x, i) => `<tr><td class="n">${i + 1}</td><td>${tlink(x.t, 18)}</td><td class="n">${sg(x.o)}</td><td class="n">${sg(x.d)}</td><td class="n"><b>${sg(x.net)}</b></td></tr>`).join("")}</tbody></table></div>
      <div><div class="tbl"><table><thead><tr><th>Όλες οι λίγκες (walk-forward)</th><th class="n">Brier</th><th class="n">νικητής</th><th class="n">CRPS διαφ.</th><th class="n">CRPS συν.</th></tr></thead><tbody>
        ${evalRow("Μόνο παίκτες", P, [P, B, O])}${evalRow(`Παίκτες + ratings (${Math.round(100 * Rt.w)}%)`, B, [P, B, O])}${evalRow("Μόνο ratings", O, [P, B, O])}</tbody></table></div>
        <p class="muted" style="font-size:12px">${Rt.games} παιγμένοι αγώνες GBL, EuroLeague και EuroCup, κάθε ένας μόνο με τους προηγούμενους. Πράσινο: το καλύτερο. Τυπική απόκλιση πρόβλεψης (πόντοι ανά 100 κατοχές): ${Rt.rmse?.toFixed(1)} με ratings, ${Rt.rmse_flat?.toFixed(1)} χωρίς.</p></div></div></section>`;
}

/** Αβεβαιότητα πέρα από τα ζάρια: τι προσαρμόστηκε, πριν/μετά, και από πού έρχεται η διασπορά. */
function reCard(F, re) {
  const B = F.before?.ALL, A = F.after?.ALL; if (!B || !A) return "";
  const good = (v, target, tol) => `style="color:var(--${Math.abs(v - target) <= tol ? "good" : "bad"})"`;
  const row = (lab, k, target) => `<tr><td>${lab}</td><td class="n" ${good(B[k], target, target === 0.5 ? 0.07 : 0.04)}>${pct(B[k])}</td><td class="n" ${good(A[k], target, target === 0.5 ? 0.07 : 0.04)}><b>${pct(A[k])}</b></td></tr>`;
  const crow = (lab, k) => `<tr><td>${lab}</td><td class="n">${B[k].toFixed(2)}</td><td class="n" style="color:var(--${A[k] < B[k] ? "good" : "bad"})"><b>${A[k].toFixed(2)}</b></td></tr>`;
  const C = ["var(--c1, #4c78a8)", "var(--c2, #f58518)", "var(--c3, #54a24b)", "var(--c4, #e45756)", "var(--c5, #b279a2)", "var(--c6, #9d755d)"];
  const bar = (k, lab) => { const D = (F.decomp?.[k] || []).map(([l, v]) => [l, Math.max(0, v)]), S = D.reduce((x, [, v]) => x + v, 0) || 1;
    return `<div style="margin:6px 0"><div style="font-size:13px">${lab}</div><div class="bar2" style="height:16px">${D.map(([l, v], i) => `<i title="${esc(l)} ${pct(v / S)}" style="width:${(100 * v) / S}%;background:${C[i]}"></i>`).join("")}</div></div>`; };
  const legend = (F.decomp?.total || []).map(([l], i) => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><i style="width:10px;height:10px;border-radius:2px;background:${C[i]};display:inline-block"></i>${esc(l)}</span>`).join("");
  return `<section class="card"><h2>Αβεβαιότητα: λεπτά, «μέρα» αγώνα, φόρμα</h2>
    <p style="margin:0 0 8px;max-width:80ch">Πέρα από τα ζάρια κάθε φάσης, κάθε προσομοιωμένος αγώνας κληρώνει: πόσες κατοχές θα έχει (± ${re.pace}), πόσα λεπτά θα παίξει ο καθένας (±${Math.round(100 * re.m)}%) και πόσο καλά θα σουτάρει σε σχέση με το επίπεδό του (${re.p} σε log-odds, περίπου ±${Math.round(100 * re.p / 4)} ποσοστιαίες μονάδες).
    ${re.g || re.t ? `Κοινός παράγοντας αγώνα: ${re.g}, ομάδας: ${re.t}.` : "Κοινός παράγοντας αγώνα («υψηλού/χαμηλού» σκορ) ή ομάδας δεν βελτίωσε τις κατανομές, οπότε μένει 0."}
    Οι τιμές βγήκαν από ${F.games} παιγμένους αγώνες GBL, EuroLeague και EuroCup (walk-forward), διαλέγοντας ό,τι δίνει τις καλύτερες κατανομές (CRPS).</p>
    <p class="muted" style="margin:0 0 8px;max-width:80ch;font-size:13px">Στα δεδομένα η ευστοχία από αγώνα σε αγώνα δεν κυμαίνεται περισσότερο απ' όσο δίνουν τα ζάρια· τα λεπτά όμως ναι (±22%). Το «σουτ» εδώ εκφράζει κυρίως ότι δεν ξέρουμε ακριβώς το πραγματικό επίπεδο κάθε παίκτη (λίγα σουτ στη σεζόν), όχι «καυτές βραδιές». Η διαφορά βγαίνει ήδη λίγο πιο φαρδιά απ' όσο πρέπει (κεραίες >90%) και το σύνολο λίγο στενό: αυτά δεν τα διορθώνει η τυχαιότητα, θέλουν αλλαγή στο ίδιο το μοντέλο.</p>
    <div class="grid"><div class="tbl"><table><thead><tr><th>Μέσα στο κουτί / στις κεραίες</th><th class="n">πριν</th><th class="n">τώρα</th></tr></thead><tbody>
      ${row("Διαφορά · κουτί (50%)", "margin_box", 0.5)}${row("Διαφορά · κεραίες (90%)", "margin_whisk", 0.9)}${row("Σύνολο · κουτί", "total_box", 0.5)}${row("Σύνολο · κεραίες", "total_whisk", 0.9)}${row("Πόντοι παίκτη · κουτί", "pts_box", 0.5)}${row("Πόντοι παίκτη · κεραίες", "pts_whisk", 0.9)}</tbody></table></div>
      <div class="tbl"><table><thead><tr><th>CRPS (μικρότερο = καλύτερο)</th><th class="n">πριν</th><th class="n">τώρα</th></tr></thead><tbody>
      ${crow("Διαφορά", "margin")}${crow("Σύνολο", "total")}${crow("Πόντοι ομάδας", "score")}${crow("Πόντοι παίκτη", "pts")}</tbody></table></div></div>
    <h3 style="margin-top:12px">Από πού έρχεται η διασπορά</h3>${bar("total", "Σύνολο πόντων")}${bar("margin", "Διαφορά")}${bar("pts", "Πόντοι παίκτη (≥15′)")}
    <div class="muted" style="font-size:12px">${legend}</div></section>`;
}

/** Ποιες πηγές δεδομένων βοηθούν: ίδιοι αγώνες, ίδια seeds, walk-forward. */
function srcCard(L) {
  const best = (k, lo = true) => (lo ? Math.min : Math.max)(...L.map((c) => c[k]));
  const cell = (c, k, f, lo = true) => `<td class="n" style="${c[k] === best(k, lo) ? "color:var(--good);font-weight:700" : ""}">${f(c[k])}</td>`;
  const S = DB.sources || {};
  return `<section class="card"><h2>Δεδομένα από άλλες λίγκες: βοηθούν;</h2>
    <p style="margin:0 0 8px;max-width:80ch">Οι ίδιοι ${L[0].games} παιγμένοι αγώνες, με ${L[0].sims_each.toLocaleString("el-GR")} προσομοιώσεις ο καθένας και ίδια ζάρια· αλλάζει μόνο από πού έρχονται τα ποσοστά των παικτών.
    Από τις άλλες λίγκες παίρνουμε μόνο την <b>ποιότητα</b> (ποσοστά, λάθη, βολές, μερίδιο τριπόντων), με βάρος ${SIMS.ext_w ?? 0.5} ανά αγώνα και μόνο αγώνες πριν από την ημερομηνία· τα λεπτά και ο ρόλος έρχονται πάντα από ${esc(DB.short)}.</p>
    <div class="tbl"><table><thead><tr><th>Πηγές</th><th class="n">Brier</th><th class="n">νικητής</th><th class="n">± διαφορά</th><th class="n">± σύνολο</th><th class="n">± πόντοι παίκτη</th></tr></thead><tbody>
    ${L.map((c) => `<tr><td>${esc(c.label)}${c.sources.length ? `<div class="muted" style="font-size:11px">${c.sources.map((k) => esc(S[k]?.label || k)).join(" · ")}</div>` : ""}</td>
      ${cell(c, "brier", (v) => v.toFixed(3))}${cell(c, "acc", pct, false)}${cell(c, "mae_margin", (v) => "±" + v.toFixed(2))}${cell(c, "mae_total", (v) => "±" + v.toFixed(2))}${cell(c, "mae_player_pts", (v) => "±" + v.toFixed(2))}</tr>`).join("")}</tbody></table></div>
    <div class="tbl" style="margin-top:10px"><table><thead><tr><th>Πηγή</th><th class="n">κοινοί παίκτες</th><th class="n">εμφανίσεις</th><th class="n">κλίμακα 2π</th><th class="n">3π</th><th class="n">βολές</th><th class="n">λάθη</th></tr></thead><tbody>
    ${Object.entries(S).map(([k, x]) => `<tr><td>${esc(x.label)}</td><td class="n">${x.players}</td><td class="n">${x.games}</td>${["fg2", "fg3", "ft", "tov"].map((q) => `<td class="n">${x.shift[q] > 0 ? "+" : ""}${x.shift[q].toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Πράσινο: το καλύτερο. «±»: μέσο απόλυτο σφάλμα, «νικητής»: πόσο συχνά βρήκε τον νικητή. Κλίμακα: πόσο (σε log-odds) διαφέρει το ποσοστό των ίδιων παικτών ${esc(DB.short)} από την πηγή· + σημαίνει ότι εδώ ευστοχούν περισσότερο. Οι διαφορές είναι μικρές με ${L[0].games} αγώνες: δες τες ως ένδειξη.</p></section>`;
}

const BETAL = { tov: "Λάθη (ανά φάση)", ftrip: "Φάουλ → βολές (ανά φάση)", fg2: "Ευστοχία 2π", fg3: "Ευστοχία 3π", orb: "Επιθ. ριμπάουντ (ομάδα)" };
function betaCard(F) {
  const f = (v) => (v == null ? "–" : v.toFixed(2));
  return `<section class="card"><h2>Βάρη του log5</h2>
    <p style="margin:0 0 8px;max-width:80ch"><span class="num">logit p = logit(λίγκα) + β0 + β1·[παίκτης − ομάδα] + β3·[ομάδα − λίγκα] + β2·[άμυνα − λίγκα]</span> (σε log-odds). Το κλασικό log5 είναι β1 = β2 = β3 = 1.
    «Ομάδα» είναι ο μέσος όρος της επίθεσης της ομάδας του παίκτη: έτσι η διαφορά ανάμεσα σε συμπαίκτες (β1, με πολύ θόρυβο) χωρίζεται από τη διαφορά δύναμης ανάμεσα σε ομάδες (β3).
    Τα β βγαίνουν με λογιστική παλινδρόμηση στα box scores (παίκτης × αγώνας), με στατιστικά μόνο από τους προηγούμενους αγώνες, και ήπια έλξη προς το 1.
    β &lt; 1 σημαίνει ότι η απόκλιση «περνάει» μόνο εν μέρει στον αγώνα.</p>
    <div class="tbl"><table><thead><tr><th>Φάση</th><th class="n">παρατηρήσεις</th><th class="n">β1 παίκτης − ομάδα</th><th class="n">β3 ομάδα − λίγκα</th><th class="n">β2 άμυνα</th><th class="n">β0</th><th class="n">κέρδος εκτός δείγματος</th></tr></thead><tbody>
    ${SIM.EVENTS.filter((k) => F[k]).map((k) => { const x = F[k], c = (i) => `<td class="n">${k === "orb" && i === 1 ? "–" : f(x.b[i] ?? x.b[1])}${x.se && !(k === "orb" && i === 1) ? ` <span class="muted">±${f(x.se[i])}</span>` : ""}</td>`;
      return `<tr><td>${BETAL[k]}</td><td class="n">${x.n}</td>${c(1)}${c(3)}${c(2)}<td class="n">${f(x.b[0])}</td>
      <td class="n" style="color:var(--${x.oos_dll > 0 ? "good" : x.oos_dll < 0 ? "bad" : "muted"})">${x.se ? (x.oos_dll >= 0 ? "+" : "") + (1000 * x.oos_dll).toFixed(2) + "‰" : "λίγα δεδομένα"}</td></tr>`; }).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Το επιθ. ριμπάουντ μετριέται μόνο σε επίπεδο ομάδας, γι' αυτό δεν έχει β1. ± = τυπικό σφάλμα. Κέρδος εκτός δείγματος: πόσο καλύτερα (log-likelihood ανά προσπάθεια) προβλέπει κάθε αγώνα με τα β των προηγούμενων αγώνων απ' ό,τι το κλασικό log5.</p></section>`;
}

/** Διάγραμμα του κώδικα της προσομοίωσης: αριστερά η ροή αρχείων/συναρτήσεων, δεξιά μία κατοχή στο SIM.game. */
function simDiagram() {
  const t = (x, y, s, c = "") => `<text x="${x}" y="${y}" class="${c}">${s}</text>`;
  const box = (x, y, w, h, a, b, kind = "") => `<g class="dg ${kind}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>` +
    t(x + w / 2, y + (b ? h / 2 - 3 : h / 2 + 4), a, "a") + (b ? t(x + w / 2, y + h / 2 + 13, b, "b") : "") + `</g>`;
  const ar = (x1, y1, x2, y2, lab = "", dash = false) => `<path d="M${x1},${y1} L${x2},${y2}" class="dg-ar${dash ? " dash" : ""}" marker-end="url(#dgm)"/>` +
    (lab ? t((x1 + x2) / 2 + (x1 === x2 ? 6 : 0), (y1 + y2) / 2 + (x1 === x2 ? 4 : -5), lab, "lab" + (x1 === x2 ? " l" : "")) : "");
  // αριστερά: η αλυσίδα των αρχείων
  const L = [["scripts/run_sims.js", "για κάθε αγώνα της λίγκας"], ["dbAsOf(ημερομηνία)", "βάση μόνο με προηγούμενους αγώνες"],
    ["fitBeta()", "β του log5 από προηγούμενους αγώνες"], ["SIM.prepare()", "ρόστερ · συρρίκνωση · άμυνα"],
    ["SIM.many(50.000)", "καλεί SIM.game ξανά και ξανά"], ["dist() · hcap()", "ροπές · ποσοστημόρια · χάντικαπ"],
    ["site/db/sims_<λίγκα>.json → app.js", "boxplots · βαθμονόμηση · ζωντανά"]];
  let svg = t(140, 14, "Ροή του κώδικα", "h");
  L.forEach(([a, b], i) => { const y = 26 + i * 78; svg += box(20, y, 240, 54, a, b, i === 4 ? "hot" : i === 0 || i === 6 ? "file" : "");
    if (i) svg += ar(140, y - 24, 140, y - 2); });
  const ym = 26 + 4 * 78 + 27;   // SIM.many -> η αρχή του αγώνα
  svg += `<path d="M262,${ym} H282 V49 H326" class="dg-ar dash" marker-end="url(#dgm)"/>`;
  // δεξιά: μία κατοχή
  const X = 330, W = 250, SX = 640, SW = 250, row = (i) => 26 + i * 70, H = 46;
  svg += t(X + W / 2 + 155, 14, "SIM.game: μία κατοχή", "h");
  const M = [["Κατοχές ~ Κανονική(ρυθμός, 3.5)", "τζάμπολ 50/50", ""], ["Επιλογή παικτών", "επίθεση ∝ φάσεις · άμυνα ∝ λεπτά", ""],
    ["Λάθος;", "comb(β.tov)", "q"], ["Φάουλ σε σουτ;", "comb(β.ftrip)", "q"], ["Σουτ 3π ή 2π · τάπα;", "p(3π) παίκτη · τάπες αμυνόμενου", "q"],
    ["Εύστοχο;", "comb(β.fg2 / β.fg3) + έδρα", "q"], ["Ριμπάουντ", "comb(β.orb)", "q"], ["Τέλος κατοχών", "ισοπαλία → παράταση (κατοχές 5′)", ""]];
  const S = { 2: ["Λάθος (ίσως κλέψιμο)", "→ αλλαγή κατοχής"], 3: ["Βολές 2 ή 3", "άστοχη η τελευταία → ριμπάουντ"], 4: ["Τάπα", "→ ριμπάουντ"],
    5: ["Πόντοι · ασίστ · and-one", "→ αλλαγή κατοχής"], 6: ["Αμυντικό", "→ αλλαγή κατοχής"] };
  M.forEach(([a, b, k], i) => { const y = row(i); svg += box(X, y, W, H, a, b, k);
    if (i) svg += ar(X + W / 2, y - 24, X + W / 2, y - 2, i === 3 || i === 4 ? "όχι" : i === 5 ? "όχι τάπα" : i === 6 ? "άστοχο" : "");
    if (S[i]) svg += ar(X + W + 2, y + H / 2, SX - 2, y + H / 2, i === 6 ? "όχι" : "ναι") + box(SX, y, SW, H, S[i][0], S[i][1], "out"); });
  // επιθετικό ριμπάουντ: η κατοχή συνεχίζει
  const yr = row(6) + H / 2, y1 = row(1) + H / 2;
  svg += `<path d="M${X - 2},${yr} H${X - 30} V${y1} H${X - 4}" class="dg-ar" marker-end="url(#dgm)"/>` + t(X - 15, yr - 6, "επιθ.", "lab");
  // όλες οι «αλλαγές κατοχής» -> επόμενη κατοχή
  svg += `<path d="M${SX + SW + 2},${row(6) + H / 2} H${SX + SW + 14} V${row(1) + H / 2} H${X + W + 4}" class="dg-ar dash" marker-end="url(#dgm)"/>` +
    t(SX + SW / 2 + 10, row(1) + H / 2 - 6, "επόμενη κατοχή (ο αντίπαλος)", "lab");
  return `<section class="card"><h2>Διάγραμμα του κώδικα</h2>
    <p style="margin:0 0 8px;max-width:80ch">Αριστερά: τι καλεί τι, από τα δεδομένα μέχρι το σάιτ (<span class="num">scripts/run_sims.js</span>, <span class="num">site/sim.js</span>, <span class="num">site/app.js</span>). Δεξιά: τι συμβαίνει σε κάθε κατοχή μέσα στο <span class="num">SIM.game</span>. Όπου γράφει <span class="num">comb(β…)</span> ρίχνεται ένα ζάρι με πιθανότητα από το log5 με βάρη.</p>
    <div class="dg-wrap"><svg viewBox="0 0 920 600" class="dg-svg" role="img" aria-label="Διάγραμμα της προσομοίωσης">
      <defs><marker id="dgm" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
      ${svg}</svg></div></section>`;
}

// ----------------------------------------------------------------------------- Αξία: μοντέλο απέναντι στις αποδόσεις
const MKT = { ml: "Νίκη", spread: "Χάντικαπ", total: "Σύνολο" };
const VAL = { code: "", mkt: "ml_home", line: "", odds: "", bank: LS.get("val_bank") || 100, frac: LS.get("val_frac") || "0.25" };
const VAL_MKTS = [["ml_home", "Νίκη γηπεδούχου"], ["ml_away", "Νίκη φιλοξενούμενου"], ["sp_home", "Χάντικαπ γηπεδούχου"], ["sp_away", "Χάντικαπ φιλοξενούμενου"], ["over", "Over (σύνολο)"], ["under", "Under (σύνολο)"]];
const VAL_FRAC = [["0.25", "¼ Kelly (προτείνεται)"], ["0.5", "½ Kelly"], ["1", "ολόκληρο Kelly"]];
const sgnL = (v) => (v > 0 ? "+" : "") + v;
/** Πιθανότητα του μοντέλου για μια αγορά ενός επόμενου αγώνα: { win, push } */
function valProb(S, mkt, line) {
  if (mkt === "ml_home") return { win: S.p_home, push: 0 };
  if (mkt === "ml_away") return { win: 1 - S.p_home, push: 0 };
  if (mkt === "sp_home") return SIM.lineProb(S.margin, line, 1);
  if (mkt === "sp_away") return SIM.lineProb(S.margin, -line, -1);
  if (mkt === "over") return SIM.lineProb(S.total, -line, 1);
  if (mkt === "under") return SIM.lineProb(S.total, -line, -1);
  return null;
}
/** Ο υπολογισμός, με όλα τα βήματα και τους αριθμούς. */
function valCalc() {
  const S = SIMS?.games?.[VAL.code]; if (!S) return `<div class="muted">Διάλεξε αγώνα.</div>`;
  const num = (x) => +String(x).replace(",", ".").replace("−", "-");
  const needLine = !VAL.mkt.startsWith("ml"), line = num(VAL.line), odds = num(VAL.odds), bank = num(VAL.bank) || 0, frac = +VAL.frac || 0.25, CAP = 0.03;
  if (needLine && (VAL.line === "" || !Number.isFinite(line))) return `<div class="muted">Βάλε τη γραμμή, όπως τη γράφει ο bookmaker (π.χ. ${VAL.mkt.startsWith("sp") ? "−4.5" : Math.round(S.total.p50) + 0.5}).</div>`;
  const P = valProb(S, VAL.mkt, line); if (!P) return `<div class="muted">Δεν υπάρχει κατανομή για αυτόν τον αγώνα.</div>`;
  const p = P.win, push = P.push, q = 1 - p - push, fair = p > 0 ? (1 - push) / p : null, n = SIMS.n;
  const head = `<div class="tiles">${tile(pct(p), "πιθανότητα να κερδίσει")}${push ? tile(pct(push), "επιστροφή (push)") : ""}${tile(fair ? fair.toFixed(2) : "–", "δίκαιη απόδοση")}`;
  if (!(odds > 1)) return head + `</div><div class="muted" style="font-size:13px;margin-top:6px">Βάλε την απόδοση του bookmaker. Αξία έχει μόνο αν είναι μεγαλύτερη από τη δίκαιη (${fair ? fair.toFixed(2) : "–"}).</div>`;
  const b = odds - 1, ev = p * odds + push - 1, fStar = Math.max(0, (b * p - q) / b), f = Math.min(CAP, frac * fStar), stake = bank * f;
  const has = ev >= 0.05 && fStar > 0;
  const verdict = has ? ["good", `Έχει αξία: παίξε ${stake.toFixed(2)} (${(100 * f).toFixed(1)}% του κεφαλαίου)`] : ev > 0 ? ["muted", "Οριακή αξία (κάτω από 5%): μην το παίξεις, είναι μέσα στο λάθος του μοντέλου"] : ["bad", "Χωρίς αξία: μην το παίξεις"];
  const r2 = (x) => x.toFixed(2), r3 = (x) => x.toFixed(3);
  return head + `${tile(`<span style="color:var(--${ev > 0 ? "good" : "bad"})">${sgnL(+(100 * ev).toFixed(1))}%</span>`, "αναμενόμενη απόδοση")}${tile(has ? stake.toFixed(2) : "0", `ποσό (κεφάλαιο ${bank})`)}</div>
    <div style="margin:10px 0 6px;font-weight:700;font-size:16px;color:var(--${verdict[0]})">${verdict[1]}</div>
    <details class="tree"><summary>Πώς βγήκαν αυτοί οι αριθμοί</summary><ol style="margin:6px 0 0;padding-left:20px;font-size:14px;line-height:1.6">
      <li><b>Πιθανότητα</b> p = ${r3(p)}: στις ${n.toLocaleString("el-GR")} προσομοιώσεις του αγώνα, το στοίχημα κερδίζει στο ${pct(p)}${push ? `, επιστροφή στο ${pct(push)}` : ""}, χάνει στο ${pct(q)} (q = ${r3(q)}).</li>
      <li><b>Δίκαιη απόδοση</b> = (1 − push) / p = ${fair ? r2(fair) : "–"}: η απόδοση στην οποία ούτε κερδίζεις ούτε χάνεις μακροπρόθεσμα.</li>
      <li><b>Αναμενόμενη απόδοση</b> (EV) = p × απόδοση + push − 1 = ${r3(p)} × ${r2(odds)}${push ? ` + ${r3(push)}` : ""} − 1 = <b>${sgnL(+(100 * ev).toFixed(1))}%</b> ανά ευρώ. Θετική = κερδίζεις μακροπρόθεσμα· κάτω από 5% δεν το παίζουμε, γιατί το μοντέλο έχει κι αυτό λάθη.</li>
      <li><b>Kelly</b>: f* = (b × p − q) / b, με b = απόδοση − 1 = ${r2(b)} → f* = (${r2(b)} × ${r3(p)} − ${r3(q)}) / ${r2(b)} = <b>${(100 * fStar).toFixed(1)}%</b> του κεφαλαίου. Είναι το ποσοστό που μεγαλώνει το κεφάλαιο όσο πιο γρήγορα γίνεται, <i>αν</i> το p είναι ακριβώς σωστό.</li>
      <li><b>Κλάσμα</b>: επειδή το p είναι εκτίμηση, παίζουμε ${frac === 1 ? "ολόκληρο" : frac === 0.5 ? "το ½" : "το ¼"} του Kelly και το πολύ ${Math.round(100 * CAP)}% του κεφαλαίου: ${frac} × ${(100 * fStar).toFixed(1)}% = ${(100 * frac * fStar).toFixed(1)}%${frac * fStar > CAP ? ` → όριο ${Math.round(100 * CAP)}%` : ""} → <b>${bank} × ${(100 * f).toFixed(1)}% = ${stake.toFixed(2)}</b>.</li>
    </ol></details>`;
}
/** Το πλαίσιο: fixed = κωδικός αγώνα (στη σελίδα του αγώνα), αλλιώς επιλογή αγώνα. */
function valForm(fixed) {
  const up = SIMS ? Object.entries(SIMS.games).filter(([, S]) => !S.played && S.margin?.hist).sort((a, b) => a[1].date.localeCompare(b[1].date)) : [];
  if (fixed) VAL.code = fixed; else if (!SIMS?.games?.[VAL.code] || SIMS.games[VAL.code].played) VAL.code = up[0]?.[0] || "";
  const S = SIMS?.games?.[VAL.code]; if (!S) return "";
  const H = team(S.home).name, A = team(S.away).name;
  const lab = { ml_home: `Νίκη ${H}`, ml_away: `Νίκη ${A}`, sp_home: `Χάντικαπ ${H}`, sp_away: `Χάντικαπ ${A}` };
  return `<div class="filters">${fixed ? "" : `<label style="max-width:100%;min-width:0">Αγώνας<select data-val="code" style="max-width:100%">${up.map(([c, x]) => `<option value="${c}" ${c === VAL.code ? "selected" : ""}>${dateGR(x.date, true)} · ${esc(team(x.home).name)} – ${esc(team(x.away).name)}</option>`).join("")}</select></label>`}
      <label style="max-width:100%;min-width:0">Στοίχημα<select data-val="mkt" style="max-width:100%">${VAL_MKTS.map(([k, l]) => `<option value="${k}" ${k === VAL.mkt ? "selected" : ""}>${esc(lab[k] || l)}</option>`).join("")}</select></label>
      <label>Γραμμή<input data-val="line" inputmode="decimal" placeholder="${VAL.mkt.startsWith("ml") ? "—" : VAL.mkt.startsWith("sp") ? "π.χ. −4.5" : "π.χ. " + (Math.round(S.total.p50) + 0.5)}" value="${esc(VAL.line)}" style="width:100px" ${VAL.mkt.startsWith("ml") ? "disabled" : ""}></label>
      <label>Απόδοση<input data-val="odds" inputmode="decimal" placeholder="π.χ. 1.90" value="${esc(VAL.odds)}" style="width:90px"></label>
      <label>Κεφάλαιο<input data-val="bank" inputmode="decimal" value="${esc(VAL.bank)}" style="width:90px"></label>
      <label>Kelly<select data-val="frac">${VAL_FRAC.map(([k, l]) => `<option value="${k}" ${k === String(VAL.frac) ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <div id="val-out" style="margin-top:10px">${valCalc()}</div>
    <p class="muted" style="font-size:12px;margin-bottom:0">Δεκαδικές αποδόσεις (όπως στους ελληνικούς bookmakers). Χάντικαπ: η γραμμή από τη μεριά της ομάδας που διαλέγεις (−4.5 = πρέπει να κερδίσει με 5+). Στις ακέραιες γραμμές μετράει και η επιστροφή.</p>`;
}
Views.value = () => {
  const V = SIMS?.value, up = SIMS ? Object.entries(SIMS.games).filter(([, S]) => !S.played && S.margin?.hist).sort((a, b) => a[1].date.localeCompare(b[1].date)) : [];
  if (!VAL.code && up.length) VAL.code = up[0][0];
  const fairRow = ([code, S]) => { const ph = S.p_home, ml = S.hcap?.fair ?? -S.margin.p50, tl = S.total.p50;
    const ov = SIM.lineProb(S.total, -(Math.floor(tl) + 0.5), 1);
    return `<tr><td><a href="#/game/${code}">${dateGR(S.date, true)}</a></td><td>${badge(S.home, 18)} ${esc(team(S.home).abbr)} – ${badge(S.away, 18)} ${esc(team(S.away).abbr)}</td>
      <td class="n">${pct(ph)}</td><td class="n"><b>${(1 / ph).toFixed(2)}</b></td><td class="n"><b>${(1 / (1 - ph)).toFixed(2)}</b></td>
      <td class="n">${sgnL(+(-S.margin.p50).toFixed(1))}</td><td class="n">${tl}</td><td class="n">${ov ? pct(ov.win) : "–"}</td></tr>`; };
  const vb = (V?.upcoming || []).flatMap((g) => g.markets.filter((m) => m.value).map((m) => ({ ...m, g })));
  const sideLab = (m, g) => m.market === "ml" ? `${m.side === "home" ? esc(team(g.home).abbr) : esc(team(g.away).abbr)} νίκη` : m.market === "spread" ? `${m.side === "home" ? esc(team(g.home).abbr) : esc(team(g.away).abbr)} ${sgnL(m.line)}` : `${m.side === "over" ? "Over" : "Under"} ${m.line}`;
  const Lg = V?.ledger;
  return `<section class="card"><h2>Αξία</h2>
    <p style="margin:0 0 8px;max-width:80ch">Ένα στοίχημα έχει <b>αξία</b> όταν η πιθανότητα του μοντέλου επί την απόδοση ξεπερνά καθαρά το 1. Βάζεις την απόδοση που βλέπεις στον bookmaker σου και ο υπολογιστής λέει αν έχει αξία και πόσο να παίξεις. Κανόνες: μόνο όταν η αναμενόμενη απόδοση είναι ≥ 5% (περιθώριο για τα λάθη του μοντέλου), <b>μονά</b> στοιχήματα (όχι παρολί: πολλαπλασιάζουν και το περιθώριο του bookmaker και τα λάθη), ποσό με ¼ Kelly και το πολύ 3% του ταμείου.</p>
    ${V?.has_odds ? (() => { const ck = (V.upcoming || []).flatMap((g) => g.markets.filter((m) => m.check && m.ev >= V.rules.min_ev).map((m) => ({ ...m, g })));
      return ck.length ? `<p class="muted" style="font-size:13px;margin:0">Δεν προτείνονται ${ck.length} επιλογές με «αξία» όπου το μοντέλο διαφωνεί με την αγορά πάνω από ${Math.round(100 * V.rules.max_gap)} μονάδες ή η απόδοση είναι πάνω από ${V.rules.max_odds}: εκεί η αγορά συνήθως ξέρει κάτι (απουσία, τραυματισμός). ${ck.slice(0, 4).map((m) => `${esc(team(m.g.home).abbr)}–${esc(team(m.g.away).abbr)} ${m.market === "total" ? (m.side === "over" ? "Over " : "Under ") + m.line : m.side === "home" ? esc(team(m.g.home).abbr) : esc(team(m.g.away).abbr)} (${pct(m.p)} έναντι ${pct(m.market_p)})`).join(" · ")}</p>` : ""; })() : ""}</section>
  ${V?.has_odds ? `<section><h2>Στοιχήματα με αξία τώρα</h2>${vb.length ? `<div class="tbl"><table><thead><tr><th>Αγώνας</th><th>Επιλογή</th><th class="n">απόδοση</th><th class="n">μοντέλο</th><th class="n">αγορά</th><th class="n">αναμ. απόδοση</th><th class="n">ποσό (% ταμείου)</th></tr></thead><tbody>
    ${vb.sort((a, b) => b.ev - a.ev).map((m) => `<tr><td><a href="#/game/${m.g.code}">${dateGR(m.g.date, true)} ${esc(team(m.g.home).abbr)}–${esc(team(m.g.away).abbr)}</a></td><td><b>${sideLab(m, m.g)}</b> <span class="muted" style="font-size:11px">${MKT[m.market]}</span></td>
      <td class="n">${m.odds.toFixed(2)}</td><td class="n">${pct(m.p)}</td><td class="n">${m.market_p != null ? pct(m.market_p) : "–"}</td><td class="n" style="color:var(--good)">+${(100 * m.ev).toFixed(1)}%</td><td class="n"><b>${(100 * m.stake).toFixed(1)}%</b></td></tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">«αγορά»: η πιθανότητα που δίνουν οι bookmakers χωρίς το περιθώριό τους (μέσος όρος).</p>` : `<div class="empty">Κανένα στοίχημα με αξία ≥ ${Math.round(100 * V.rules.min_ev)}% αυτή τη στιγμή.</div>`}</section>` : ""}
  <section><h2>Δίκαιες αποδόσεις του μοντέλου</h2>${up.length ? `<div class="tbl"><table><thead><tr><th>Ημ/νία</th><th>Αγώνας</th><th class="n">P(γηπ.)</th><th class="n">1</th><th class="n">2</th><th class="n">χάντικαπ γηπ.</th><th class="n">σύνολο</th><th class="n">P(over)</th></tr></thead><tbody>${up.map(fairRow).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">1/2: δίκαιες αποδόσεις νίκης (χωρίς περιθώριο). Χάντικαπ: η διάμεσος της διαφοράς από τη μεριά του γηπεδούχου. Σύνολο: διάμεσος· P(over) για τη μισή γραμμή πάνω από τη διάμεσο. Από ${SIMS.n.toLocaleString("el-GR")} προσομοιώσεις ανά αγώνα (με ratings και αβεβαιότητα).</p>` : `<div class="empty">Δεν υπάρχουν επόμενοι αγώνες με προσομοίωση.</div>`}</section>
  <section class="card" style="border-left:4px solid var(--bad)"><b>Προσοχή:</b> σε backtest με τις αποδόσεις κλεισίματος της φετινής σεζόν, κανένας κανόνας στοιχηματισμού πάνω σε αυτό το μοντέλο δεν κέρδισε σε αγώνες που δεν είχε δει. <a href="#/strategy">Δες τη μελέτη «Στρατηγική» →</a></section>
  <section class="card" id="val-calc"><h2>Έχει αξία;</h2><div id="val-form">${valForm()}</div></section>
  ${valHelp()}
  ${Lg && (Lg.n || Lg.open) ? `<section class="card"><h2>Ημερολόγιο (εικονικά στοιχήματα)</h2>
    <div class="tiles">${tile(Lg.n, "τακτοποιημένα")}${tile(Lg.open, "ανοιχτά")}${tile(Lg.n ? pct(Lg.wins / Lg.n) : "–", "κερδισμένα")}${tile(Lg.roi != null ? `<span style="color:var(--${Lg.roi >= 0 ? "good" : "bad"})">${sgnL(+(100 * Lg.roi).toFixed(1))}%</span>` : "–", "απόδοση (ROI)")}
      ${Lg.vs_market ? tile(`${Lg.vs_market.brier_model.toFixed(3)} / ${Lg.vs_market.brier_market.toFixed(3)}`, `Brier μοντέλο / αγορά (${Lg.vs_market.n} αγ.)`) : ""}</div>
    <div class="tbl" style="margin-top:10px"><table><thead><tr><th>Αγώνας</th><th>Επιλογή</th><th class="n">απόδοση</th><th class="n">μοντέλο</th><th class="n">ποσό</th><th>αποτέλεσμα</th></tr></thead><tbody>
      ${Lg.recent.map((b) => `<tr><td><a href="#/game/${b.code}">${dateGR(b.date, true)} ${esc(team(b.home).abbr)}–${esc(team(b.away).abbr)}</a></td><td>${sideLab(b, b)}</td><td class="n">${b.odds.toFixed(2)}</td><td class="n">${pct(b.p)}</td><td class="n">${(100 * b.stake).toFixed(1)}%</td>
        <td style="color:var(--${b.result === "win" ? "good" : b.result === "loss" ? "bad" : "muted"})">${b.result === "win" ? "κέρδος" : b.result === "loss" ? "χάθηκε" : b.result === "push" ? "επιστροφή" : "ανοιχτό"}${b.profit ? ` (${sgnL(+(100 * b.profit).toFixed(2))}%)` : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Κάθε στοίχημα με αξία καταγράφεται με την τελευταία απόδοση πριν από τον αγώνα και τακτοποιείται αυτόματα. Το κριτήριο που μετράει: αν σε βάθος χρόνου το ROI μένει θετικό και αν το Brier του μοντέλου πλησιάζει ή κερδίζει της αγοράς. Με λίγες δεκάδες στοιχήματα, το αποτέλεσμα είναι κυρίως τύχη.</p></section>` : ""}`;
};
Views.value.bind = () => {};
/** Εξήγηση: από πού έρχεται η πιθανότητα, τι είναι αξία, τι είναι Kelly. */
function valHelp() {
  return `<section class="card"><h2>Πώς υπολογίζεται</h2><div style="max-width:80ch;font-size:14px;line-height:1.65">
    <p style="margin-top:0"><b>1. Η πιθανότητα (p).</b> Κάθε επόμενος αγώνας παίζεται ${SIMS ? SIMS.n.toLocaleString("el-GR") : "50.000"} φορές στην προσομοίωση, φάση-φάση, από τα στατιστικά των παικτών, διορθωμένη με τα ratings των ομάδων και με την αβεβαιότητα (λεπτά, μέρα αγώνα). Για ένα στοίχημα μετράμε σε πόσες από αυτές κερδίζει: αν ο Άρης κερδίζει με 5+ σε 27.500 από τις 50.000, τότε για το «Άρης −4.5» p = 55%. Στις ακέραιες γραμμές (π.χ. −5) μετράμε χωριστά και τις ισοπαλίες της γραμμής (επιστροφή).</p>
    <p><b>2. Η δίκαιη απόδοση</b> = 1 / p (π.χ. p = 55% → 1.82). Αν ο bookmaker δίνει περισσότερο από αυτό, το στοίχημα έχει θετική αναμενόμενη απόδοση· αν δίνει λιγότερο, χάνεις μακροπρόθεσμα όσο καλή κι αν μοιάζει η επιλογή.</p>
    <p><b>3. Η αναμενόμενη απόδοση (EV)</b> = p × απόδοση − 1. Με p = 55% και απόδοση 1.95: 0.55 × 1.95 − 1 = +7.3%: κατά μέσο όρο κερδίζεις 7.3 λεπτά ανά ευρώ. Παίζουμε μόνο όταν είναι ≥ 5%, γιατί και το μοντέλο κάνει λάθη (στη βαθμονόμηση βγαίνει σωστό στο ~60–75% των νικητών, ανάλογα με τη λίγκα).</p>
    <p><b>4. Πόσο να παίξεις: το κριτήριο Kelly.</b> f* = (b × p − q) / b, όπου b = απόδοση − 1 (το καθαρό κέρδος ανά ευρώ) και q = 1 − p η πιθανότητα να χάσεις. Με p = 0.55, απόδοση 1.95: b = 0.95, f* = (0.95 × 0.55 − 0.45) / 0.95 = 7.6% του κεφαλαίου. Είναι το ποσοστό που μεγαλώνει το κεφάλαιο όσο πιο γρήγορα γίνεται μακροπρόθεσμα — αλλά μόνο αν το p είναι ακριβώς σωστό. Αν το μοντέλο υπερεκτιμά έστω και λίγο, το ολόκληρο Kelly οδηγεί σε μεγάλες απώλειες.</p>
    <p><b>5. Γι' αυτό ¼ Kelly και όριο 3%.</b> Παίζουμε το ένα τέταρτο: 7.6% / 4 = 1.9% του κεφαλαίου (με κεφάλαιο 100: 1.90). Κρατά το μεγαλύτερο μέρος της ανάπτυξης με πολύ μικρότερο ρίσκο, και κανένα στοίχημα δεν ξεπερνά το 3%. Το κεφάλαιο ενημερώνεται μετά από κάθε στοίχημα (το ποσό είναι πάντα ποσοστό του τωρινού).</p>
    <p style="margin-bottom:0"><b>Μονά, όχι παρολί.</b> Σε ένα παρολί πολλαπλασιάζονται οι αποδόσεις αλλά και το περιθώριο του bookmaker (≈5% ανά επιλογή) και τα λάθη του μοντέλου· ένα 10× παρολί σχεδόν πάντα έχει αρνητική αναμενόμενη απόδοση, ακόμη κι όταν κάθε επιλογή μοιάζει καλή.</p></div></section>`;
}

// ----------------------------------------------------------------------------- Στρατηγική: γενετικός αλγόριθμος
let STRAT = null;
const fmtN = (v) => (v >= 100 ? Math.round(v).toLocaleString("el-GR") : v.toFixed(1));
/** Γράφημα κεφαλαίου (λογαριθμικός άξονας, ένας άξονας): series [{ pts: [[ημ/νία, τιμή]], cls, label, dash }] */
function bankChart(series, { cut, w = 720, h = 300 } = {}) {
  const all = series.flatMap((s) => s.pts), dates = [...new Set(all.map((p) => p[0]))].sort();
  const vals = all.map((p) => p[1]).filter((v) => v > 0), lo = Math.max(10, Math.min(50, ...vals) * 0.8), hi = Math.max(150, ...vals) * 1.15;
  const L = 46, R = 92, T = 12, B = 28, X = (d) => L + ((w - L - R) * dates.indexOf(d)) / Math.max(1, dates.length - 1),
    Y = (v) => T + (h - T - B) * (1 - (Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
  let g = "";
  for (const v of [12.5, 25, 50, 100, 200, 400, 800, 1600, 3200].filter((v) => v >= lo && v <= hi))
    g += `<line x1="${L}" x2="${w - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v === 100 ? "" : 'stroke-dasharray="2 4"'}/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${fmtN(v)}</text>`;
  if (cut && dates.includes(cut)) g += `<line x1="${X(cut)}" x2="${X(cut)}" y1="${T}" y2="${h - B}" stroke="var(--muted)" stroke-dasharray="4 3"/><text x="${X(cut) + 5}" y="${h - B - 6}" class="ax">δοκιμή →</text><text x="${X(cut) - 5}" y="${h - B - 6}" class="ax" text-anchor="end">← εκπαίδευση</text>`;
  [0, Math.floor(dates.length / 2), dates.length - 1].forEach((i) => { if (dates[i]) g += `<text x="${X(dates[i])}" y="${h - 8}" text-anchor="middle" class="ax">${dateGR(dates[i])}</text>`; });
  // ετικέτες στο τέλος: χωρίς επικαλύψεις (τουλάχιστον 14px κάθετη απόσταση)
  const ends = series.filter((s) => s.pts.length).map((s) => ({ s, y: Y(s.pts.at(-1)[1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  const labY = new Map(ends.map((e) => [e.s, e.y]));
  for (const s of series) {
    if (!s.pts.length) continue;
    g += `<polyline fill="none" class="${s.cls}" stroke-width="2" ${s.dash ? 'stroke-dasharray="6 4"' : ""} points="${s.pts.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`;
    g += s.pts.map(([d, v]) => `<circle cx="${X(d).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="7" fill="transparent"><title>${esc(s.label)} · ${dateGR(d)}: ${fmtN(v)}</title></circle>`).join("");
    const [d, v] = s.pts.at(-1); g += `<circle cx="${X(d)}" cy="${Y(v)}" r="4" class="${s.cls} dot"/><text x="${X(d) + 8}" y="${labY.get(s) + 4}" class="lab">${esc(s.short || "")} ${fmtN(v)}</text>`;
  }
  return `<svg viewBox="0 0 ${w} ${h}" class="st-chart" role="img" aria-label="Εξέλιξη κεφαλαίου">${g}</svg>
    <div class="st-legend">${series.map((s) => `<span><i class="${s.cls}${s.dash ? " dash" : ""}"></i>${esc(s.label)}</span>`).join("")}</div>`;
}
/** Λωρίδα κουκκίδων: οι ψεύτικες σεζόν (γκρι) και η πραγματική (χρώμα), σε λογαριθμικό άξονα. */
function nullStrip(vals, real, label) {
  const w = 720, h = 70, L = 46, R = 20, lo = Math.max(5, Math.min(real, ...vals) * 0.8), hi = Math.max(real, ...vals) * 1.2;
  const X = (v) => L + ((w - L - R) * (Math.log(v) - Math.log(lo))) / (Math.log(hi) - Math.log(lo));
  let g = `<line x1="${L}" x2="${w - R}" y1="38" y2="38" stroke="var(--line)"/>`;
  for (const v of [12.5, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400].filter((v) => v >= lo && v <= hi)) g += `<line x1="${X(v)}" x2="${X(v)}" y1="34" y2="42" stroke="var(--line)"/><text x="${X(v)}" y="62" text-anchor="middle" class="ax">${fmtN(v)}</text>`;
  const sorted = [...vals].sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  vals.forEach((v, i) => { g += `<circle cx="${X(v).toFixed(1)}" cy="${30 - (i % 4) * 6}" r="3.2" fill="var(--muted)" opacity=".55"><title>ψεύτικη σεζόν: ${fmtN(v)}</title></circle>`; });
  g += `<line x1="${X(med)}" x2="${X(med)}" y1="8" y2="42" stroke="var(--muted)" stroke-width="2"/><text x="${X(med)}" y="7" text-anchor="middle" class="ax">διάμεσος ${fmtN(med)}</text>`;
  g += `<circle cx="${X(real)}" cy="38" r="6" class="st-a dot"><title>πραγματική: ${fmtN(real)}</title></circle><text x="${X(real)}" y="54" text-anchor="middle" class="lab">πραγματική ${fmtN(real)}</text>`;
  return `<div style="font-size:13px;margin-top:6px">${label}</div><svg viewBox="0 0 ${w} ${h}" class="st-chart" role="img" aria-label="${esc(label)}">${g}</svg>`;
}
function fitChart(hist) {
  const w = 340, h = 150, L = 34, R = 10, T = 10, B = 22, n = hist.length, all = hist.flat(), lo = Math.min(...all), hi = Math.max(...all);
  const X = (i) => L + ((w - L - R) * i) / Math.max(1, n - 1), Y = (v) => T + (h - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const line = (k, cls) => `<polyline fill="none" class="${cls}" stroke-width="2" points="${hist.map((x, i) => `${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join(" ")}"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" class="st-chart" role="img" aria-label="Σύγκλιση"><line x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}" stroke="var(--line)"/>
    ${line(0, "st-a")}${line(1, "st-b")}<text x="${L}" y="${h - 6}" class="ax">γενιά 1</text><text x="${w - R}" y="${h - 6}" class="ax" text-anchor="end">${n}</text></svg>
    <div class="st-legend"><span><i class="st-a"></i>καλύτερη στρατηγική</span><span><i class="st-b"></i>μέσος όρος πληθυσμού</span></div>`;
}
const stratText = (s) => [s.legs === 1 ? "μονά" : `παρολί ${s.legs} επιλογών`, `αξία ≥ ${Math.round(100 * s.minEv)}%`, `αποδόσεις ${s.minOdds}–${s.maxOdds}`,
  s.fav !== "όλα" ? s.fav : "", s.ha !== "όλα" ? s.ha : "", `λίγκες ${s.leagues.map((L) => ({ GBL: "GBL", E: "EuroLeague", U: "EuroCup" })[L]).join(", ")}`,
  s.k != null ? `μοντέλο ×${s.k} στα log-odds` : "", s.alpha ? `${Math.round(100 * s.alpha)}% αγορά` : "", `${s.frac >= 0.99 ? "ολόκληρο" : Math.round(100 * s.frac) + "%"} Kelly${s.cap != null ? `, έως ${(100 * s.cap).toFixed(1)}% ανά στοίχημα` : ""}`].filter(Boolean).join(" · ");
Views.strategy = () => {
  if (!STRAT) { fetch("strategy.json?v=__BUILD__").then((r) => (r.ok ? r.json() : null)).then((x) => { STRAT = x || { error: true }; if (route().view === "strategy") render(); }).catch(() => { STRAT = { error: true }; render(); });
    return `<div class="empty">Φόρτωση…</div>`; }
  if (STRAT.error) return `<div class="empty">Τα αποτελέσματα δεν βρέθηκαν.</div>`;
  const S = STRAT, B = S.best, C = S.safe, O = S.refs.ours, q = (a, p) => { a = [...a].sort((x, y) => x - y); return a[Math.floor(p * (a.length - 1))]; };
  const hero = (v, l, cls = "") => `<div class="tile st-hero"><div class="v ${cls}">${v}</div><div class="l">${l}</div></div>`;
  const pc = (x) => `<span style="color:var(--${x >= 0 ? "good" : "bad"})">${x >= 0 ? "+" : ""}${(100 * x).toFixed(0)}%</span>`;
  const curveFull = [...B.curve_train, ...B.curve_test.map(([d, v]) => [d, (v * B.train.final) / 100])];
  return `<section class="card"><h2>Η καλύτερη στρατηγική στοιχηματισμού: τι βρήκε ο γενετικός αλγόριθμος</h2>
    <p style="margin:0 0 10px;max-width:80ch">${S.games} παιγμένοι αγώνες GBL, EuroLeague και EuroCup της φετινής σεζόν (${dateGR(S.split.from)} – ${dateGR(S.split.to)}), με την πιθανότητα της προσομοίωσης (κάθε αγώνας μόνο με τους προηγούμενους) και τις μέσες αποδόσεις κλεισίματος (betexplorer, περιθώριο bookmaker ${(100 * S.margin).toFixed(1)}%).
    Ο αλγόριθμος ψάχνει ανάμεσα σε μονά και παρολί, όρια αξίας και αποδόσεων, φαβορί/αουτσάιντερ, λίγκες και μέγεθος πονταρίσματος (Kelly). <b>Μαθαίνει</b> στους πρώτους ${S.split.train_games} αγώνες και <b>κρίνεται</b> στους επόμενους ${S.split.test_games}, που δεν έχει δει.</p>
    <div class="tiles">${hero("100 → " + fmtN(B.train.final), "στους αγώνες που «έμαθε»", "good")}${hero("100 → " + fmtN(B.test.final), "στους αγώνες που δεν είχε δει", "bad")}${hero("100 → " + fmtN(S.rolling.final), "αν τον χρησιμοποιούσαμε όλη τη σεζόν (κυλιόμενα)", "bad")}${hero(fmtN(q(S.nulls.train_final, 0.5)), "διάμεσο «κέρδος» σε σεζόν χωρίς καμία ευκαιρία")}</div>
    <p style="margin:12px 0 0;max-width:80ch;font-size:15px"><b>Συμπέρασμα:</b> δεν υπάρχει κερδοφόρα στρατηγική με αυτό το μοντέλο απέναντι στις αποδόσεις κλεισίματος. Ό,τι «δουλεύει» στους αγώνες που ο αλγόριθμος έχει δει είναι τύχη: σε ${S.nulls.n} ψεύτικες σεζόν όπου η αγορά έχει πάντα δίκιο, βρίσκει το ίδιο εύκολα «στρατηγικές» που πολλαπλασιάζουν το κεφάλαιο — και χάνουν μόλις παιχτούν σε νέους αγώνες.</p></section>
  <section class="card"><h2>Εξέλιξη κεφαλαίου</h2>
    ${bankChart([{ pts: curveFull, cls: "st-a", label: "Γενετικός (καλύτερη στην εκπαίδευση)", short: "ΓΑ" }, { pts: [...(C.curve_train || []), ...(C.curve_test || []).map(([d, v]) => [d, (v * C.train.final) / 100])], cls: "st-a", dash: true, label: "Γενετικός, συντηρητικός", short: "ΓΑ-σ" },
      { pts: S.rolling.curve, cls: "st-b", label: "Κυλιόμενα (μαθαίνει μόνο από το παρελθόν)", short: "κυλ." }, { pts: O.curve_test.map(([d, v]) => [d, (v * O.train.final) / 100]), cls: "st-c", label: "Οι κανόνες της «Αξίας» (δοκιμή)", short: "Αξία" }], { cut: S.cut })}
    <p class="muted" style="font-size:12px">Λογαριθμικός άξονας (κάθε γραμμή διπλασιάζει). Οι στρατηγικές του γενετικού στη δοκιμή ξεκινούν από όπου έφτασαν στην εκπαίδευση: η πτώση μετά τη διακεκομμένη γραμμή είναι η αλήθεια. Δείξε με το ποντίκι για τιμές.</p></section>
  <section class="card"><h2>Τύχη ή ικανότητα;</h2>
    <p style="margin:0 0 6px;max-width:80ch">Ο ίδιος αλγόριθμος έτρεξε σε ${S.nulls.n} «ψεύτικες» σεζόν: ίδιοι αγώνες, ίδιες αποδόσεις, αλλά τα αποτελέσματα κληρώθηκαν από τις πιθανότητες της αγοράς — άρα κανένα πλεονέκτημα δεν υπάρχει. Κάθε γκρι κουκκίδα είναι μια τέτοια σεζόν.</p>
    ${nullStrip(S.nulls.train_final, S.nulls.real_train_final, "Τελικό κεφάλαιο στους αγώνες που «έμαθε» (από 100)")}
    ${nullStrip(S.nulls.test_final, S.nulls.real_test_final, "Τελικό κεφάλαιο στους αγώνες που δεν είχε δει (από 100)")}
    <p class="muted" style="font-size:12px">Στην εκπαίδευση η πραγματική σεζόν (${fmtN(S.nulls.real_train_final)}) είναι μέσα στο εύρος της τύχης: το ${Math.round(100 * S.nulls.share_better_or_equal)}% των ψεύτικων σεζόν τα πήγε εξίσου ή καλύτερα. Στη δοκιμή, οι ψεύτικες σεζόν χάνουν κατά διάμεσο όρο ${100 - Math.round(q(S.nulls.test_final, 0.5))}% — περίπου όσο το περιθώριο του bookmaker επί τα στοιχήματα — και η πραγματική χάνει ${100 - Math.round(S.nulls.real_test_final)}%.</p></section>
  <section class="grid">
    <div class="card"><h3>Η «καλύτερη» στρατηγική</h3><p style="margin:0;font-size:14px">${esc(stratText(B.strategy))}</p>
      <div class="tbl" style="margin-top:8px"><table><thead><tr><th></th><th class="n">στοιχήματα</th><th class="n">κερδισμένα</th><th class="n">ROI</th><th class="n">κεφάλαιο</th><th class="n">μέγ. πτώση</th></tr></thead><tbody>
        <tr><td>εκπαίδευση</td><td class="n">${B.train.n}</td><td class="n">${B.train.wins}</td><td class="n">${pc(B.train.roi)}</td><td class="n">${fmtN(B.train.final)}</td><td class="n">${Math.round(100 * B.train.max_dd)}%</td></tr>
        <tr><td>δοκιμή</td><td class="n">${B.test.n}</td><td class="n">${B.test.wins}</td><td class="n">${pc(B.test.roi)}</td><td class="n">${fmtN(B.test.final)}</td><td class="n">${Math.round(100 * B.test.max_dd)}%</td></tr></tbody></table></div>
      <h3 style="margin-top:12px">Συντηρητική εκδοχή</h3><p style="margin:0;font-size:14px">${esc(stratText(C.strategy))}</p>
      <p class="muted" style="font-size:13px">Βαριά ποινή στις πτώσεις, τουλάχιστον 30 στοιχήματα: εκπαίδευση 100 → ${fmtN(C.train.final)}, δοκιμή 100 → ${fmtN(C.test.final)}, κυλιόμενα 100 → ${fmtN(C.rolling.final)}.</p></div>
    <div class="card"><h3>Πώς έψαξε ο γενετικός</h3>${fitChart(S.ga.hist)}
      <p class="muted" style="font-size:12px">${S.ga.pop} στρατηγικές × ${S.ga.gens} γενιές × ${S.ga.seeds} ανεξάρτητες εκκινήσεις. Κάθε στρατηγική είναι ${S.ga.genes} «γονίδια»· σε κάθε γενιά επιβιώνουν οι καλύτερες (τουρνουά), διασταυρώνονται και μεταλλάσσονται. Καταλληλότητα: ο λογάριθμος του τελικού κεφαλαίου μείον ποινή για τη μέγιστη πτώση.</p></div></section>
  <section><h2>Οι 10 καλύτερες στην εκπαίδευση — και τι έγινε μετά</h2><div class="tbl"><table><thead><tr><th>Στρατηγική</th><th class="n">εκπ.: στοιχ.</th><th class="n">ROI</th><th class="n">κεφάλαιο</th><th class="n">δοκιμή: στοιχ.</th><th class="n">ROI</th><th class="n">κεφάλαιο</th></tr></thead><tbody>
    ${S.top.map((t) => `<tr><td style="white-space:normal;font-size:13px">${esc(stratText(t))}</td><td class="n">${t.train.n}</td><td class="n">${pc(t.train.roi)}</td><td class="n">${fmtN(t.train.final)}</td><td class="n">${t.test.n}</td><td class="n">${pc(t.test.roi)}</td><td class="n"><b>${fmtN(t.test.final)}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Όλες οι «καλύτερες» είναι παρολί με ολόκληρο Kelly: η πιο ριψοκίνδυνη επιλογή κερδίζει στην εκπαίδευση όταν έτυχε να βγουν τα αποτελέσματα — και χάνει τα περισσότερα όταν δεν βγαίνουν.</p></section>
  <section class="grid"><div><h2>Κυλιόμενη δοκιμή</h2><div class="tbl"><table><thead><tr><th>Τμήμα</th><th class="n">στοιχήματα</th><th class="n">ROI</th><th class="n">κεφάλαιο ×</th></tr></thead><tbody>
      ${S.rolling.blocks.map((x) => `<tr><td>${dateGR(x.from)} – ${dateGR(x.to)} <span class="muted" style="font-size:11px">${x.legs === 1 ? "μονά" : "παρολί " + x.legs}</span></td><td class="n">${x.n}</td><td class="n">${pc(x.roi)}</td><td class="n">×${x.mult.toFixed(2)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="font-size:12px">Σε κάθε τμήμα ο αλγόριθμος ξαναψάχνει με ό,τι έχει παιχτεί μέχρι τότε και η στρατηγική του παίζεται στο επόμενο τμήμα: έτσι θα δούλευε στην πράξη.</p></div>
    <div><h2>Σημεία αναφοράς (δοκιμή)</h2><div class="tbl"><table><thead><tr><th></th><th class="n">στοιχήματα</th><th class="n">ROI</th></tr></thead><tbody>
      <tr><td>Κανόνες «Αξίας» (¼ Kelly, EV ≥ 5%)</td><td class="n">${O.test.n}</td><td class="n">${pc(O.test.roi)}</td></tr>
      <tr><td>Πάντα το φαβορί, σταθερό ποσό</td><td class="n">${S.refs.fav_flat.test.n}</td><td class="n">${pc(S.refs.fav_flat.test.roi)}</td></tr>
      <tr><td>Πάντα το αουτσάιντερ, σταθερό ποσό</td><td class="n">${S.refs.dog_flat.test.n}</td><td class="n">${pc(S.refs.dog_flat.test.roi)}</td></tr>
      <tr><td>Κανένα στοίχημα</td><td class="n">0</td><td class="n">0%</td></tr></tbody></table></div>
      <p class="muted" style="font-size:12px">Όλη η σεζόν με τους κανόνες της «Αξίας»: ${O.train.n + O.test.n} στοιχήματα, κεφάλαιο 100 → ${fmtN((O.full?.final) || 0)}.</p></div></section>
  <section class="card"><h2>Τι σημαίνει</h2><ol style="margin:0;max-width:80ch;line-height:1.6">
    <li><b>Με τόσους αγώνες, η βελτιστοποίηση βρίσκει πάντα κάτι.</b> 15 ρυθμίσεις, 227 αγώνες: αρκεί για να «χωρέσει» ο αλγόριθμος την τύχη μιας σεζόν. Γι' αυτό κρίνουμε μόνο σε αγώνες που δεν έχει δει.</li>
    <li><b>Το παρολί μεγαλώνει την τύχη, όχι την αξία.</b> Πολλαπλασιάζει και το περιθώριο του bookmaker· βγαίνει «καλύτερο» στο παρελθόν μόνο επειδή είναι το πιο ριψοκίνδυνο.</li>
    <li><b>Ο αλγόριθμος δεν μπορεί να φτιάξει πλεονέκτημα που δεν έχει το μοντέλο.</b> Το μοντέλο προβλέπει χειρότερα από τις αποδόσεις κλεισίματος (Brier 0.209 έναντι 0.196)· καμία στρατηγική πάνω του δεν κερδίζει μακροπρόθεσμα.</li>
    <li><b>Τι θα χρειαζόταν:</b> μοντέλο που κερδίζει την αγορά (ratings από πολλές σεζόν, απουσίες, ενδεκάδες), αποδόσεις ανοίγματος πριν «κάτσει» η αγορά, ή αγορές που τιμολογούνται χειρότερα (στατιστικά παικτών) — και μετά ξανά αυτή η δοκιμή.</li></ol></section>`;
};

Views.sims = () => {
  const G = SIMS ? Object.entries(SIMS.games).sort((a, b) => a[1].date.localeCompare(b[1].date)) : [];
  const C = SIMS?.check, up = G.filter(([, S]) => !S.played), pl = G.filter(([, S]) => S.played).reverse();
  const row = ([code, S]) => { const a = S.actual, ok = a && (a.hs > a.as) === (S.p_home >= 0.5);
    return `<a class="game-row" href="#/game/${code}"><span class="d">${dateGR(S.date, true)}<br>${a ? `<span style="color:var(--${ok ? "good" : "bad"})">${ok ? "✓ σωστό" : "✗ λάθος"}</span>` : `${S.n.toLocaleString("el-GR")} αγώνες`}</span>
      <span class="h">${esc(team(S.home).name)} ${badge(S.home, 20)} <b class="num">${pct(S.p_home)}</b></span>
      <span class="sc">${a ? `${a.hs} – ${a.as}` : `${Math.round(S.score[0].mean)} – ${Math.round(S.score[1].mean)}`}${a ? `<div class="muted" style="font:11px var(--font-num)">προσ. ${Math.round(S.score[0].mean)}–${Math.round(S.score[1].mean)}</div>` : ""}</span>
      <span><b class="num">${pct(1 - S.p_home)}</b> ${badge(S.away, 20)} ${esc(team(S.away).name)}</span><span class="go">›</span></a>`; };
  const COVL = { score: "Πόντοι ομάδας", margin: "Διαφορά (χάντικαπ)", total: "Σύνολο πόντων", pts: "Πόντοι παίκτη", reb: "Ριμπάουντ παίκτη", ast: "Ασίστ παίκτη", pir: "PIR παίκτη" };
  return `<section><h2>Επόμενοι αγώνες</h2>${up.length ? `<div class="card" style="padding:0">${up.map(row).join("")}</div>` : `<div class="empty">Κανένας.</div>`}</section>
  <section><h2>Παιγμένοι: προσομοίωση πριν από τον αγώνα, απέναντι στο αποτέλεσμα</h2>${pl.length ? `<div class="card" style="padding:0">${pl.map(row).join("")}</div>` : `<div class="empty">Κανένας.</div>`}</section>
  ${C ? `<section class="card"><h2>Βαθμονόμηση</h2>
    <p style="margin:0 0 8px;max-width:80ch">Σε ${C.games} παιγμένους αγώνες όλης της λίγκας, με ${C.sims_each.toLocaleString("el-GR")} προσομοιώσεις ο καθένας και στατιστικά μόνο από τους αγώνες πριν από αυτόν: πόσο συχνά το πραγματικό έπεσε μέσα στο κουτί (θέλουμε ~50%) και μέσα στις κεραίες (θέλουμε ~90%).</p>
    <div class="tiles">${tile(pct(C.acc), "σωστός νικητής")}${tile(C.brier.toFixed(3), `Brier (ποσοστό γηπεδούχου: ${C.brier_home_rate.toFixed(3)})`)}${tile("±" + C.mae_margin, "σφάλμα στη διαφορά")}${tile("±" + C.mae_total, "σφάλμα στο σύνολο")}</div>
    <div class="tbl" style="margin-top:10px"><table><thead><tr><th>Μέγεθος</th><th class="n">περιπτώσεις</th><th class="n">μέσα στο κουτί (25–75%)</th><th class="n">μέσα στις κεραίες (5–95%)</th><th class="n">κάτω από τη διάμεσο</th></tr></thead><tbody>
      ${Object.entries(C.coverage || {}).map(([k, c]) => `<tr><td>${COVL[k] || k}</td><td class="n">${c.n}</td><td class="n" style="color:var(--${Math.abs(c.box - 0.5) <= 0.07 ? "good" : "bad"})">${pct(c.box)}</td>
        <td class="n" style="color:var(--${Math.abs(c.whisk - 0.9) <= 0.05 ? "good" : "bad"})">${pct(c.whisk)}</td><td class="n">${pct(c.below_median)}</td></tr>`).join("")}</tbody></table></div>
    <p class="muted" style="font-size:12px">Πράσινο: κοντά στον στόχο. Αν το «κουτί» πιάνει πολύ περισσότερο από 50%, η προσομοίωση είναι πιο αβέβαιη απ' όσο χρειάζεται (πολύ φαρδιά)· αν πιάνει λιγότερο, είναι πολύ σίγουρη.</p></section>` : ""}
  ${SIMS?.ratings ? ratingsCard(SIMS.ratings) : ""}
  ${SIMS?.re_fit ? reCard(SIMS.re_fit, SIMS.re) : ""}
  ${SIMS?.check_sources ? srcCard(SIMS.check_sources) : ""}
  ${SIMS?.beta_fit ? betaCard(SIMS.beta_fit) : ""}
  ${simDiagram()}
  <section class="card"><h2>Πώς δουλεύει</h2>
    <p style="margin:0 0 8px;max-width:80ch">Μοντέλο κατοχής (αλυσίδα Markov) και Monte Carlo: κάθε αγώνας «παίζεται» φάση-φάση, με τα ζάρια να ρίχνονται από τα στατιστικά των παικτών, και επαναλαμβάνεται ${SIMS ? SIMS.n.toLocaleString("el-GR") : "50.000"} φορές. Από τις κατανομές κρατάμε τις ροπές (μέσος, διασπορά, ασυμμετρία, κύρτωση) και τα ποσοστημόρια.</p>
    <ol style="margin:0;max-width:80ch">
      <li><b>Κατοχές:</b> από τον μέσο ρυθμό των δύο ομάδων (± 3.5). <b>Τζάμπολ:</b> 50/50.</li>
      <li><b>Ποιος παίζει τη φάση:</b> επιθετικός ανάλογα με τις φάσεις που τελειώνει ανά αγώνα, αμυνόμενος ανάλογα με τα λεπτά. Όσοι δεν έπαιξαν στους 3 τελευταίους αγώνες μετρούν ελάχιστα.</li>
      <li><b>Κοντράρισμα (log5 με βάρη):</b> επιθετικός ⊗ άμυνα αντιπάλου, ως προς τη λίγκα, με βάρη β που μαθαίνονται από τα δεδομένα (πίνακας πιο πάνω). Ο αμυνόμενος παίκτης: κλεψίματα, τάπες, φάουλ.</li>
      <li><b>Φάση:</b> λάθος (ίσως κλέψιμο) · φάουλ → βολές · σουτ 2π/3π → τάπα / εύστοχο (ασίστ, and-one) / άστοχο → ριμπάουντ (επιθετικό: η κατοχή συνεχίζει).</li>
      <li><b>Παράταση</b> με τις κατοχές 5 λεπτών. <b>Έδρα:</b> μικρή ώθηση στις ευστοχίες.</li>
      <li><b>Παιγμένοι αγώνες:</b> walk-forward, με στατιστικά μόνο από τους αγώνες πριν από αυτόν (οι αγώνες των 2 πρώτων αγωνιστικών παραλείπονται).</li>
    </ol></section>`;
};
Views.sims.bind = () => {};

// ----------------------------------------------------------------------------- σενάρια (αλλαγές στους μέσους όρους)
// Ένα σενάριο ανά αγώνα: { out: [pid], avg: { pid: { min, fga, … } }, paceAdj, tags: [ετικέτες έτοιμων σεναρίων] }
const SCEN = {};
// [πεδίο, ετικέτα, ελάχιστο, μέγιστο, βήμα, μορφή, ομάδα]
const SC_F = [["min", "Λεπτά", 0, 40, 1, (v) => v.toFixed(0), "role"], ["pts", "Πόντοι", 0, 40, 0.5, f1, "role"], ["fga", "Σουτ (2π+3π)", 0, 25, 0.5, f1, "role"],
  ["fg2p", "2π %", 0.2, 0.8, 0.01, pct, "shot"], ["fg3p", "3π %", 0.1, 0.6, 0.01, pct, "shot"], ["ftp", "Βολές %", 0.3, 1, 0.01, pct, "shot"], ["tov", "Λάθη", 0, 6, 0.1, f1, "shot"],
  ["reb", "Ριμπάουντ", 0, 15, 0.1, f1, "reb"], ["ast", "Ασίστ", 0, 12, 0.1, f1, "reb"],
  ["dshot", "Σουτ αντιπάλου", -8, 8, 0.5, (v) => (v > 0 ? "−" : v < 0 ? "+" : "±") + Math.abs(v).toFixed(1) + "%", "def"],
  ["stl", "Κλεψίματα", 0, 4, 0.1, f1, "def"], ["blk", "Τάπες", 0, 4, 0.1, f1, "def"], ["pf", "Φάουλ", 0, 5, 0.1, f1, "def"]];
const SC_G = [["role", "Χρόνος & ρόλος"], ["shot", "Ευστοχία & λάθη"], ["reb", "Ριμπάουντ & ασίστ"], ["def", "Άμυνα"]];
/** Έτοιμες αλλαγές για έναν παίκτη (σχετικά με τους τωρινούς μέσους όρους του στο σενάριο). */
const SC_PP = [
  ["Αμφίβολος: 50% να παίξει", (sc, pid) => { sc.play[pid] = 0.5; }],
  ["Παίζει περισσότερο (+6′)", (sc, pid, v) => scSet(sc, pid, "min", Math.min(40, v.min + 6))],
  ["Παίζει λιγότερο (−8′)", (sc, pid, v) => scSet(sc, pid, "min", Math.max(0, v.min - 8))],
  ["Σε φόρμα: +4% σε 2π και 3π", (sc, pid, v) => { scSet(sc, pid, "fg2p", Math.min(0.8, v.fg2p + 0.04)); scSet(sc, pid, "fg3p", Math.min(0.6, v.fg3p + 0.04)); }],
  ["Μεγαλύτερος ρόλος: +25% σουτ", (sc, pid, v) => scSet(sc, pid, "fga", Math.min(25, v.fga * 1.25))],
  ["Ντεφορμέ: −5% στα σουτ, +0.5 λάθη", (sc, pid, v) => { scSet(sc, pid, "fg2p", Math.max(0.2, v.fg2p - 0.05)); scSet(sc, pid, "fg3p", Math.max(0.1, v.fg3p - 0.05)); scSet(sc, pid, "tov", v.tov + 0.5); }],
  ["Καλύτερη άμυνα: −3% στο σουτ αντιπάλου, +30% κλεψ./τάπες", (sc, pid, v) => { scSet(sc, pid, "dshot", Math.min(8, v.dshot + 3)); scSet(sc, pid, "stl", v.stl * 1.3); scSet(sc, pid, "blk", v.blk * 1.3); }],
  ["Κυριαρχεί στη ρακέτα: +2 ριμπάουντ, +4% στο 2π", (sc, pid, v) => { scSet(sc, pid, "reb", Math.min(15, v.reb + 2)); scSet(sc, pid, "fg2p", Math.min(0.8, v.fg2p + 0.04)); }],
];
const scNew = () => ({ out: [], avg: {}, play: {}, paceAdj: 0, tags: [], sources: [], extW: 0.5, re: true });
/** Οι μέσοι όροι ενός παίκτη όπως είναι στο σενάριο (για τα sliders). */
function scVals(pid, sc) {
  const p = DB.players[pid], a = SIM.adjAvg(p.avg, sc.avg[pid]), lg = DB.lg || {};
  const r = (m, n, d) => (n > 0 ? m / n : d);
  return { min: a.min, fga: a.fg2a + a.fg3a, fg2p: r(a.fg2m, a.fg2a, lg.fg2 || 0.5), fg3p: r(a.fg3m, a.fg3a, lg.fg3 || 0.33), ftp: r(a.ftm, a.fta, lg.ft || 0.72),
    tov: a.tov, reb: a.oreb + a.dreb, ast: a.ast, pts: 2 * a.fg2m + 3 * a.fg3m + a.ftm, stl: a.stl, blk: a.blk, pf: a.pf, dshot: sc.avg[pid]?.dshot ?? 0 };
}
const scSet = (sc, pid, f, v) => { (sc.avg[pid] ||= {})[f] = v; };
const playTag = (sc, pid) => (sc.play[pid] != null && sc.play[pid] < 1 ? ` <span class="sc-tag">${pct(sc.play[pid])} να παίξει</span>` : "");
const scCount = (sc) => sc.out.length + Object.values(sc.avg).filter((o) => Object.keys(o).length).length + Object.keys(sc.play).length + (sc.paceAdj ? 1 : 0) + (sc.sources.length ? 1 : 0) + (sc.re ? 0 : 1);
const extGames = (pid, sc) => sc.sources.reduce((n, k) => n + (DB.players[pid]?.ext?.[k]?.length || 0), 0);
/** Έτοιμα σενάρια ανά ομάδα, από τους παίκτες της (πρώτος σκόρερ, πλέι-μέικερ, ριμπάουντερ, σουτέρ). */
function scPresets(base) {
  const side = base.T.map((T) => {
    const pl = T.pl.map((q) => ({ pid: q.pid, name: DB.players[q.pid].name.split(" ").at(-1), a: DB.players[q.pid].avg }));
    const by = (f, list = pl) => [...list].sort((x, y) => f(y.a) - f(x.a));
    const sc1 = by((a) => a.pts)[0], sc2 = by((a) => a.pts)[1], pg = by((a) => a.ast)[0], rb = by((a) => a.reb)[0];
    const sh = by((a) => (a.fg3a >= 1.5 ? a.fg3m / a.fg3a : -1))[0];
    const rel = (sc, x, f, d) => scSet(sc, x.pid, f, Math.max(0, scVals(x.pid, sc)[f] + d));
    const L = [
      [`Λείπει ο ${sc1.name} (1ος σκόρερ)`, (sc) => sc.out.push(sc1.pid)],
      [`Λείπουν ${sc1.name} και ${sc2.name}`, (sc) => sc.out.push(sc1.pid, sc2.pid)],
      [`${sc1.name} με ενόχληση: λιγότερα λεπτά, −5% στα σουτ`, (sc) => { scSet(sc, sc1.pid, "min", Math.min(20, sc1.a.min * 0.75)); rel(sc, sc1, "fg2p", -0.05); rel(sc, sc1, "fg3p", -0.05); }],
      [`${sc2.name} ντεφορμέ: −8% στα σουτ, +1 λάθος`, (sc) => { rel(sc, sc2, "fg2p", -0.08); rel(sc, sc2, "fg3p", -0.08); rel(sc, sc2, "tov", 1); }],
      [`${sh.name} «ζεστό χέρι»: +8% στο τρίποντο`, (sc) => rel(sc, sh, "fg3p", 0.08)],
      [`${rb.name} φορτώνεται φάουλ: 15′`, (sc) => scSet(sc, rb.pid, "min", Math.min(15, rb.a.min))],
    ];
    if (pg.pid !== sc1.pid) L.splice(2, 0, [`Λείπει ο πλέι-μέικερ ${pg.name}`, (sc) => sc.out.push(pg.pid)]);
    return L;
  });
  const game = [["Γρήγορος ρυθμός (+6 κατοχές)", (sc) => (sc.paceAdj = 6)], ["Αργός ρυθμός (−6 κατοχές)", (sc) => (sc.paceAdj = -6)]];
  return { side, game };
}
/** Το δέντρο: Σενάριο ▸ Έτοιμα (ανά ομάδα, αγώνας) · Αγώνας ▸ ρυθμός · Ομάδα ▸ Παίκτης ▸ sliders */
function scTree(g, base, sc) {
  const PR = scPresets(base), n = scCount(sc);
  const plist = (list, pre) => `<ul class="tree-list">${list.map(([l], i) => `<li><button class="plink" data-preset="${pre}:${i}">${esc(l)}</button></li>`).join("")}</ul>`;
  const slider = (pid, [f, lab, lo, hi, st, fmt], v, touched) => `<label class="sc-row${touched ? " on" : ""}"><span>${lab}</span>
    <input type="range" min="${lo}" max="${hi}" step="${st}" value="${v}" data-pid="${pid}" data-f="${f}"><output>${fmt(v)}</output></label>`;
  // λεπτά που θα παίξει ο καθένας στο σενάριο (μετά την ανακατανομή) απέναντι στα βασικά
  let cur = null; try { cur = SIM.prepare(DB, base.T[0].code, base.T[1].code, { beta: SIMS?.beta, out: sc.out, avg: sc.avg }); } catch (e) { /* */ }
  const minOf = (c, pid) => { for (const T of c?.T || []) { const q = T.pl.find((x) => x.pid === pid); if (q) return q.minShare * 200; } return 0; };
  const player = (q) => { const pid = q.pid, o = sc.avg[pid] || {}, out = sc.out.includes(pid), v = scVals(pid, sc), k = Object.keys(o).length;
    const eg = extGames(pid, sc), m0 = minOf(base, pid), m1 = minOf(cur, pid) * (sc.play[pid] ?? 1), dm = m1 - m0;
    const mins = out ? "" : `<span class="muted num" style="font-size:11px">${Math.round(m1)}′${Math.abs(dm) >= 0.5 ? ` <span style="color:var(--${dm > 0 ? "good" : "bad"})">${dm > 0 ? "+" : "−"}${Math.abs(dm).toFixed(1)}</span>` : ""}</span>`;
    const group = ([g, lab]) => { const F = SC_F.filter((x) => x[6] === g), ch = F.filter((x) => o[x[0]] != null).length;
      const pp = sc.play[pid] ?? 1;
      return `<details class="tree-node" data-k="g:${pid}:${g}"><summary>${lab}${ch + (g === "role" && pp < 1) ? ` <span class="sc-tag">${ch + (g === "role" && pp < 1)}</span>` : ""}</summary><div class="tree-in">
        ${g === "role" ? `<label class="sc-row${pp < 1 ? " on" : ""}"><span>Πιθανότητα να παίξει</span><input type="range" min="0.05" max="1" step="0.05" value="${pp}" data-play="${pid}"><output>${pct(pp)}</output></label>` : ""}
        ${F.map((x) => slider(pid, x, +(+v[x[0]]).toFixed(3), o[x[0]] != null)).join("")}
        ${g === "def" ? `<div class="muted" style="font-size:11px">«Σουτ αντιπάλου»: πόσο αλλάζει το ποσοστό του αντιπάλου όταν αμύνεται αυτός (− = καλύτερη άμυνα).</div>` : ""}</div></details>`; };
    return `<details class="tree-node" data-k="p:${pid}"><summary>${esc(DB.players[pid].name)} ${mins}${eg ? ` <span class="muted" style="font-size:11px">+${eg} αγ. εκτός ${esc(DB.short)}</span>` : ""}${out ? ` <span class="sc-tag bad">εκτός</span>` : k ? ` <span class="sc-tag">${k} αλλαγ${k > 1 ? "ές" : "ή"}</span>` : ""}${out ? "" : playTag(sc, pid)}</summary>
      <div class="tree-in"><label class="sc-row"><span>Παίζει</span><input type="checkbox" data-out="${pid}" ${out ? "" : "checked"}><output></output></label>
      ${out ? "" : `<details class="tree-node" data-k="pp:${pid}"><summary>Έτοιμες αλλαγές</summary><div class="tree-in"><ul class="tree-list">
        ${SC_PP.map(([l], i) => `<li><button class="plink" data-ppreset="${pid}:${i}">${esc(l)}</button></li>`).join("")}</ul></div></details>
        ${SC_G.map(group).join("")}`}
      ${k || out || sc.play[pid] != null ? `<button class="plink" data-screset="${pid}" style="font-size:12px">↺ πίσω στους πραγματικούς μέσους όρους</button>` : ""}</div></details>`; };
  const teamNode = (ti) => { const T = base.T[ti], ch = T.pl.filter((q) => sc.out.includes(q.pid) || Object.keys(sc.avg[q.pid] || {}).length).length;
    const outN = T.pl.filter((q) => sc.out.includes(q.pid)).length, fixedMin = T.pl.reduce((x, q) => x + (sc.avg[q.pid]?.min ?? 0), 0);
    return `<details class="tree-node" data-k="t:${ti}"><summary>${badge(T.code, 18)} ${esc(team(T.code).name)}${ch ? ` <span class="sc-tag">${ch}</span>` : ""}</summary>
      <div class="tree-in"><div class="muted" style="font-size:12px">Δίπλα σε κάθε παίκτη: τα λεπτά του στο σενάριο (σύνολο 200) και η αλλαγή από το βασικό. Τα sliders είναι μέσοι όροι ανά αγώνα. ${outN ? "Ο χρόνος όσων λείπουν μοιράζεται στους υπόλοιπους αναλογικά με τα λεπτά τους." : "Όσα λεπτά ορίσεις μένουν σταθερά· τα υπόλοιπα μοιράζονται στους άλλους."}</div>
      ${fixedMin > 200 ? `<div style="font-size:12px;color:var(--bad)">Τα λεπτά που όρισες ξεπερνούν τα 200 (${Math.round(fixedMin)}′).</div>` : ""}
      ${T.pl.map(player).join("")}</div></details>`; };
  return `<details class="tree" data-k="root"><summary><b>Σενάριο:</b> ${n ? `${n} αλλαγ${n > 1 ? "ές" : "ή"}` : "πραγματικοί μέσοι όροι"}${sc.tags.length ? ` <span class="muted" style="font-size:12px">· ${sc.tags.map(esc).join(" · ")}</span>` : ""}</summary>
    <div class="tree-in">
      <details class="tree-node" data-k="pre"><summary>Έτοιμα σενάρια</summary><div class="tree-in">
        ${[0, 1].map((ti) => `<details class="tree-node" data-k="pre:${ti}"><summary>${badge(base.T[ti].code, 18)} ${esc(team(base.T[ti].code).name)}</summary><div class="tree-in">${plist(PR.side[ti], ti)}</div></details>`).join("")}
        <details class="tree-node" data-k="pre:g"><summary>Αγώνας</summary><div class="tree-in">${plist(PR.game, "g")}</div></details>
        <div class="muted" style="font-size:12px">Τα έτοιμα σενάρια προστίθενται το ένα πάνω στο άλλο.</div></div></details>
      <details class="tree-node" data-k="game"><summary>Αγώνας${sc.paceAdj ? ` <span class="sc-tag">ρυθμός ${sc.paceAdj > 0 ? "+" : ""}${sc.paceAdj}</span>` : ""}${sc.re ? "" : ` <span class="sc-tag">μόνο ζάρια</span>`}</summary><div class="tree-in">
        <label class="sc-row${sc.paceAdj ? " on" : ""}"><span>Ρυθμός (± κατοχές)</span><input type="range" min="-12" max="12" step="1" value="${sc.paceAdj}" data-pace><output>${sc.paceAdj > 0 ? "+" : ""}${sc.paceAdj}</output></label>
        <div class="muted" style="font-size:12px">Μέσος ρυθμός των δύο ομάδων: ${base.pace.toFixed(1)} κατοχές.</div>
        <label class="sc-row${sc.re ? "" : " on"}"><span>Λεπτά & «μέρα» αγώνα</span><input type="checkbox" data-reon ${sc.re ? "checked" : ""}><output style="font-size:11px">${sc.re ? "ναι" : "όχι"}</output></label>
        <div class="muted" style="font-size:12px">Με «ναι» κάθε προσομοιωμένος αγώνας κληρώνει πόσα λεπτά θα παίξει ο καθένας και αν ο αγώνας θα είναι «υψηλού» ή «χαμηλού» σκορ (τιμές από τα δεδομένα, σελίδα <a href="#/sims">Προσομοιώσεις</a>). Με «όχι» μόνο τα ζάρια κάθε φάσης.</div></div></details>
      ${srcNode(base, sc)}
      ${teamNode(0)}${teamNode(1)}
      ${n ? `<button class="plink" data-screset="*" style="font-size:13px">↺ Καθάρισμα όλων</button>` : ""}
      <div class="muted" style="font-size:12px;margin-top:4px">Ό,τι αλλάζεις θεωρείται η αλήθεια για τον αγώνα: ο παίκτης το πετυχαίνει απέναντι σε μέση άμυνα (χωρίς τη «συρρίκνωση» προς τη λίγκα). Μικρότερα λεπτά = λιγότερα σουτ, ριμπάουντ, ασίστ αναλογικά.</div>
    </div></details>`;
}
/** Κόμβος «Δεδομένα»: ποιες άλλες λίγκες/σεζόν μπαίνουν στα ποσοστά των παικτών και με τι βάρος. */
function srcNode(base, sc) {
  const S = DB.sources || {}, keys = Object.keys(S); if (!keys.length) return "";
  const inGame = (k) => base.T.reduce((n, T) => n + T.pl.filter((q) => DB.players[q.pid]?.ext?.[k]?.length).length, 0);
  const C = SIMS?.check_sources;
  return `<details class="tree-node" data-k="src"><summary>Δεδομένα${sc.sources.length ? ` <span class="sc-tag">+${sc.sources.length} πηγ${sc.sources.length > 1 ? "ές" : "ή"}</span>` : ` <span class="muted" style="font-size:12px">μόνο ${esc(DB.short)}</span>`}</summary><div class="tree-in">
    <label class="sc-row on"><span>${esc(DB.short)} ${DB.season}-${String((DB.season + 1) % 100).padStart(2, "0")}</span><input type="checkbox" checked disabled><output></output></label>
    ${keys.map((k) => `<label class="sc-row${sc.sources.includes(k) ? " on" : ""}"><span>${esc(S[k].label)}</span><input type="checkbox" data-src="${k}" ${sc.sources.includes(k) ? "checked" : ""}><output style="font-size:11px">${inGame(k)} παίκτ.</output></label>`).join("")}
    <label class="sc-row${sc.sources.length ? " on" : ""}"><span>Βάρος ανά αγώνα</span><input type="range" min="0.1" max="1" step="0.05" value="${sc.extW}" data-extw><output>${sc.extW.toFixed(2)}</output></label>
    <div class="muted" style="font-size:12px">Από τις άλλες λίγκες μετράει μόνο η ποιότητα (ποσοστά, λάθη, βολές), μετατρεμμένη στην κλίμακα της λίγκας (${esc(DB.short)})· λεπτά και ρόλος μένουν από αυτήν. «παίκτ.» = πόσοι από τους δύο ρόστερ έχουν αγώνες εκεί.${C ? ` Στον έλεγχο (σελίδα <a href="#/sims">Προσομοιώσεις</a>) οι άλλες λίγκες έδωσαν Brier ${C.find((c) => /άλλες/.test(c.label))?.brier ?? "–"} έναντι ${C[0].brier} μόνο με ${esc(DB.short)}.` : ""}</div></div></details>`;
}
/** Σύγκριση βασικό ↔ σενάριο από Monte Carlo. */
function scCompare(base, r, ctx) {
  const row = (l, a, b, f = (x) => x.toFixed(1)) => { const d = b - a; return `<tr><td>${l}</td><td class="n">${f(a)}</td><td class="n"><b>${f(b)}</b></td>
    <td class="n" style="color:var(--${Math.abs(d) < 0.005 ? "muted" : d > 0 ? "good" : "bad"})">${d > 0 ? "+" : ""}${f(d)}</td></tr>`; };
  const pmap = (R) => Object.fromEntries(R.players.flat().map((p) => [p.pid, p.pts.mean]));
  const P0 = pmap(base), P1 = pmap(r), pids = [...new Set([...Object.keys(P0), ...Object.keys(P1)])];
  const ch = pids.map((pid) => [pid, P0[pid] || 0, P1[pid] || 0]).filter((x) => Math.abs(x[2] - x[1]) >= 0.8).sort((x, y) => Math.abs(y[2] - y[1]) - Math.abs(x[2] - x[1])).slice(0, 8);
  const H = team(ctx.T[0].code), A = team(ctx.T[1].code);
  return `<h3 style="margin-top:10px">Σενάριο απέναντι στο βασικό <span class="muted" style="font:12px var(--font-body)">(${r.n.toLocaleString("el-GR")} προσομοιώσεις)</span></h3>
    <div class="tbl"><table><thead><tr><th></th><th class="n">βασικό</th><th class="n">σενάριο</th><th class="n">Δ</th></tr></thead><tbody>
    ${row(`Νίκη ${esc(H.abbr)}`, 100 * base.p_home, 100 * r.p_home, (x) => x.toFixed(1) + "%")}
    ${row(`Πόντοι ${esc(H.abbr)}`, base.score[0].mean, r.score[0].mean)}${row(`Πόντοι ${esc(A.abbr)}`, base.score[1].mean, r.score[1].mean)}
    ${row("Διαφορά", base.margin.mean, r.margin.mean)}${row("Σύνολο", base.total.mean, r.total.mean)}
    ${ch.map(([pid, a, b]) => row(`${esc(DB.players[pid]?.name || pid)} · πόντοι`, a, b)).join("")}</tbody></table></div>`;
}

// ----------------------------------------------------------------------------- ζωντανός αγώνας (play-by-play)
const Live = {
  stop: null,
  mount(el, g) {
    if (!g || !window.SIM) { el.remove(); return; }
    const H = team(g.home), A = team(g.away);
    let ctx, base;
    try { ctx = base = SIM.prepare(DB, g.home, g.away, { beta: SIMS?.beta, re: SIMS?.re }); } catch (e) { el.innerHTML = `<div class="muted">Δεν γίνεται προσομοίωση: ${esc(e.message)}</div>`; return; }
    if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) { el.innerHTML = `<div class="muted">Δεν υπάρχουν αρκετοί παίκτες για προσομοίωση.</div>`; return; }
    const sc = (SCEN[g.code] ||= scNew());
    const scOpts = () => ({ beta: SIMS?.beta, out: sc.out, avg: sc.avg, play: sc.play, paceAdj: sc.paceAdj, sources: sc.sources, extW: sc.extW, re: sc.re ? SIMS?.re : SIM.RE0 });
    let baseMC = SIMS?.games?.[g.code] && !SIMS.games[g.code].played ? SIMS.games[g.code] : null;
    // διόρθωση ομάδας (ratings): από τις έτοιμες προσομοιώσεις, αλλιώς υπολογίζεται εδώ· μένει ίδια σε κάθε σενάριο
    base.tAdj = SIMS?.games?.[g.code]?.tadj || (() => { const Rt = SIMS?.ratings; if (!Rt?.w || !Rt.teams[g.home] || !Rt.teams[g.away]) return null;
      const T = Rt.teams, tgt = [Rt.mu + Rt.h + T[g.home].o - T[g.away].d, Rt.mu + T[g.away].o - T[g.home].d].map((x) => (x * base.pace) / 100);
      try { return SIM.calibrate(base, tgt, Rt.w, 300).tAdj; } catch (e) { return null; } })();
    const SPEEDS = [["×10", 10], ["×60", 60], ["×240", 240], ["άμεσα", 1e9]];
    let speed = 60, log = [], idx = 0, clock = 0, raf = 0, last = 0, running = false, box = {};
    el.innerHTML = `<div class="section-head"><h2 style="margin:0">Ζωντανή προσομοίωση</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap" id="lv-ctl">${Object.keys(DB.sources || {}).length ? `<button class="btn" id="sc-src" aria-pressed="false"></button>` : ""}<button class="btn primary" id="lv-go">▶ Start</button>
          ${SPEEDS.map(([l, v]) => `<button class="btn" data-sp="${v}" style="${v === speed ? "border-color:var(--accent)" : ""}">${l}</button>`).join("")}</div></div>
      <div class="muted" style="font-size:12px;margin:4px 0 10px">Ένας τυχαίος αγώνας με την ίδια μηχανή που τρέχει τις ${SIMS ? SIMS.n.toLocaleString("el-GR") : ""} προσομοιώσεις. Κάθε φορά βγαίνει διαφορετικός. Άλλαξε ό,τι θέλεις στο σενάριο και πάτα Start: παίζεται ένας αγώνας ζωντανά και τρέχουν 5.000 προσομοιώσεις για σύγκριση με το βασικό.</div>
      <div id="sc-tree">${scTree(g, base, sc)}</div><div id="sc-res"></div>
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
      if (idx < log.length && running) raf = requestAnimationFrame(step); else { running = false; $("#lv-go", el).textContent = "▶ Start (νέος αγώνας)"; }
    };
    const runMC = () => {
      const res = $("#sc-res", el);
      if (!scCount(sc)) { res.innerHTML = ""; return; }
      res.innerHTML = `<div class="muted" style="font-size:13px;margin-top:8px">Τρέχουν 5.000 προσομοιώσεις του σεναρίου…</div>`;
      setTimeout(() => { if (!el.isConnected) return; baseMC ||= SIM.many(base, 5000, 11);
        res.innerHTML = scCompare(baseMC, SIM.many(ctx, 5000, 12), ctx); }, 30);
    };
    const start = () => {
      try { ctx = scCount(sc) ? Object.assign(SIM.prepare(DB, g.home, g.away, scOpts()), { tAdj: base.tAdj }) : base; } catch (e) { $("#sc-res", el).innerHTML = `<div class="muted">Σφάλμα σεναρίου: ${esc(e.message)}</div>`; return; }
      if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) { $("#sc-res", el).innerHTML = `<div class="muted" style="margin-top:8px">Χρειάζονται τουλάχιστον 5 παίκτες ανά ομάδα.</div>`; return; }
      runMC();
      log = []; SIM.game(ctx, SIM.rng((Math.random() * 2 ** 31) | 0), log);
      idx = 0; clock = 0; last = 0; box = {}; running = true;
      $("#lv-feed", el).innerHTML = ""; $("#lv-sc", el).textContent = "0 – 0"; drawMargin(); drawBox();
      $("#lv-go", el).textContent = "⏸ Παύση";
      raf = requestAnimationFrame(step);
    };
    $("#lv-go", el).addEventListener("click", () => {
      if (running) { running = false; cancelAnimationFrame(raf); $("#lv-go", el).textContent = "▶ Συνέχεια"; return; }
      if (log.length && idx < log.length && !dirty) { running = true; last = 0; $("#lv-go", el).textContent = "⏸ Παύση"; raf = requestAnimationFrame(step); return; }
      dirty = false;
      start();
    });
    // ---- δέντρο σεναρίου
    const tree = $("#sc-tree", el);
    let dirty = false;
    // ένα κουμπί: μόνο τα δεδομένα της λίγκας ή και όλες οι άλλες λίγκες (λεπτομέρειες στο δέντρο, κόμβος «Δεδομένα»)
    const srcBtn = $("#sc-src", el), ALLSRC = Object.keys(DB.sources || {});
    const srcLabel = () => { if (!srcBtn) return; const on = sc.sources.length > 0; srcBtn.setAttribute("aria-pressed", on);
      srcBtn.style.borderColor = on ? "var(--accent)" : ""; srcBtn.innerHTML = on ? `Δεδομένα: <b>+ άλλες λίγκες</b>${sc.sources.length < ALLSRC.length ? ` (${sc.sources.length})` : ""}` : `Δεδομένα: <b>μόνο ${esc(DB.short)}</b>`; };
    srcBtn?.addEventListener("click", () => { sc.sources = sc.sources.length ? [] : [...ALLSRC]; redraw(); changed(); });
    const redraw = () => { srcLabel(); const open = [...tree.querySelectorAll("details[open]")].map((d) => d.dataset.k);
      tree.innerHTML = scTree(g, base, sc); tree.querySelectorAll("details").forEach((d) => { if (open.includes(d.dataset.k)) d.open = true; });
      if (!running) $("#lv-go", el).textContent = "▶ Start"; };
    const changed = () => { dirty = true; if (running) return; log = []; idx = 0; $("#lv-go", el).textContent = "▶ Start"; };
    tree.addEventListener("input", (e) => {
      const t = e.target, o = t.parentElement.querySelector("output");
      if (t.dataset.pace != null) { sc.paceAdj = +t.value; o.textContent = (sc.paceAdj > 0 ? "+" : "") + sc.paceAdj; changed(); return; }
      if (t.dataset.extw != null) { sc.extW = +t.value; o.textContent = sc.extW.toFixed(2); changed(); return; }
      if (t.dataset.play) { const v = +t.value; if (v >= 1) delete sc.play[t.dataset.play]; else sc.play[t.dataset.play] = v; o.textContent = pct(v); changed(); return; }
      if (!t.dataset.f) return;
      const pid = t.dataset.pid, F = SC_F.find((x) => x[0] === t.dataset.f);
      scSet(sc, pid, F[0], +t.value); o.textContent = F[5](+t.value); t.parentElement.classList.add("on");
      // τα υπόλοιπα sliders του παίκτη ακολουθούν (π.χ. λιγότερα λεπτά -> λιγότερα σουτ)
      const v = scVals(pid, sc);
      t.closest("details[data-k^='p:']").querySelectorAll("input[data-f]").forEach((x) => { if (x === t) return; const G = SC_F.find((y) => y[0] === x.dataset.f);
        x.value = v[G[0]]; x.parentElement.querySelector("output").textContent = G[5](v[G[0]]); });
      changed();
    });
    tree.addEventListener("change", (e) => { const t = e.target;
      if (t.dataset.src) { const k = t.dataset.src; sc.sources = t.checked ? [...sc.sources, k] : sc.sources.filter((x) => x !== k); redraw(); changed(); }
      else if (t.dataset.out) { const pid = t.dataset.out; sc.out = t.checked ? sc.out.filter((x) => x !== pid) : [...sc.out, pid]; redraw(); changed(); }
      else if (t.dataset.reon != null) { sc.re = t.checked; redraw(); changed(); }
      else if (t.dataset.f || t.dataset.pace != null || t.dataset.play) redraw(); });
    tree.addEventListener("click", (e) => {
      const pr = e.target.closest("[data-preset]"), rs = e.target.closest("[data-screset]"), pp = e.target.closest("[data-ppreset]");
      if (pp) { const [pid, i] = pp.dataset.ppreset.split(":"), P = SC_PP[+i]; P[1](sc, pid, scVals(pid, sc));
        const tag = `${DB.players[pid].name.split(" ").at(-1)}: ${P[0].split(":")[0].split(" (")[0]}`; if (!sc.tags.includes(tag)) sc.tags.push(tag); redraw(); changed(); return; }
      if (pr) { const [k, i] = pr.dataset.preset.split(":"), PR = scPresets(base), P = k === "g" ? PR.game[+i] : PR.side[+k][+i];
        P[1](sc); sc.out = [...new Set(sc.out)]; if (!sc.tags.includes(P[0])) sc.tags.push(P[0]); redraw(); changed(); }
      if (rs) { const pid = rs.dataset.screset;
        if (pid === "*") SCEN[g.code] = Object.assign(sc, scNew()); else { delete sc.avg[pid]; delete sc.play[pid]; sc.out = sc.out.filter((x) => x !== pid); }
        redraw(); changed(); }
    });

    $("#lv-ctl", el).addEventListener("click", (e) => { const b = e.target.closest("[data-sp]"); if (!b) return; speed = +b.dataset.sp;
      $("#lv-ctl", el).querySelectorAll("[data-sp]").forEach((x) => (x.style.borderColor = x === b ? "var(--accent)" : "")); });
    drawMargin(); drawBox(); srcLabel();
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
    ${(() => { const me = playerEval(pid); if (!me) return ""; const col = team(p.team).c1 || "var(--accent)";
      return `<div style="display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:center">${radarSVG([{ pcts: me.pcts, color: col, label: p.name }, { pcts: RADAR.map(() => 0.5), color: "#d9a227", label: "μέσος όρος", dash: true }], { size: 150, labels: false })}
        <div style="font-size:12px;display:grid;grid-template-columns:auto auto;gap:2px 10px">${RADAR.map(([, lab], i) => `<span class="muted">${lab}</span><b class="num" style="color:var(--${me.pcts[i] >= 0.67 ? "good" : me.pcts[i] <= 0.33 ? "bad" : "fg"})">${Math.round(100 * me.pcts[i])}</b>`).join("")}</div></div>`; })()}
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
const NAV = { strategy: "#/strategy", value: "#/value", sims: "#/sims", home: "#/", standings: "#/standings", teams: "#/teams", team: "#/teams", players: "#/players", player: "#/players", games: "#/games", game: "#/games" };
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
document.addEventListener("input", (e) => {
  const k = e.target.dataset?.val; if (!k) return;
  VAL[k] = e.target.value; if (k === "bank") LS.set("val_bank", VAL.bank); if (k === "frac") LS.set("val_frac", VAL.frac);
  if (k === "mkt" || k === "code") { if (k === "mkt" && VAL.mkt.startsWith("ml")) VAL.line = ""; const f = $("#val-form"); if (f) { f.innerHTML = valForm(f.dataset.fixed || ""); return; } }
  const o = $("#val-out"); if (o) o.innerHTML = valCalc();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "rd-cmp") { RD_CMP.pid = e.target.value; const sec = $("#radar"); if (sec) sec.outerHTML = radarSection(e.target.dataset.pid); }
});
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pop]"); if (p) { e.preventDefault(); popup(p.dataset.pop); return; }
  const ss = e.target.closest("[data-simstat],[data-simmom]");
  if (ss) { if (ss.dataset.simstat) simUI.stat = ss.dataset.simstat; else simUI.moments = !simUI.moments;
    const sec = $("#simsec"), code = route().arg; if (sec && code) { const y = window.scrollY; sec.outerHTML = simSection(code); window.scrollTo(0, y); } return; }
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
    const want = (new URLSearchParams(location.search).get("l") || LS.get("league") || "GBL").toUpperCase(), L = ["GBL", "E", "U"].includes(want) ? want : "GBL";
    LS.set("league", L);
    DB = await fetch(`db/${L}.json?v=__BUILD__`).then((r) => { if (!r.ok) throw new Error(`db/${L}.json`); return r.json(); });
    SIMS = await fetch(`db/sims_${L}.json?v=__BUILD__`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    // επιλογή λίγκας: ?l=… (κάθε λίγκα έχει τη δική της βάση και τις δικές της προσομοιώσεις)
    $("#leagues").innerHTML = (DB.leagues || []).map((x) => `<a href="?l=${x.comp}#/" ${x.comp === L ? 'aria-current="page"' : ""}>${esc(x.short)}</a>`).join("");
    document.title = `o-dimarxos · ${DB.league}`;
    $("#sub").textContent = `${DB.league} ${DB.season}-${String((DB.season + 1) % 100).padStart(2, "0")} · ${DB.demo.length} ομάδες`;
    $("#foot").textContent = `Δεδομένα: ${DB.comp === "GBL" ? "esake.gr (box scores), EuroLeague API/ESPN (βιογραφικά)" : "EuroLeague API (box scores, βιογραφικά)"} · ενημέρωση ${DB.updated}`;
    render();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">Σφάλμα φόρτωσης: ${esc(e.message)}</div>`;
  }
})();
