/* Campus TgMaster — espace administrateur */
"use strict";

let A = null;          // état administrateur renvoyé par le serveur
let CSRF = "";
let setupMode = false;
let view = {name:"students", student:null, q:"", classe:"", rq:"", rcourse:"", rclasse:""};
let lastCreds = [];    // identifiants générés pendant cette session (affichés une seule fois)
const app = document.getElementById("app");
const $ = id => document.getElementById(id);

async function api(action, data, query){
  const opt = {credentials:"same-origin", headers:{"X-CSRF":CSRF}};
  if(data !== undefined){ opt.method = "POST"; opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(data); }
  let res, json;
  try{ res = await fetch("api.php?action=" + action + (query || ""), opt); json = await res.json(); }
  catch(e){ throw {status:0, message:"Connexion au serveur impossible. Vérifiez votre réseau puis réessayez."}; }
  if(!res.ok){
    if(res.status === 401 && action !== "admin_login") boot();
    throw {status:res.status, message:json.error || "Erreur."};
  }
  return json;
}

const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const fmtDT = t => t ? new Date(t * 1000).toLocaleString("fr-FR", {day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"}) : "—";
const fmtD = t => t ? new Date(t * 1000).toLocaleDateString("fr-FR", {day:"2-digit", month:"2-digit", year:"numeric"}) : "—";
const fullName = s => (s.nom + " " + s.prenoms).trim();
const lessonInfo = id => { for(const c of A.courses){ const l = c.lessons.find(x => x.id === id); if(l) return {c, l}; } return null; };
const studentById = id => A.students.find(s => s.id === id);
const classes = () => [...new Set(A.students.map(s => s.classe).filter(Boolean))].sort();

/* ---------- Connexion / installation ---------- */
async function boot(){
  $("shell").hidden = true;
  let st;
  try{ st = await api("admin_status"); }
  catch(x){ $("auth").hidden = false; $("auth-err").textContent = x.message; $("auth-err").hidden = false; return; }
  CSRF = st.csrf;
  if(st.logged && !st.setup){ return load(); }
  setupMode = st.setup;
  $("auth").hidden = false;
  $("auth-title").textContent = setupMode ? "Créer le compte administrateur" : "Connexion administrateur";
  $("auth-text").textContent = setupMode ? "Première utilisation : choisissez l'identifiant et le mot de passe de l'administrateur." : "Réservé à la direction pédagogique.";
  $("auth-btn").textContent = setupMode ? "Créer le compte" : "Se connecter";
  $("a-pw-help").hidden = !setupMode;
  $("a-pw").autocomplete = setupMode ? "new-password" : "current-password";
}
$("auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("auth-err"); err.hidden = true; $("auth-btn").disabled = true;
  try{
    const r = await api(setupMode ? "admin_setup" : "admin_login", {username:$("a-user").value, password:$("a-pw").value});
    CSRF = r.csrf; $("a-pw").value = "";
    await load();
  }catch(x){ err.textContent = x.message; err.hidden = false; }
  $("auth-btn").disabled = false;
});
$("logout").onclick = async () => { try{ await api("logout", {}); }catch(e){} A = null; lastCreds = []; boot(); };
$("refresh").onclick = () => load();

async function load(){
  A = await api("admin_state");
  CSRF = A.csrf;
  $("auth").hidden = true; $("shell").hidden = false;
  render();
}

/* ---------- Rendu ---------- */
function render(){
  document.querySelectorAll(".nav button").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === (view.name === "student" ? "students" : view.name))));
  $("n-students").textContent = A.students.length || "";
  $("n-results").textContent = A.results.length || "";
  ({students:renderStudents, student:renderStudent, results:renderResults, create:renderCreate, settings:renderSettings}[view.name])();
  window.scrollTo({top:0});
}
document.querySelectorAll(".nav button").forEach(b => b.onclick = () => { view.name = b.dataset.view; render(); });

