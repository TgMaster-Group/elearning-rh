/* Campus TgMaster — espace étudiant */
"use strict";

const PROGRAM = "Bachelor 3 · Management des Ressources Humaines";
const UNITS = {
  trad:{label:"Unité Traditionnelle", cls:"u-trad", color:"--accent"},
  lang:{label:"Unité Langues", cls:"u-lang", color:"--plum"},
  prat:{label:"Pratique & Compétences", cls:"u-prat", color:"--ochre"}
};

let ST = null;                 // état renvoyé par le serveur
let CSRF = "";
const lessonCache = {};        // contenu des leçons déjà chargées
let view = {name:"catalogue", course:null, lesson:null, tab:"cours", filter:"all", q:""};
const app = document.getElementById("app");
const $ = id => document.getElementById(id);

/* ---------- Appels serveur ---------- */
async function api(action, data, query){
  const opt = {credentials:"same-origin", headers:{"X-CSRF":CSRF}};
  if(data !== undefined){ opt.method = "POST"; opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(data); }
  let res, json;
  try{
    res = await fetch("api.php?action=" + action + (query || ""), opt);
    json = await res.json();
  }catch(e){ throw {status:0, message:"Connexion au serveur impossible. Vérifiez votre réseau puis réessayez."}; }
  if(!res.ok){
    if(res.status === 401 && action !== "login"){ showLogin(); }
    throw {status:res.status, message:json.error || "Erreur."};
  }
  return json;
}

/* ---------- Utilitaires ---------- */
const esc = s => String(s).replace(/[&<>"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
const fmtMin = m => m >= 60 ? `${Math.floor(m/60)} h ${String(m%60).padStart(2,"0")}` : `${m} min`;
const fmtDate = t => new Date(t * 1000).toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric"});
const unitTag = u => `<span class="unit ${UNITS[u].cls}">${UNITS[u].label}</span>`;
const findCourse = id => ST.courses.find(c => c.id === id);
const res = l => ST.results[l.id] || null;
const passed = l => { const r = res(l); return !!r && r.score >= ST.pass; };
const progress = c => {
  const done = c.lessons.filter(res).length, ok = c.lessons.filter(passed).length;
  return {done, ok, t:c.lessons.length, pct:Math.round(done / c.lessons.length * 100)};
};
const minutes = c => c.lessons.reduce((s, l) => s + l.min, 0);
const courseAvg = c => { const rs = c.lessons.map(res).filter(Boolean); return rs.length ? Math.round(rs.reduce((s, r) => s + r.score, 0) / rs.length) : null; };
const status = c => { const p = progress(c); return p.done === 0 ? ["new","À commencer"] : p.done === p.t ? ["done","Terminé"] : ["prog","En cours"]; };

/* ordre des réponses propre à chaque étudiant */
function order(n, seedStr){
  let seed = [...seedStr].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const idx = [...Array(n).keys()];
  for(let i = n - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx;
}

/* brouillon des réponses (dans ce navigateur) tant que le quiz n'est pas validé */
const draftKey = id => "campus-draft:" + ST.student.matricule + ":" + id;
function loadDraft(id){ try{ return JSON.parse(localStorage.getItem(draftKey(id)) || "{}"); }catch(e){ return {}; } }
function saveDraft(id, d){ try{ localStorage.setItem(draftKey(id), JSON.stringify(d)); }catch(e){} }
function clearDraft(id){ try{ localStorage.removeItem(draftKey(id)); }catch(e){} }

/* ---------- Connexion ---------- */
function showLogin(){
  ST = null;
  $("shell").hidden = true; $("auth").hidden = false;
  $("login-pw").value = "";
}
function showApp(payload){
  ST = payload; CSRF = payload.csrf;
  $("auth").hidden = true; $("shell").hidden = false;
  $("who-name").textContent = (ST.student.prenoms + " " + ST.student.nom).trim();
  $("who-mat").textContent = ST.student.matricule + (ST.student.classe ? " · " + ST.student.classe : "");
  view = {name:"catalogue", course:null, lesson:null, tab:"cours", filter:"all", q:""};
  render();
}
$("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("login-err"), btn = $("login-btn");
  err.hidden = true; btn.disabled = true;
  try{ showApp(await api("login", {matricule:$("login-mat").value, password:$("login-pw").value})); }
  catch(x){ err.textContent = x.message; err.hidden = false; }
  btn.disabled = false;
});
$("logout").onclick = async () => { try{ await api("logout", {}); }catch(e){} showLogin(); };

/* ---------- Rendu ---------- */
function render(){
  document.querySelectorAll(".nav button").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === (view.name === "course" ? "catalogue" : view.name))));
  const started = ST.courses.filter(c => progress(c).done > 0).length;
  $("nav-count").textContent = started ? `${started}/${ST.courses.length}` : "";
  if(view.name === "catalogue") renderCatalogue();
  else if(view.name === "dashboard") renderDashboard();
  else if(view.name === "account") renderAccount();
  else renderCourse();
  window.scrollTo({top:0});
}

