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

let DB = null;

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
    <div style="text-align:center;margin-top:14px"><button class="btn" disabled title="Επόμενο βήμα">▶ Προσομοίωση play-by-play (σύντομα)</button></div></section>`;
  if (g.played) {
    const box = (c) => { const R = g.box?.[c] || []; const tot = R.reduce((s, r) => ({ pts: s.pts + r.pts, reb: s.reb + r.reb, ast: s.ast + r.ast }), { pts: 0, reb: 0, ast: 0 });
      return `<div><h3>${tlink(c, 20)}</h3>${R.length ? `<div class="tbl"><table><thead><tr><th>Παίκτης</th><th class="n">Λεπ.</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">2π</th><th class="n">3π</th><th class="n">Βολ</th><th class="n">PIR</th></tr></thead><tbody>
        ${R.map((r) => `<tr><td>${pbtn(r.pid)}</td>${r.min > 0 ? `<td class="n">${f1(r.min)}</td><td class="n"><b>${r.pts}</b></td><td class="n">${r.reb}</td><td class="n">${r.ast}</td><td class="n">${r.fg2m}/${r.fg2a}</td><td class="n">${r.fg3m}/${r.fg3a}</td><td class="n">${r.ftm}/${r.fta}</td><td class="n">${r.pir}</td>` : `<td colspan="8" class="muted">δεν αγωνίστηκε</td>`}</tr>`).join("")}
        <tr><td><b>Σύνολο</b></td><td></td><td class="n"><b>${tot.pts}</b></td><td class="n">${tot.reb}</td><td class="n">${tot.ast}</td><td colspan="4"></td></tr></tbody></table></div>` : `<div class="empty">Χωρίς box score.</div>`}</div>`; };
    return head + `<section><h2>Box score</h2><div style="display:flex;flex-direction:column;gap:18px">${box(g.home)}${box(g.away)}</div></section>`;
  }
  // επερχόμενος: πιθανά ρόστερ (με σειρά λεπτών) και προηγούμενη συνάντηση
  const roster = (c) => { const L = (DB.teams[c]?.roster || Object.values(DB.players).filter((p) => p.team === c).sort((a, b) => b.avg.min - a.avg.min).map((p) => p.pid)).slice(0, 9).map((pid) => DB.players[pid]);
    return `<div class="card"><h3>${tlink(c, 20)}</h3>${L.length ? `<table><thead><tr><th>Παίκτης</th><th class="n">Λεπ.</th><th class="n">Π</th><th class="n">Ρ</th><th class="n">Α</th><th class="n">PIR</th></tr></thead><tbody>
      ${L.map((p) => `<tr><td>${pbtn(p.pid)}</td><td class="n">${f1(p.avg.min)}</td><td class="n">${f1(p.avg.pts)}</td><td class="n">${f1(p.avg.reb)}</td><td class="n">${f1(p.avg.ast)}</td><td class="n"><b>${f1(p.avg.pir)}</b></td></tr>`).join("")}</tbody></table>`
      : `<div class="muted">Δεν υπάρχουν στοιχεία για τους παίκτες (εκτός demo).</div>`}</div>`; };
  const h2h = demoGames().filter((x) => x.played && [x.home, x.away].sort().join() === [g.home, g.away].sort().join());
  return head + `<section><h2>Ρόστερ (με σειρά λεπτών)</h2><div class="grid">${roster(g.home)}${roster(g.away)}</div></section>
    ${h2h.length ? `<section><h2>Φετινές συναντήσεις</h2>${gamesList(h2h)}</section>` : ""}`;
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
    <div style="display:flex;justify-content:space-between;gap:8px"><button class="btn" data-close>Κλείσιμο</button><a class="btn primary" href="#/player/${esc(pid)}" data-close>Σελίδα παίκτη →</a></div></div>`;
  d.showModal();
}
$("#pop").addEventListener("click", (e) => { if (e.target.id === "pop" || e.target.closest("[data-close]")) $("#pop").close(); });

// ----------------------------------------------------------------------------- δρομολόγηση
function route() {
  const [, view = "", arg = ""] = (location.hash || "#/").split("/");
  return { view: view || "home", arg: decodeURIComponent(arg) };
}
const NAV = { home: "#/", standings: "#/standings", teams: "#/teams", team: "#/teams", players: "#/players", player: "#/players", games: "#/games", game: "#/games" };
function render() {
  const { view, arg } = route(), V = Views[view] || Views.home, el = $("#view");
  el.innerHTML = V(arg);
  V.bind?.(el);
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
    $("#sub").textContent = `${DB.league} ${DB.season}-${String((DB.season + 1) % 100).padStart(2, "0")} · demo: ${DB.demo.map((c) => team(c).name).join(", ")}`;
    $("#foot").textContent = `Δεδομένα: esake.gr (box scores), EuroLeague API/ESPN (βιογραφικά) · ενημέρωση ${DB.updated}`;
    render();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">Σφάλμα φόρτωσης: ${esc(e.message)}</div>`;
  }
})();