function statTiles(){
  const act = A.students.filter(s => s.active).length;
  const started = A.students.filter(s => s.done > 0).length;
  const avg = A.results.length ? Math.round(A.results.reduce((s, r) => s + r.score, 0) / A.results.length) + " %" : "—";
  const pass = A.results.length ? Math.round(A.results.filter(r => r.score >= A.pass).length / A.results.length * 100) + " %" : "—";
  return `<div class="stats">
    <div class="stat"><strong>${A.students.length}</strong><span>Comptes étudiants (${act} actifs)</span></div>
    <div class="stat"><strong>${started}</strong><span>Étudiants ayant passé au moins un quiz</span></div>
    <div class="stat"><strong>${A.results.length}</strong><span>Quiz validés au total</span></div>
    <div class="stat"><strong>${avg}</strong><span>Score moyen · ${pass} de réussite</span></div>
  </div>`;
}

function renderStudents(){
  const q = view.q.toLowerCase();
  const list = A.students.filter(s => (!view.classe || s.classe === view.classe) &&
    (!q || (s.matricule + " " + s.nom + " " + s.prenoms).toLowerCase().includes(q)));
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Administration</div><h1>Étudiants</h1>
    <p>Progression de chaque compte créé : quiz passés sur ${A.lessons_total}, leçons réussies (${A.pass} % et plus) et moyenne.</p></div>
    <button class="btn primary" id="go-create">Créer des comptes</button></div>
    ${statTiles()}
    <div class="toolbar">
      <input class="search" id="q" type="search" placeholder="Rechercher un nom ou un matricule…" value="${esc(view.q)}" aria-label="Rechercher un étudiant">
      <select id="f-classe" aria-label="Filtrer par classe"><option value="">Toutes les classes</option>${classes().map(c => `<option ${c===view.classe?"selected":""}>${esc(c)}</option>`).join("")}</select>
      <span class="note-sample">${list.length} étudiant(s)</span>
    </div>
    ${A.students.length === 0 ? `<div class="empty">Aucun compte étudiant pour l'instant. Créez les premiers comptes pour commencer le suivi.</div>` :
    `<div class="tbl-wrap"><table class="data"><thead><tr><th>Matricule</th><th>Nom et prénoms</th><th>Classe</th><th>Progression</th><th class="num">Réussies</th><th class="num">Moyenne</th><th>Dernier quiz</th><th>État</th></tr></thead><tbody>
      ${list.map(s => { const pct = Math.round(s.done / A.lessons_total * 100); return `<tr class="click" data-s="${s.id}" tabindex="0">
        <td class="mono">${esc(s.matricule)}</td><td><strong>${esc(fullName(s))}</strong></td><td>${esc(s.classe) || "—"}</td>
        <td><div class="mini"><div class="bar"><i style="width:${pct}%"></i></div><span class="mono">${s.done}/${A.lessons_total}</span></div></td>
        <td class="num">${s.passed}</td><td class="num">${s.avg === null ? "—" : s.avg + " %"}</td><td>${fmtD(s.last_result)}</td>
        <td><span class="pill ${s.active ? (s.done ? "prog" : "new") : "new"}">${s.active ? (s.done ? "Actif" : "Pas commencé") : "Désactivé"}</span></td></tr>`; }).join("") ||
        `<tr><td colspan="8" class="note-sample">Aucun étudiant ne correspond à ces critères.</td></tr>`}
    </tbody></table></div>`}`;
  $("go-create").onclick = () => { view.name = "create"; render(); };
  const qi = $("q");
  qi.oninput = () => { view.q = qi.value; const p = qi.selectionStart; renderStudents(); const n = $("q"); n.focus(); n.setSelectionRange(p, p); };
  $("f-classe").onchange = e => { view.classe = e.target.value; renderStudents(); };
  app.querySelectorAll("[data-s]").forEach(tr => {
    const go = () => { view.name = "student"; view.student = +tr.dataset.s; render(); };
    tr.onclick = go; tr.onkeydown = e => { if(e.key === "Enter") go(); };
  });
}

function renderStudent(){
  const s = studentById(view.student);
  if(!s){ view.name = "students"; return render(); }
  const mine = {}; A.results.filter(r => r.student_id === s.id).forEach(r => mine[r.lesson_id] = r);
  app.innerHTML = `
    <button class="back" id="back">← Tous les étudiants</button>
    <div class="page-head"><div><div class="eyebrow">${esc(s.matricule)}${s.classe ? " · " + esc(s.classe) : ""}</div><h1>${esc(fullName(s))}</h1>
    <p>Compte créé le ${fmtD(s.created_at)} · dernière connexion : ${fmtDT(s.last_login)}${s.active ? "" : " · compte désactivé"}</p></div></div>
    <div class="stats">
      <div class="stat"><strong>${s.done}<span class="mono" style="font-size:1rem"> / ${A.lessons_total}</span></strong><span>Quiz passés</span></div>
      <div class="stat"><strong>${s.passed}</strong><span>Leçons réussies</span></div>
      <div class="stat"><strong>${s.avg === null ? "—" : s.avg + " %"}</strong><span>Moyenne</span></div>
      <div class="stat"><strong>${A.courses.filter(c => c.lessons.every(l => mine[l.id])).length}<span class="mono" style="font-size:1rem"> / ${A.courses.length}</span></strong><span>Cours terminés</span></div>
    </div>
    <div class="panel">
      <h2>Scores par cours et par leçon</h2>
      <div class="legend"><span><i style="background:var(--ok-soft)"></i>Réussi (${A.pass} % et plus)</span><span><i style="background:var(--bad-soft)"></i>Sous le seuil</span><span><i style="background:var(--sunk)"></i>Quiz non passé</span></div>
      <div style="overflow-x:auto"><div class="heat">
        <span></span>${Array.from({length:10}, (_, i) => `<span class="hh">L${i+1}</span>`).join("")}
        ${A.courses.map(c => `<span class="mono" title="${esc(c.title)}">${c.code}</span>` + c.lessons.map(l => { const r = mine[l.id];
          return r ? `<button class="hc ${r.score >= A.pass ? "pass" : "fail"}" data-r="${l.id}" title="${esc(l.t)} · ${r.good}/${r.total} · ${fmtDT(r.submitted_at)}">${r.score}</button>` : `<span class="hc" title="${esc(l.t)} · non passé">·</span>`; }).join("")).join("")}
      </div></div>
      <div id="reset-zone" class="note-sample">Cliquez sur un score pour voir le détail ou autoriser une nouvelle tentative.</div>
    </div>
    <div class="panel">
      <h2>Gestion du compte</h2>
      <div class="msg" id="acc-msg" hidden></div>
      <div class="form-grid">
        <div class="field"><label for="e-nom">Nom</label><input id="e-nom" value="${esc(s.nom)}"></div>
        <div class="field"><label for="e-prenoms">Prénoms</label><input id="e-prenoms" value="${esc(s.prenoms)}"></div>
        <div class="field"><label for="e-classe">Classe</label><input id="e-classe" value="${esc(s.classe)}"></div>
      </div>
      <div class="toolbar" id="acc-actions">
        <button class="btn primary" id="e-save">Enregistrer</button>
        <button class="btn" id="e-reset">Générer un nouveau mot de passe</button>
        <button class="btn" id="e-toggle">${s.active ? "Désactiver le compte" : "Réactiver le compte"}</button>
        <button class="btn" id="e-del" style="color:var(--bad)">Supprimer le compte</button>
      </div>
    </div>`;
  $("back").onclick = () => { view.name = "students"; render(); };
  const msg = (t, ok) => { const m = $("acc-msg"); m.className = "msg " + (ok ? "ok" : "err"); m.textContent = t; m.hidden = false; };
  app.querySelectorAll("[data-r]").forEach(b => b.onclick = () => {
    const r = mine[b.dataset.r], info = lessonInfo(r.lesson_id), z = $("reset-zone");
    z.className = "confirm";
    z.innerHTML = `<span><strong>${info.c.code} · leçon ${info.l.n} : ${esc(info.l.t)}</strong><br>${r.score} % (${r.good}/${r.total}), validé le ${fmtDT(r.submitted_at)}.</span>
      <button class="btn" id="rz-no">Fermer</button><button class="btn" id="rz-yes" style="color:var(--bad)">Effacer ce résultat et autoriser une nouvelle tentative</button>`;
    $("rz-no").onclick = renderStudent;
    $("rz-yes").onclick = async () => {
      try{ await api("result_reset", {student_id:s.id, lesson_id:r.lesson_id}); await load(); }
      catch(x){ z.className = "msg err"; z.textContent = x.message; }
    };
  });
  $("e-save").onclick = async () => {
    try{ await api("student_update", {id:s.id, nom:$("e-nom").value, prenoms:$("e-prenoms").value, classe:$("e-classe").value}); await load(); }
    catch(x){ msg(x.message, false); }
  };
  $("e-reset").onclick = async () => {
    try{ const r = await api("student_update", {id:s.id, reset_password:true});
      msg(`Nouveau mot de passe de ${r.matricule} : ${r.password} — notez-le maintenant, il ne sera plus affiché.`, true); }
    catch(x){ msg(x.message, false); }
  };
  $("e-toggle").onclick = async () => {
    try{ await api("student_update", {id:s.id, active:!s.active}); await load(); }
    catch(x){ msg(x.message, false); }
  };
  $("e-del").onclick = () => {
    $("acc-actions").innerHTML = `<div class="confirm"><span><strong>Supprimer ${esc(fullName(s))} ?</strong> Le compte, ses ${s.done} résultat(s) et ses notes seront effacés définitivement.</span>
      <button class="btn" id="d-no">Annuler</button><button class="btn primary" id="d-yes" style="background:var(--bad);border-color:var(--bad)">Supprimer définitivement</button></div>`;
    $("d-no").onclick = renderStudent;
    $("d-yes").onclick = async () => {
      try{ await api("student_delete", {id:s.id}); view.name = "students"; await load(); }
      catch(x){ msg(x.message, false); }
    };
  };
}

function renderResults(){
  const q = view.rq.toLowerCase();
  const rows = A.results.map(r => ({r, s:studentById(r.student_id), i:lessonInfo(r.lesson_id)})).filter(x => x.s && x.i)
    .filter(x => (!view.rcourse || x.r.course_id === view.rcourse) && (!view.rclasse || x.s.classe === view.rclasse) &&
      (!q || (x.s.matricule + " " + x.s.nom + " " + x.s.prenoms).toLowerCase().includes(q)));
  const shown = rows.slice(0, 300);
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Administration</div><h1>Résultats des quiz</h1>
    <p>Chaque quiz validé par un étudiant arrive ici, du plus récent au plus ancien. La validation est unique : un score ne change plus, sauf si vous autorisez une nouvelle tentative depuis la fiche de l'étudiant.</p></div>
    <a class="btn primary" href="api.php?action=export" style="text-decoration:none">Exporter en CSV (Excel)</a></div>
    <div class="toolbar">
      <input class="search" id="rq" type="search" placeholder="Rechercher un étudiant…" value="${esc(view.rq)}" aria-label="Rechercher un étudiant">
      <select id="rcourse" aria-label="Filtrer par cours"><option value="">Tous les cours</option>${A.courses.map(c => `<option value="${c.id}" ${c.id===view.rcourse?"selected":""}>${c.code} · ${esc(c.title)}</option>`).join("")}</select>
      <select id="rclasse" aria-label="Filtrer par classe"><option value="">Toutes les classes</option>${classes().map(c => `<option ${c===view.rclasse?"selected":""}>${esc(c)}</option>`).join("")}</select>
      <span class="note-sample">${rows.length} résultat(s)${rows.length > shown.length ? `, ${shown.length} affichés (l'export contient tout)` : ""}</span>
    </div>
    ${A.results.length === 0 ? `<div class="empty">Aucun quiz validé pour l'instant. Les résultats apparaîtront ici dès qu'un étudiant validera un quiz.</div>` :
    `<div class="tbl-wrap"><table class="data"><thead><tr><th>Date</th><th>Étudiant</th><th>Classe</th><th>Cours</th><th>Leçon</th><th class="num">Score</th><th class="num">Bonnes rép.</th><th>Résultat</th></tr></thead><tbody>
      ${shown.map(x => `<tr class="click" data-s="${x.s.id}" tabindex="0"><td class="mono">${fmtDT(x.r.submitted_at)}</td><td><strong>${esc(fullName(x.s))}</strong><br><span class="mono" style="color:var(--muted)">${esc(x.s.matricule)}</span></td>
        <td>${esc(x.s.classe) || "—"}</td><td class="mono">${x.i.c.code}</td><td class="wrap">${x.i.l.n}. ${esc(x.i.l.t)}</td>
        <td class="num"><strong>${x.r.score} %</strong></td><td class="num">${x.r.good}/${x.r.total}</td>
        <td><span class="pill ${x.r.score >= A.pass ? "done" : "prog"}">${x.r.score >= A.pass ? "Réussi" : "Sous le seuil"}</span></td></tr>`).join("") ||
        `<tr><td colspan="8" class="note-sample">Aucun résultat ne correspond à ces critères.</td></tr>`}
    </tbody></table></div>`}`;
  const qi = $("rq");
  qi.oninput = () => { view.rq = qi.value; const p = qi.selectionStart; renderResults(); const n = $("rq"); n.focus(); n.setSelectionRange(p, p); };
  $("rcourse").onchange = e => { view.rcourse = e.target.value; renderResults(); };
  $("rclasse").onchange = e => { view.rclasse = e.target.value; renderResults(); };
  app.querySelectorAll("[data-s]").forEach(tr => {
    const go = () => { view.name = "student"; view.student = +tr.dataset.s; render(); };
    tr.onclick = go; tr.onkeydown = e => { if(e.key === "Enter") go(); };
  });
}

function credsText(){ return lastCreds.map(c => [c.matricule, c.nom, c.prenoms, c.classe, c.password].join(";")).join("\n"); }

function renderCreate(){
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Administration</div><h1>Créer des comptes</h1>
    <p>Le mot de passe de chaque étudiant est généré automatiquement et affiché une seule fois, juste après la création. L'étudiant peut ensuite le changer dans « Mon compte ».</p></div></div>
    ${lastCreds.length ? `<div class="panel"><h2>Identifiants à remettre aux étudiants (${lastCreds.length})</h2>
      <p class="note-sample" style="margin:0">Copiez ou téléchargez cette liste maintenant : les mots de passe ne pourront plus être affichés. Format : matricule;nom;prénoms;classe;mot de passe.</p>
      <div class="creds" id="creds">${esc(credsText())}</div>
      <div class="toolbar"><button class="btn primary" id="copy">Copier la liste</button><button class="btn" id="dl">Télécharger en CSV</button><button class="btn" id="clear">J'ai noté les identifiants</button><span class="note-sample" id="copy-state"></span></div></div>` : ""}
    <form class="panel" id="one">
      <h2>Un étudiant</h2>
      <div class="msg err" id="one-err" hidden></div>
      <div class="form-grid">
        <div class="field"><label for="c-mat">Matricule</label><input id="c-mat" required maxlength="40" placeholder="MRH26-001"></div>
        <div class="field"><label for="c-nom">Nom</label><input id="c-nom" required maxlength="80"></div>
        <div class="field"><label for="c-prenoms">Prénoms</label><input id="c-prenoms" maxlength="120"></div>
        <div class="field"><label for="c-classe">Classe</label><input id="c-classe" maxlength="60" placeholder="B3 MRH" list="classes"><datalist id="classes">${classes().map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
      </div>
      <div><button class="btn primary" type="submit">Créer le compte</button></div>
    </form>
    <form class="panel" id="many">
      <h2>Plusieurs étudiants à la fois</h2>
      <div class="msg err" id="many-err" hidden style="white-space:pre-line"></div>
      <div class="field"><label for="c-text">Une ligne par étudiant : matricule;nom;prénoms;classe</label>
        <textarea id="c-text" rows="8" placeholder="MRH26-001;KOUASSI;Aya Marie;B3 MRH&#10;MRH26-002;TRAORÉ;Ibrahim;B3 MRH" style="font-family:var(--mono);font-size:.88rem"></textarea>
        <small>Vous pouvez coller directement des colonnes copiées depuis Excel. Séparateurs acceptés : point-virgule, virgule ou tabulation.</small></div>
      <div><button class="btn primary" type="submit">Créer les comptes</button></div>
    </form>`;
  if(lastCreds.length){
    $("copy").onclick = async () => {
      try{ await navigator.clipboard.writeText(credsText()); $("copy-state").textContent = "Liste copiée."; }
      catch(e){ const r = document.createRange(); r.selectNodeContents($("creds")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); $("copy-state").textContent = "Liste sélectionnée : faites Ctrl + C."; }
    };
    $("dl").onclick = () => {
      const blob = new Blob(["﻿Matricule;Nom;Prénoms;Classe;Mot de passe\n" + credsText() + "\n"], {type:"text/csv;charset=utf-8"});
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "identifiants-campus-tgmaster.csv";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $("clear").onclick = () => { lastCreds = []; renderCreate(); };
  }
  $("one").onsubmit = async e => {
    e.preventDefault();
    try{
      const r = await api("student_create", {matricule:$("c-mat").value, nom:$("c-nom").value, prenoms:$("c-prenoms").value, classe:$("c-classe").value});
      lastCreds = r.created.concat(lastCreds); await load();
    }catch(x){ const m = $("one-err"); m.textContent = x.message; m.hidden = false; }
  };
  $("many").onsubmit = async e => {
    e.preventDefault();
    const text = $("c-text").value;
    try{
      const r = await api("students_import", {text});
      lastCreds = r.created.concat(lastCreds); await load();
      if(r.errors.length){ const m = $("many-err"); m.textContent = `${r.created.length} compte(s) créé(s). ${r.errors.length} ligne(s) ignorée(s) :\n` + r.errors.join("\n"); m.hidden = false; }
    }catch(x){ const m = $("many-err"); m.textContent = x.message; m.hidden = false; }
  };
}

function renderSettings(){
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Administration</div><h1>Paramètres</h1></div></div>
    <div class="panel" style="max-width:640px">
      <h2>Quiz</h2>
      <p style="margin:0">Chaque quiz ne peut être validé qu'une seule fois par étudiant. Le seuil de réussite d'une leçon est de ${A.pass} %.</p>
      <label class="switch"><input type="checkbox" id="s-corr" ${A.show_corrections ? "checked" : ""}> <span>Afficher la correction détaillée à l'étudiant après la validation</span></label>
      <p class="note-sample" style="margin:0">Décochez cette option pendant une période d'évaluation, pour éviter que les réponses circulent entre étudiants. Le score reste affiché.</p>
      <div class="msg ok" id="s-msg" hidden></div>
    </div>
    <form class="panel" id="pw" style="max-width:640px">
      <h2>Mot de passe administrateur</h2>
      <div class="msg" id="pw-msg" hidden></div>
      <div class="form-grid">
        <div class="field"><label for="p-old">Mot de passe actuel</label><input id="p-old" type="password" autocomplete="current-password" required></div>
        <div class="field"><label for="p-new">Nouveau mot de passe</label><input id="p-new" type="password" autocomplete="new-password" minlength="10" required><small>10 caractères au minimum.</small></div>
      </div>
      <div><button class="btn primary" type="submit">Changer le mot de passe</button></div>
    </form>`;
  $("s-corr").onchange = async e => {
    try{ await api("admin_settings", {show_corrections:e.target.checked}); A.show_corrections = e.target.checked; const m = $("s-msg"); m.textContent = "Paramètre enregistré."; m.hidden = false; }
    catch(x){ e.target.checked = !e.target.checked; const m = $("s-msg"); m.className = "msg err"; m.textContent = x.message; m.hidden = false; }
  };
  $("pw").onsubmit = async e => {
    e.preventDefault();
    const m = $("pw-msg");
    try{ await api("admin_settings", {old_password:$("p-old").value, new_password:$("p-new").value}); m.className = "msg ok"; m.textContent = "Mot de passe modifié."; $("pw").reset(); }
    catch(x){ m.className = "msg err"; m.textContent = x.message; }
    m.hidden = false;
  };
}

boot();
