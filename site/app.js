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
  const L = [["scripts/run_sims.js", "για κάθε αγώνα του demo"], ["dbAsOf(ημερομηνία)", "βάση μόνο με προηγούμενους αγώνες"],
    ["fitBeta()", "β του log5 από προηγούμενους αγώνες"], ["SIM.prepare()", "ρόστερ · συρρίκνωση · άμυνα"],
    ["SIM.many(50.000)", "καλεί SIM.game ξανά και ξανά"], ["dist() · hcap()", "ροπές · ποσοστημόρια · χάντικαπ"],
    ["site/db/sims.json → app.js", "boxplots · βαθμονόμηση · ζωντανά"]];
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
const SC_F = [["min", "Λεπτά", 0, 40, 1, (v) => v.toFixed(0)], ["fga", "Σουτ (2π+3π)", 0, 25, 0.5, f1], ["fg2p", "2π %", 0.2, 0.8, 0.01, pct],
  ["fg3p", "3π %", 0.1, 0.6, 0.01, pct], ["ftp", "Βολές %", 0.3, 1, 0.01, pct], ["tov", "Λάθη", 0, 6, 0.1, f1], ["reb", "Ριμπάουντ", 0, 15, 0.1, f1], ["ast", "Ασίστ", 0, 12, 0.1, f1]];