function renderCatalogue(){
  const list = ST.courses.filter(c => (view.filter === "all" || c.unit === view.filter) &&
    (!view.q || (c.title + c.summary + c.code + c.lessons.map(l => l.t).join(" ")).toLowerCase().includes(view.q.toLowerCase())));
  const nl = ST.courses.reduce((s, c) => s + c.lessons.length, 0);
  app.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${PROGRAM} · 2026-2027</div><h1>Catalogue des cours</h1>
      <p>${ST.courses.length} cours et ${nl} leçons. Chaque leçon se termine par un quiz à <strong>validation unique</strong> : une fois vos réponses validées, le score est définitif et transmis à l'administration.</p></div>
    </div>
    <div class="filters" role="group" aria-label="Filtrer par unité">
      <button class="chip" data-f="all" aria-pressed="${view.filter==='all'}">Toutes les unités</button>
      ${Object.entries(UNITS).map(([k,u]) => `<button class="chip" data-f="${k}" aria-pressed="${view.filter===k}">${u.label}</button>`).join("")}
      <input class="search" id="search" type="search" placeholder="Rechercher un cours ou une leçon…" value="${esc(view.q)}" aria-label="Rechercher un cours">
    </div>
    ${list.length ? `<div class="grid">${list.map(card).join("")}</div>` : `<div class="empty">Aucun cours ne correspond à votre recherche.</div>`}`;
  app.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { view.filter = b.dataset.f; renderCatalogue(); });
  const s = $("search");
  s.oninput = () => { view.q = s.value; const pos = s.selectionStart; renderCatalogue(); const n = $("search"); n.focus(); n.setSelectionRange(pos, pos); };
  app.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openCourse(b.dataset.open));
  app.querySelectorAll("canvas[data-seed]").forEach(drawPattern);
}

function card(c){
  const p = progress(c);
  const label = p.done === 0 ? "Commencer" : p.done === p.t ? "Revoir" : "Continuer";
  return `<article class="card">
    <div class="card-top"><canvas data-seed="${c.id}" data-unit="${c.unit}"></canvas><span class="code mono">${c.code}</span></div>
    <div class="card-body">
      ${unitTag(c.unit)}
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.summary)}</p>
      <div class="meta"><span>${c.lessons.length} leçons</span><span>${c.lessons.reduce((s,l)=>s+l.nq,0)} questions</span><span>${fmtMin(minutes(c))}</span></div>
      <div class="bar" aria-label="Progression ${p.pct} %"><i style="width:${p.pct}%"></i></div>
      <div class="card-foot"><span class="mono">${p.done}/${p.t} quiz passés</span><button class="btn ${p.done<p.t?'primary':''}" data-open="${c.id}">${label}</button></div>
    </div></article>`;
}

function drawPattern(cv){
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if(!r.width) return;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const x = cv.getContext("2d"); x.scale(dpr, dpr);
  const cs = getComputedStyle(document.documentElement);
  const col = cs.getPropertyValue(UNITS[cv.dataset.unit].color).trim();
  x.fillStyle = cs.getPropertyValue("--sunk").trim(); x.fillRect(0, 0, r.width, r.height);
  let seed = [...cv.dataset.seed].reduce((a, ch) => a * 7 + ch.charCodeAt(0), 3) % 233280;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  x.fillStyle = col; x.strokeStyle = col;
  if(cv.dataset.unit === "trad"){
    x.globalAlpha = .25; for(let y = 12; y < r.height; y += 12) x.fillRect(0, y, r.width, 1);
    x.globalAlpha = .8; for(let i = 0; i < 14; i++){ const w = 20 + rnd() * 60; x.fillRect(r.width - 20 - (i % 2 ? w : 0) - w, 8 + i * 12 % r.height, w, 5); }
  } else if(cv.dataset.unit === "lang"){
    x.globalAlpha = .75; const n = Math.floor(r.width / 7);
    for(let i = 0; i < n; i++){ const h = 6 + Math.abs(Math.sin(i * .35 + rnd())) * (r.height * .6); x.fillRect(i * 7, (r.height - h) / 2, 3, h); }
  } else {
    x.globalAlpha = .35; x.lineWidth = 2; x.beginPath(); x.moveTo(0, r.height * .65);
    const pts = []; for(let i = 1; i <= 6; i++){ const px = i * r.width / 7, py = r.height * (.25 + rnd() * .5); pts.push([px, py]); x.lineTo(px, py); }
    x.stroke(); x.globalAlpha = .9; pts.forEach(([px, py]) => { x.beginPath(); x.arc(px, py, 5, 0, Math.PI * 2); x.fill(); });
  }
}

function openCourse(id){
  const c = findCourse(id);
  view = {...view, name:"course", course:id, tab:"cours", lesson:(c.lessons.find(l => !res(l)) || c.lessons[0]).id};
  render();
}

function renderCourse(){
  const c = findCourse(view.course), L = c.lessons.find(l => l.id === view.lesson), idx = L.n - 1;
  const p = progress(c), r = res(L);
  const allDone = p.done === p.t;
  app.innerHTML = `
    <button class="back" id="back">← Retour au catalogue</button>
    <div class="page-head"><div>${unitTag(c.unit)}<h1 style="margin-top:8px">${esc(c.title)}</h1><p>${c.code} · B3 MRH</p></div></div>
    <div class="course">
      <nav class="outline" aria-label="Plan du cours">
        <div><div class="meta" style="justify-content:space-between;margin-bottom:6px"><span>${p.done} / ${p.t} quiz passés</span><span class="mono">${p.pct} %</span></div>
        <div class="bar"><i style="width:${p.pct}%"></i></div></div>
        <ol>${c.lessons.map(l => { const b = res(l); return `<li><button class="lesson-btn" data-l="${l.id}" aria-current="${l.id===L.id}">
          <span class="dot ${b ? 'done' : ''}" ${b && !passed(l) ? 'style="background:var(--bad);border-color:var(--bad)"' : ''}></span><span><span class="mono" style="color:var(--muted)">${String(l.n).padStart(2,"0")}</span> ${esc(l.t)}</span><span class="mono">${b ? b.score + " %" : l.min + "′"}</span></button></li>`; }).join("")}</ol>
        ${allDone ? `<button class="btn primary" id="cert-btn">Voir mon attestation</button>` : ""}
      </nav>
      <article class="lesson" id="lesson">
        <div><div class="eyebrow">Leçon ${L.n} sur ${c.lessons.length} · ${fmtMin(L.min)} · quiz de ${L.nq} questions${r ? ` · score ${r.score} %` : ""}</div><h2 style="margin-top:6px">${esc(L.t)}</h2></div>
        <div class="tabs" role="tablist">
          <button role="tab" id="tab-cours" aria-selected="${view.tab==='cours'}">Cours</button>
          <button role="tab" id="tab-quiz" aria-selected="${view.tab==='quiz'}">Quiz · ${L.nq} questions ${r ? `<span class="pill ${passed(L)?'done':'prog'}">${r.score} %</span>` : ''}</button>
        </div>
        <div id="panel"><p class="note-sample">Chargement de la leçon…</p></div>
        <div class="lesson-nav">
          <button class="btn" id="prev" ${idx===0?"disabled":""}>← Leçon précédente</button>
          <button class="btn" id="next" ${idx===c.lessons.length-1?"disabled":""}>Leçon suivante →</button>
        </div>
      </article>
    </div>`;
  $("back").onclick = () => { view.name = "catalogue"; render(); };
  app.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { view.lesson = b.dataset.l; view.tab = "cours"; render(); });
  $("prev").onclick = () => { view.lesson = c.lessons[idx-1].id; view.tab = "cours"; render(); };
  $("next").onclick = () => { view.lesson = c.lessons[idx+1].id; view.tab = "cours"; render(); };
  $("tab-cours").onclick = () => { view.tab = "cours"; renderPanel(c, L); };
  $("tab-quiz").onclick = () => { view.tab = "quiz"; renderPanel(c, L); };
  const cb = $("cert-btn"); if(cb) cb.onclick = () => showCert(c);
  loadLesson(L.id).then(() => { if(view.name === "course" && view.lesson === L.id) renderPanel(c, L); })
    .catch(x => { const pn = $("panel"); if(pn) pn.innerHTML = `<div class="msg err">${esc(x.message)}</div>`; });
}

async function loadLesson(id){
  if(!lessonCache[id]) lessonCache[id] = await api("lesson", undefined, "&id=" + encodeURIComponent(id));
  return lessonCache[id];
}

let noteTimer = null;
function renderPanel(c, L){
  const D = lessonCache[L.id];
  if(!D) return;
  $("tab-cours").setAttribute("aria-selected", view.tab === "cours");
  $("tab-quiz").setAttribute("aria-selected", view.tab === "quiz");
  const panel = $("panel");
  if(view.tab === "cours"){
    panel.innerHTML = `<div class="prose">${D.html}</div>
      <div class="notes"><label class="eyebrow" for="note">Mes notes <span id="note-state" class="note-sample" style="text-transform:none;letter-spacing:0;font-weight:400"></span></label>
      <textarea id="note" placeholder="Notez ici les points à retenir…">${esc(D.note)}</textarea></div>
      ${D.result ? "" : `<div class="to-quiz"><div><strong>Prêt à passer le quiz ?</strong><br><span class="note-sample">${L.nq} questions, une seule validation possible. Relisez bien le cours avant.</span></div><button class="btn primary" id="go-quiz">Passer le quiz</button></div>`}`;
    const ta = $("note");
    ta.oninput = () => {
      D.note = ta.value; $("note-state").textContent = "";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(async () => {
        try{ await api("note", {lesson:L.id, body:D.note}); const s = $("note-state"); if(s) s.textContent = "· enregistrées"; }
        catch(x){ const s = $("note-state"); if(s) s.textContent = "· non enregistrées : " + x.message; }
      }, 900);
    };
    const g = $("go-quiz"); if(g) g.onclick = () => { view.tab = "quiz"; renderPanel(c, L); $("lesson").scrollIntoView({block:"start"}); };
  } else if(D.result){
    renderQuizDone(L, D);
  } else {
    renderQuizForm(c, L, D);
  }
}

function questionHtml(L, D, i, opts){
  const q = D.quiz[i], ord = order(q.o.length, L.id + ":" + i + ":" + ST.student.matricule);
  return `<fieldset class="q"><legend><span class="mono qn">${i+1}</span> ${esc(q.q)}</legend>
    ${ord.map(j => {
      let cls = "opt", attr = "";
      if(opts.done){
        attr = "disabled" + (q.chosen === j ? " checked" : "");
        if(D.corrections){ if(j === q.a) cls += " right"; else if(q.chosen === j) cls += " wrong"; }
      } else if(opts.draft[i] === j) attr = "checked";
      return `<label class="${cls}"><input type="radio" name="q${i}" id="r-${i}-${j}" value="${j}" ${attr}><span>${esc(q.o[j])}</span></label>`;
    }).join("")}
    ${opts.done && D.corrections ? `<div class="explain"><strong>${q.chosen === q.a ? "Bonne réponse." : "Réponse attendue : " + esc(q.o[q.a]) + "."}</strong> ${esc(q.e)}</div>` : ""}
  </fieldset>`;
}

function renderQuizDone(L, D){
  const r = D.result, ok = r.score >= ST.pass;
  $("panel").innerHTML = `<div id="quiz">
    <div class="score ${ok ? "pass" : "fail"}"><strong>${r.score} %</strong><span>${r.good} / ${r.total} bonnes réponses. Quiz validé le ${fmtDate(r.at)}. ${ok ? "Leçon réussie." : `Le seuil de réussite est de ${ST.pass} %.`}</span></div>
    <div class="locked"><span>Ce quiz est à validation unique : vos réponses sont définitives et le score a été transmis à l'administration.${D.corrections ? "" : " La correction détaillée n'est pas affichée."}</span></div>
    ${D.quiz.map((_, i) => questionHtml(L, D, i, {done:true})).join("")}
  </div>`;
}

function renderQuizForm(c, L, D){
  const n = D.quiz.length, draft = loadDraft(L.id);
  $("panel").innerHTML = `<form id="quiz">
    <div class="quiz-head"><span><strong>Validation unique.</strong> Répondez aux ${n} questions, puis validez une seule fois. Seuil de réussite : ${ST.pass} %.</span><span class="mono" id="answered"></span></div>
    ${D.quiz.map((_, i) => questionHtml(L, D, i, {done:false, draft})).join("")}
    <div class="msg err" id="quiz-err" hidden></div>
    <div id="quiz-actions" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" type="submit" id="submit">Valider mes réponses</button></div>
  </form>`;
  const f = $("quiz");
  const answers = () => D.quiz.map((_, i) => { const v = f.querySelector(`input[name=q${i}]:checked`); return v ? +v.value : null; });
  const counter = () => { $("answered").textContent = `${answers().filter(a => a !== null).length} / ${n} répondues`; };
  counter();
  f.addEventListener("change", () => { const d = {}; answers().forEach((a, i) => { if(a !== null) d[i] = a; }); saveDraft(L.id, d); counter(); });
  f.onsubmit = e => {
    e.preventDefault();
    const err = $("quiz-err"), ans = answers();
    const missing = ans.map((a, i) => a === null ? i + 1 : null).filter(Boolean);
    if(missing.length){ err.textContent = `Il reste ${missing.length} question(s) sans réponse : n° ${missing.join(", ")}.`; err.hidden = false; return; }
    err.hidden = true;
    $("quiz-actions").innerHTML = `<div class="confirm"><span><strong>Confirmer la validation ?</strong> Vous ne pourrez plus modifier vos réponses ni repasser ce quiz.</span>
      <button class="btn" type="button" id="cancel">Revoir mes réponses</button><button class="btn primary" type="button" id="confirm">Valider définitivement</button></div>`;
    $("cancel").onclick = () => { $("quiz-actions").innerHTML = `<button class="btn primary" type="submit" id="submit">Valider mes réponses</button>`; };
    $("confirm").onclick = async () => {
      const b = $("confirm"); b.disabled = true; b.textContent = "Envoi…";
      try{
        lessonCache[L.id] = await api("submit", {lesson:L.id, answers:answers()});
        clearDraft(L.id);
        ST.results[L.id] = lessonCache[L.id].result;
        view.tab = "quiz"; render();
        $("lesson").scrollIntoView({block:"start"});
      }catch(x){
        if(x.status === 409){ delete lessonCache[L.id]; try{ ST = Object.assign(ST, await api("state")); }catch(e){} render(); return; }
        err.textContent = x.message; err.hidden = false; b.disabled = false; b.textContent = "Valider définitivement";
      }
    };
  };
}

function showCert(c){
  const avg = courseAvg(c), ok = avg >= ST.pass;
  const name = (ST.student.prenoms + " " + ST.student.nom).trim();
  const last = Math.max(...c.lessons.map(l => res(l).at));
  $("lesson").innerHTML = ok ? `
    <div class="cert">
      <div class="eyebrow">TgMaster University · Université Internationale de Francophonie</div>
      <h3>Attestation de suivi</h3>
      <p style="margin:0">Il est attesté que</p>
      <div class="name">${esc(name)}</div>
      <p style="margin:0" class="mono">Matricule ${esc(ST.student.matricule)}</p>
      <p style="margin:0;max-width:52ch">a suivi les ${c.lessons.length} leçons du cours <strong>${esc(c.title)}</strong> (${c.code}, ${PROGRAM}) et passé les ${c.lessons.length} quiz avec une moyenne de <strong>${avg} %</strong>.</p>
      <p class="mono" style="margin:6px 0 0">Dernier quiz validé le ${fmtDate(last)}</p>
    </div>
    <p class="note-sample">Attestation indicative générée par la plateforme ; elle ne remplace pas un document officiel signé.</p>
    <div class="lesson-nav"><button class="btn" id="cert-back">← Revenir aux leçons</button></div>`
  : `<div class="score fail"><strong>${avg} %</strong><span>Vous avez passé tous les quiz de ce cours, mais la moyenne est inférieure au seuil de ${ST.pass} %. L'attestation n'est pas délivrée.</span></div>
    <div class="lesson-nav"><button class="btn" id="cert-back">← Revenir aux leçons</button></div>`;
  $("cert-back").onclick = () => render();
}

function renderDashboard(){
  const all = ST.courses.flatMap(c => c.lessons), done = all.filter(res), ok = all.filter(passed);
  const mins = done.reduce((s, l) => s + l.min, 0);
  const avg = done.length ? Math.round(done.reduce((s, l) => s + res(l).score, 0) / done.length) + " %" : "—";
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">${esc((ST.student.prenoms + " " + ST.student.nom).trim())}</div><h1>Ma progression</h1>
    <p>Quiz passés, leçons réussies et moyenne. Ces résultats sont ceux que voit l'administration.</p></div></div>
    <div class="stats">
      <div class="stat"><strong>${done.length}<span class="mono" style="font-size:1rem"> / ${all.length}</span></strong><span>Quiz passés</span></div>
      <div class="stat"><strong>${ok.length}</strong><span>Leçons réussies (${ST.pass} % et plus)</span></div>
      <div class="stat"><strong>${avg}</strong><span>Moyenne aux quiz passés</span></div>
      <div class="stat"><strong>${fmtMin(mins)}</strong><span>Temps d'étude des leçons faites</span></div>
    </div>
    <div class="rows">
      ${ST.courses.map(c => { const p = progress(c), [k, lab] = status(c), a = courseAvg(c); return `
        <div class="row"><div><div class="t">${esc(c.title)}</div><div class="s">${c.code} · ${UNITS[c.unit].label}${a !== null ? " · moyenne " + a + " %" : ""}</div></div>
        <div class="bar-cell"><div class="bar"><i style="width:${p.pct}%"></i></div><div class="mono" style="margin-top:4px;color:var(--muted)">${p.done}/${p.t} quiz · ${p.ok} réussis</div></div>
        <span class="pill ${k}">${lab}</span>
        <button class="btn ${k==='done'?'':'primary'}" data-open="${c.id}">${k==='new'?'Commencer':k==='done'?'Revoir':'Continuer'}</button></div>`; }).join("")}
    </div>`;
  app.querySelectorAll("[data-open]").forEach(b => b.onclick = () => openCourse(b.dataset.open));
}