const scNew = () => ({ out: [], avg: {}, paceAdj: 0, tags: [] });
/** Οι μέσοι όροι ενός παίκτη όπως είναι στο σενάριο (για τα sliders). */
function scVals(pid, sc) {
  const p = DB.players[pid], a = SIM.adjAvg(p.avg, sc.avg[pid]), lg = DB.lg || {};
  const r = (m, n, d) => (n > 0 ? m / n : d);
  return { min: a.min, fga: a.fg2a + a.fg3a, fg2p: r(a.fg2m, a.fg2a, lg.fg2 || 0.5), fg3p: r(a.fg3m, a.fg3a, lg.fg3 || 0.33), ftp: r(a.ftm, a.fta, lg.ft || 0.72),
    tov: a.tov, reb: a.oreb + a.dreb, ast: a.ast };
}
const scSet = (sc, pid, f, v) => { (sc.avg[pid] ||= {})[f] = v; };
const scCount = (sc) => sc.out.length + Object.values(sc.avg).filter((o) => Object.keys(o).length).length + (sc.paceAdj ? 1 : 0);
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
  const player = (q) => { const pid = q.pid, o = sc.avg[pid] || {}, out = sc.out.includes(pid), v = scVals(pid, sc), k = Object.keys(o).length;
    return `<details class="tree-node" data-k="p:${pid}"><summary>${esc(DB.players[pid].name)}${out ? ` <span class="sc-tag bad">εκτός</span>` : k ? ` <span class="sc-tag">${k} αλλαγ${k > 1 ? "ές" : "ή"}</span>` : ""}</summary>
      <div class="tree-in"><label class="sc-row"><span>Παίζει</span><input type="checkbox" data-out="${pid}" ${out ? "" : "checked"}><output></output></label>
      ${out ? "" : SC_F.map((F) => slider(pid, F, +(+v[F[0]]).toFixed(3), o[F[0]] != null)).join("")}
      ${k || out ? `<button class="plink" data-screset="${pid}" style="font-size:12px">↺ πίσω στους πραγματικούς μέσους όρους</button>` : ""}</div></details>`; };
  const teamNode = (ti) => { const T = base.T[ti], ch = T.pl.filter((q) => sc.out.includes(q.pid) || Object.keys(sc.avg[q.pid] || {}).length).length;
    return `<details class="tree-node" data-k="t:${ti}"><summary>${badge(T.code, 18)} ${esc(team(T.code).name)}${ch ? ` <span class="sc-tag">${ch}</span>` : ""}</summary>
      <div class="tree-in">${T.pl.map(player).join("")}</div></details>`; };
  return `<details class="tree" data-k="root"><summary><b>Σενάριο:</b> ${n ? `${n} αλλαγ${n > 1 ? "ές" : "ή"}` : "πραγματικοί μέσοι όροι"}${sc.tags.length ? ` <span class="muted" style="font-size:12px">· ${sc.tags.map(esc).join(" · ")}</span>` : ""}</summary>
    <div class="tree-in">
      <details class="tree-node" data-k="pre"><summary>Έτοιμα σενάρια</summary><div class="tree-in">
        ${[0, 1].map((ti) => `<details class="tree-node" data-k="pre:${ti}"><summary>${badge(base.T[ti].code, 18)} ${esc(team(base.T[ti].code).name)}</summary><div class="tree-in">${plist(PR.side[ti], ti)}</div></details>`).join("")}
        <details class="tree-node" data-k="pre:g"><summary>Αγώνας</summary><div class="tree-in">${plist(PR.game, "g")}</div></details>
        <div class="muted" style="font-size:12px">Τα έτοιμα σενάρια προστίθενται το ένα πάνω στο άλλο.</div></div></details>
      <details class="tree-node" data-k="game"><summary>Αγώνας${sc.paceAdj ? ` <span class="sc-tag">ρυθμός ${sc.paceAdj > 0 ? "+" : ""}${sc.paceAdj}</span>` : ""}</summary><div class="tree-in">
        <label class="sc-row${sc.paceAdj ? " on" : ""}"><span>Ρυθμός (± κατοχές)</span><input type="range" min="-12" max="12" step="1" value="${sc.paceAdj}" data-pace><output>${sc.paceAdj > 0 ? "+" : ""}${sc.paceAdj}</output></label>
        <div class="muted" style="font-size:12px">Μέσος ρυθμός των δύο ομάδων: ${base.pace.toFixed(1)} κατοχές.</div></div></details>
      ${teamNode(0)}${teamNode(1)}
      ${n ? `<button class="plink" data-screset="*" style="font-size:13px">↺ Καθάρισμα όλων</button>` : ""}
      <div class="muted" style="font-size:12px;margin-top:4px">Ό,τι αλλάζεις θεωρείται η αλήθεια για τον αγώνα: ο παίκτης το πετυχαίνει απέναντι σε μέση άμυνα (χωρίς τη «συρρίκνωση» προς τη λίγκα). Μικρότερα λεπτά = λιγότερα σουτ, ριμπάουντ, ασίστ αναλογικά.</div>
    </div></details>`;
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
    try { ctx = base = SIM.prepare(DB, g.home, g.away, { beta: SIMS?.beta }); } catch (e) { el.innerHTML = `<div class="muted">Δεν γίνεται προσομοίωση: ${esc(e.message)}</div>`; return; }
    if (ctx.T[0].pl.length < 5 || ctx.T[1].pl.length < 5) { el.innerHTML = `<div class="muted">Δεν υπάρχουν αρκετοί παίκτες για προσομοίωση.</div>`; return; }
    const sc = (SCEN[g.code] ||= scNew());
    const scOpts = () => ({ beta: SIMS?.beta, out: sc.out, avg: sc.avg, paceAdj: sc.paceAdj });
    let baseMC = SIMS?.games?.[g.code] && !SIMS.games[g.code].played ? SIMS.games[g.code] : null;
    const SPEEDS = [["×10", 10], ["×60", 60], ["×240", 240], ["άμεσα", 1e9]];
    let speed = 60, log = [], idx = 0, clock = 0, raf = 0, last = 0, running = false, box = {};
    el.innerHTML = `<div class="section-head"><h2 style="margin:0">Ζωντανή προσομοίωση</h2>
        <div style="display:flex;gap:6px;flex-wrap:wrap" id="lv-ctl"><button class="btn primary" id="lv-go">▶ Start</button>
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
      try { ctx = scCount(sc) ? SIM.prepare(DB, g.home, g.away, scOpts()) : base; } catch (e) { $("#sc-res", el).innerHTML = `<div class="muted">Σφάλμα σεναρίου: ${esc(e.message)}</div>`; return; }
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
    const redraw = () => { const open = [...tree.querySelectorAll("details[open]")].map((d) => d.dataset.k);
      tree.innerHTML = scTree(g, base, sc); tree.querySelectorAll("details").forEach((d) => { if (open.includes(d.dataset.k)) d.open = true; });
      if (!running) $("#lv-go", el).textContent = "▶ Start"; };
    const changed = () => { dirty = true; if (running) return; log = []; idx = 0; $("#lv-go", el).textContent = "▶ Start"; };
    tree.addEventListener("input", (e) => {
      const t = e.target, o = t.parentElement.querySelector("output");
      if (t.dataset.pace != null) { sc.paceAdj = +t.value; o.textContent = (sc.paceAdj > 0 ? "+" : "") + sc.paceAdj; changed(); return; }
      if (!t.dataset.f) return;
      const pid = t.dataset.pid, F = SC_F.find((x) => x[0] === t.dataset.f);
      scSet(sc, pid, F[0], +t.value); o.textContent = F[5](+t.value); t.parentElement.classList.add("on");
      // τα υπόλοιπα sliders του παίκτη ακολουθούν (π.χ. λιγότερα λεπτά -> λιγότερα σουτ)
      const v = scVals(pid, sc);
      t.closest(".tree-in").querySelectorAll("input[data-f]").forEach((x) => { if (x === t) return; const G = SC_F.find((y) => y[0] === x.dataset.f);
        x.value = v[G[0]]; x.parentElement.querySelector("output").textContent = G[5](v[G[0]]); });
      changed();
    });
    tree.addEventListener("change", (e) => { const t = e.target;
      if (t.dataset.out) { const pid = t.dataset.out; sc.out = t.checked ? sc.out.filter((x) => x !== pid) : [...sc.out, pid]; redraw(); changed(); }
      else if (t.dataset.f || t.dataset.pace != null) redraw(); });
    tree.addEventListener("click", (e) => {
      const pr = e.target.closest("[data-preset]"), rs = e.target.closest("[data-screset]");
      if (pr) { const [k, i] = pr.dataset.preset.split(":"), PR = scPresets(base), P = k === "g" ? PR.game[+i] : PR.side[+k][+i];
        P[1](sc); sc.out = [...new Set(sc.out)]; if (!sc.tags.includes(P[0])) sc.tags.push(P[0]); redraw(); changed(); }
      if (rs) { const pid = rs.dataset.screset;
        if (pid === "*") SCEN[g.code] = Object.assign(sc, scNew()); else { delete sc.avg[pid]; sc.out = sc.out.filter((x) => x !== pid); }
        redraw(); changed(); }
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
    DB = await fetch("db/demo.json?v=__BUILD__").then((r) => { if (!r.ok) throw new Error("db/demo.json"); return r.json(); });
    SIMS = await fetch("db/sims.json?v=__BUILD__").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    $("#sub").textContent = `${DB.league} ${DB.season}-${String((DB.season + 1) % 100).padStart(2, "0")} · demo: ${DB.demo.map((c) => team(c).name).join(", ")}`;
    $("#foot").textContent = `Δεδομένα: esake.gr (box scores), EuroLeague API/ESPN (βιογραφικά) · ενημέρωση ${DB.updated}`;
    render();
  } catch (e) {
    $("#view").innerHTML = `<div class="empty">Σφάλμα φόρτωσης: ${esc(e.message)}</div>`;
  }
})();