function renderAccount(){
  app.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Mon compte</div><h1>${esc((ST.student.prenoms + " " + ST.student.nom).trim())}</h1>
    <p>Matricule ${esc(ST.student.matricule)}${ST.student.classe ? " · " + esc(ST.student.classe) : ""}</p></div></div>
    <form class="panel" id="pw-form" style="max-width:460px">
      <h2>Changer mon mot de passe</h2>
      <div class="msg" id="pw-msg" hidden></div>
      <div class="field"><label for="pw-old">Mot de passe actuel</label><input id="pw-old" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="pw-new">Nouveau mot de passe</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8" required><small>8 caractères au minimum.</small></div>
      <div><button class="btn primary" type="submit">Enregistrer</button></div>
    </form>`;
  $("pw-form").onsubmit = async e => {
    e.preventDefault();
    const m = $("pw-msg");
    try{ await api("password", {old:$("pw-old").value, new:$("pw-new").value}); m.className = "msg ok"; m.textContent = "Mot de passe modifié."; $("pw-form").reset(); }
    catch(x){ m.className = "msg err"; m.textContent = x.message; }
    m.hidden = false;
  };
}

/* ---------- Démarrage ---------- */
document.querySelectorAll(".nav button").forEach(b => b.onclick = () => { view.name = b.dataset.view; render(); });
let rz; window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { if(ST && view.name === "catalogue") app.querySelectorAll("canvas[data-seed]").forEach(drawPattern); }, 150); });
api("state").then(showApp).catch(() => showLogin());
