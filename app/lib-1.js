
const DATA = JSON.parse(document.getElementById("data").textContent) || {summary: {}, stops: [], clips: [], sprite: {}};
const S = DATA.sprite;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
const fmtDur = (s) => { if (s == null) return ""; if (s < 59.5) return `${s.toFixed(1)}s`; const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const fmtDay = (iso) => new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString(undefined, {weekday: "short", day: "numeric", month: "short", year: "numeric"});
const fmtShort = (iso) => new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString(undefined, {day: "numeric", month: "short"});
const addDays = (iso, n) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const placeHow = {gps: "GPS fix", "nearby-clip": "from a GPS clip shot nearby in time", "last-known-gps": "camera's last known GPS position", estimated: "estimated from clips up to 2 days away"};
const timeHow = {camera: "camera clock (local time)", estimated: "estimated from neighbouring clips", "camera-suspect": "camera clock, looks wrong"};
const MARKS = {best: "★ Best", keep: "Keep", maybe: "Maybe", reject: "Reject"};
const STATUSES = [
  ["idea", "Idea"], ["clips", "Picking moments"], ["edit", "Editing with Claude"], ["render", "Approved"],
  ["cut", "Final ready"], ["scheduled", "Scheduled"], ["posted", "Posted"],
];
const LEGACY_STATUS = {ready: "edit", approved: "render"};  // older posts
const normPost = (p) => ({...p, status: LEGACY_STATUS[p.status] || p.status || "idea"});
const STATUS_NAME = Object.fromEntries(STATUSES);
const EDITED = new Set(["render", "cut", "scheduled", "posted"]);
const KINDS = {reel: "Reel", carousel: "Carousel", long: "Long video"};
const JSTART = DATA.summary.journey_start || "2000-01-01";

const processed = DATA.clips.filter((c) => c.t);
const byId = new Map(DATA.clips.map((c) => [c.id, c]));
const waitingCount = DATA.clips.length - processed.length;

/* ---------------- saved data: marks, posts, plan ----------------
   Saves to the page's shared store (Claude can read it) when it's reachable; otherwise to this browser,
   and moves those local saves into the shared store the next time it connects. */
const LOCAL_KEY = "gopro-travels-local-v1";
const store = {db: null, mode: "connecting", marks: new Map(), posts: new Map(), moments: new Map(), edits: new Map(), plan: {rate: 3, start: ""}};
const canSave = () => store.mode === "shared" || store.mode === "local";
function markOf(id) { return store.marks.get(id) || null; }
function postsWith(id) { return [...store.posts.values()].filter((p) => (p.clips || []).includes(id)); }
function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "null"); } catch (e) { return null; } }
function writeLocal() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({marks: Object.fromEntries(store.marks), posts: Object.fromEntries(store.posts), moments: Object.fromEntries(store.moments), edits: Object.fromEntries(store.edits), plan: store.plan}));
  } catch (e) { toast("Couldn't save in this browser either. Changes will be lost when you close the page.", true); }
}
let toastTimer;
function toast(msg, bad) {
  const t = $("toast"); (document.querySelector("dialog[open]") || document.body).appendChild(t); t.textContent = msg; t.dataset.bad = bad ? "1" : ""; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 1600);
}
function setStatus() {
  const el = $("store"), n = $("storenote");
  if (store.mode === "shared") { el.textContent = "● Saved to Drive"; n.hidden = true; }
  else if (store.mode === "local") {
    el.textContent = "● Saving in this browser";
    n.hidden = false; n.textContent = "Your marks and posts are saving in this browser only, because the shared store isn't reachable here. Open the page on claude.ai (signed in) and they move over automatically, so Claude can see them.";
  } else el.textContent = "Connecting…";
}
async function saveMark(id, patch, quiet) {
  if (!canSave()) return;
  const next = {...(markOf(id) || {}), ...patch, at: Date.now()};
  store.marks.set(id, next); refreshAfterMark(id);
  if (store.mode === "local") { writeLocal(); if (!quiet) toast("Saved"); return; }
  try { await store.db.collection("marks").doc(id).set(next); if (!quiet) toast("Saved"); }
  catch (e) { storeProblem(e); }
}
async function savePost(id, data, quiet) {
  if (!canSave()) return null;
  const body = {...data, updated: Date.now()};
  if (Array.isArray(body.items)) {  // a post is its moments in order; clips is kept as the derived list of clip ids
    body.items = body.items.map(({clip, a, b, role, note}) => ({clip, a: a ?? null, b: b ?? null, role: role || "", note: note || ""}));
    body.clips = [...new Set(body.items.map((it) => it.clip))];
  }
  if (store.mode === "local") {
    const newId = id || "local-" + Date.now().toString(36);
    store.posts.set(newId, {...body, created: body.created || Date.now(), id: newId}); writeLocal(); softRefresh(); if (!quiet) toast("Post saved"); return newId;
  }
  try {
    if (id) { await store.db.collection("posts").doc(id).set(body); if (!quiet) toast("Post saved"); return id; }
    const ref = await store.db.collection("posts").add({...body, created: Date.now()});
    if (!quiet) toast("Post saved"); return ref.id;
  } catch (e) { storeProblem(e); return null; }
}
async function deletePost(id) {
  if (store.mode === "local") { store.posts.delete(id); writeLocal(); softRefresh(); toast("Post deleted"); return; }
  try { await store.db.collection("posts").doc(id).delete(); toast("Post deleted"); } catch (e) { storeProblem(e); }
}
async function savePlan() {
  if (store.mode === "local") { writeLocal(); return; }
  if (!store.db) return;
  try { await store.db.collection("config").doc("plan").set(store.plan); toast("Saved"); } catch (e) { storeProblem(e); }
}
function storeProblem(e) {
  toast(e?.code === "quota_exceeded" ? "The saved-data limit is full. Remove some posts, then try again."
    : "That change didn't save. Check your connection and try again.", true);
}
function goLocal() {
  const local = readLocal() || {};
  store.mode = "local";
  store.marks = new Map(Object.entries(local.marks || {}));
  store.posts = new Map(Object.entries(local.posts || {}).map(([k, p]) => [k, normPost(p)]));
  store.edits = new Map(Object.entries(local.edits || {}));
  store.moments = new Map(Object.entries(local.moments || {}));
  store.plan = {...store.plan, ...(local.plan || {})};
  $("pl-rate").value = store.plan.rate; $("pl-start").value = store.plan.start || "";
  setStatus(); renderAll();
}
async function moveLocalToShared(db) {
  const local = readLocal();
  if (!local) return;
  const marks = Object.entries(local.marks || {}), posts = Object.values(local.posts || {}), moms = Object.entries(local.moments || {});
  try {
    for (const [id, m] of marks) await db.collection("marks").doc(id).set(m);
    for (const [id, m] of moms) await db.collection("moments").doc(id).set(m);
    for (const p of posts) { const {id, ...body} = p; await db.collection("posts").add(body); }
    localStorage.removeItem(LOCAL_KEY);
    if (marks.length || posts.length) toast(`Moved ${marks.length} marks and ${posts.length} posts from this browser into your Library`);
  } catch (e) { /* keep the local copy; try again next visit */ }
}
async function connect() {
  let db = null;
  try { db = await window.claude?.use?.("db"); } catch (e) { db = null; }
  if (!db) return goLocal();
  store.db = db; store.mode = "shared"; setStatus(); renderAll();
  await moveLocalToShared(db);
  let warned = false;
  const slow = setTimeout(() => { warned = true; $("store").textContent = "Saved data is slow to load…"; }, 10000);
  const ok = () => { clearTimeout(slow); if (warned) setStatus(); };
  db.collection("marks").onSnapshot((snap) => { store.marks = new Map(snap.docs.map((d) => [d.id, d.data()])); ok(); softRefresh(); if (!rvMarksLoaded) { rvMarksLoaded = true; if (!$("v-review").hidden) { rvIndex = 0; renderReview(); } } }, storeProblem);
  db.collection("posts").onSnapshot((snap) => { store.posts = new Map(snap.docs.map((d) => [d.id, normPost({...d.data(), id: d.id})])); ok(); softRefresh(); }, storeProblem);
  db.collection("edits").onSnapshot((snap) => { store.edits = new Map(snap.docs.map((d) => [d.id, d.data()])); softRefresh(); if (draft && $("pdlg").open && !studio.busy && !document.querySelector("#st-edit :focus")) drawEdit(); }, storeProblem);
  db.collection("moments").onSnapshot((snap) => { store.moments = new Map(snap.docs.map((d) => [d.id, d.data()])); ok(); softRefresh(); refreshMoments(); }, storeProblem);
  db.doc("config/plan").onSnapshot((snap) => {
    if (snap.exists) store.plan = {...store.plan, ...snap.data()};
    $("pl-rate").value = store.plan.rate; $("pl-start").value = store.plan.start || "";
    ok(); if (location.hash === "#roadmap") renderRoadmap();
  }, storeProblem);
}

/* ---------------- thumbnails ---------------- */
function thumbStyle(c, k) {
  if (!c?.sp) return "";
  const [sheet, row] = c.sp;
  const x = S.per_clip > 1 ? (k / (S.per_clip - 1)) * 100 : 0;
  const y = S.per_sheet > 1 ? (row / (S.per_sheet - 1)) * 100 : 0;
  return `background-image:url(sprites/s${String(sheet).padStart(3, "0")}.jpg);background-size:${S.per_clip * 100}% ${S.per_sheet * 100}%;background-position:${x}% ${y}%`;
}
const coverFrame = (c) => Math.min(1, (c?.sp?.[2] || 1) - 1);
const markChip = (m) => m?.r ? `<span class="chip ${m.r === "maybe" ? "" : m.r}">${MARKS[m.r]}</span>` : "";

/* ---------------- views / routing ---------------- */
const VIEWS = ["home", "library", "review", "map", "posts", "roadmap"];
const curView = () => VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "home";
function route() {
  const v = curView();
  if (v === "home") renderHome();
  VIEWS.forEach((x) => { $("v-" + x).hidden = x !== v; });
  document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.view === v ? "page" : "false"));
  if (v === "review") renderReview();
  if (v === "map") renderMap();
  if (v === "posts") renderBoard();
  if (v === "roadmap") renderRoadmap();
}
addEventListener("hashchange", route);
function renderAll() { renderLibrary(); if (curView() === "home") renderHome(); const v = location.hash.slice(1); if (v === "review") renderReview(true); if (v === "posts") renderBoard(); if (v === "roadmap") renderRoadmap(); }
// After a save or a live update: redraw only what can't hold half-typed input.
function softRefresh() {
  document.querySelectorAll("#list .card").forEach((el) => { const c = byId.get(el.dataset.id); if (c) el.outerHTML = card(c); });
  renderReviewProgress();
  if (curView() === "home") renderHome();
  const v = location.hash.slice(1);
  if (v === "posts") renderBoard();
  if (v === "roadmap") renderRoadmap();
  if (v === "map") mapSoftRefresh();
}
function refreshAfterMark() { softRefresh(); }

/* ---------------- LIBRARY ---------------- */
function header() {
  const s = DATA.summary, st = s.stages_done || {};
  $("sub").textContent = `${(st.meta || 0).toLocaleString()} of ${(s.videos || 0).toLocaleString()} clips processed · ${s.hours_of_footage_processed ?? 0} h of footage · updated ${new Date(s.built).toLocaleDateString(undefined, {day: "numeric", month: "short"})}. Show progress`;
  $("stats").innerHTML = [
    ["Clips processed", `${(st.meta || 0).toLocaleString()} / ${(s.videos || 0).toLocaleString()}`],
    ["Video processed", `${s.pass1_done_gb ?? 0} / ${s.video_gb ?? 0} GB`],
    ["Footage", `${s.hours_of_footage_processed ?? 0} h`],
    ["Countries", (s.countries || []).length],
    ["Duplicates found", `${s.duplicates ?? 0} (${s.duplicates_gb ?? 0} GB)`],
  ].map(([k, v]) => `<div class="stat"><span class="label">${k}</span><b>${v}</b></div>`).join("");
  const names = {meta: "Date + GPS", frames: "Frames", audio: "Audio", place: "Place names", speech: "Speech (pass 2)", scenes: "Scene tags (pass 2)"};
  $("stages").innerHTML = Object.entries(names).map(([k, label]) => {
    const n = st[k] || 0, pct = s.videos ? (n / s.videos) * 100 : 0;
    return `<div class="stage"><span>${label} · ${n.toLocaleString()}</span><span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span></div>`;
  }).join("");
  $("journey").innerHTML = (DATA.stops || []).length
    ? DATA.stops.map((p) => `<button class="stop${p.before_trip ? " pre" : ""}" data-q="${esc(p.area || p.city)}"><strong>${esc(p.area || p.city)}</strong><span>${p.before_trip ? "Before the trip · " : ""}${esc(p.country)} · ${fmtShort(p.start)}${p.start.slice(0, 10) !== p.end.slice(0, 10) ? "–" + fmtShort(p.end) : ""} · ${p.clips} clips</span></button>`).join("")
    : `<span class="muted">Places appear here as clips with GPS are processed.</span>`;
  const countries = [...new Set(processed.map((c) => c.country).filter(Boolean))].sort();
  const opts = `<option value="">All countries</option>` + countries.map((c) => `<option>${esc(c)}</option>`).join("") + `<option value="?">Place unknown</option>`;
  $("country").innerHTML = opts; $("rv-country").innerHTML = opts;
  const scenes = [...new Set(processed.flatMap((c) => c.scenes))].sort();
  $("scene").innerHTML = `<option value="">All scenes</option>` + scenes.map((c) => `<option>${esc(c)}</option>`).join("");
  setupTimeline();
  $("waiting").textContent = waitingCount ? `${waitingCount.toLocaleString()} clips are still waiting for Colab. They appear after the next refresh.` : "";
}
$("journey").addEventListener("click", (e) => { const b = e.target.closest(".stop"); if (b) { $("q").value = b.dataset.q; renderLibrary(); } });

const isJunk = (c) => c.flags.some((f) => f === "short" || f === "dark" || f === "pocket");
const matchCountry = (c, co) => co === "?" ? !c.country : !co || c.country === co;
/* Timeline: a two-handle slider over the months the clips cover (year + time of year in one control). */
const TL_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tlIdx = (t) => +t.slice(0, 4) * 12 + (+t.slice(5, 7) - 1);
const tlName = (i) => `${TL_MON[i % 12]} ${Math.floor(i / 12)}`;
let TL = {lo: 0, hi: 0};
function tlRange() { let a = +$("tlmin").value, b = +$("tlmax").value; if (a > b) [a, b] = [b, a]; return [a, b]; }
function tlActive() { const [a, b] = tlRange(); return a > TL.lo || b < TL.hi; }
function drawTimeline() {
  const [a, b] = tlRange(), span = Math.max(1, TL.hi - TL.lo);
  $("tllabel").textContent = a === TL.lo && b === TL.hi ? "All time" : a === b ? tlName(a) : `${tlName(a)} – ${tlName(b)}`;
  $("tlfill").style.left = `${((a - TL.lo) / span) * 100}%`; $("tlfill").style.width = `${((b - a) / span) * 100}%`;
}
function setupTimeline() {
  const idx = processed.filter((c) => c.t).map((c) => tlIdx(c.t));
  if (!idx.length) { $("tl").hidden = true; return; }
  const lo = idx.reduce((m, x) => Math.min(m, x)), hi = idx.reduce((m, x) => Math.max(m, x));
  TL = {lo, hi}; $("tl").hidden = lo === hi;
  for (const id of ["tlmin", "tlmax"]) { const r = $(id); r.min = lo; r.max = hi; r.step = 1; }
  $("tlmin").value = lo; $("tlmax").value = hi;
  const span = Math.max(1, hi - lo), ticks = [];
  for (let y = Math.floor(lo / 12); y <= Math.floor(hi / 12); y++) {
    const i = Math.max(lo, y * 12);
    ticks.push(`<span style="left:${((i - lo) / span) * 100}%">${y === Math.floor(lo / 12) ? tlName(lo) : y}</span>`);
  }
  $("tlticks").innerHTML = ticks.join("");
  drawTimeline();
}
window.tlReset = () => { if (!TL.hi) return; $("tlmin").value = TL.lo; $("tlmax").value = TL.hi; drawTimeline(); };
["tlmin", "tlmax"].forEach((id) => $(id).addEventListener("input", () => { drawTimeline(); renderLibrary(); }));
function filtered() {
  const q = $("q").value.trim().toLowerCase(), co = $("country").value, sc = $("scene").value, mk = $("mark").value;
  const tlOn = tlActive(), [tlA, tlB] = tlRange();
  const talk = $("talk").checked, hide = $("hidejunk").checked, hl = $("hl").checked;
  let list = processed.filter((c) => {
    if (!matchCountry(c, co)) return false;
    if (tlOn) { if (!c.t) return false; const m = tlIdx(c.t); if (m < tlA || m > tlB) return false; }
    if (sc && !c.scenes.includes(sc)) return false;
    if (talk && !(c.speech > 2)) return false;
    if (hl && !(c.hl >= 4 || markOf(c.id)?.r === "best")) return false;
    if (hide && isJunk(c)) return false;
    const m = markOf(c.id)?.r;
    if (mk === "notreject" && m === "reject") return false;
    if (mk === "none" && m) return false;
    if (["best", "keep", "maybe", "reject"].includes(mk) && m !== mk) return false;
    if (mk === "unused" && !((m === "best" || m === "keep") && !postsWith(c.id).length)) return false;
    if (q) {
      const mm = markOf(c.id) || {};
      const hay = `${c.name} ${c.file} ${c.city} ${c.region} ${c.country} ${c.scenes.join(" ")} ${c.title || ""} ${c.desc || ""} ${(c.tags || []).join(" ")} ${c.tx || ""} ${mm.note || ""} ${(mm.labels || []).join(" ")}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const by = $("sort").value;
  if (by === "new") list = [...list].reverse();
  if (by === "long") list = [...list].sort((a, b) => (b.dur || 0) - (a.dur || 0));
  if (by === "motion") list = [...list].sort((a, b) => (b.motion || 0) - (a.motion || 0));
  return list;
}

// A readable card title when the free model hasn't written one yet: main scene + place, e.g. "Scooter ride in town".
const SCENE_TITLE = {scooter: "Scooter ride", car: "Car ride", boat: "Boat trip", walking: "Walk", selfie: "Talking to camera", hotel: "Hotel room",
  desk: "At the desk", rain: "Rain", sea: "Sea view", river: "River", beach: "Beach", food: "Food", market: "Market", temple: "Temple",
  nightlife: "Night out", "city-night": "City at night", city: "City", street: "Street", airport: "Airport", plane: "Flight", train: "Train",
  dark: "Night clip", pool: "Pool", mountain: "Mountains", nature: "Nature", bar: "Bar", party: "Party"};
function clipTitle(c) {
  if (c.title) return c.title;
  const counts = {};
  for (const s of (c.scenes?.length ? c.scenes : c.st || [])) counts[s] = (counts[s] || 0) + 1;
  const top = Object.keys(counts).filter((s) => s !== "dark" || Object.keys(counts).length === 1).sort((a, b) => counts[b] - counts[a])[0];
  const what = top ? (SCENE_TITLE[top] || top[0].toUpperCase() + top.slice(1).replace(/-/g, " ")) : (c.flags?.includes("dark") ? "Night clip" : "Clip");
  const place = c.city || c.region;
  return place ? `${what} in ${place}` : what;
}
function card(c) {
  const where = [c.city, c.cc].filter(Boolean).join(", ") || "Place unknown";
  const m = markOf(c.id), inPosts = postsWith(c.id).length;
  return `<button class="card${m?.r === "reject" ? " reject" : ""}" data-id="${esc(c.id)}">
    <div class="thumb" style="${thumbStyle(c, coverFrame(c))}">${m?.r === "best" ? `<span class="mk">★</span>` : ""}<span class="dur">${fmtDur(c.dur)}</span></div>
    <div class="body">
      <div class="title">${esc(clipTitle(c))}</div><div class="name small">${esc(c.file || c.name)}</div>
      <div class="meta">${c.t ? c.t.slice(11, 16) : ""} · ${esc(where)}${inPosts ? ` · in ${inPosts} post${inPosts > 1 ? "s" : ""}` : ""}</div>
      <div class="chips">${markChip(m)}${momentsOf(c.id).length ? `<span class="chip keep">${momentsOf(c.id).length} moment${momentsOf(c.id).length > 1 ? "s" : ""}</span>` : ""}${(m?.labels || []).map((l) => `<span class="chip label">${esc(l)}</span>`).join("")}${c.scenes.slice(0, 3).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}${c.flags.map((f) => `<span class="chip flag">${esc(f)}</span>`).join("")}</div>
    </div></button>`;
}

let shown = 0, current = [];
const PAGE = 120;
function dayTitle(c) { return c.pre ? `Before the trip · ${fmtDay(c.t)}` : `Day ${c.day} · ${fmtDay(c.t)}`; }
function renderLibrary(more = false) {
  if (!more) { current = filtered(); shown = 0; $("list").innerHTML = ""; }
  const grouped = $("sort").value === "old" || $("sort").value === "new";
  const slice = current.slice(shown, shown + PAGE);
  shown += slice.length;
  $("count").textContent = `${current.length.toLocaleString()} clips`;
  if (!current.length) { $("list").innerHTML = `<p class="empty">${processed.length ? "No clips match these filters." : "No clips processed yet. Run pass 1 in Colab, then ask Claude to refresh this page."}</p>`; return; }
  $("list").querySelector(".more")?.remove();
  if (grouped) {
    const days = new Map();
    for (const c of slice) { const d = c.t.slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(c); }
    for (const [d, cs] of days) {
      const existing = $("list").querySelector(`.day[data-day="${d}"] .grid`);
      if (existing) { existing.insertAdjacentHTML("beforeend", cs.map(card).join("")); continue; }
      const all = current.filter((c) => c.t.slice(0, 10) === d);
      const places = [...new Set(all.map((c) => c.region || c.city).filter(Boolean))].join(", ") || "Place unknown";
      const mins = all.reduce((a, c) => a + (c.dur || 0), 0) / 60;
      $("list").insertAdjacentHTML("beforeend", `<section class="day" data-day="${d}"><div class="day-head"><h2>${dayTitle(cs[0])}</h2><span class="where">${esc(places)} · ${all.length} clips · ${mins.toFixed(0)} min</span></div><div class="grid">${cs.map(card).join("")}</div></section>`);
    }
  } else {
    $("list").insertAdjacentHTML("beforeend", `<div class="grid">${slice.map(card).join("")}</div>`);
  }
  if (shown < current.length) $("list").insertAdjacentHTML("beforeend", `<button class="btn quiet more" id="more">Show ${Math.min(PAGE, current.length - shown)} more</button>`);
}
["q", "country", "scene", "mark", "sort", "talk", "hl", "hidejunk"].forEach((id) => $(id).addEventListener(id === "q" ? "input" : "change", () => renderLibrary()));
$("list").addEventListener("click", (e) => {
  if (e.target.id === "more") return renderLibrary(true);
  const c = e.target.closest(".card"); if (c) openClip(c.dataset.id, current);
});

/* ---------------- playback (flipbook over the preview frames) ---------------- */
// frames: [{c, k, label}] — one clip's frames, or a whole post's clips in a row.
function playerHTML(id) {
  return `<div class="player" id="${id}"><div class="screen"><span class="dur"></span></div>
    <div class="controls"><button class="btn quiet" data-play>▶ Play</button><input type="range" min="0" value="0" aria-label="Position"><span class="muted mono" data-pos style="font-size:12px"></span></div></div>`;
}
function wirePlayer(id, frames, autoplay) {
  const root = $(id); if (!root || !frames.length) { if (root) root.querySelector(".screen").insertAdjacentHTML("beforeend", ""); return; }
  const screen = root.querySelector(".screen"), range = root.querySelector("input"), btn = root.querySelector("[data-play]"), pos = root.querySelector("[data-pos]");
  range.max = frames.length - 1;
  let i = 0, timer = null;
  const show = () => { const f = frames[i]; screen.setAttribute("style", thumbStyle(f.c, f.k)); screen.querySelector(".dur").textContent = f.label; root.dataset.t = f.c?.ft?.[f.k] ?? ""; range.value = i; pos.textContent = `${i + 1}/${frames.length}`; };
  const stop = () => { clearInterval(timer); timer = null; btn.textContent = "▶ Play"; };
  btn.onclick = () => {
    if (timer) return stop();
    btn.textContent = "❚❚ Pause";
    timer = setInterval(() => { if (!root.isConnected) return clearInterval(timer); i = (i + 1) % frames.length; show(); if (i === frames.length - 1) stop(); }, 650);
  };
  range.oninput = () => { stop(); i = +range.value; show(); };
  show();
  if (autoplay && frames.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) btn.click();
}
const resLabel = (res) => { if (!res) return ""; const [w, h] = res.split("x").map(Number); return w >= 5000 ? "5.3K" : w >= 3800 ? "4K" : w >= 2600 ? "2.7K" : `${h}p`; };
// Real playback: the GoPro Travels Player (streams the actual files from Drive) when it's set up, else Drive's own player.
const pItem = (c, start = 0) => [c.drive, c.pv || "", c.title || c.name, start || 0, c.hd || ""].map((x) => encodeURIComponent(x).replace(/~/g, "%7E")).join("~");
// A list of moments: each plays from its start second.
function itemsLink(items, q, i = 0) {
  const list = items.map((it) => ({c: byId.get(it.clip), a: it.a})).filter((x) => x.c?.drive);
  return `${DATA.player}#q=${q}&i=${i}&list=${encodeURIComponent(list.map((x) => pItem(x.c, x.a || 0)).join("|"))}`;
}
function playerLink(clips, q, i = 0) {
  // fields are encoded, then the whole list again, so titles with | ~ % survive the player's URL parsing
  return `${DATA.player}#q=${q}&i=${i}&list=${encodeURIComponent(clips.filter((c) => c?.drive).map(pItem).join("|"))}`;
}
function watchHTML(c, small) {
  if (DATA.player && c.drive) {
    return `<div class="row"><a class="${small ? "btn quiet" : "btn"}" href="${esc(playerLink([c], "light"))}" target="gopro-player" rel="noopener" title="${c.pv ? "540p copy, starts fast" : "Light copy not made yet; plays the original"}">▶ Play${c.pv ? "" : " (original)"}</a>
      <a class="${small ? "btn quiet" : "btn ghost"}" href="${esc(playerLink([c], "full"))}" target="gopro-player" rel="noopener" title="Original ${esc(c.res || "")}">▶ Full ${resLabel(c.res)}</a></div>`;
  }
  const cls = small ? "btn quiet" : "btn";
  const light = c.pv ? `<a class="${cls}" href="https://drive.google.com/file/d/${esc(c.pv)}/view" target="_blank" rel="noopener" title="540p copy: starts fast, light on data">▶ Light</a>`
    : `<span class="btn quiet" aria-disabled="true" style="opacity:.55;cursor:default" title="Made in Colab pass 3">▶ Light (after pass 3)</span>`;
  const full = c.drive ? `<a class="${small ? "btn quiet" : "btn ghost"}" href="https://drive.google.com/file/d/${esc(c.drive)}/view" target="_blank" rel="noopener" title="Original ${esc(c.res || "")} file">▶ Full ${resLabel(c.res)}</a>` : "";
  return `<div class="row">${light}${full}</div>`;
}
const clipFrames = (c) => c?.sp ? Array.from({length: c.sp[2]}, (_, k) => ({c, k, label: c.ft?.[k] != null ? fmtDur(c.ft[k]) : ""})) : [];

/* ---------------- MOMENTS: the seconds worth using inside a clip ----------------
   Suggestions (c.sug = [[start, end, kind, score]]) come from tools/moments.py: motion, brightness, speech. No AI.
   Kept moments live in the db: moments/<clip id> = {items: [{a, b, role, note}], at}.
   Posts copy moments into post.items, so trimming a post never changes the clip's saved moments. */
const ROLES = {"": "Role…", hook: "Hook / opener", scenery: "Scenery", action: "Action", talk: "Talking", story: "Story beat", ending: "Ending"};
const KIND_ROLE = {talk: "talk", steady: "scenery", action: "action", change: "story"};
const KIND_NAME = {talk: "Talking", steady: "Steady shot", action: "Action", change: "Scene change"};
const fmtT = (s) => s == null || s === "" ? "" : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
function parseT(v) {
  v = String(v ?? "").trim().replace(",", ".");
  if (!v) return null;
  const p = v.split(":").map(Number);
  if (p.some((x) => !isFinite(x)) || p.length > 3) return null;
  return Math.round(p.reduce((acc, x) => acc * 60 + x, 0) * 10) / 10;
}
const momentsOf = (id) => store.moments.get(id)?.items || [];
const itemLen = (it) => { const c = byId.get(it.clip); return it.a == null ? (c?.dur || 0) : Math.max(0, (it.b ?? c?.dur ?? it.a) - it.a); };
const topSug = (c) => [...(c?.sug || [])].sort((x, y) => y[3] - x[3])[0];
function nearestFrame(c, t) {
  const ft = c?.ft || [];
  let k = 0;
  ft.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(ft[k] - t)) k = i; });
  return k;
}
async function saveMoments(id, items, quiet) {
  if (!canSave()) return;
  const next = {items: [...items].sort((x, y) => x.a - y.a), at: Date.now()};
  store.moments.set(id, next); refreshMoments(); softRefresh();
  if (store.mode === "local") { writeLocal(); if (!quiet) toast("Moment kept"); return; }
  try { await store.db.collection("moments").doc(id).set(next); if (!quiet) toast("Moment kept"); } catch (e) { storeProblem(e); }
}
// What "add this clip to a post" means: your kept moments, else the top suggestion, else the whole clip.
function itemsFor(c) {
  const ms = momentsOf(c.id);
  if (ms.length) return ms.map((m) => ({clip: c.id, a: m.a, b: m.b, role: m.role || "", note: m.note || ""}));
  const s = topSug(c);
  if (s) return [{clip: c.id, a: s[0], b: s[1], role: KIND_ROLE[s[2]] || "", note: ""}];
  return [{clip: c.id, a: null, b: null, role: "", note: ""}];
}
const postItems = (p) => p.items || (p.clips || []).map((id) => ({clip: id, a: null, b: null, role: "", note: ""}));
const sameItem = (x, y) => x.clip === y.clip && x.a === y.a && x.b === y.b;
function newPostSeed(c, items) {
  return {items, days: [c.t.slice(0, 10), c.t.slice(0, 10)], place: c.region || c.city || "", title: `${c.region || c.city || "New post"} · ${fmtShort(c.t)}`};
}
async function addItemsToPost(pid, items) {
  const p = store.posts.get(pid);
  if (!p) return;
  const cur = postItems(p), fresh = items.filter((it) => !cur.some((x) => sameItem(x, it)));
  if (!fresh.length) return toast("Already in this post");
  const {id, ...rest} = p, all = [...cur, ...fresh];
  const saved = await savePost(pid, {...rest, items: all, status: (p.status || "idea") === "idea" ? "clips" : p.status, days: daysOf(all.map((it) => it.clip), p.days)});
  if (saved) toast(`Added ${fresh.length === 1 ? "a moment" : fresh.length + " moments"} to “${p.title}”`);
}
const postOptions = () => [...store.posts.values()].filter((p) => p.status !== "posted").sort(postOrder)
  .map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join("");
function momentsHTML(c, prefix) {
  const saved = momentsOf(c.id), dur = c.dur || 1, dis = canSave() ? "" : "disabled";
  const covered = (s) => saved.some((m) => Math.max(0, Math.min(m.b ?? dur, s[1]) - Math.max(m.a, s[0])) > 0.5 * (s[1] - s[0]));
  const sugs = (c.sug || []).filter((s) => !covered(s));
  const pct = (t) => `${Math.max(0, Math.min(100, (t / dur) * 100)).toFixed(2)}%`;
  const ticks = dur > 20 ? [0.25, 0.5, 0.75].map((f) => `<span style="left:${f * 100}%">${fmtT(Math.round(dur * f))}</span>`).join("") : "";
  const bar = `<div class="tl" aria-hidden="true">${sugs.map((s) => `<i class="s" style="left:${pct(s[0])};width:${pct(s[1] - s[0])}"></i>`).join("")}${saved.map((m) => `<i class="m" style="left:${pct(m.a)};width:${pct((m.b ?? dur) - m.a)}"></i>`).join("")}${ticks}</div>`;
  const play = (a) => DATA.player && c.drive ? `<a href="${esc(itemsLink([{clip: c.id, a}], "light"))}" target="gopro-player" rel="noopener" title="Watch the real clip from ${fmtT(a)}" aria-label="Watch from ${fmtT(a)}">▶${prefix === "rv" ? "" : " " + fmtT(a)}</a>` : "";
  const rowSaved = (m, i) => `<div class="mrow" data-i="${i}"><div class="thumb" style="${thumbStyle(c, nearestFrame(c, (m.a + (m.b ?? m.a)) / 2))}"></div>
    <div class="fields"><input class="t" data-f="a" value="${fmtT(m.a)}" aria-label="Start" inputmode="decimal" ${dis}>–<input class="t" data-f="b" value="${fmtT(m.b)}" aria-label="End" inputmode="decimal" ${dis}>
      <span class="muted" style="font-size:12px">${((m.b ?? dur) - m.a).toFixed(1)} s</span>
      <select data-f="role" aria-label="Role" ${dis}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${(m.role || "") === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input class="note" data-f="note" value="${esc(m.note || "")}" placeholder="Note for the edit (e.g. keep the sound)" ${dis}></div>
    <div class="ops">${play(m.a)}<select data-op="post" aria-label="Add this moment to a post" ${dis}><option value="">＋ Post…</option>${postOptions()}<option value="__new">+ New post</option></select><button data-op="del" aria-label="Remove moment" ${dis}>✕</button></div></div>`;
  const rowSug = (s) => `<div class="mrow sug" data-a="${s[0]}" data-b="${s[1]}" data-kind="${esc(s[2])}"><div class="thumb" style="${thumbStyle(c, nearestFrame(c, (s[0] + s[1]) / 2))}"></div>
    <div class="fields"><span style="font-variant-numeric:tabular-nums">${fmtT(s[0])}–${fmtT(s[1])}</span><span class="muted" style="font-size:13px">${prefix === "rv" ? "" : "Suggested · "}${esc(KIND_NAME[s[2]] || s[2])} · ${(s[1] - s[0]).toFixed(1)} s</span></div>
    <div class="ops">${play(s[0])}<button class="keep" data-op="keep" ${dis}>Keep</button></div></div>`;
  const empty = !saved.length && !sugs.length
    ? `<p class="muted" style="font-size:13px">${c.flags.includes("pocket") ? "Mostly pocket or covered lens, so nothing is suggested." : "No suggestions for this clip. Watch it, then add a moment and type its start and end."}</p>` : "";
  return `<div class="moments" data-clip="${esc(c.id)}" data-prefix="${prefix}">
    <div class="row" style="justify-content:space-between"><span class="label">${prefix === "rv" ? (saved.length ? `${saved.length} kept` : "None kept yet") : `Moments · ${saved.length ? `${saved.length} kept` : "none kept yet"}${sugs.length ? ` · ${sugs.length} suggested` : ""}`}</span>
      <button class="btn quiet" data-op="new" ${dis} title="Starts at the frame the player is showing (key N)">+ New moment here</button></div>
    ${bar}${saved.map(rowSaved).join("")}${prefix === "rv" && sugs.length ? `<div class="rx-group">Suggested</div>` : ""}${sugs.map(rowSug).join("")}${empty}
    <p class="muted" style="font-size:12px">Type times as seconds (12.5) or minutes:seconds (1:05). ▶ plays the real clip from that second so you can check where it starts and ends.</p></div>`;
}
function wireMoments(root) {
  const box = root.querySelector(".moments");
  if (!box) return;
  const id = box.dataset.clip, c = byId.get(id);
  const items = () => momentsOf(id).map((m) => ({...m}));
  box.addEventListener("change", async (e) => {
    const row = e.target.closest(".mrow[data-i]");
    if (!row) return;
    const list = items(), m = list[+row.dataset.i];
    if (!m) return;
    const f = e.target.dataset.f;
    if (e.target.dataset.op === "post") {
      const v = e.target.value; e.target.value = "";
      if (!v) return;
      const it = [{clip: id, a: m.a, b: m.b, role: m.role || "", note: m.note || ""}];
      return v === "__new" ? openPost(null, newPostSeed(c, it)) : addItemsToPost(v, it);
    }
    if (f === "a" || f === "b") {
      const t = parseT(e.target.value);
      if (t == null || t < 0 || t > (c.dur || 1e9)) { toast("Use seconds (12.5) or minutes:seconds (1:05), inside the clip", true); e.target.value = fmtT(m[f]); return; }
      m[f] = t;
      if (m.b != null && m.b <= m.a) m.b = Math.min(c.dur || m.a + 3, m.a + 3);
    } else if (f) m[f] = e.target.value.trim();
    await saveMoments(id, list, true);
  });
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-op]");
    if (!b) return;
    const list = items();
    if (b.dataset.op === "keep") {
      const r = b.closest(".mrow");
      list.push({a: +r.dataset.a, b: +r.dataset.b, role: KIND_ROLE[r.dataset.kind] || "", note: ""});
      await saveMoments(id, list);
    }
    if (b.dataset.op === "del") { list.splice(+b.closest(".mrow").dataset.i, 1); await saveMoments(id, list, true); toast("Moment removed"); }
    if (b.dataset.op === "new") await newMomentHere(c, root);
  });
}
async function newMomentHere(c, root) {
  const t = parseFloat(root.querySelector(".player")?.dataset.t);
  const a = Math.max(0, isFinite(t) ? t : 0), b = Math.min(c.dur || a + 4, a + 4);
  await saveMoments(c.id, [...momentsOf(c.id), {a, b, role: "", note: ""}]);
}
async function keepTopSuggestion(c) {
  const saved = momentsOf(c.id);
  const s = [...(c.sug || [])].sort((x, y) => y[3] - x[3]).find((x) => !saved.some((m) => m.a === x[0] && m.b === x[1]));
  if (!s) return toast(c.sug?.length ? "All suggestions are kept already" : "No suggested moment for this clip");
  await saveMoments(c.id, [...saved, {a: s[0], b: s[1], role: KIND_ROLE[s[2]] || "", note: ""}]);
}
// Redraw open moment panels after a save or a live update, unless you're typing in one.
function refreshMoments() {
  drawRvMarks();
  document.querySelectorAll(".moments[data-clip]").forEach((box) => {
    if (box.contains(document.activeElement) && document.activeElement.matches("input, textarea")) return;
    const c = byId.get(box.dataset.clip), holder = box.parentElement;
    if (!c || !holder) return;
    box.outerHTML = momentsHTML(c, box.dataset.prefix);
    wireMoments(holder);
  });
}

/* clip panel (used by Library dialog and Review) */
function framesHTML(c, big) {
  return c.sp ? `<div class="frames${big ? " big" : ""}">${Array.from({length: c.sp[2]}, (_, k) => `<div class="frame"><div class="thumb" style="${thumbStyle(c, k)}"></div><span class="mono">${c.ft?.[k] != null ? fmtDur(c.ft[k]) : ""}${c.st?.[k] ? " · " + esc(c.st[k]) : ""}</span></div>`).join("")}</div>` : `<p class="muted">No preview frames yet.</p>`;
}
function factsHTML(c) {
  return `<dl class="facts">${[
    ["Original file", `<span class="mono">${esc(c.file)}</span>`],
    ["Shot", c.t ? `${c.pre ? "Before the trip" : "Day " + c.day} · ${fmtDay(c.t)}, ${c.t.slice(11, 16)}<br><span class="label">${esc(timeHow[c.th] || c.th || "")}</span>` : "unknown"],
    ["Place", c.city ? `${esc(c.region || "")}${c.region && c.city !== c.region ? ` (${esc(c.city)})` : ""}, ${esc(c.country || "")}<br><span class="label">${esc(placeHow[c.ph] || "")}</span>` : "unknown"],
    ["Length", fmtDur(c.dur)],
    ["Video", `${esc(c.res || "")} · ${c.fps ?? ""} fps · ${(c.size / 1e6).toFixed(0)} MB`],
    ["Scenes", c.scenes.join(", ") || "not tagged yet (pass 2)"],
    ["Motion", c.motion != null ? `${c.motion.toFixed(2)} rad/s` : "—"],
    ["Audio", c.db != null ? `${c.db} dB average` : "—"],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
}
function txHTML(c) {
  return c.tx ? `<div style="display:grid;gap:6px"><div class="label">Spoken (${esc(c.lang || "")}, ${c.speech}s)</div><p class="tx">${esc(c.tx)}</p></div>`
              : `<p class="muted">${c.done.includes("speech") ? "No speech detected." : "Speech is transcribed in pass 2."}</p>`;
}
function rateHTML(c, keys) {
  const m = markOf(c.id);
  const dis = canSave() ? "" : "disabled";
  return `<div class="rate" data-id="${esc(c.id)}">${Object.entries(MARKS).map(([k, v], i) => `<button data-r="${k}" aria-pressed="${m?.r === k}" ${dis}>${v}${keys ? `<kbd>${i + 1}</kbd>` : ""}</button>`).join("")}</div>`;
}
function editHTML(c, prefix) {
  const m = markOf(c.id) || {};
  const dis = canSave() ? "" : "disabled";
  const posts = [...store.posts.values()].sort(postOrder);
  const inP = postsWith(c.id);
  return `<div class="two">
    <label class="field"><span>Your note (what happens, who's in it, why it matters)</span><textarea id="${prefix}-note" ${dis}>${esc(m.note || "")}</textarea></label>
    <div style="display:grid;gap:12px;align-content:start">
      <label class="field"><span>Labels, comma separated (e.g. hook, funny, sunset, b-roll)</span><input type="text" id="${prefix}-labels" value="${esc((m.labels || []).join(", "))}" ${dis}></label>
      <label class="field"><span>Add this clip's moments to a post${inP.length ? ` · already in: ${inP.map((p) => esc(p.title)).join(", ")}` : ""}</span>
        <select id="${prefix}-addpost" ${dis}><option value="">Choose a post…</option><option value="__new">+ New post with this clip</option>${posts.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} · ${STATUS_NAME[p.status] || ""}</option>`).join("")}</select></label>
    </div></div>`;
}
function wireEdit(c, prefix) {
  const note = $(prefix + "-note"), labels = $(prefix + "-labels"), addp = $(prefix + "-addpost");
  note?.addEventListener("change", () => saveMark(c.id, {note: note.value.trim()}));
  labels?.addEventListener("change", () => saveMark(c.id, {labels: labels.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)}));
  addp?.addEventListener("change", async () => {
    const v = addp.value; addp.value = "";
    if (!v) return;
    if (v === "__new") { openPost(null, newPostSeed(c, itemsFor(c))); return; }
    await addItemsToPost(v, itemsFor(c));
  });
}
function wireRate(root, after) {
  root.querySelector(".rate")?.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-r]"); if (!b) return;
    const id = b.parentElement.dataset.id, r = b.dataset.r;
    await saveMark(id, {r: markOf(id)?.r === r && !after ? null : r});
    root.querySelectorAll(".rate button").forEach((x) => x.setAttribute("aria-pressed", markOf(id)?.r === x.dataset.r));
    if (after) after();
  });
}
let dlgList = [];
function openClip(id, list) {
  const c = byId.get(id); if (!c) return;
  if (list) dlgList = list;
  const pos = dlgList.findIndex((x) => x.id === id);
  $("detail").innerHTML = `
    <div class="detail-head"><div><div class="label">${pos >= 0 ? `${pos + 1} of ${dlgList.length} · ` : ""}${esc(dayTitle(c))}, ${c.t.slice(11, 16)}</div><div class="name">${esc(c.name)}</div></div>
      <div class="row"><button class="btn quiet" id="dl-prev" ${pos > 0 ? "" : "disabled"} aria-label="Previous clip">←</button><button class="btn quiet" id="dl-next" ${pos >= 0 && pos < dlgList.length - 1 ? "" : "disabled"} aria-label="Next clip">→</button><button class="btn quiet" id="close">Close</button></div></div>
    <div class="split">${playerHTML("dl-player")}<div style="display:grid;gap:8px;align-content:start">
      ${c.title ? `<h3>${esc(c.title)}</h3>` : ""}${c.desc ? `<p>${esc(c.desc)}</p>` : `<p class="muted">A free AI description appears after pass 2.</p>`}
      ${(c.tags || []).length ? `<div class="chips">${c.tags.map((t) => `<span class="chip label">${esc(t)}</span>`).join("")}${c.hl ? `<span class="chip">highlight ${c.hl}/5</span>` : ""}</div>` : ""}
      <div style="display:grid;gap:4px"><span class="label">Watch with sound</span>${watchHTML(c)}</div>
      <p class="muted" style="font-size:12px">The player on the left flips through frames. ${DATA.player ? "<b>Play</b> streams the clip from your Drive in the GoPro Travels Player (Light = fast 540p copy, Full = the original)." : "<b>Light</b> plays a fast 540p copy and <b>Full</b> the original, both in Google Drive (on a phone, in the Drive app)."}</p></div></div>
    ${framesHTML(c)}
    <div>${momentsHTML(c, "dl")}</div>
    ${rateHTML(c)}
    ${editHTML(c, "dl")}
    ${factsHTML(c)}
    ${txHTML(c)}
    <div class="row"><button class="btn ghost" id="copy">Copy name</button></div>`;
  $("close").onclick = () => $("dlg").close();
  $("dl-prev").onclick = () => openClip(dlgList[pos - 1].id);
  $("dl-next").onclick = () => openClip(dlgList[pos + 1].id);
  $("copy").onclick = (e) => copyText(c.name, e.target, $("detail").querySelector(".detail-head .name"));
  wireRate($("detail")); wireEdit(c, "dl"); wireMoments($("detail"));
  if (!$("dlg").open) $("dlg").showModal();
  wirePlayer("dl-player", clipFrames(c), true);
}
$("dlg").addEventListener("click", (e) => { if (e.target === $("dlg")) $("dlg").close(); });
$("dlg").addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || $("pdlg").open) return;
  const r = {"1": "best", "2": "keep", "3": "maybe", "4": "reject"}[e.key];
  const btn = r && $("detail").querySelector(`.rate button[data-r="${r}"]`);
  if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  const mc = byId.get($("detail").querySelector(".moments")?.dataset.clip);
  if (mc && (e.key === "m" || e.key === "M")) { e.preventDefault(); keepTopSuggestion(mc); }
  if (mc && (e.key === "n" || e.key === "N")) { e.preventDefault(); newMomentHere(mc, $("detail")); }
  if (e.key === "ArrowRight" && !$("dl-next").disabled) { e.preventDefault(); $("dl-next").click(); }
  if (e.key === "ArrowLeft" && !$("dl-prev").disabled) { e.preventDefault(); $("dl-prev").click(); }
});
function copyText(text, btn, selEl) {
  navigator.clipboard.writeText(text).then(() => { btn.textContent = "Copied"; }).catch(() => {
    if (selEl) { const r = document.createRange(); r.selectNodeContents(selEl); getSelection().removeAllRanges(); getSelection().addRange(r); }
    btn.textContent = "Selected, press Cmd+C";
  });
}

/* ---------------- REVIEW ---------------- */
let rvIndex = 0, rvList = [], rvMarksLoaded = false;
function reviewQueue() {
  const q = $("rv-queue").value, co = $("rv-country").value, skip = $("rv-skipjunk").checked, day = $("rv-day").value;
  return processed.filter((c) => {
    if (!matchCountry(c, co)) return false;
    if (day && c.t.slice(0, 10) !== day) return false;
    if (skip && isJunk(c)) return false;
    const m = markOf(c.id)?.r;
    if (q === "none") return !m;
    if (q === "maybe") return m === "maybe";
    return true;
  });
}
function renderReviewProgress() {
  const done = processed.filter((c) => markOf(c.id)?.r).length;
  $("rv-progress").textContent = `${done.toLocaleString()} of ${processed.length.toLocaleString()} reviewed`;
  const pct = processed.length ? (done / processed.length) * 100 : 0;
  $("rv-bar").innerHTML = `<i style="width:${pct.toFixed(1)}%"></i>`;
}
const undoStack = [];
async function undo() {
  const last = undoStack.pop(); if (!last) return toast("Nothing to undo");
  await saveMark(last.id, {r: last.prev}, true);
  const i = reviewQueue().findIndex((c) => c.id === last.id);
  rvIndex = i >= 0 ? i : last.idx; toast("Undone"); renderReview();
}
function fillTarget() {
  const sel = $("rv-target"), cur = sel.value;
  const posts = [...store.posts.values()].filter((p) => p.status !== "posted").sort(postOrder);
  sel.innerHTML = `<option value="">Choose a post…</option>` + posts.map((p) => `<option value="${esc(p.id)}">${esc(p.title)} · ${postItems(p).length} moments</option>`).join("") + `<option value="__new">+ New post</option>`;
  if (cur && (cur === "__new" || store.posts.has(cur))) sel.value = cur;
}
async function addToTarget(c) {
  const v = $("rv-target").value;
  if (!v) return toast("Choose the post you're working on first");
  if (v === "__new") {
    const id = await savePost(null, {...newPostSeed(c, itemsFor(c)), kind: "reel", status: "clips", hook: "", caption: "", notes: "", brief: briefDefaults("reel")});
    if (id) { setTimeout(() => { fillTarget(); $("rv-target").value = id; renderReview(true); }, 150); }
    return;
  }
  await addItemsToPost(v, itemsFor(c));
}
$("rv-target").addEventListener("change", (e) => { e.target.blur(); renderReview(true); });
let rvTab = "moments";
// Moment position on the filmstrip: frames are evenly spaced but not evenly timed, so markers follow the frames.
function rvX(c, t) {
  const f = c.ft || [], n = f.length, dur = c.dur || 1;
  if (!n) return (t / dur) * 100;
  if (t <= f[0]) return ((f[0] ? t / f[0] : 1) * 50) / n;
  for (let k = 0; k < n - 1; k++) if (t <= f[k + 1]) return ((k + 0.5 + (t - f[k]) / ((f[k + 1] - f[k]) || 1)) / n) * 100;
  return ((n - 0.5 + Math.min(1, (t - f[n - 1]) / ((dur - f[n - 1]) || 1)) * 0.5) / n) * 100;
}
function drawRvMarks() {
  const el = $("rv-marks"), c = byId.get(el?.dataset.clip);
  if (!c) return;
  const saved = momentsOf(c.id), dur = c.dur || 1;
  const covered = (s) => saved.some((m) => Math.max(0, Math.min(m.b ?? dur, s[1]) - Math.max(m.a, s[0])) > 0.5 * (s[1] - s[0]));
  const seg = (cls, a, b) => { const x = rvX(c, a); return `<i class="${cls}" style="left:${x.toFixed(2)}%;width:${(rvX(c, b) - x).toFixed(2)}%"></i>`; };
  el.innerHTML = (c.sug || []).filter((s) => !covered(s)).map((s) => seg("s", s[0], s[1])).join("") + saved.map((m) => seg("m", m.a, m.b ?? dur)).join("");
  const count = $("rv-mcount");
  if (count) count.textContent = saved.length ? `Moments (${saved.length})` : "Moments";
}
function renderReview(keepPos) {
  fillTarget(); fillDays();
  renderReviewProgress();
  const pick = (id) => $(id).selectedOptions[0]?.textContent.split(" · ").slice(0, 2).join(" · ") || "";
  $("rv-fsum").textContent = [$("rv-queue").value !== "none" && pick("rv-queue"), $("rv-country").selectedIndex > 0 && pick("rv-country"), $("rv-day").value && pick("rv-day"), !$("rv-skipjunk").checked && "Showing all"].filter(Boolean).join(", ");
  const curId = rvList[rvIndex]?.id;
  rvList = reviewQueue();
  if (keepPos && curId) { const i = rvList.findIndex((c) => c.id === curId); if (i >= 0) rvIndex = i; }
  rvIndex = Math.max(0, Math.min(rvIndex, rvList.length - 1));
  const c = rvList[rvIndex];
  if (!c) { $("rv").innerHTML = `<div class="review"><p class="empty">${processed.length ? "Nothing left in this queue. Pick another queue above." : "No clips processed yet."}</p></div>`; return; }
  const junk = isJunk(c);
  const notes = markOf(c.id)?.note || (markOf(c.id)?.labels || []).length;
  const tab = (k, name, id) => `<button type="button" role="tab" data-tab="${k}" ${id ? `id="${id}"` : ""} aria-selected="${rvTab === k}">${name}</button>`;
  const strip = c.sp ? `<div class="rx-strip" id="rv-strip">${Array.from({length: c.sp[2]}, (_, k) => `<button type="button" data-k="${k}" title="${c.ft?.[k] != null ? fmtDur(c.ft[k]) : ""}${c.st?.[k] ? " · " + esc(c.st[k]) : ""}" aria-label="Show frame ${k + 1}"><span class="thumb" style="${thumbStyle(c, k)}"></span><small>${c.ft?.[k] != null ? fmtDur(c.ft[k]) : ""}</small></button>`).join("")}</div>
      <div class="rx-marks" id="rv-marks" data-clip="${esc(c.id)}" title="Moments in this clip. Click to jump there."></div>
      <div class="rx-legend"><span><i class="m"></i>Kept</span><span><i></i>Suggested</span></div>` : `<p class="muted">No preview frames yet.</p>`;
  $("rv").innerHTML = `<div class="rx">
    <div class="rx-stage">
      <div class="rx-head"><div><h2>${esc(c.title || dayTitle(c))}</h2><p>Clip ${rvIndex + 1} of ${rvList.length} · ${c.title ? esc(dayTitle(c)) + " · " : ""}${c.t.slice(11, 16)} · ${fmtDur(c.dur)}</p></div>${watchHTML(c, true)}</div>
      ${junk ? `<p class="rx-warn">Suggested: reject (${c.flags.filter((f) => ["short", "dark", "pocket"].includes(f)).join(", ")})</p>` : ""}
      ${playerHTML("rv-player")}
      ${strip}
      ${c.desc ? `<p class="rx-desc">${esc(c.desc)}</p>` : ""}
    </div>
    <aside class="rx-side">
      <div class="rx-tabs" role="tablist">${tab("moments", "Moments", "rv-mcount")}${tab("notes", notes ? "Notes ✓" : "Notes")}${tab("info", "Clip info")}</div>
      <div class="rx-panel" data-panel="moments" ${rvTab === "moments" ? "" : "hidden"}><div>${momentsHTML(c, "rv")}</div></div>
      <div class="rx-panel" data-panel="notes" ${rvTab === "notes" ? "" : "hidden"}>${editHTML(c, "rv")}</div>
      <div class="rx-panel" data-panel="info" ${rvTab === "info" ? "" : "hidden"}>
        <div class="row" style="justify-content:space-between"><span class="mono" style="font-size:12px;word-break:break-all">${esc(c.name)}</span></div>
        ${(c.tags || []).length ? `<div class="chips">${c.tags.map((t) => `<span class="chip label">${esc(t)}</span>`).join("")}${c.hl ? `<span class="chip">highlight ${c.hl}/5</span>` : ""}</div>` : ""}
        ${factsHTML(c)}${txHTML(c)}
      </div>
    </aside>
  </div>
  <div class="rx-bar" style="margin-top:14px">
    ${rateHTML(c, true)}
    <button class="btn ghost rx-add" id="rv-add" ${canSave() && $("rv-target").value ? "" : "disabled"} title="${$("rv-target").value ? "Add this clip's moments to the post" : "Choose a post at the top first"}">Add to post <kbd class="mono" style="font-size:11px">A</kbd></button>
    <span class="rx-gap"></span>
    <button class="btn quiet" id="rv-undo" ${undoStack.length ? "" : "disabled"}>Undo</button>
    <button class="btn quiet" id="rv-prev" ${rvIndex > 0 ? "" : "disabled"} aria-label="Previous clip">←</button>
    <button class="btn quiet" id="rv-next" ${rvIndex < rvList.length - 1 ? "" : "disabled"} aria-label="Next clip">→</button>
    <details class="rx-pop rx-keys"><summary aria-label="Keyboard shortcuts" title="Keyboard shortcuts">?</summary><div class="rx-menu">
      <dl><dt>1 2 3 4</dt><dd>Best, keep, maybe, reject</dd><dt>M</dt><dd>Keep the top suggested moment</dd><dt>N</dt><dd>New moment at the frame showing</dd><dt>A</dt><dd>Add the clip's moments to the post</dd><dt>U</dt><dd>Undo</dd><dt>← →</dt><dd>Previous / next clip</dd><dt>Space</dt><dd>Play / pause the preview</dd></dl>
      <p>Moment times accept seconds (12.5) or minutes:seconds (1:05).</p>
    </div></details>
  </div>`;
  wirePlayer("rv-player", clipFrames(c), true);
  const rvPl = $("rv-player"), rvRange = rvPl.querySelector("input"), rvStrip = $("rv-strip");
  rvPl.querySelector(".screen").onclick = () => rvPl.querySelector("[data-play]").click();
  if (rvStrip) {
    const seek = (k) => { rvRange.value = k; rvRange.dispatchEvent(new Event("input")); };
    const mark = () => rvStrip.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-current", i === +rvRange.value));
    new MutationObserver(mark).observe(rvPl, {attributes: true, attributeFilter: ["data-t"]});
    mark();
    rvStrip.onclick = (e) => { const b = e.target.closest("button[data-k]"); if (b) seek(+b.dataset.k); };
    $("rv-marks").onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(), n = c.sp[2]; seek(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)))); };
    drawRvMarks();
  }
  $("rv").querySelector(".rx-tabs").onclick = (e) => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    rvTab = b.dataset.tab;
    $("rv").querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
    $("rv").querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== rvTab; });
  };
  $("rv-add").onclick = () => addToTarget(c);
  $("rv-undo").onclick = undo;
  $("rv").querySelector(".rate").addEventListener("click", (e) => { const b = e.target.closest("button[data-r]"); if (b) undoStack.push({id: c.id, prev: markOf(c.id)?.r ?? null, idx: rvIndex}); }, true);
  wireRate($("rv"), () => { if ($("rv-queue").value === "all") rvIndex++; renderReview(); });
  wireEdit(c, "rv"); wireMoments($("rv"));
  $("rv-prev").onclick = () => { rvIndex--; renderReview(); };
  $("rv-next").onclick = () => { rvIndex++; renderReview(); };
}
["rv-queue", "rv-country", "rv-day", "rv-skipjunk"].forEach((id) => $(id).addEventListener("change", (e) => { e.target.blur(); rvIndex = 0; renderReview(); }));
document.addEventListener("click", (e) => { document.querySelectorAll("#v-review details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });
addEventListener("keydown", (e) => {
  if ($("v-review").hidden || $("dlg").open || $("pdlg").open) return;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
  const c = rvList[rvIndex]; if (!c) return;
  const r = {"1": "best", "2": "keep", "3": "maybe", "4": "reject"}[e.key];
  if (r && canSave()) { e.preventDefault(); undoStack.push({id: c.id, prev: markOf(c.id)?.r ?? null, idx: rvIndex}); saveMark(c.id, {r}).then(() => { if ($("rv-queue").value === "all") rvIndex++; renderReview(); }); }
  if (e.key === "ArrowRight") { rvIndex++; renderReview(); }
  if (e.key === "ArrowLeft") { rvIndex--; renderReview(); }
  if (e.key === "a" || e.key === "A") { e.preventDefault(); addToTarget(c); }
  if (e.key === "m" || e.key === "M") { e.preventDefault(); keepTopSuggestion(c); }
  if (e.key === "n" || e.key === "N") { e.preventDefault(); newMomentHere(c, $("rv")); }
  if (e.key === "u" || e.key === "U") { e.preventDefault(); undo(); }
  if (e.key === " ") { e.preventDefault(); $("rv-player")?.querySelector("[data-play]")?.click(); }
});

/* ---------------- POSTS ---------------- */
function daysOf(clipIds, fallback) {
  const ds = clipIds.map((id) => byId.get(id)?.t?.slice(0, 10)).filter(Boolean).sort();
  return ds.length ? [ds[0], ds[ds.length - 1]] : (fallback || null);
}
function postOrder(a, b) { return (a.days?.[0] || "9999").localeCompare(b.days?.[0] || "9999") || (a.created || 0) - (b.created || 0); }
function postDays(p) { return p.days ? (p.days[0] === p.days[1] ? fmtShort(p.days[0]) : `${fmtShort(p.days[0])}–${fmtShort(p.days[1])}`) : "no dates yet"; }
$("board").addEventListener("click", (e) => { const b = e.target.closest(".pcard"); if (b) openPost(b.dataset.id); });
$("board").addEventListener("keydown", (e) => { const b = e.target.closest(".pcard"); if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPost(b.dataset.id); } });
// Drag a post card to another column to change its stage.
{
  const bd = $("board"); let dragId = null;
  const clear = () => bd.querySelectorAll(".col.drop").forEach((c) => c.classList.remove("drop"));
  bd.addEventListener("dragstart", (e) => { const b = e.target.closest(".pcard"); if (!b) return; dragId = b.dataset.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); requestAnimationFrame(() => b.classList.add("dragging")); });
  bd.addEventListener("dragend", () => { dragId = null; clear(); bd.querySelectorAll(".dragging").forEach((c) => c.classList.remove("dragging")); });
  bd.addEventListener("dragover", (e) => { const c = e.target.closest(".col"); if (!dragId || !c) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!c.classList.contains("drop")) { clear(); c.classList.add("drop"); } });
  bd.addEventListener("drop", async (e) => {
    const c = e.target.closest(".col"); if (!dragId || !c) return; e.preventDefault(); clear();
    const id = dragId; dragId = null;
    const col = BOARD.find(([n]) => n === c.querySelector("h3")?.textContent), p = store.posts.get(id);
    if (!col || !p || col[1].includes(p.status || "idea")) return;
    if (!canSave()) return toast("Sign in to move posts", true);
    const {id: _i, ...body} = p;
    body.status = col[1][0] === "idea" ? ((postItems(p).length) ? "clips" : "idea") : col[1][0];
    if (body.status === "posted" && !body.postedAt) body.postedAt = new Date().toISOString().slice(0, 10);
    await savePost(id, body, true); toast(`Moved to ${col[0]}`); renderBoard();
  });
}
$("newpost").addEventListener("click", () => openPost(null, {}));

let draft = null;
/* ================= POST STUDIO =================
   One post = moments (raw material, your order) + a brief + Claude's edits (versions) + the final render.
   Claude edits inside this page through the page's own Claude access (your Claude plan, no API):
   it reads the brief and the clip facts, looks at one frame per moment, and writes an edit decision list (EDL).
   Each answer is a version in db `edits/<post>-v<n>`; your notes on a version produce the next one.
   Approve a version → Claude Code queues it → Colab renders it from the original files (tools/render.py). */
function briefDefaults(kind) {
  return {story: "", length: kind === "reel" ? 30 : "", aspect: {reel: "9:16", carousel: "4:5", long: "16:9"}[kind] || "9:16",
    audio: "", captions: "", pace: "", mood: "", refs: "", include: "", avoid: "", variants: 1};
}
const BRIEF_OPTS = {
  aspect: [["9:16", "9:16 vertical (Reels)"], ["4:5", "4:5 feed"], ["1:1", "1:1 square"], ["16:9", "16:9 wide (long video)"]],
  audio: [["", "Claude's choice"], ["original", "Original sound only"], ["voiceover", "My voiceover (added later)"], ["music", "Music, a little ambient"], ["mix", "Original sound + music"]],
  captions: [["", "Claude's choice"], ["none", "No text"], ["keywords", "A few key words"], ["speech", "Subtitles of what I say"], ["story", "Story lines on screen"]],
  pace: [["", "Claude's choice"], ["calm", "Calm, let shots breathe"], ["medium", "Medium"], ["fast", "Fast, punchy cuts"]],
};
const ASPECT = {"9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080]};
const briefOpts = (k, v) => BRIEF_OPTS[k].map(([val, name]) => `<option value="${val}" ${String(v ?? "") === val ? "selected" : ""}>${name}</option>`).join("");
const r2 = (x) => Math.round(x * 100) / 100;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const shotLen = (s) => (s.out - s.in) / (s.speed || 1);
const edlLen = (e) => (e?.shots || []).reduce((a, s) => a + shotLen(s), 0);
const editsOf = (pid) => [...store.edits.values()].filter((e) => e.post === pid).sort((a, b) => a.v - b.v);
// [done?, text, needed before Claude edits]
function postChecks(p) {
  const items = p.items || [], total = items.reduce((a, it) => a + itemLen(it), 0), target = +p.brief?.length || 0;
  const whole = items.filter((it) => it.a == null).length, need = p.kind === "reel" ? 2 : 1;
  return [
    [!!(p.title || "").trim(), "A title", true],
    [items.length >= need, `At least ${need} moment${need > 1 ? "s" : ""}`, true],
    [!!(p.brief?.story || "").trim(), "What the post is about (helps Claude find the story)", false],
    [!whole, whole ? `${whole} whole clip${whole > 1 ? "s" : ""} without a moment picked (Claude will choose the seconds)` : "Every clip has its moment picked", false],
    [!target || total >= target, target ? (total >= target ? `${fmtDur(total)} of moments for a ${target} s target` : `${fmtDur(total)} of moments for a ${target} s target: more material gives Claude room to cut`) : "No target length (Claude decides)", false],
  ];
}
const checksHTML = (p) => postChecks(p).map(([ok, text, req]) => `<li class="${ok ? "ok" : req ? "" : "warn"}">${esc(text)}</li>`).join("");

/* ---------- open / autosave ---------- */
const studio = {ver: null, ctl: null, busy: null, live: "", saving: Promise.resolve(), timer: null, playing: null, cands: 24};
function openPost(id, seed) {
  const p = id ? {...store.posts.get(id)} : {title: "", kind: "reel", status: (seed?.items?.length ? "clips" : "idea"), hook: "", caption: "", notes: "", renderUrl: "", scheduled: "", igUrl: "", ...seed};
  draft = {...p, id, items: postItems(p).map((it) => ({...it})), brief: {...briefDefaults(p.kind || "reel"), ...(p.brief || {})}};
  delete draft.clips;  // rebuilt from items when saved
  const vers = id ? editsOf(id) : [];
  studio.ver = p.edit && vers.some((e) => e.v === p.edit) ? p.edit : vers.at(-1)?.v ?? null;
  studio.cands = 24;
  drawPost();
  if (!$("pdlg").open) $("pdlg").showModal();
  if (!id && draft.items.length && draft.title) persist();  // a post started from a clip exists right away
}
function savedState(t) { const el = $("p-saved"); if (el) el.textContent = t; }
function queueSave() { clearTimeout(studio.timer); savedState("Unsaved changes…"); studio.timer = setTimeout(persist, 700); }
function persist() {
  clearTimeout(studio.timer); studio.timer = null;
  const d = draft;  // the post as it is now, even if the studio closes before the save runs
  studio.saving = studio.saving.then(async () => {
    if (!d || !canSave()) return;
    if (!(d.title || "").trim()) { savedState("Give the post a title to save it"); return; }
    const {id, ...body} = d;
    body.items = body.items.map((it) => ({...it}));
    body.days = daysOf(body.items.map((it) => it.clip), body.days);
    if (body.status === "posted" && !body.postedAt) body.postedAt = new Date().toISOString().slice(0, 10);
    savedState("Saving…");
    const newId = await savePost(d.id, body, true);
    if (newId) { const first = !d.id; d.id = newId; if (draft === d) { savedState("Saved"); if (first) drawEdit(); } }
  }).catch(() => savedState("Not saved: check your connection"));
  return studio.saving;
}
$("pdlg").addEventListener("close", () => { if (draft && studio.timer) persist(); studio.ctl?.abort(); stopAnim(); draft = null; });

/* ---------- layout ---------- */
function drawPost() {
  const p = draft;
  $("pdlg").classList.add("studio");
  $("pdetail").innerHTML = `
    <div class="st-head">
      <input class="st-title" id="p-title" value="${esc(p.title)}" placeholder="Post title, e.g. First night in a new city" aria-label="Post title">
      <div class="row">
        <select id="p-kind" aria-label="Format">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <label class="row" style="gap:6px;font-size:13px" title="Planned post date"><span class="muted">Post on</span><input type="date" id="p-sched" value="${esc(p.scheduled || "")}"></label>
        <span class="muted" id="p-saved" style="font-size:13px">${p.id ? "Saved" : ""}</span>
        <button class="btn quiet" id="p-close">Close</button>
      </div>
    </div>
    <div class="steps" id="p-steps" role="group" aria-label="Status">${STATUSES.map(([k, n], i) => `<button data-st="${k}" aria-pressed="${(p.status || "idea") === k}">${i + 1}. ${n}</button>`).join("")}</div>
    <div class="st-grid">
      <section class="st-col" id="st-moments"></section>
      <section class="st-col st-main" id="st-edit"></section>
      <section class="st-col" id="st-brief"></section>
    </div>`;
  $("p-close").onclick = () => $("pdlg").close();
  $("p-title").oninput = () => { draft.title = $("p-title").value.trim(); queueSave(); };
  $("p-kind").onchange = () => { draft.kind = $("p-kind").value; queueSave(); drawMoments(); };
  $("p-sched").onchange = () => { draft.scheduled = $("p-sched").value; queueSave(); };
  $("p-steps").onclick = (e) => { const b = e.target.closest("[data-st]"); if (!b || !canSave()) return; setPostStatus(b.dataset.st); };
  drawMoments(); drawEdit(); drawBrief();
  if (!canSave()) $("pdetail").querySelectorAll("input:not([type=range]),select,textarea,button:not(#p-close)").forEach((x) => x.disabled = true);
}
function setPostStatus(s) {
  draft.status = s;
  document.querySelectorAll("#p-steps [data-st]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.st === s));
  queueSave(); drawEdit();
}

/* ---------- moments column ---------- */
const roleOpts = (r) => Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${(r || "") === k ? "selected" : ""}>${v}</option>`).join("");
function candidates(p) {
  const days = daysOf(p.items.map((it) => it.clip), p.days), ds = new Set();
  if (days) for (let d = days[0]; d <= days[1]; d = addDays(d, 1)) ds.add(d);
  const pool = processed.filter((c) => (ds.size ? ds.has(c.t.slice(0, 10)) : p.place && (c.region || c.city) === p.place) && markOf(c.id)?.r !== "reject" && !isJunk(c));
  const used = (clip, a, b) => p.items.some((it) => it.clip === clip && (it.a == null || Math.max(0, Math.min(it.b ?? 1e9, b) - Math.max(it.a, a)) > 0.5 * (b - a)));
  const out = [];
  for (const c of pool) {
    for (const m of momentsOf(c.id)) if (!used(c.id, m.a, m.b)) out.push({c, a: m.a, b: m.b, kind: "kept", role: m.role || "", note: m.note || "", score: 2});
    for (const s of c.sug || []) if (!used(c.id, s[0], s[1]) && !momentsOf(c.id).some((m) => Math.abs(m.a - s[0]) < 0.5)) out.push({c, a: s[0], b: s[1], kind: s[2], role: KIND_ROLE[s[2]] || "", note: "", score: s[3] + (["best", "keep"].includes(markOf(c.id)?.r) ? 0.5 : 0)});
  }
  return {list: out.sort((x, y) => y.score - x.score || x.c.t.localeCompare(y.c.t)), days};
}
function drawMoments() {
  const p = draft, items = p.items, total = items.reduce((a, it) => a + itemLen(it), 0);
  const row = (it, i) => {
    const c = byId.get(it.clip), whole = it.a == null;
    const picks = whole ? [...momentsOf(it.clip).map((m) => [m.a, m.b, "kept"]), ...(c?.sug || [])] : [];
    const times = whole
      ? `<span class="muted" style="font-size:12px">Whole clip (${fmtDur(c?.dur)})</span>${picks.length ? `<select data-f="pick" aria-label="Pick a moment"><option value="">Pick a moment…</option>${picks.map((s) => `<option value="${s[0]}|${s[1]}">${fmtT(s[0])}–${fmtT(s[1])} · ${s[2] === "kept" ? "your moment" : esc(KIND_NAME[s[2]] || s[2])}</option>`).join("")}</select>` : ""}`
      : `<input class="t" data-f="a" value="${fmtT(it.a)}" aria-label="Start" inputmode="decimal">–<input class="t" data-f="b" value="${fmtT(it.b)}" aria-label="End" inputmode="decimal"><span class="muted" style="font-size:12px">${itemLen(it).toFixed(1)} s</span>`;
    return `<div class="mrow" draggable="true" data-i="${i}"><div class="thumb" style="${thumbStyle(c, whole ? coverFrame(c) : nearestFrame(c, (it.a + (it.b ?? it.a)) / 2))}"><span class="num">${i + 1}</span></div>
      <div style="display:grid;gap:4px;min-width:0"><div class="mtitle">${esc(c?.title || (c ? `${c.region || c.city || ""} ${c.t.slice(11, 16)}`.trim() : it.clip))} <span class="muted">· ${esc(c ? (c.pre ? "Before" : "Day " + c.day) : "")}</span></div>
        <div class="fields">${times}<select data-f="role" aria-label="Role">${roleOpts(it.role)}</select></div>
        <input class="note" data-f="note" value="${esc(it.note || "")}" placeholder="Note for Claude (e.g. keep the sound)"></div>
      <div class="ops">${DATA.player && c?.drive ? `<a href="${esc(itemsLink(items, "light", i))}" target="gopro-player" rel="noopener" aria-label="Play from this moment">▶</a>` : ""}<button data-op="up" aria-label="Move up">↑</button><button data-op="down" aria-label="Move down">↓</button><button data-op="rm" aria-label="Remove">✕</button></div></div>`;
  };
  const {list, days} = candidates(p);
  const cand = (x, k) => `<div class="mrow sug" data-k="${k}"><div class="thumb" style="${thumbStyle(x.c, nearestFrame(x.c, (x.a + x.b) / 2))}"></div>
    <div style="display:grid;gap:2px;min-width:0"><div class="mtitle">${esc(x.c.title || `${x.c.region || x.c.city || ""} ${x.c.t.slice(11, 16)}`)}</div>
      <span class="muted" style="font-size:12px">${fmtT(x.a)}–${fmtT(x.b)} · ${x.kind === "kept" ? "your moment" : esc(KIND_NAME[x.kind] || x.kind)} · ${(x.b - x.a).toFixed(1)} s${markOf(x.c.id)?.r === "best" ? " · ★" : ""}</span></div>
    <div class="ops">${DATA.player && x.c.drive ? `<a href="${esc(itemsLink([{clip: x.c.id, a: x.a}], "light"))}" target="gopro-player" rel="noopener" aria-label="Watch">▶</a>` : ""}<button class="keep" data-op="add">+ Add</button></div></div>`;
  studio.candList = list;
  $("st-moments").innerHTML = `
    <div class="st-sec-head"><h3>Moments</h3><span class="muted">${items.length} · ${fmtDur(total) || "0s"}${+p.brief.length ? ` of ${p.brief.length} s` : ""}</span></div>
    <p class="muted small">Your raw material in story order. Drag to reorder. Claude trims, reorders or drops them and may pull in extras from below.</p>
    <div class="plist" id="p-items">${items.map(row).join("") || `<p class="muted small">No moments yet. Add some from below, or from any clip in the Library or Review.</p>`}</div>
    <div class="st-add"><div class="st-sec-head"><span class="label">More from ${days ? (days[0] === days[1] ? fmtShort(days[0]) : `${fmtShort(days[0])}–${fmtShort(days[1])}`) : esc(p.place || "this post")}</span><span class="muted small">${list.length} found</span></div>
      <div class="plist" id="p-cands">${list.slice(0, studio.cands).map(cand).join("") || `<p class="muted small">${days || p.place ? "Nothing else from these days yet." : "Add one moment and its day's other footage shows up here."}</p>`}</div>
      ${list.length > studio.cands ? `<button class="btn quiet" id="p-more">Show more</button>` : ""}</div>`;
  const box = $("p-items");
  box.onchange = (e) => {
    const r = e.target.closest(".mrow[data-i]"); if (!r) return;
    const it = draft.items[+r.dataset.i], f = e.target.dataset.f, c = byId.get(it.clip);
    if (f === "pick" && e.target.value) { const [a, b] = e.target.value.split("|").map(Number); Object.assign(it, {a, b}); queueSave(); return drawMoments(); }
    if (f === "a" || f === "b") {
      const t = parseT(e.target.value);
      if (t == null || t < 0 || t > (c?.dur || 1e9)) { toast("Use seconds (12.5) or minutes:seconds (1:05), inside the clip", true); e.target.value = fmtT(it[f]); return; }
      it[f] = t; if (it.b != null && it.b <= it.a) it.b = Math.min(c?.dur || it.a + 3, it.a + 3);
      queueSave(); return drawMoments();
    }
    if (f) { it[f] = e.target.value.trim(); queueSave(); }
  };
  box.oninput = (e) => { if (e.target.dataset.f === "note") { draft.items[+e.target.closest(".mrow").dataset.i].note = e.target.value; queueSave(); } };
  box.onclick = (e) => {
    const b = e.target.closest("button[data-op]"); if (!b) return;
    const i = +b.closest(".mrow").dataset.i, l = draft.items;
    if (b.dataset.op === "up" && i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]];
    if (b.dataset.op === "down" && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
    if (b.dataset.op === "rm") l.splice(i, 1);
    queueSave(); drawMoments();
  };
  let dragFrom = null;
  box.ondragstart = (e) => { const r = e.target.closest(".mrow[data-i]"); if (!r || e.target.closest("input,select")) return e.preventDefault(); dragFrom = +r.dataset.i; r.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; };
  box.ondragover = (e) => { if (dragFrom != null) { e.preventDefault(); box.querySelectorAll(".mrow").forEach((x) => x.classList.toggle("drop", x === e.target.closest(".mrow"))); } };
  box.ondragend = () => { dragFrom = null; box.querySelectorAll(".mrow").forEach((x) => x.classList.remove("drop", "dragging")); };
  box.ondrop = (e) => {
    e.preventDefault(); const r = e.target.closest(".mrow[data-i]"); if (dragFrom == null || !r) return;
    const to = +r.dataset.i, [m] = draft.items.splice(dragFrom, 1); draft.items.splice(to, 0, m); dragFrom = null; queueSave(); drawMoments();
  };
  $("p-cands").onclick = (e) => {
    const b = e.target.closest("button[data-op=add]"); if (!b) return;
    const x = studio.candList[+b.closest(".mrow").dataset.k]; if (!x) return;
    draft.items.push({clip: x.c.id, a: x.a, b: x.b, role: x.role, note: x.note});
    if (["idea", undefined, ""].includes(draft.status)) draft.status = "clips";
    queueSave(); drawMoments(); drawEdit();
  };
  if ($("p-more")) $("p-more").onclick = () => { studio.cands += 24; drawMoments(); };
}

/* ---------- brief column ---------- */
function drawBrief() {
  const p = draft, br = p.brief;
  $("st-brief").innerHTML = `
    <div class="st-sec-head"><h3>Brief</h3><span class="muted small">Claude reads this</span></div>
    <label class="field"><span>What is this post about?</span><textarea id="b-story" placeholder="e.g. First night in a new city: overwhelmed at first, then I find the street food and love it.">${esc(br.story || "")}</textarea></label>
    <div class="two tight">
      <label class="field"><span>Length (s)</span><input type="number" id="b-length" min="3" max="3600" value="${esc(br.length ?? "")}"></label>
      <label class="field"><span>Shape</span><select id="b-aspect">${briefOpts("aspect", br.aspect)}</select></label>
      <label class="field"><span>Sound</span><select id="b-audio">${briefOpts("audio", br.audio)}</select></label>
      <label class="field"><span>Text on screen</span><select id="b-captions">${briefOpts("captions", br.captions)}</select></label>
      <label class="field"><span>Pace</span><select id="b-pace">${briefOpts("pace", br.pace)}</select></label>
      <label class="field"><span>Mood</span><input type="text" id="b-mood" value="${esc(br.mood || "")}" placeholder="e.g. chill, then energetic"></label>
    </div>
    <label class="field"><span>Must include</span><input type="text" id="b-include" value="${esc(br.include || "")}" placeholder="e.g. end on the sunset"></label>
    <label class="field"><span>Avoid</span><input type="text" id="b-avoid" value="${esc(br.avoid || "")}" placeholder="e.g. the blurry tuk-tuk shot"></label>
    <label class="field"><span>Reels you like (links)</span><textarea id="b-refs" style="min-height:40px">${esc(br.refs || "")}</textarea></label>
    <label class="field"><span>Anything else for Claude</span><textarea id="p-notes" style="min-height:48px">${esc(p.notes || "")}</textarea></label>
    <div class="st-sec-head" style="margin-top:6px"><h3>Posting</h3></div>
    <label class="field"><span>Hook (first 2 seconds)</span><input type="text" id="p-hook" value="${esc(p.hook || "")}" placeholder="Claude can put this on screen"></label>
    <label class="field"><span>Caption</span><textarea id="p-caption">${esc(p.caption || "")}</textarea></label>
    ${ideasHTML(p)}
    <label class="field"><span>Instagram link once posted</span><input type="url" id="p-ig" value="${esc(p.igUrl || "")}"></label>
    ${p.id ? `<button class="btn quiet" id="p-del" style="justify-self:start">Delete post</button>` : ""}`;
  const map = {"b-story": "story", "b-length": "length", "b-aspect": "aspect", "b-audio": "audio", "b-captions": "captions", "b-pace": "pace", "b-mood": "mood", "b-include": "include", "b-avoid": "avoid", "b-refs": "refs"};
  const top = {"p-notes": "notes", "p-hook": "hook", "p-caption": "caption", "p-ig": "igUrl"};
  $("st-brief").oninput = $("st-brief").onchange = (e) => {
    const id = e.target.id;
    if (map[id]) { draft.brief[map[id]] = id === "b-length" ? (e.target.value === "" ? "" : Math.max(1, +e.target.value)) : e.target.value; }
    else if (top[id]) draft[top[id]] = e.target.value;
    else return;
    queueSave();
    if (id === "b-length") drawMoments();
  };
  $("st-brief").querySelectorAll("button.use").forEach((b) => b.onclick = () => { draft[b.dataset.field] = b.dataset.text; queueSave(); drawBrief(); });
  if ($("p-del")) {
    let armed = false;
    $("p-del").onclick = async (e) => {
      if (!armed) { armed = true; e.target.textContent = "Click again to delete the post"; return; }
      clearTimeout(studio.timer); const id = draft.id; draft = null; await deletePost(id); $("pdlg").close();
    };
  }
}

/* ---------- Claude's edit (center) ---------- */
function curEdit() { const vs = editsOf(draft?.id); return vs.find((e) => e.v === studio.ver) || vs.at(-1) || null; }
function drawEdit() {
  const p = draft; if (!p) return;
  stopAnim();
  const vers = p.id ? editsOf(p.id) : [], cur = curEdit(), busy = studio.busy;
  const ready = postChecks(p).every(([ok, , req]) => ok || !req) && p.id;
  const tabs = vers.length ? `<div class="vtabs" role="tablist">${vers.map((e) => `<button role="tab" data-v="${e.v}" aria-selected="${cur?.v === e.v}">v${e.v}${p.edit === e.v && ["render", "cut", "scheduled", "posted"].includes(p.status) ? " ✓" : ""}</button>`).join("")}</div>` : "";
  const thinking = busy ? `<div class="thinking"><b>${busy === "first" ? "Claude is making the edit…" : busy === "take" ? "Claude is trying another take…" : "Claude is revising…"}</b>
      <span class="muted small">${esc(studio.live || "Looking at your moments and the brief. This usually takes 30–90 seconds.")}</span><button class="btn quiet" id="ed-stop">Stop</button></div>` : "";
  let body;
  if (!cur) {
    body = `<div class="ed-intro">
      <h3>Let Claude edit this post</h3>
      <p class="muted">Claude reads your brief and every moment (place, time, what's said, how the camera moves), looks at a frame of each one, then writes the edit: shot order, exact in and out points, how each shot is framed for ${esc(p.brief.aspect || "9:16")}, speed, and text on screen if the brief asks for it. It runs on your Claude plan inside this page. No API.</p>
      <ul class="checks">${checksHTML(p)}</ul>
      <div class="row"><button class="btn" id="ed-make" ${ready && !busy ? "" : "disabled"}>✦ Request edit</button>
        <label class="toggle" title="Uses Claude's most capable model; slower"><input type="checkbox" id="ed-hard"> Think harder</label></div>
      ${thinking}<p class="muted small" id="ed-msg">${esc(window.__requestNote?.(p.id) || "")}</p></div>`;
  } else {
    const e = cur.edl, len = edlLen(e), target = +p.brief.length || 0, approved = p.edit === cur.v && ["render", "cut", "scheduled", "posted"].includes(p.status);
    const shotsHTML = e.shots.map((s, i) => { const c = byId.get(s.clip); return `<div class="shot" data-i="${i}">
      <div class="crop sm" style="--r:${cropR(e)};--x:${s.x}"><div class="ci" style="${thumbStyle(c, nearestFrame(c, (s.in + s.out) / 2))}"></div><span class="num">${i + 1}</span></div>
      <div class="fields"><span class="mtitle">${esc(c?.title || s.clip)}</span>
        <input class="t" data-f="in" value="${fmtT(s.in)}" aria-label="In">–<input class="t" data-f="out" value="${fmtT(s.out)}" aria-label="Out"><span class="muted small">${shotLen(s).toFixed(1)} s</span>
        <select data-f="speed" aria-label="Speed">${[1, 1.25, 1.5, 2].map((v) => `<option value="${v}" ${+s.speed === v ? "selected" : ""}>${v}×</option>`).join("")}</select>
        <label class="small muted" style="display:inline-flex;gap:4px;align-items:center">Frame<input type="range" data-f="x" min="0" max="1" step="0.05" value="${s.x}" style="width:80px"></label>
        <input class="note" data-f="text" value="${esc(s.text || "")}" placeholder="Text on screen (none)">
        ${s.why ? `<span class="muted small" style="flex-basis:100%">${esc(s.why)}</span>` : ""}</div>
      <div class="ops"><button data-op="up" aria-label="Move up">↑</button><button data-op="down" aria-label="Move down">↓</button><button data-op="rm" aria-label="Remove shot">✕</button></div></div>`; }).join("");
    body = `
      <div class="ed-top">
        <div class="ed-prev">
          <div class="crop anim" id="ed-anim" style="--r:${cropR(e)};--x:0.5;aspect-ratio:${ASPECT[e.aspect || "9:16"]?.join(" / ") || "9 / 16"}"><div class="ci"></div><div class="ovl" hidden></div><span class="num"></span></div>
          <div class="lenbar" id="ed-prog"><i style="width:0%"></i></div>
          <div class="row"><button class="btn quiet" id="ed-play">▶ Preview</button>${DATA.player ? `<a class="btn quiet" href="${esc(edlLink(e))}" target="gopro-player" rel="noopener" title="Plays the real clips, cut and framed like this edit (GoPro Travels Player)">▶ Real video</a>` : ""}</div>
          <p class="muted small">Preview flips through stills; Real video plays the actual cut.</p>
        </div>
        <div class="ed-info">
          <div class="row" style="justify-content:space-between"><b>v${cur.v} · ${esc(e.title || "Untitled cut")}</b><span class="muted small">${cur.by === "adam" ? "your changes" : "by Claude"}${cur.request ? ` · from your note “${esc(cur.request.slice(0, 80))}${cur.request.length > 80 ? "…" : ""}”` : ""}</span></div>
          <p>${esc(e.summary || "")}</p>
          <div class="kv small"><div><span class="label">Length</span><b>${len.toFixed(1)} s</b>${target ? `<span class="muted small">target ${target} s</span>` : ""}</div><div><span class="label">Shots</span><b>${e.shots.length}</b></div><div><span class="label">Shape</span><b>${esc(e.aspect || "9:16")}</b></div></div>
          ${e.audio ? `<p class="small"><span class="label">Sound</span><br>${esc(e.audio)}</p>` : ""}
          ${(e.questions || []).length ? `<div class="ideas"><span class="label">Claude asks</span>${e.questions.map((q) => `<p class="small">${esc(q)}</p>`).join("")}</div>` : ""}
        </div>
      </div>
      <div class="strip2" id="ed-strip">${e.shots.map((s, i) => `<button data-i="${i}" style="flex:${Math.max(0.5, shotLen(s))}" title="Shot ${i + 1}: ${shotLen(s).toFixed(1)} s"><span class="crop" style="--r:${cropR(e)};--x:${s.x}"><span class="ci" style="${thumbStyle(byId.get(s.clip), nearestFrame(byId.get(s.clip), (s.in + s.out) / 2))}"></span></span></button>`).join("")}</div>
      <div class="ed-chat">
        <label class="field"><span>Tell Claude what to change</span><textarea id="ed-note" placeholder="e.g. Open on the tuk-tuk, cut faster in the market, end on the sunset. Drop the selfie.">${esc(studio.draftNote || "")}</textarea></label>
        <div class="row"><button class="btn" id="ed-revise" ${busy ? "disabled" : ""}>Revise with Claude</button><button class="btn ghost" id="ed-take" ${busy ? "disabled" : ""} title="A fresh, clearly different edit of the same moments">Try another take</button>
          <label class="toggle" title="Uses Claude's most capable model; slower"><input type="checkbox" id="ed-hard"> Think harder</label></div>
        ${thinking}<p class="muted small" id="ed-msg">${esc(window.__requestNote?.(p.id) || "")}</p>
      </div>
      <details class="ed-shots" ${studio.shotsOpen ? "open" : ""}><summary>Shot list · fine-tune it yourself (${e.shots.length})</summary><div class="plist" id="ed-shots">${shotsHTML}</div></details>
      <div class="ed-approve">${approved ? (window.__gtaReview?.button(p.id, cur.v) || "") : ""}${approved
        ? (p.renderUrl ? `<div style="display:grid;gap:6px"><span class="label">Final render of v${cur.v}</span>${renderEmbed(p)}<div class="row">${p.status === "cut" ? `<button class="btn" data-st-go="scheduled">Looks good: schedule it</button>` : ""}<a class="btn ghost" href="${esc(p.renderUrl)}" target="_blank" rel="noopener">Open the file</a></div></div>`
          : `<p><b>v${cur.v} is approved.</b> The final ${esc((ASPECT[e.aspect || "9:16"] || ASPECT["9:16"]).join("×"))} render is made for free in Colab from your original files. Tell Claude Code <b>“render the approved posts”</b>: it queues the edit, and the next Colab run (any pass, or PASS = 4 for renders only) makes it. The cut then plays here.</p>`)
        : `<button class="btn" id="ed-approve" ${busy ? "disabled" : ""}>Approve v${cur.v} for the final render</button><span class="muted small">You can keep revising after; approving just picks the version to render.</span>`}</div>`;
  }
  $("st-edit").innerHTML = `<div class="st-sec-head"><h3>Claude's edit</h3>${tabs}</div>${body}`;
  const w = $("st-edit");
  w.querySelector(".vtabs")?.addEventListener("click", (ev) => { const b = ev.target.closest("[data-v]"); if (b) { studio.ver = +b.dataset.v; drawEdit(); } });
  $("ed-stop")?.addEventListener("click", () => studio.ctl?.abort());
  $("ed-make")?.addEventListener("click", () => askClaude("first"));
  $("ed-revise")?.addEventListener("click", () => { const n = $("ed-note").value.trim(); if (!n) { $("ed-msg").textContent = "Write what to change first."; return; } askClaude("revise", n); });
  $("ed-take")?.addEventListener("click", () => askClaude("take", $("ed-note").value.trim()));
  $("ed-note")?.addEventListener("input", (ev) => { studio.draftNote = ev.target.value; });
  $("ed-approve")?.addEventListener("click", async () => { draft.edit = cur.v; setPostStatus("render"); await persist(); await saveEdit({...cur, approved: Date.now()}); toast(`v${cur.v} approved`); drawEdit(); });
  w.querySelector("[data-st-go]")?.addEventListener("click", (ev) => setPostStatus(ev.target.dataset.stGo));
  w.querySelector("details.ed-shots")?.addEventListener("toggle", (ev) => { studio.shotsOpen = ev.target.open; });
  if (cur) wireShots(cur);
  if (cur) { $("ed-play").onclick = () => (studio.playing ? stopAnim() : playAnim(cur.edl)); showAnimFrame(cur.edl, 0); }
  $("ed-strip")?.addEventListener("click", (ev) => { const b = ev.target.closest("[data-i]"); if (b) { stopAnim(); showAnimFrame(cur.edl, startOf(cur.edl, +b.dataset.i)); } });
}
function wireShots(cur) {
  const box = $("ed-shots"); if (!box) return;
  const commit = async (redraw) => {
    cur.edl.length = r2(edlLen(cur.edl)); cur.by = cur.by === "claude" ? "claude+adam" : cur.by;
    if (draft.edit === cur.v && draft.status === "render") { setPostStatus("edit"); toast("Changed after approval: approve it again when you're happy"); }
    await saveEdit(cur); if (redraw) drawEdit();
  };
  box.onchange = (ev) => {
    const r = ev.target.closest(".shot"); if (!r) return;
    const s = cur.edl.shots[+r.dataset.i], f = ev.target.dataset.f, c = byId.get(s.clip);
    if (f === "in" || f === "out") {
      const t = parseT(ev.target.value);
      if (t == null || t < 0 || t > (c?.dur || 1e9)) { toast("Use seconds (12.5) or minutes:seconds (1:05), inside the clip", true); ev.target.value = fmtT(s[f]); return; }
      s[f] = t; if (s.out <= s.in + 0.2) s.out = Math.min(c?.dur || s.in + 1, s.in + 1);
    } else if (f === "speed") s.speed = +ev.target.value;
    else if (f === "x") s.x = +ev.target.value;
    else if (f === "text") s.text = ev.target.value.trim();
    else return;
    commit(f !== "text");
  };
  box.oninput = (ev) => { if (ev.target.dataset.f === "x") { const r = ev.target.closest(".shot"); r.querySelector(".crop").style.setProperty("--x", ev.target.value); } };
  box.onclick = (ev) => {
    const b = ev.target.closest("button[data-op]"); if (!b) return;
    const i = +b.closest(".shot").dataset.i, l = cur.edl.shots;
    if (b.dataset.op === "up" && i > 0) [l[i - 1], l[i]] = [l[i], l[i - 1]];
    if (b.dataset.op === "down" && i < l.length - 1) [l[i + 1], l[i]] = [l[i], l[i + 1]];
    if (b.dataset.op === "rm") l.splice(i, 1);
    commit(true);
  };
}
async function saveEdit(e) {
  const id = `${e.post}-v${e.v}`, body = {...e, at: Date.now()};
  store.edits.set(id, body);
  if (store.mode === "local") { writeLocal(); return; }
  try { await store.db.collection("edits").doc(id).set(body); } catch (err) { storeProblem(err); }
}

/* ---------- preview: stills cut to time, framed like the output ---------- */
const cropR = (e) => { const [w, h] = ASPECT[e?.aspect || "9:16"] || ASPECT["9:16"]; return Math.max(1, (16 / 9) / (w / h)).toFixed(4); };
const startOf = (e, i) => e.shots.slice(0, i).reduce((a, s) => a + shotLen(s), 0);
function showAnimFrame(e, t) {
  const box = $("ed-anim"); if (!box || !e.shots.length) return;
  let i = 0, acc = 0;
  while (i < e.shots.length - 1 && acc + shotLen(e.shots[i]) <= t) { acc += shotLen(e.shots[i]); i++; }
  const s = e.shots[i], c = byId.get(s.clip), local = s.in + (t - acc) * (s.speed || 1);
  box.style.setProperty("--x", s.x);
  box.querySelector(".ci").setAttribute("style", thumbStyle(c, nearestFrame(c, local)));
  const o = box.querySelector(".ovl"); o.hidden = !s.text; o.textContent = s.text || "";
  box.querySelector(".num").textContent = `${i + 1}/${e.shots.length} · ${fmtT(t)}`;
  const L = edlLen(e); $("ed-prog").firstElementChild.style.width = `${L ? Math.min(100, (t / L) * 100) : 0}%`;
  $("ed-strip")?.querySelectorAll("button").forEach((b, k) => b.classList.toggle("on", k === i));
}
function playAnim(e) {
  stopAnim();
  const L = edlLen(e), t0 = performance.now();
  studio.playing = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    if (!$("ed-anim") || t >= L) { stopAnim(); return; }
    showAnimFrame(e, t);
  }, 120);
  if ($("ed-play")) $("ed-play").textContent = "❚❚ Pause";
}
function stopAnim() { clearInterval(studio.playing); studio.playing = null; if ($("ed-play")) $("ed-play").textContent = "▶ Preview"; }
// The edit in the GoPro Travels Player: real clips, each from its in to its out, framed and titled like the final.
function edlLink(e) {
  const f = (x) => encodeURIComponent(x ?? "").replace(/~/g, "%7E");
  const list = e.shots.map((s) => { const c = byId.get(s.clip); return c?.drive ? [c.drive, c.pv || "", c.title || c.name, s.in, c.hd || "", s.out, s.x, s.text || "", s.speed || 1].map(f).join("~") : null; }).filter(Boolean);
  return `${DATA.player}#q=light&i=0&edit=1&list=${encodeURIComponent(list.join("|"))}`;
}

/* ---------- asking Claude ---------- */
const EDIT_RULES = "";
function clipFacts(c, a, b) {
  const lo = Math.max(0, Math.floor(a ?? 0)), hi = Math.ceil(b ?? c.dur ?? 0);
  const words = (c.txs || []).filter(([s, e]) => e > (a ?? 0) && s < (b ?? 1e9)).map(([s, e, t]) => `[${s.toFixed(1)}–${e.toFixed(1)}] ${t}`).join(" ").slice(0, 500);
  const shake = (c.mps || []).slice(lo, hi + 1).map((x) => x.toFixed(1)).join(" ");
  return [
    `${c.pre ? "Before the trip" : "Day " + c.day} ${fmtDay(c.t)} ${c.t.slice(11, 16)}`,
    [c.region || c.city, c.country].filter(Boolean).join(", ") || "place unknown",
    `clip ${c.id}, ${fmtDur(c.dur)} long`,
    c.title ? `AI title: ${c.title}` : "", c.desc ? `AI description: ${c.desc}` : "",
    c.scenes?.length ? `scenes: ${c.scenes.join(", ")}` : "",
    words ? `speech: ${words}` : (c.tx ? `speech in clip: ${c.tx.slice(0, 200)}` : ""),
    shake ? `camera movement per second from ${lo}s (rad/s; under 0.8 steady, over 2 a lot): ${shake}` : "",
    markOf(c.id)?.note ? `The creator's clip note: ${markOf(c.id).note}` : "",
  ].filter(Boolean).join(" · ");
}
function editData(p) {
  const br = p.brief, opt = (k) => (BRIEF_OPTS[k].find(([v]) => v === (br[k] || ""))?.[1] || "Claude's choice");
  const alts = studio.candList?.slice(0, 24) || [];
  return [
    `POST: "${p.title}" · ${KINDS[p.kind] || "Reel"}${p.place ? " · " + p.place : ""}`,
    `BRIEF: about: ${br.story || "(not given; find the story in the moments)"} | target length: ${br.length ? br.length + " s" : "Claude's choice"} | shape: ${br.aspect || "9:16"} | sound: ${opt("audio")} | text on screen: ${opt("captions")} | pace: ${opt("pace")} | mood: ${br.mood || "Claude's choice"}${br.include ? " | must include: " + br.include : ""}${br.avoid ? " | avoid: " + br.avoid : ""}${br.refs ? " | reference reels: " + br.refs.replace(/\s+/g, " ") : ""}${p.notes ? " | notes: " + p.notes : ""}${p.hook ? " | hook idea: " + p.hook : ""}`,
    "",
    "MOMENTS THE CREATOR PICKED, in his order:",
    ...p.items.map((it, i) => { const c = byId.get(it.clip); return c ? `${i + 1}. ${it.a == null ? "whole clip (pick the best seconds)" : `${it.a.toFixed(1)}–${(it.b ?? c.dur).toFixed(1)} s`}${it.role ? " · role: " + it.role : ""}${it.note ? " · note: " + it.note : ""} · ${clipFacts(c, it.a, it.b)}` : ""; }),
    "",
    alts.length ? "ALTERNATES from the same days (use only if they make it better):" : "",
    ...alts.map((x, k) => `A${k + 1}. ${x.a.toFixed(1)}–${x.b.toFixed(1)} s · ${x.kind === "kept" ? "You kept this" : "suggested " + (KIND_NAME[x.kind] || x.kind)} · ${clipFacts(x.c, x.a, x.b)}`),
  ].join("\n");
}
// Contact sheets: one labelled still per moment (and per alternate), drawn from the page's own sprite images.
const spriteImgs = new Map();
function spriteImg(n) {
  if (!spriteImgs.has(n)) spriteImgs.set(n, new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = bad; im.src = `sprites/s${String(n).padStart(3, "0")}.jpg`; }));
  return spriteImgs.get(n);
}
async function contactSheet(entries) {
  if (!entries.length) return null;
  const cols = Math.min(4, entries.length), rows = Math.ceil(entries.length / cols);
  const tw = Math.floor(Math.min(400, Math.sqrt(1.15e6 / (rows * cols * 9 / 16)))), th = Math.round(tw * 9 / 16);
  const cv = document.createElement("canvas"); cv.width = cols * tw; cv.height = rows * th;
  const g = cv.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, cv.width, cv.height);
  for (const [k, en] of entries.entries()) {
    const c = en.c; if (!c?.sp) continue;
    const im = await spriteImg(c.sp[0]).catch(() => null); if (!im) continue;
    const f = nearestFrame(c, en.t), x = (k % cols) * tw, y = Math.floor(k / cols) * th;
    g.drawImage(im, f * S.w, c.sp[1] * S.h, S.w, S.h, x, y, tw, th);
    g.fillStyle = "rgba(0,0,0,.75)"; g.fillRect(x, y, 56, 30); g.fillStyle = "#fff"; g.font = "bold 22px sans-serif"; g.fillText(en.label, x + 7, y + 23);
  }
  return new Promise((ok) => cv.toBlob((b) => ok(b), "image/jpeg", 0.85));
}
function cleanEdl(r, p) {
  const [w, h] = ASPECT[p.brief.aspect || "9:16"] || ASPECT["9:16"];
  const shots = (Array.isArray(r?.shots) ? r.shots : []).map((s) => {
    const c = byId.get(String(s?.clip || "").trim()); if (!c) return null;
    let a = +s.in, b = +s.out; if (!isFinite(a) || !isFinite(b)) return null;
    a = clamp(a, 0, c.dur || a); b = clamp(b, a, c.dur || b); if (b - a < 0.3) return null;
    return {clip: c.id, in: r2(a), out: r2(b), speed: clamp(+s.speed || 1, 1, 2), x: clamp(isFinite(+s.x) ? +s.x : 0.5, 0, 1), text: String(s.text || "").slice(0, 90), why: String(s.why || "").slice(0, 140), m: s.m == null ? null : String(s.m)};
  }).filter(Boolean);
  return {title: String(r?.title || "").slice(0, 60), summary: String(r?.summary || "").slice(0, 600), shots, audio: String(r?.audio || "").slice(0, 300),
    questions: (Array.isArray(r?.questions) ? r.questions : []).map(String).filter(Boolean).slice(0, 4), aspect: p.brief.aspect || "9:16", format: {w, h, fps: 30}, length: r2(shots.reduce((a, s) => a + (s.out - s.in) / s.speed, 0))};
}
const compactEdl = (e) => JSON.stringify({title: e.title, summary: e.summary, shots: e.shots.map(({m, clip, in: a, out, speed, x, text, why}) => ({m, clip, in: a, out, speed, x, text, why})), audio: e.audio, questions: []});
async function askClaude(mode, note) {
  const p = draft; if (!p?.id || studio.busy) return;
  const sample = await window.claude?.use?.("sample");
  const msg = (t) => { const el = $("ed-msg"); if (el) el.textContent = t; };
  if (!sample) { await persist(); await window.__requestEdit(p.id, mode, note); drawEdit(); return; }
  await persist();
  const cur = curEdit(), data = editData(p);
  let turns;
  if (mode === "revise" && cur) turns = [{role: "user", content: `${EDIT_RULES}\n\n${data}\n\nMake the edit.`}, {role: "assistant", content: compactEdl(cur.edl)}, {role: "user", content: `The creator watched this version and says: "${note}"\nRevise the edit accordingly. Keep what he didn't mention. Reply with the complete revised JSON in the same format.`}];
  else if (mode === "take" && cur) turns = `${EDIT_RULES}\n\n${data}\n\nAdam already has a version (“${cur.edl.title}”: ${cur.edl.summary}). Make a clearly DIFFERENT take: another opening, order or rhythm.${note ? ` He adds: "${note}"` : ""}`;
  else turns = `${EDIT_RULES}\n\n${data}\n\nMake the edit.`;
  // stills: The creator's moments first, then alternates, as one or two labelled contact sheets
  let images;
  try {
    const lim = await sample.limits().catch(() => null);
    if (lim?.images) {
      const mom = p.items.map((it, i) => ({c: byId.get(it.clip), t: it.a == null ? (byId.get(it.clip)?.dur || 0) / 2 : (it.a + (it.b ?? it.a)) / 2, label: String(i + 1)}));
      const alt = (studio.candList || []).slice(0, 24).map((x, k) => ({c: x.c, t: (x.a + x.b) / 2, label: `A${k + 1}`}));
      images = (await Promise.all([contactSheet(mom), contactSheet(alt)])).filter(Boolean).slice(0, lim.images.maxCount);
    }
  } catch (e) { images = undefined; }
  studio.ctl = new AbortController(); studio.busy = mode === "revise" ? "revise" : cur ? "take" : "first"; studio.live = ""; drawEdit();
  try {
    const hard = $("ed-hard")?.checked;
    const res = await sample.json(turns, {signal: studio.ctl.signal, cache: false, modelTier: hard ? "complex" : "default", ...(images?.length ? {images} : {}),
      onText: ({text}) => { studio.live = `Writing the edit… ${(text.match(/"clip"/g) || []).length} shots so far`; const el = document.querySelector(".thinking .small"); if (el) el.textContent = studio.live; }});
    const edl = cleanEdl(res, p);
    if (!edl.shots.length) throw {code: "no_shots"};
    const v = Math.max(0, ...editsOf(p.id).map((e) => e.v)) + 1;
    await saveEdit({post: p.id, v, edl, by: "claude", mode, request: mode === "first" ? "" : (note || (mode === "take" ? "another take" : "")), tier: hard ? "complex" : "default", created: Date.now()});
    studio.ver = v; studio.draftNote = "";
    if (draft && draft.id === p.id && ["idea", "clips", "", undefined].includes(draft.status)) setPostStatus("edit");
    else if (!draft || draft.id !== p.id) { const sp = store.posts.get(p.id); if (sp && ["idea", "clips"].includes(sp.status)) { const {id, ...b} = sp; await savePost(p.id, {...b, status: "edit"}, true); } }
    toast(`v${v} is ready`);
  } catch (e) {
    const t = {cancelled: "", not_granted: "You didn't allow Claude for this page, so it can't edit here.", sampling_disabled: "Claude isn't available for this account here.",
      rate_limited: "Claude is busy or you've hit a usage limit. Try again in a bit.", invalid_json: "Claude's answer wasn't a usable edit. Try again.", no_shots: "Claude's edit had no usable shots. Try again, or add more moments.",
      refused: "Claude declined this request. Change the brief or note and try again.", prompt_too_large: "Too much for one request. Remove some moments and try again.", session_expired: "Sign in to claude.ai again, then retry."}[e?.code];
    studio.busy = null; if (draft) { drawEdit(); msg(t ?? "Something went wrong talking to Claude. Try again."); }
    return;
  }
  studio.busy = null; if (draft) drawEdit();
}

/* ---------- posts board ---------- */
const BOARD = [["Building", ["idea", "clips"]], ["Editing with Claude", ["edit"]], ["Approved", ["render"]], ["Final ready", ["cut"]], ["Scheduled & posted", ["scheduled", "posted"]]];
function nextStep(p) {
  const items = postItems(p), v = editsOf(p.id);
  if (["idea", "clips"].includes(p.status || "idea")) return items.length >= 2 ? "Ready for Claude to edit" : "Add moments";
  if (p.status === "edit") return v.length ? `Watch v${v.at(-1).v}, revise or approve` : "Ask Claude to edit";
  if (p.status === "render") return "Waiting for the final render";
  if (p.status === "cut") return "Check the final, then schedule";
  if (p.status === "scheduled") return p.scheduled ? `Post on ${fmtShort(p.scheduled)}` : "Pick a post date";
  return p.igUrl ? "Live on Instagram" : "Posted";
}
function renderBoard() {
  const posts = [...store.posts.values()].sort(postOrder);
  $("newpost").disabled = !canSave();
  $("board").innerHTML = BOARD.map(([name, sts]) => {
    const ps = posts.filter((p) => sts.includes(p.status || "idea"));
    return `<div class="col" data-col="${esc(sts[0])}"><div class="col-head"><h3>${name}</h3><span class="muted mono">${ps.length}</span></div>
      ${ps.map((p) => { const items = postItems(p), v = editsOf(p.id), e = (v.find((x) => x.v === p.edit) || v.at(-1))?.edl, first = e?.shots?.[0] || (items[0] && {clip: items[0].clip, in: items[0].a ?? 0, out: items[0].b ?? 1, x: 0.5});
        const c = first && byId.get(first.clip);
        return `<div class="pcard" role="button" tabindex="0" draggable="true" data-id="${esc(p.id)}"><span class="crop cover" style="--r:${cropR(e || {aspect: p.brief?.aspect})};--x:${first?.x ?? 0.5}"><span class="ci" style="${c ? thumbStyle(c, nearestFrame(c, ((first.in || 0) + (first.out || 0)) / 2)) : ""}"></span></span>
          <span style="display:grid;gap:3px;min-width:0"><strong>${esc(p.title || "Untitled")}</strong>
          <span class="muted" style="font-size:12px">${KINDS[p.kind] || "Reel"} · ${esc(postDays(p))} · ${e ? `${edlLen(e).toFixed(0)} s cut · v${v.length}` : `${items.length} moments`}</span>
          <span class="nextstep">${esc(nextStep(p))}</span></span></div>`; }).join("") || `<p class="muted" style="font-size:13px">${name === "Building" ? "Plan posts from the Roadmap, or add a clip's moments to a new post." : "None yet."}</p>`}
    </div>`;
  }).join("");
}

// Free suggestions written in Colab by an open model (catalog/stories.json), matched to the post's place and dates.
function storiesFor(p) {
  const out = [];
  for (const st of DATA.stops || []) {
    const key = `${st.area || st.city}|${st.start.slice(0, 10)}`, story = (DATA.stories || {})[key];
    if (!story) continue;
    const a = st.start.slice(0, 10), b = st.end.slice(0, 10);
    const ids = new Set(stopClips(st).map((c) => c.id));
    if ((p.clips || []).some((id) => ids.has(id)) || (p.place === st.area && p.days && p.days[0] <= b && p.days[1] >= a)) out.push([st, story]);
  }
  return out;
}
function ideasHTML(p) {
  const list = storiesFor(p);
  if (!list.length) return `<p class="muted" style="font-size:13px">Free AI suggestions for hooks and captions appear here once Colab pass 2 has run on this place.</p>`;
  return list.map(([st, s]) => `<div class="ideas"><span class="label">Free AI suggestions · ${esc(st.area || st.city)} · click one to use it</span>
    ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
    ${(s.hooks || []).map((h) => `<button class="use" data-field="hook" data-text="${esc(h)}">Hook: ${esc(h)}</button>`).join("")}
    ${s.caption ? `<button class="use" data-field="caption" data-text="${esc(s.caption)}">Caption: ${esc(s.caption)}</button>` : ""}</div>`).join("");
}
// A finished cut plays here when it is stored with this page (Claude uploads renders as page assets).
function renderEmbed(p) {
  const u = p.renderUrl || "";
  if (/^\/_blob\/|^[^:]+\.(mp4|webm|mov)$/i.test(u)) return `<div style="display:grid;gap:6px"><span class="label">The cut</span><video src="${esc(u)}" controls playsinline preload="metadata" style="width:100%;max-height:70vh;border-radius:8px;background:var(--thumb-bg)"></video></div>`;
  return "";
}

/* ---------------- ROADMAP ---------------- */
function stopClips(s) { return processed.filter((c) => (c.region || c.city) === s.area && c.t >= s.start && c.t <= s.end); }
function postsForStop(s, posts) {
  const ids = new Set(stopClips(s).map((c) => c.id));
  const a = s.start.slice(0, 10), b = s.end.slice(0, 10);
  return posts.filter((p) => (p.clips || []).some((id) => ids.has(id)) || (p.place === s.area && p.days && p.days[0] <= b && p.days[1] >= a));
}
function journeyDays() {
  const end = DATA.summary.last_day && DATA.summary.last_day > JSTART ? DATA.summary.last_day : JSTART;
  const out = [];
  for (let d = JSTART; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
function dayState() {
  const st = new Map();
  for (const c of processed) { if (!c.pre) st.set(c.t.slice(0, 10), Math.max(st.get(c.t.slice(0, 10)) || 0, 1)); }
  for (const p of store.posts.values()) {
    const lvl = p.status === "posted" ? 4 : EDITED.has(p.status) ? 3 : 2;
    const ds = new Set((p.clips || []).map((id) => byId.get(id)?.t?.slice(0, 10)).filter(Boolean));
    if (!ds.size && p.days) for (let d = p.days[0]; d <= p.days[1]; d = addDays(d, 1)) ds.add(d);
    for (const d of ds) st.set(d, Math.max(st.get(d) || 0, lvl));
  }
  return st;
}
const CLS = ["s-none", "s-foot", "s-plan", "s-edit", "s-post"];
function renderRoadmap() {
  const posts = [...store.posts.values()].sort(postOrder);
  const days = journeyDays(), st = dayState();
  const withFoot = days.filter((d) => (st.get(d) || 0) >= 1).length;
  const covered = days.filter((d) => (st.get(d) || 0) >= 2).length;
  const edited = posts.filter((p) => EDITED.has(p.status)).length, posted = posts.filter((p) => p.status === "posted").length;
  $("rm-tiles").innerHTML = [
    ["Journey days", days.length.toLocaleString(), `${withFoot} with processed footage`],
    ["Days in a post", covered.toLocaleString(), withFoot ? `${Math.round((covered / withFoot) * 100)}% of days with footage` : ""],
    ["Posts planned", posts.length.toLocaleString(), `${posts.filter((p) => ["idea", "clips"].includes(p.status || "idea")).length} still need clips`],
    ["Edited", edited.toLocaleString(), `${posts.filter((p) => p.status === "edit").length} being edited with Claude`],
    ["Posted", posted.toLocaleString(), posts.length ? `${posts.length - posted} to go` : "nothing planned yet"],
  ].map(([k, v, s]) => `<div class="tile"><span class="label">${k}</span><b>${v}</b><span class="muted" style="font-size:12px">${s}</span></div>`).join("");

  const colors = {idea: "var(--line)", clips: "var(--muted)", ready: "var(--warn)", cut: "var(--accent-soft)", approved: "var(--accent)", scheduled: "var(--good)", posted: "var(--ink)"};
  const counts = STATUSES.map(([k]) => posts.filter((p) => (p.status || "idea") === k).length);
  $("rm-pipe").innerHTML = posts.length ? STATUSES.map(([k], i) => counts[i] ? `<i style="flex:${counts[i]};background:${colors[k]}" title="${STATUS_NAME[k]}: ${counts[i]}"></i>` : "").join("") : "";
  $("rm-pipe-legend").innerHTML = STATUSES.map(([k, n], i) => `<span><i style="background:${colors[k]}"></i>${n} ${counts[i]}</span>`).join("");

  const months = new Map();
  for (const d of days) { const m = d.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(d); }
  $("rm-months").innerHTML = [...months].map(([m, ds]) => {
    const first = +ds[0].slice(8, 10);
    const cells = Array.from({length: 31}, (_, i) => {
      const d = `${m}-${String(i + 1).padStart(2, "0")}`;
      if (!ds.includes(d)) return `<span class="cell out"></span>`;
      return `<button class="cell ${CLS[st.get(d) || 0]}" data-d="${d}" title="${fmtDay(d)}"></button>`;
    }).join("");
    return `<div class="month"><span class="label">${new Date(m + "-15T12:00").toLocaleDateString(undefined, {month: "short", year: "numeric"})}</span><div class="cells">${cells}</div></div>`;
  }).join("");

  $("rm-stops").innerHTML = (DATA.stops || []).map((s, i) => {
    const ids = new Set(stopClips(s).map((c) => c.id));
    const ps = postsForStop(s, posts);
    const best = [...ids].filter((id) => ["best", "keep"].includes(markOf(id)?.r)).length;
    const state = ps.some((p) => p.status === "posted") ? "Posted" : ps.some((p) => EDITED.has(p.status)) ? "Edited" : ps.length ? "Planned" : "Not planned";
    return `<div class="stoprow${s.before_trip ? " pre" : ""}"><div><strong>${esc(s.area || s.city)}</strong> <span class="muted">${esc(s.country)}${s.before_trip ? " · before the trip" : ""}</span><div class="muted" style="font-size:12px">${fmtShort(s.start)}${s.start.slice(0, 10) !== s.end.slice(0, 10) ? "–" + fmtShort(s.end) : ""} · ${s.clips} clips · ${Math.round(s.seconds / 60)} min · ${best} kept</div></div>
      ${(() => { const st = (DATA.stories || {})[`${s.area || s.city}|${s.start.slice(0, 10)}`]; return st?.summary ? `<p class="muted" style="font-size:13px;grid-column:1/-1;order:3">${esc(st.summary)}</p>` : ""; })()}
      <div class="chips"><span class="chip ${state === "Posted" ? "keep" : state === "Not planned" ? "flag" : ""}">${state}</span>${ps.map((p) => `<span class="chip label">${esc(p.title)}</span>`).join("")}</div>
      ${ps.length ? `<button class="btn quiet" data-open="${esc(ps[0].id)}">Open post</button>` : `<button class="btn ghost" data-stop="${i}" ${canSave() ? "" : "disabled"}>Plan a reel</button>`}</div>`;
  }).join("") || `<p class="muted">Stops appear once clips with GPS are processed.</p>`;

  const rate = Math.max(1, +store.plan.rate || 3);
  const left = posts.filter((p) => p.status !== "posted");
  const start = store.plan.start || new Date().toISOString().slice(0, 10);
  const weeks = left.length / rate;
  $("rm-forecast").innerHTML = left.length
    ? `At <b>${rate} posts a week</b> from ${fmtDay(start)}, the ${left.length} posts not yet live finish around <b>${fmtDay(addDays(start, Math.ceil(weeks * 7)))}</b>. More posts get added as you plan the rest of the journey.`
    : `<span class="muted">Plan some posts to see a finish date.</span>`;
  $("rm-next").innerHTML = left.slice(0, 8).map((p, i) => `<div class="pclip" style="grid-template-columns:96px 1fr auto"><div class="thumb" style="${thumbStyle(byId.get(p.clips?.[0]), coverFrame(byId.get(p.clips?.[0])))}"></div>
    <div><strong>${esc(p.title)}</strong><div class="muted" style="font-size:12px">${KINDS[p.kind] || "Reel"} · ${esc(postDays(p))} · ${STATUS_NAME[p.status] || "Idea"} · post ${p.scheduled ? fmtDay(p.scheduled) : "≈ " + fmtDay(addDays(start, Math.floor((i / rate) * 7)))}</div></div>
    <button class="btn quiet" data-open="${esc(p.id)}">Open</button></div>`).join("");
}
$("rm-months").addEventListener("click", (e) => { const b = e.target.closest(".cell[data-d]"); if (!b) return; $("q").value = b.dataset.d; $("mark").value = ""; location.hash = "#library"; renderLibrary(); });
document.addEventListener("click", (e) => { const b = e.target.closest("[data-open]"); if (b) openPost(b.dataset.open); });
$("rm-stops").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-stop]"); if (!b) return;
  b.disabled = true; await planStop(+b.dataset.stop);
});
async function planStop(i) {
  const s = DATA.stops[i];
  const all = stopClips(s).filter((c) => markOf(c.id)?.r !== "reject");
  let picks = all.filter((c) => ["best", "keep"].includes(markOf(c.id)?.r));
  if (!picks.length) {  // nothing rated yet: suggest the strongest-looking clips, in time order
    picks = all.filter((c) => !isJunk(c)).sort((a, b) => (b.hl || 0) - (a.hl || 0) || (b.motion || 0) - (a.motion || 0)).slice(0, 10)
      .sort((a, b) => a.t.localeCompare(b.t));
  }
  const items = picks.flatMap(itemsFor);
  await savePost(null, {title: `${s.before_trip ? "Before the trip: " : ""}${s.area || s.city}`, kind: "reel", status: items.length ? "clips" : "idea",
    brief: briefDefaults("reel"), items, days: [s.start.slice(0, 10), s.end.slice(0, 10)], place: s.area || s.city, hook: "", caption: "",
    notes: picks.length && !stopClips(s).some((c) => ["best", "keep"].includes(markOf(c.id)?.r)) ? "Clips were suggested automatically. Swap them for your favourites." : ""});
}
$("planall").addEventListener("click", async (e) => {
  if (!canSave()) return;
  e.target.disabled = true;
  const posts = [...store.posts.values()];
  for (let i = 0; i < (DATA.stops || []).length; i++) {
    if (postsForStop(DATA.stops[i], posts).length) continue;
    await planStop(i);
  }
  e.target.disabled = false;
});
$("pl-rate").addEventListener("change", () => { store.plan.rate = Math.max(1, +$("pl-rate").value || 3); savePlan(); renderRoadmap(); });
$("pl-start").addEventListener("change", () => { store.plan.start = $("pl-start").value; savePlan(); renderRoadmap(); });
// (the studio's own close handler saves and clears the draft)

/* ---------------- MAP ---------------- */
const COUNTRY_ALIAS = {"Viet Nam": "Vietnam", "Lao People's Democratic Republic": "Laos", "Korea, Republic of": "South Korea",
  "Taiwan, Province of China": "Taiwan", "Brunei Darussalam": "Brunei", "Russian Federation": "Russia", "Iran, Islamic Republic of": "Iran",
  "Türkiye": "Turkey", "Czechia": "Czechia", "Myanmar": "Myanmar", "Philippines": "Philippines", "Hong Kong": "Hong Kong", "Macao": "Macao"};
const niceCountry = (c) => COUNTRY_ALIAS[c] || c;
const toRad = (x) => x * Math.PI / 180;
function km(a, b) {
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
// The journey as visits: consecutive clips in the same province/prefecture, in time order, at their mean position.
function journeyVisits() {
  const out = [];
  for (const c of processed) {
    if (c.lat == null || !c.country) continue;
    const area = c.region || c.city, last = out[out.length - 1];
    if (last && last.area === area && last.cc === c.cc) {
      last.clips.push(c); last.end = c.t; last.lat += (c.lat - last.lat) / last.clips.length; last.lon += (c.lon - last.lon) / last.clips.length;
    } else out.push({area, country: niceCountry(c.country), cc: c.cc, start: c.t, end: c.t, lat: c.lat, lon: c.lon, clips: [c], pre: !!c.pre});
  }
  return out;
}
function daysBetween(a, b) { return Math.round((new Date(b.slice(0, 10) + "T12:00") - new Date(a.slice(0, 10) + "T12:00")) / 864e5); }
function journeyStats(visits) {
  const trip = visits.filter((v) => !v.pre);
  const legs = [];
  for (let i = 1; i < visits.length; i++) { const d = km(visits[i - 1], visits[i]); legs.push({a: visits[i - 1], b: visits[i], km: d, flight: d > 400, pre: visits[i].pre}); }
  const tripLegs = legs.filter((l) => !l.pre);
  const last = trip.length ? trip[trip.length - 1].end.slice(0, 10) : null;
  const perCountry = new Map();
  if (trip.length) {
    let vi = 0, cur = null;
    for (let d = JSTART; d <= last; d = addDays(d, 1)) {
      while (vi < trip.length && trip[vi].start.slice(0, 10) <= d) { cur = trip[vi].country; vi++; }
      if (cur) perCountry.set(cur, (perCountry.get(cur) || 0) + 1);
    }
  }
  const stays = new Map();  // longest single stay per area
  for (const v of trip) { const days = daysBetween(v.start, v.end) + 1; if (days > (stays.get(v.area)?.days || 0)) stays.set(v.area, {days, v}); }
  const longest = [...stays.values()].sort((a, b) => b.days - a.days)[0];
  return {visits, legs, trip, last, perCountry, longest,
    totalKm: tripLegs.reduce((a, l) => a + l.km, 0), flights: tripLegs.filter((l) => l.flight).length,
    areas: new Set(trip.map((v) => v.area)).size, countries: new Set(trip.map((v) => v.country)).size,
    filmedMin: trip.reduce((a, v) => a + v.clips.reduce((x, c) => x + (c.dur || 0), 0), 0) / 60};
}
/* The map: the whole world down to street level. Pins are frames of the footage, grouped by how close
   they sit on screen, so zooming splits a country into places, places into districts, districts into clips.
   Selecting anything (a pin, a country, a day, a search) fills the side panel with what was filmed there. */
const GEO = JSON.parse(document.getElementById("geo").textContent);
let WORLD = null;
const KCOL = ["--k1", "--k2", "--k3", "--k4", "--k5", "--k6"];
const areaOf = (c) => c.region || c.city;
const dkey = (c) => c.t.slice(0, 10);
const placedAll = processed.filter((c) => c.lat != null && c.lon != null && c.country);
const COUNTRY_ORDER = [...new Set(placedAll.map((c) => niceCountry(c.country)))];
const kc = (country) => `var(${KCOL[Math.max(0, COUNTRY_ORDER.indexOf(country)) % KCOL.length]})`;
const MARK_W = {best: 4, keep: 3, maybe: 1, reject: -5};
const prio = (c) => (MARK_W[markOf(c.id)?.r] || 0) * 1000 + (c.hl || 0) * 100 + (isJunk(c) ? -500 : 0) + (c.speech > 2 ? 30 : 0) + Math.min(c.dur || 0, 300) / 10;
const mins = (cs) => cs.reduce((a, c) => a + (c.dur || 0), 0) / 60;
const fmtMin = (m) => m >= 90 ? `${(m / 60).toFixed(1)} h` : `${Math.max(0, Math.round(m))} min`;
const dayLabel = (d) => d < JSTART ? "Before the trip" : `Day ${daysBetween(JSTART, d) + 1}`;
const yearOf = (d) => d.slice(0, 4);
function rangeLabel(a, b) {
  if (a === b) return fmtDay(a);
  return `${fmtShort(a)}${yearOf(a) !== yearOf(b) ? " " + yearOf(a) : ""} – ${fmtShort(b)} ${yearOf(b)}`;
}
function groupBy(arr, f) { const m = new Map(); for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
const repClip = (cs) => cs.reduce((best, c) => (!best || prio(c) > prio(best) ? c : best), null);
const isKept = (c) => ["best", "keep"].includes(markOf(c.id)?.r);
const isTalk = (c) => c.speech > 2;
const isAction = (c) => (c.motion || 0) >= 1;
const showPre = () => $("mp-pre").checked;
const mapClips = () => placedAll.filter((c) => showPre() || !c.pre);

const M = {built: false, W: 0, H: 0, proj: null, zoom: null, svg: null, geo: null, labG: null, t: null, minK: 1, feats: [], items: [],
  legs: [], tracks: new Map(), sel: null, hot: new Set(), raf: 0, f: {kind: "all", scene: "", junk: false}, more: 24, days: [], dayIdx: new Map(),
  timer: null, grid: [], finder: new Map()};

/* ---------- selection ---------- */
function makeSel(kind, key) {
  const pool = mapClips();
  if (kind === "country") return {kind, key, title: key, clips: pool.filter((c) => niceCountry(c.country) === key)};
  if (kind === "area") { const [cc, a] = key.split("|"); return {kind, key, title: a, cc, clips: pool.filter((c) => c.cc === cc && areaOf(c) === a)}; }
  if (kind === "city") { const [cc, a, ci] = key.split("|"); return {kind, key, title: ci, area: a, cc, clips: pool.filter((c) => c.cc === cc && areaOf(c) === a && c.city === ci)}; }
  if (kind === "day") return {kind, key, title: dayLabel(key), clips: processed.filter((c) => dkey(c) === key && (showPre() || !c.pre))};
  const first = pool[0], last = pool[pool.length - 1];
  return {kind: "journey", key: "", title: first && last && areaOf(first) !== areaOf(last) ? `${areaOf(first)} to ${areaOf(last)}` : "The whole journey", clips: pool};
}
function select(kind, key, opt = {}) {
  M.sel = makeSel(kind, key);
  if (!opt.keepFilter) { M.f = {kind: "all", scene: "", junk: false}; M.more = 24; }
  if (!opt.keepScroll) $("mp-panel").scrollTop = 0;
  renderPanel(); renderCrumbs(); drawStrip(); schedule();
  M.legs.forEach((l) => l.el.classList.toggle("future", kind === "day" && l.start.slice(0, 10) > key));
  if (opt.fly !== false) {
    const maxK = {journey: 2500, country: 900, area: 4000, city: 9000, day: 6000}[M.sel.kind];
    flyTo(M.sel.clips, maxK, opt.dur);
  }
}
function selectFromCluster(ms) {
  const cos = new Set(ms.map((c) => niceCountry(c.country))), areas = new Set(ms.map((c) => c.cc + "|" + areaOf(c))), cities = new Set(ms.map((c) => c.cc + "|" + areaOf(c) + "|" + c.city));
  if (ms.length === 1 && M.t.k > 3000) { openClip(ms[0].id, M.grid.length ? M.grid : ms); return; }
  // clips stacked on one spot (estimated places) only zoom in a few steps; spread ones zoom to fit
  const stacked = new Set(ms.map((c) => `${c.lat},${c.lon}`)).size === 1;
  const maxK = stacked ? Math.min(9000, M.t.k * 4) : 9000;
  if (cities.size === 1 && [...cities][0].split("|")[2] !== [...areas][0].split("|")[1]) select("city", [...cities][0], {fly: false});
  else if (areas.size === 1) select("area", [...areas][0], {fly: false});
  else if (cos.size === 1) select("country", [...cos][0], {fly: false});
  flyTo(ms, stacked ? maxK : cos.size === 1 && areas.size > 1 ? 2500 : maxK);
}

/* ---------- drawing ---------- */
function buildMap() {
  const wrap = $("mp-wrap"), W = wrap.clientWidth, H = wrap.clientHeight;
  if (!W || !H) return false;
  const keepView = M.built && M.t && M.W === W && M.H === H;
  M.W = W; M.H = H;
  const svg = d3.select("#mp-svg").attr("viewBox", `0 0 ${W} ${H}`);
  svg.selectAll("*").remove();
  WORLD = WORLD || topojson.feature(GEO, GEO.objects.countries);
  const feats = WORLD.features.filter((f) => f.properties.name !== "Antarctica");
  // k = 1 shows the whole world across the map's width; up to k = 16384 (a few metres per pixel)
  const proj = d3.geoMercator().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
  const path = d3.geoPath(proj);
  const yTop = proj([0, 84])[1], yBot = proj([0, -60])[1];
  M.minK = Math.max(1, H / (yBot - yTop));
  M.proj = proj;
  const clips = mapClips();
  const visited = new Set(clips.map((c) => niceCountry(c.country)));
  const geo = svg.append("g");
  geo.append("path").attr("class", "graticule").attr("d", path(d3.geoGraticule().step([10, 10]).extent([[-180, -60], [180.01, 84]])()));
  geo.append("g").selectAll("path").data(feats).join("path")
    .attr("class", (f) => "country" + (visited.has(f.properties.name) ? " visited" : "")).attr("d", path)
    .attr("style", (f) => visited.has(f.properties.name) ? `fill:color-mix(in srgb, ${kc(f.properties.name)} 10%, var(--land))` : null)
    .on("click", (e, f) => { if (visited.has(f.properties.name)) select("country", f.properties.name); })
    .append("title").text((f) => f.properties.name);
  M.feats = feats.map((f) => {
    let g = f.geometry;
    if (g && g.type === "MultiPolygon") { let best = null, ba = -1; for (const p of g.coordinates) { const a = d3.geoArea({type: "Polygon", coordinates: p}); if (a > ba) { ba = a; best = p; } } g = {type: "Polygon", coordinates: best}; }
    const c = g ? path.centroid(g) : [NaN, NaN];
    return {name: f.properties.name, x: c[0], y: c[1], area: g ? path.area(g) : 0, visited: visited.has(f.properties.name)};
  }).filter((d) => isFinite(d.x) && isFinite(d.y));
  M.tileG = geo.append("g").attr("class", "tiles").attr("display", "none"); M.tileN = -1;
  buildDetail(geo);
  const trG = geo.append("g").attr("display", $("mp-tracks").checked ? null : "none");
  M.tracks = new Map();
  for (const c of clips) if (c.trk && c.trk.length > 1)
    M.tracks.set(c.id, trG.append("path").attr("class", "track").attr("d", path({type: "MultiLineString", coordinates: cleanTrack(c.trk)})).node());
  // the route between stops: straight overland, a bowed dashed arc for flights
  const visits = journeyVisits().filter((v) => showPre() || !v.pre);
  const legG = geo.append("g");
  M.legs = []; M.legDim = null;
  for (let i = 1; i < visits.length; i++) {
    const a = visits[i - 1], b = visits[i], [x0, y0] = proj([a.lon, a.lat]), [x1, y1] = proj([b.lon, b.lat]);
    const flight = km(a, b) > 400;
    let d = `M${x0},${y0}L${x1},${y1}`;
    if (flight) {
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len; if (ny > 0) { nx = -nx; ny = -ny; }  // bow the arc upwards
      d = `M${x0},${y0}Q${(x0 + x1) / 2 + nx * len * 0.22},${(y0 + y1) / 2 + ny * len * 0.22} ${x1},${y1}`;
    }
    const el = legG.append("path").attr("class", "leg" + (flight ? " flight" : "") + (b.pre ? " pre" : "")).attr("d", d).node();
    M.legs.push({el, start: b.start, flight});
  }
  buildJourneyLayer(geo);
  M.plG = svg.append("g");
  M.labG = svg.append("g");
  M.items = clips.map((c) => { const [px, py] = proj([c.lon, c.lat]); return {c, px, py}; }).sort((a, b) => prio(b.c) - prio(a.c));
  const zoom = d3.zoom().scaleExtent([M.minK, Math.max(16384, 256 * 2 ** 19 / W)]).translateExtent([[0, yTop], [W, yBot]])
    .on("zoom", (e) => { if (e.sourceEvent) hidePicker(); if (e.sourceEvent && J.on && J.playing) pauseJourney(); M.t = e.transform; geo.attr("transform", e.transform); markMoving(); placeMarker(); schedule(); });
  svg.call(zoom);
  M.svg = svg; M.geo = geo; M.zoom = zoom; M.built = true;
  $("mp-in").onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 2);
  $("mp-out").onclick = () => svg.transition().duration(300).call(zoom.scaleBy, 0.5);
  $("mp-fit").onclick = () => select("journey", "");
  $("mp-fs").onclick = () => {
    const w = $("mp-wrap"), native = document.fullscreenElement || document.webkitFullscreenElement;
    if (native || w.classList.contains("pseudo-fs")) { w.classList.remove("pseudo-fs", "is-fs"); if (native) (document.exitFullscreen || document.webkitExitFullscreen).call(document); document.documentElement.style.overflow = ""; $("mp-fs").title = "Full screen"; return; }
    const req = w.requestFullscreen || w.webkitRequestFullscreen;
    const fall = () => { if (document.fullscreenElement || document.webkitFullscreenElement || w.classList.contains("pseudo-fs")) return; w.classList.add("pseudo-fs", "is-fs"); document.documentElement.style.overflow = "hidden"; };
    if (req) { try { Promise.resolve(req.call(w)).catch(fall); } catch (e) { fall(); } setTimeout(fall, 500); }
    else fall();
    $("mp-fs").title = "Exit full screen";
  };
  if (!window.__mapFsBound) {
    window.__mapFsBound = true;
    const sync = () => { const w = $("mp-wrap"), on = !!(document.fullscreenElement || document.webkitFullscreenElement); if (w && !w.classList.contains("pseudo-fs")) w.classList.toggle("is-fs", on); if (!on && w && !w.classList.contains("pseudo-fs")) $("mp-fs").title = "Full screen"; };
    document.addEventListener("fullscreenchange", sync); document.addEventListener("webkitfullscreenchange", sync);
    document.addEventListener("keydown", (e) => { const w = $("mp-wrap"); if (e.key === "Escape" && w && w.classList.contains("pseudo-fs")) $("mp-fs").onclick(); });
  }
  $("mp-world").onclick = () => svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - (W / 2) * M.minK, H / 2 - proj([0, 22])[1] * M.minK).scale(M.minK));
  $("mp-world").onclick = () => svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - (W / 2) * M.minK, H / 2 - proj([0, 22])[1] * M.minK).scale(M.minK));
  if (keepView) svg.call(zoom.transform, M.t);
  else { M.t = d3.zoomIdentity; svg.call(zoom.transform, d3.zoomIdentity.scale(M.minK)); flyTo(M.sel?.clips || clips, 2500, 0); }
  if (J.on) journeyRebuild();
  return true;
}
// GPS glitches show up as jumps of kilometres between samples a few seconds apart: break the line there
function cleanTrack(trk) {
  const parts = [[]];
  for (let i = 0; i < trk.length; i++) {
    const [la, lo] = trk[i];
    if (i && km({lat: trk[i - 1][0], lon: trk[i - 1][1]}, {lat: la, lon: lo}) > 2.5) parts.push([]);
    parts[parts.length - 1].push([lo, la]);
  }
  return parts.filter((p) => p.length > 1);
}
function flyTo(clips, maxK = 4000, dur = 800) {
  const pts = (clips || []).filter((c) => c.lat != null).map((c) => M.proj([c.lon, c.lat]));
  if (!pts.length || !M.zoom) return;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = Math.min(120, M.W * 0.14), padTop = 90, padBot = 60;  // pins stand above their spot
  let k = Math.min(maxK, (M.W - 2 * padX) / Math.max(1e-9, x1 - x0), (M.H - padTop - padBot) / Math.max(1e-9, y1 - y0));
  k = Math.max(M.minK, k);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const t = d3.zoomIdentity.translate(M.W / 2, padTop + (M.H - padTop - padBot) / 2).scale(k).translate(-cx, -cy);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!dur || reduce) M.svg.call(M.zoom.transform, t); else M.svg.transition().duration(dur).call(M.zoom.transform, t);
}
function schedule() { if (!M.raf) M.raf = requestAnimationFrame(() => { M.raf = 0; drawOverlay(); }); }
// pan / zoom / fly in progress: heavy extras (glows, glass blur, loading new street tiles) wait until it settles
function markMoving() {
  const w = $("mp-wrap");
  if (!M.moving) { M.moving = true; w.classList.add("moving"); }
  clearTimeout(M.movT);
  M.movT = setTimeout(() => { M.moving = false; w.classList.remove("moving"); M.tileKey = ""; schedule(); }, 160);
}
function drawOverlay() {
  if (!M.built || !M.t) return;
  const t = M.t, k = t.k, W = M.W, H = M.H;
  // pins: greedy grouping in screen space, best footage first so it becomes the group's cover
  const CW = 82, CH = 66, cells = new Map(), clusters = [];
  updateTiles(t);
  // street map on: the CSS hides the baked detail, place names and country names underneath, so none of that is worked out
  const tilesOn = !!M.tileG && zOf(k) >= TILE_FROM;
  if (!tilesOn) updateDetail(t);
  for (const it of M.items) {
    if (J.on && !J.seen.has(it.c.id)) continue;
    const x = t.applyX(it.px), y = t.applyY(it.py);
    if (x < -100 || x > W + 100 || y < -40 || y > H + 120) continue;
    const gx = Math.floor(x / CW), gy = Math.floor(y / CH);
    let hit = null;
    for (let i = -1; i <= 1 && !hit; i++) for (let j = -1; j <= 1 && !hit; j++) {
      for (const cl of cells.get(`${gx + i},${gy + j}`) || []) if (Math.abs(cl.ax - x) < CW && Math.abs(cl.ay - y) < CH) { hit = cl; break; }
    }
    if (hit) { hit.ms.push(it.c); hit.sx += x; hit.sy += y; }
    else { const cl = {ax: x, ay: y, sx: x, sy: y, ms: [it.c], key: it.c.id}; clusters.push(cl); const ck = `${gx},${gy}`; if (!cells.has(ck)) cells.set(ck, []); cells.get(ck).push(cl); }
  }
  const selIds = M.sel && M.sel.kind !== "journey" ? new Set(M.sel.clips.map((c) => c.id)) : null;
  for (const cl of clusters) {
    cl.x = cl.sx / cl.ms.length; cl.y = cl.sy / cl.ms.length;
    const n = cl.ms.length, rep = cl.ms[0];
    const cities = new Set(cl.ms.map((c) => c.city)), areas = new Set(cl.ms.map(areaOf)), cos = new Set(cl.ms.map((c) => niceCountry(c.country)));
    cl.small = n === 1 && k > 3000;
    cl.name = cl.small ? `${fmtShort(rep.t)} ${rep.t.slice(11, 16)}`
      : cities.size === 1 && rep.city && rep.city !== areaOf(rep) ? rep.city
      : areas.size === 1 ? areaOf(rep)
      : cos.size === 1 ? `${[...cos][0]} · ${areas.size} places` : `${cos.size} countries`;
    cl.pc = kc(niceCountry(rep.country));
    cl.pw = n >= 30 ? 78 : n >= 8 ? 66 : n > 1 ? 58 : cl.small ? 48 : 54;
    cl.sel = selIds ? cl.ms.some((c) => selIds.has(c.id)) : false;
    cl.pre = cl.ms.every((c) => c.pre);
    cl.sig = `${n}|${cl.name}|${rep.id}|${cl.pw}`;
  }
  $("mp-pins").classList.toggle("focus", !!selIds);
  d3.select("#mp-pins").selectAll(".pin").data(clusters, (d) => d.key).join((enter) => enter.append("button").attr("class", "pin"))
    .each(function (d) {
      // only touch the DOM for what changed: style and layout work is what makes a pan or zoom stutter
      if (this._sig !== d.sig) {
        this.innerHTML = `<span class="ph" style="${thumbStyle(d.ms[0], coverFrame(d.ms[0]))}">${d.ms.length > 1 ? `<b>${d.ms.length}</b>` : ""}</span><span class="nm">${esc(d.name)}</span><span class="tl"></span>`;
        this._sig = d.sig;
        this.setAttribute("aria-label", `${d.name}: ${d.ms.length} clip${d.ms.length > 1 ? "s" : ""}`);
      }
      const cls = "pin" + (d.sel ? " sel" : "") + (d.small ? " small" : "") + (d.pre ? " pre" : "") + (d.ms.some((c) => M.hot.has(c.id)) ? " here" : "");
      if (this._cls !== cls) { this.className = cls; this._cls = cls; }
      if (this._pc !== d.pc) { this.style.setProperty("--pc", d.pc); this._pc = d.pc; }
      if (this._pw !== d.pw) { this.style.setProperty("--pw", d.pw + "px"); this._pw = d.pw; }
      const tr = `translate(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px) translate(-50%, -100%)`;
      if (this._tr !== tr) { this.style.transform = tr; this._tr = tr; }
    });
  if (tilesOn) { drawScale(t, k, W, H); return; }
  const boxes = clusters.map((cl) => [cl.x - cl.pw / 2 - 8, cl.y - cl.pw * 0.5625 - 34, cl.x + cl.pw / 2 + 8, cl.y + 14]);
  // country names: visited ones first, then the biggest, skipping any that would collide or that fill the whole view
  const labs = [];  // boxes already holds the pins, so names never sit under one
  const cand = M.feats.filter((d) => (d.visited || d.area * k * k > 7000) && d.area * k * k < W * H * 5)
    .map((d) => ({...d, sx: t.applyX(d.x), sy: t.applyY(d.y)})).filter((d) => d.sx > -60 && d.sx < W + 60 && d.sy > 0 && d.sy < H)
    .sort((a, b) => (b.visited - a.visited) || (b.area - a.area));
  for (const d of cand) {
    const w = d.name.length * (d.visited ? 12 : 6.4) + 10, h = d.visited ? 18 : 14;
    const bx = [d.sx - w / 2, d.sy - h / 2, d.sx + w / 2, d.sy + h / 2];
    if (boxes.some((b) => !(bx[2] < b[0] || bx[0] > b[2] || bx[3] < b[1] || bx[1] > b[3]))) continue;
    boxes.push(bx); labs.push(d); if (labs.length > 70) break;
  }
  M.labG.selectAll("text").data(labs, (d) => d.name).join("text").attr("class", (d) => "clabel" + (d.visited ? " visited" : ""))
    .attr("x", (d) => d.sx).attr("y", (d) => d.sy + 4).text((d) => d.name);
  drawPlaces(t, boxes);
  drawScale(t, k, W, H);
}
function drawScale(t, k, W, H) {
  // scale bar: a round distance about 90 px long at the map's middle latitude
  const lat = M.proj.invert([t.invertX(W / 2), t.invertY(H / 2)])[1];
  const mPerPx = 6371000 * Math.cos(toRad(lat)) / (M.proj.scale() * k);
  const target = mPerPx * 90, pow = 10 ** Math.floor(Math.log10(target)), nice = [1, 2, 5, 10].map((m) => m * pow).filter((v) => v <= target).pop() || pow;
  const w = `${Math.round(nice / mPerPx)}px`, label = nice >= 1000 ? `${(nice / 1000).toLocaleString()} km` : `${nice} m`;
  if (M.scaleW !== w || M.scaleL !== label) {
    M.scaleW = w; M.scaleL = label;
    if (!M.scaleEl) M.scaleEl = [$("mp-scale").querySelector("i"), $("mp-scale").querySelector("span")];
    M.scaleEl[0].style.width = w; M.scaleEl[1].textContent = label;
  }
  const dim = k > 2500;
  if (M.legDim !== dim) { M.legDim = dim; M.legs.forEach((l) => { l.el.style.opacity = !l.flight && dim ? 0.35 : ""; }); }
}
function setHot(ids) {
  for (const id of M.hot) M.tracks.get(id)?.classList.remove("hot");
  M.hot = new Set(ids);
  for (const id of M.hot) { const p = M.tracks.get(id); if (p) { p.classList.add("hot"); p.parentNode.appendChild(p); } }
  document.querySelectorAll("#mp-pins .pin").forEach((el) => { const d = el.__data__; if (d) el.classList.toggle("here", d.ms.some((c) => M.hot.has(c.id))); });
}
function showTip(d, el) {
  const tip = $("mp-tip"), ms = d.ms, ds = ms.map(dkey).sort();
  const rep = ms[0];
  tip.innerHTML = `<div class="thumb" style="${thumbStyle(rep, coverFrame(rep))}"></div><b>${esc(d.small ? (rep.title || rep.city || areaOf(rep)) : d.name)}</b>
    <span>${ms.length} clip${ms.length > 1 ? "s" : ""} · ${fmtMin(mins(ms))} filmed · ${esc(rangeLabel(ds[0], ds[ds.length - 1]))}</span>
    <span>${d.small ? "Click to open the clip" : "Click to see what you filmed here"}</span>`;
  tip.hidden = false;
  const wr = $("mp-wrap").getBoundingClientRect(), r = el.getBoundingClientRect();
  let x = r.left - wr.left + r.width / 2 - 120, y = r.top - wr.top - tip.offsetHeight - 8;
  if (y < 8) y = r.bottom - wr.top + 8;
  tip.style.left = `${Math.max(8, Math.min(M.W - 248, x))}px`; tip.style.top = `${Math.max(8, Math.min(M.H - tip.offsetHeight - 8, y))}px`;
}
$("mp-pins").addEventListener("click", (e) => {
  const el = e.target.closest(".pin"); if (!el?.__data__) return;
  const d = el.__data__, ms = d.ms; $("mp-tip").hidden = true; stopJourney();
  // one clip opens straight away; a handful in one place get a picker; a big spread zooms in as before
  if (ms.length === 1) { openClip(ms[0].id, M.grid.length ? M.grid : ms); return; }
  if (ms.length <= 24 && new Set(ms.map((c) => c.cc + "|" + areaOf(c))).size === 1) { showPicker(d, el); return; }
  hidePicker(); selectFromCluster(ms);
});
// the picker: tap a pin, see its clips as thumbnails, tap one to watch it
function hidePicker() { const b = $("mp-pick"); if (!b.hidden) { b.hidden = true; M.pickList = null; } }
function showPicker(d, el) {
  const box = $("mp-pick"), ms = [...d.ms].sort((a, b) => (a.t < b.t ? -1 : 1)), show = ms.slice(0, 12);
  M.pickList = ms; M.pickPin = d;
  box.innerHTML = `<div class="pk-h"><b>${esc(d.name)}</b><span>${ms.length} clips · ${fmtMin(mins(ms))} filmed</span><button data-act="close" aria-label="Close">×</button></div>
    <div class="pk-g">${show.map((c) => `<button class="pk" data-id="${esc(c.id)}" aria-label="${esc(fmtShort(c.t))} ${esc(c.t.slice(11, 16))}, ${esc(fmtDur(c.dur))}"><span class="ph" style="${thumbStyle(c, coverFrame(c))}"></span><span class="t">${esc(fmtShort(c.t))} · ${esc(c.t.slice(11, 16))}</span><i>${esc(fmtDur(c.dur))}</i></button>`).join("")}</div>
    <div class="pk-f">${ms.length > show.length ? `<span>+${ms.length - show.length} more in the list</span>` : ""}<button data-act="zoom">Zoom in here</button></div>`;
  box.hidden = false;
  const wr = $("mp-wrap").getBoundingClientRect(), r = el.getBoundingClientRect();
  let x = r.left - wr.left + r.width / 2 - box.offsetWidth / 2, y = r.top - wr.top - box.offsetHeight - 10;
  if (y < 8) y = r.bottom - wr.top + 10;
  box.style.left = `${Math.max(8, Math.min(M.W - box.offsetWidth - 8, x))}px`; box.style.top = `${Math.max(8, Math.min(M.H - box.offsetHeight - 8, y))}px`;
  box.querySelector(".pk")?.focus({preventScroll: true});
}
$("mp-pick").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.id) { const list = M.pickList; hidePicker(); openClip(b.dataset.id, list); }
  else if (b.dataset.act === "zoom") { const ms = M.pickList; hidePicker(); selectFromCluster(ms); }
  else hidePicker();
});
$("mp-pick").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); hidePicker(); } });
$("mp-svg").addEventListener("pointerdown", () => hidePicker());
$("mp-pins").addEventListener("mouseover", (e) => { const el = e.target.closest(".pin"); if (el?.__data__) { showTip(el.__data__, el); setHot(el.__data__.ms.map((c) => c.id)); } });
$("mp-pins").addEventListener("mouseout", (e) => { const el = e.target.closest(".pin"); if (el && !el.contains(e.relatedTarget)) { $("mp-tip").hidden = true; setHot([]); } });
// let the wheel zoom the map even when the pointer is over a pin
$("mp-pins").addEventListener("wheel", (e) => { e.preventDefault(); $("mp-svg").dispatchEvent(new WheelEvent("wheel", e)); }, {passive: false});

/* ---------- breadcrumbs + search ---------- */
function renderCrumbs() {
  const s = M.sel, parts = [["journey", "", "World"]];
  const any = s.clips.find((c) => c.lat != null) || s.clips[0];
  if (s.kind === "day") parts.push(["day", s.key, `${s.title} · ${fmtShort(s.key)}`]);
  else if (s.kind !== "journey" && any) {
    parts.push(["country", niceCountry(any.country), niceCountry(any.country)]);
    if (s.kind === "area" || s.kind === "city") parts.push(["area", `${any.cc}|${areaOf(any)}`, areaOf(any)]);
    if (s.kind === "city") parts.push(["city", s.key, s.title]);
  }
  $("mp-crumbs").innerHTML = parts.map(([k, key, label], i) => `${i ? "<i>›</i>" : ""}<button data-k="${k}" data-key="${esc(key)}" aria-current="${i === parts.length - 1}">${esc(label)}</button>`).join("");
}
$("mp-crumbs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { stopJourney(); select(b.dataset.k, b.dataset.key); } });
function buildFinder() {
  M.finder = new Map();
  const cs = mapClips();
  for (const c of cs) {
    const co = niceCountry(c.country);
    M.finder.set(co, ["country", co]);
    M.finder.set(`${areaOf(c)}, ${co}`, ["area", `${c.cc}|${areaOf(c)}`]);
    if (c.city && c.city !== areaOf(c)) M.finder.set(`${c.city}, ${areaOf(c)}`, ["city", `${c.cc}|${areaOf(c)}|${c.city}`]);
  }
  $("mp-places").innerHTML = [...M.finder.keys()].sort().map((k) => `<option value="${esc(k)}"></option>`).join("");
}
function findPlace() {
  const v = $("mp-find").value.trim().toLowerCase(); if (!v) return;
  const hit = [...M.finder].find(([k]) => k.toLowerCase() === v) || [...M.finder].find(([k]) => k.toLowerCase().startsWith(v)) || [...M.finder].find(([k]) => k.toLowerCase().includes(v));
  if (hit) { stopJourney(); select(...hit[1]); $("mp-find").value = ""; $("mp-find").blur(); }
  else toast(`No footage from “${$("mp-find").value.trim()}” yet`, true);
}
$("mp-find").addEventListener("change", findPlace);
$("mp-find").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findPlace(); } });

/* ---------- the side panel ---------- */
function placeRows(groups) {
  return `<div class="plrows">${groups.map((g) => {
    const rep = repClip(g.clips), ds = g.clips.map(dkey).sort();
    return `<button class="plrow${g.pre ? " pre" : ""}" data-sel="${g.kind}|${esc(g.key)}" style="--pc:${kc(niceCountry(rep.country))}">
      <div class="thumb" style="${thumbStyle(rep, coverFrame(rep))}"></div>
      <span style="min-width:0"><strong>${esc(g.label)}</strong><small>${esc(rangeLabel(ds[0], ds[ds.length - 1]))} · ${fmtMin(mins(g.clips))}</small></span>
      <span class="n">${g.clips.length}</span></button>`;
  }).join("")}</div>`;
}
function subGroups(s) {
  const cs = s.clips.filter((c) => c.lat != null && c.country);
  const order = (m) => [...m].sort((a, b) => a[1][0].t.localeCompare(b[1][0].t));
  if (s.kind === "journey") {
    // stops in the order you reached them; a place you went back to shows up again
    const vs = journeyVisits().filter((v) => showPre() || !v.pre);
    return vs.map((v) => ({kind: "area", key: `${v.cc}|${v.area}`, label: `${v.area}, ${v.country}`, clips: v.clips, pre: v.pre}));
  }
  if (s.kind === "country") return order(groupBy(cs, (c) => `${c.cc}|${areaOf(c)}`)).map(([k, v]) => ({kind: "area", key: k, label: k.split("|")[1], clips: v, pre: v.every((c) => c.pre)}));
  if (s.kind === "area" || s.kind === "day") {
    const g = order(groupBy(cs, (c) => `${c.cc}|${areaOf(c)}|${c.city}`));
    if (s.kind === "area" && g.length < 2) return [];
    return g.map(([k, v]) => { const [, a, ci] = k.split("|"); return ci && ci !== a ? {kind: "city", key: k, label: s.kind === "day" ? `${ci}, ${a}` : ci, clips: v} : {kind: "area", key: `${v[0].cc}|${a}`, label: a, clips: v}; });
  }
  return [];
}
function daysHTML(s) {
  const g = [...groupBy(s.clips, dkey)].sort((a, b) => a[0].localeCompare(b[0]));
  if (g.length < 2 && s.kind !== "city") return "";
  const maxM = Math.max(...g.map(([, v]) => mins(v)), 1);
  return `<div class="pn-sec"><div class="label"><span>Day by day</span><span>${g.length} day${g.length > 1 ? "s" : ""} with footage</span></div><div class="cbars">${g.map(([d, v]) => {
    const where = [...new Set(v.map((c) => c.city || areaOf(c)).filter(Boolean))].slice(0, 3).join(", ");
    return `<button class="cbar" data-sel="day|${d}" style="--pc:${kc(niceCountry((v.find((c) => c.country) || {}).country))}"><span>${esc(dayLabel(d))} · ${esc(fmtShort(d))}${s.kind === "city" ? "" : ` <span class="muted">${esc(where)}</span>`}</span><span class="mono">${v.length} · ${fmtMin(mins(v))}</span><span class="track2"><i style="width:${Math.max(3, mins(v) / maxM * 100)}%"></i></span></button>`;
  }).join("")}</div></div>`;
}
function gridList() {
  const s = M.sel, f = M.f;
  return s.clips.filter((c) => {
    if (!f.junk && isJunk(c)) return false;
    if (f.scene && !c.scenes.includes(f.scene)) return false;
    if (f.kind === "kept") return isKept(c);
    if (f.kind === "talk") return isTalk(c);
    if (f.kind === "action") return isAction(c);
    if (markOf(c.id)?.r === "reject" && f.kind !== "all") return false;
    return true;
  });
}
function mclip(c) {
  const m = markOf(c.id)?.r, where = c.city || areaOf(c) || "Place unknown";
  return `<button class="mclip${m === "reject" ? " reject" : ""}" data-clip="${esc(c.id)}"><div class="thumb" style="${thumbStyle(c, coverFrame(c))}">${m === "best" ? `<span class="mk">★</span>` : m === "keep" ? `<span class="mk">Keep</span>` : ""}<span class="dur">${fmtDur(c.dur)}</span></div>
    <div class="b"><strong>${esc(c.title || where + (c.scenes[0] ? " · " + c.scenes[0] : ""))}</strong><small>${esc(dayLabel(dkey(c)))} · ${esc(fmtShort(c.t))} ${c.t.slice(11, 16)}${c.title ? " · " + esc(where) : ""}</small></div></button>`;
}
function renderPanel() {
  const s = M.sel, all = s.clips, el = $("mp-panel");
  if (!all.length) {
    el.innerHTML = `<div class="pn-head"><span class="label">${s.kind === "day" ? esc(fmtDay(s.key)) : "Map"}</span><h3>${esc(s.title)}</h3><p class="muted">No placed footage here yet. Places fill in as Colab processes more clips.</p></div>`;
    return;
  }
  const ds = [...new Set(all.map(dkey))].sort(), first = ds[0], last = ds[ds.length - 1];
  const any = all.find((c) => c.country) || all[0];
  const spanDays = daysBetween(first, last) + 1;
  const eyebrow = {journey: `${COUNTRY_ORDER.length} countr${COUNTRY_ORDER.length === 1 ? "y" : "ies"} · ${new Set(all.map((c) => c.cc + areaOf(c))).size} places`,
    country: "Country", area: `${any.pre ? "Before the trip · " : ""}${niceCountry(any.country || "")}`, city: `${areaOf(any)}, ${niceCountry(any.country || "")}`,
    day: fmtDay(s.key)}[s.kind];
  const dn = (d) => daysBetween(JSTART, d) + 1;
  const sub = s.kind === "day" ? [...new Set(all.map((c) => c.city || areaOf(c)).filter(Boolean))].join(", ") || "Place unknown"
    : `${rangeLabel(first, last)} · ${first >= JSTART ? `Day ${dn(first)}${last !== first ? `–${dn(last)}` : ""}` : last >= JSTART ? `before the trip until Day ${dn(last)}` : "before the trip"}`;
  let nav = "";
  if (s.kind === "day") {
    const fd = M.days.filter((d) => d.n), i = fd.findIndex((d) => d.date === s.key);
    const prev = fd[i - 1], next = fd[i + 1];
    nav = `<div class="row"><button class="btn quiet" data-sel="${prev ? "day|" + prev.date : ""}" ${prev ? "" : "disabled"}>← ${prev ? esc(dayLabel(prev.date)) : "Earlier"}</button><button class="btn quiet" data-sel="${next ? "day|" + next.date : ""}" ${next ? "" : "disabled"}>${next ? esc(dayLabel(next.date)) : "Later"} →</button></div>`;
  }
  const kept = all.filter(isKept), talk = all.filter(isTalk), act = all.filter(isAction), junk = all.filter(isJunk);
  const daysCount = s.kind === "journey" ? spanDays : s.kind === "day" ? 1 : ds.length;
  const top = [...all].filter((c) => !isJunk(c) && markOf(c.id)?.r !== "reject").sort((a, b) => prio(b) - prio(a)).slice(0, 10);
  const scenes = [...groupBy(all.flatMap((c) => c.scenes), (x) => x)].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const list = gridList(); M.grid = list;
  const posts = [...store.posts.values()].filter((p) => (p.clips || []).some((id) => all.some((c) => c.id === id)) || (s.kind !== "journey" && p.place === s.title));
  const groups = subGroups(s);
  const fchip = (k, label, n) => `<button class="chipbtn" data-f="${k}" aria-pressed="${M.f.kind === k}">${label} <em>${n}</em></button>`;
  const watch = DATA.player && list.some((c) => c.drive)
    ? `<a class="btn" href="${esc(playerLink(list, "light"))}" target="gopro-player" rel="noopener">▶ Watch ${list.length === all.length ? "all " : "these "}${list.length} clip${list.length > 1 ? "s" : ""}</a>` : "";
  const countryBars = s.kind === "journey" ? (() => {
    const per = new Map(); for (const d of M.days) if (d.country) per.set(d.country, (per.get(d.country) || 0) + 1);
    const max = Math.max(1, ...per.values());
    return `<div class="pn-sec"><div class="label"><span>Days in each country</span><span>incl. days without footage</span></div><div class="cbars">${[...per].sort((a, b) => b[1] - a[1]).map(([c, n]) =>
      `<button class="cbar" data-sel="country|${esc(c)}" style="--pc:${kc(c)}"><span>${esc(c)}</span><span class="mono">${n} day${n === 1 ? "" : "s"}</span><span class="track2"><i style="width:${n / max * 100}%"></i></span></button>`).join("")}</div></div>`;
  })() : "";
  el.innerHTML = `
    <div class="pn-head">
      ${s.kind !== "journey" ? `<button class="back" data-act="back">← ${s.kind === "city" ? esc(areaOf(any)) : s.kind === "area" ? esc(niceCountry(any.country || "")) : "Whole journey"}</button>` : ""}
      <span class="label">${esc(eyebrow)}</span>
      <h3>${esc(s.kind === "day" ? `${s.title} · ${fmtShort(s.key)}` : s.title)}</h3>
      <p class="pn-sub">${esc(sub)}</p>
    </div>
    ${nav}
    <div class="pn-stats">
      <div><b>${daysCount}</b><span>day${daysCount === 1 ? "" : "s"}</span></div>
      <div><b>${all.length}</b><span>clips</span></div>
      <div><b>${fmtMin(mins(all))}</b><span>filmed</span></div>
      <div><b>${kept.length}</b><span>kept</span></div>
    </div>
    ${top.length ? `${playerHTML("mp-player")}` : ""}
    <div class="row">${watch}<button class="btn ${watch ? "quiet" : ""}" data-act="post">New post from here</button><button class="btn quiet" data-act="library">Open in Library</button></div>
    ${countryBars}
    ${groups.length ? `<div class="pn-sec"><div class="label"><span>${s.kind === "journey" ? "Stops, in order" : s.kind === "country" ? "Places" : s.kind === "day" ? "Where you were" : "Districts"}</span><span>clips</span></div>${placeRows(groups)}</div>` : ""}
    ${s.kind !== "journey" && s.kind !== "day" ? daysHTML(s) : ""}
    ${scenes.length ? `<div class="pn-sec"><span class="label">What you filmed</span><div class="chips" style="gap:6px">${scenes.map(([k, n]) => `<button class="chipbtn" data-scene="${esc(k)}" aria-pressed="${M.f.scene === k}">${esc(k)} <em>${n}</em></button>`).join("")}</div></div>` : ""}
    <div class="pn-sec">
      <div class="label"><span>Clips</span><span>${list.length} shown</span></div>
      <div class="chips" style="gap:6px">${fchip("all", "All", all.length - (M.f.junk ? 0 : junk.length))}${fchip("kept", "★ Kept", kept.length)}${fchip("talk", "Talking", talk.length)}${fchip("action", "Action", act.length)}
        ${junk.length ? `<button class="chipbtn" data-act="junk" aria-pressed="${M.f.junk}">Short / dark <em>${junk.length}</em></button>` : ""}</div>
      ${list.length ? `<div class="mgrid">${list.slice(0, M.more).map(mclip).join("")}</div>` : `<p class="muted" style="font-size:13px">${M.f.kind === "kept" ? "Nothing marked Best or Keep here yet. Rate clips in Review or in any clip window." : "No clips match."}</p>`}
      ${list.length > M.more ? `<button class="btn quiet more" data-act="more">Show ${Math.min(48, list.length - M.more)} more</button>` : ""}
    </div>
    ${posts.length ? `<div class="pn-sec"><span class="label">Posts with footage from here</span><div class="chips">${posts.map((p) => `<span class="chip label">${esc(p.title)} · ${STATUS_NAME[p.status] || "Idea"}</span>`).join("")}</div></div>` : ""}`;
  if (top.length) wirePlayer("mp-player", top.flatMap((c) => [0, 2, 4, 6].filter((k) => k < (c.sp?.[2] || 0)).map((k) => ({c, k, label: `${c.city || areaOf(c) || ""} · ${fmtShort(c.t)} ${c.t.slice(11, 16)}`}))), false);
}
$("mp-panel").addEventListener("click", (e) => {
  const t = e.target.closest("[data-sel],[data-clip],[data-f],[data-scene],[data-act]"); if (!t) return;
  if (t.dataset.clip) return openClip(t.dataset.clip, M.grid);
  if (t.dataset.sel) { const [k, ...rest] = t.dataset.sel.split("|"); if (k) { stopJourney(); select(k, rest.join("|")); } return; }
  if (t.dataset.f) { M.f.kind = t.dataset.f; M.more = 24; return renderPanel(); }
  if (t.dataset.scene != null) { M.f.scene = M.f.scene === t.dataset.scene ? "" : t.dataset.scene; M.more = 24; return renderPanel(); }
  const a = t.dataset.act, s = M.sel;
  if (a === "more") { M.more += 48; return renderPanel(); }
  if (a === "junk") { M.f.junk = !M.f.junk; return renderPanel(); }
  if (a === "back") {
    const any = s.clips.find((c) => c.country) || s.clips[0];
    if (s.kind === "city") return select("area", `${any.cc}|${areaOf(any)}`);
    if (s.kind === "area") return select("country", niceCountry(any.country));
    return select("journey", "");
  }
  if (a === "library") {
    $("q").value = s.kind === "city" || s.kind === "area" ? s.title : s.kind === "day" ? s.key : "";
    $("country").value = s.kind === "country" ? (s.clips[0]?.country || "") : "";
    $("mark").value = ""; location.hash = "#library"; renderLibrary(); return;
  }
  if (a === "post") {
    let picks = s.clips.filter(isKept);
    if (!picks.length) picks = [...s.clips].filter((c) => !isJunk(c) && markOf(c.id)?.r !== "reject").sort((x, y) => prio(y) - prio(x)).slice(0, 12);
    picks.sort((x, y) => x.t.localeCompare(y.t));
    const ds = picks.map(dkey);
    const place = s.kind === "day" ? (picks[0] && (picks[0].city || areaOf(picks[0]))) || "" : s.kind === "journey" ? "" : s.title;
    openPost(null, {clips: picks.map((c) => c.id), days: ds.length ? [ds[0], ds[ds.length - 1]] : undefined, place,
      title: `${place || "Journey"} · ${ds.length ? fmtShort(ds[0]) : ""}`});
  }
});
$("mp-panel").addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-clip],[data-sel]");
  if (!t || t === M.hoverEl) return;  // the same card again: nothing to redo
  M.hoverEl = t;
  if (t.dataset.clip) return setHot([t.dataset.clip]);
  const [k, ...rest] = t.dataset.sel.split("|"); if (k) setHot(makeSel(k, rest.join("|")).clips.map((c) => c.id));
});
$("mp-panel").addEventListener("mouseleave", () => { M.hoverEl = null; setHot([]); });

/* ---------- the day strip ---------- */
function buildDays() {
  const cs = processed.filter((c) => showPre() || !c.pre);
  const placed = mapClips();
  if (!placed.length) { M.days = []; return; }
  const pd = placed.map(dkey).sort();
  const start = showPre() ? (pd[0] < JSTART ? pd[0] : JSTART) : JSTART;
  const end = pd[pd.length - 1] > start ? pd[pd.length - 1] : start;
  const byDay = groupBy(cs.filter((c) => dkey(c) >= start && dkey(c) <= end), dkey);
  M.days = []; M.dayIdx = new Map();
  let cur = null;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const v = byDay.get(d) || [];
    const per = new Map(); for (const c of v) if (c.country) per.set(niceCountry(c.country), (per.get(niceCountry(c.country)) || 0) + (c.dur || 1));
    if (per.size) cur = [...per].sort((a, b) => b[1] - a[1])[0][0];
    M.dayIdx.set(d, M.days.length);
    M.days.push({date: d, n: v.length, min: mins(v), country: cur, clips: v});
  }
}
function drawStrip() {
  const box = $("mp-strip");
  if (!M.days.length) { box.innerHTML = `<p class="muted" style="font-size:13px">The timeline fills in once clips have GPS places.</p>`; return; }
  const n = M.days.length, W = Math.max(560, box.clientWidth || 800), H = 92, top = 6, base = 62, bw = W / n;
  const maxM = Math.max(1, ...M.days.map((d) => d.min));
  const selDays = M.sel ? new Set(M.sel.clips.map(dkey)) : new Set();
  const showSel = M.sel && M.sel.kind !== "journey";
  let s = "";
  M.days.forEach((d, i) => {
    const x = i * bw, w = Math.max(1, bw - (bw > 4 ? 1 : 0));
    if (showSel && selDays.has(d.date)) s += `<rect class="selband" x="${x}" y="0" width="${Math.max(w, 2)}" height="${base + 2}"/>`;
    const col = d.country ? kc(d.country) : "var(--muted)";
    if (d.n) { const h = 4 + Math.sqrt(d.min / maxM) * (base - top - 4); s += `<rect class="dbar" x="${x}" y="${base - h}" width="${w}" height="${h}" style="fill:${col}${d.date < JSTART ? ";fill-opacity:.55" : ""}"/>`; }
    else s += `<rect class="dbar" x="${x}" y="${base - 2}" width="${w}" height="2" style="fill:${col};fill-opacity:.3"/>`;
  });
  // month ticks, the trip's Day 1, and today's position while playing
  let lastLabel = -999;
  M.days.forEach((d, i) => {
    const x = i * bw;
    if (d.date === JSTART) s += `<rect class="cursor" x="${x}" y="${base + 1}" width="1.5" height="12"/><text class="axis" x="${x + 4}" y="${base + 12}" style="fill:var(--ink)">Day 1</text>`;
    if (d.date.slice(8) === "01" || i === 0) {
      s += `<line class="tick" x1="${x}" x2="${x}" y1="${base + 16}" y2="${H - 2}"/>`;
      if (x - lastLabel > 60) {
        s += `<text class="axis" x="${x + 4}" y="${H - 6}">${new Date(d.date + "T12:00").toLocaleDateString(undefined, {month: "short", year: d.date.slice(5, 7) === "01" || i === 0 ? "numeric" : undefined})}</text>`; lastLabel = x;
      }
    }
  });
  if (M.sel?.kind === "day" && M.dayIdx.has(M.sel.key)) { const x = M.dayIdx.get(M.sel.key) * bw; s += `<rect class="cursor" x="${x + Math.max(1, bw) / 2 - 1}" y="0" width="2" height="${base + 2}"/>`; }
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Footage per day, coloured by country"><rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/><rect class="hoverband" id="mp-hb" x="-10" y="0" width="${Math.max(bw, 2)}" height="${base + 2}"/>${s}</svg>`;
  M.stripBW = bw;
}
const stripDay = (e) => { const svg = $("mp-strip").querySelector("svg"); if (!svg || !M.days.length) return null; const r = svg.getBoundingClientRect(); const i = Math.floor((e.clientX - r.left) / (r.width / M.days.length)); return M.days[Math.max(0, Math.min(M.days.length - 1, i))]; };
function nowHTML(d) {
  if (!d) { const sd = M.sel?.kind === "day" && M.days[M.dayIdx.get(M.sel.key)]; return sd ? nowHTML(sd) : `<b>Every day of the trip</b><span>Tap a day to see where you were and what you filmed</span>`; }
  const where = [...new Set(d.clips.map((c) => c.city || areaOf(c)).filter(Boolean))].slice(0, 3).join(", ");
  return `<b>${esc(dayLabel(d.date))} · ${esc(fmtDay(d.date))}</b><span>${d.n ? `${esc(where || d.country || "Place unknown")} · ${d.n} clip${d.n > 1 ? "s" : ""} · ${fmtMin(d.min)}` : `No footage${d.country ? ` · in ${esc(d.country)}` : ""}`}</span>`;
}
$("mp-strip").addEventListener("mousemove", (e) => { const d = stripDay(e); if (!d) return; const hb = $("mp-hb"); if (hb) hb.setAttribute("x", M.dayIdx.get(d.date) * M.stripBW); $("mp-now").innerHTML = nowHTML(d); });
$("mp-strip").addEventListener("mouseleave", () => { const hb = $("mp-hb"); if (hb) hb.setAttribute("x", -10); $("mp-now").innerHTML = nowHTML(null); });
$("mp-strip").addEventListener("click", (e) => {
  const d = stripDay(e); if (!d) return;
  if (J.on && d.n && journeySeek(d.date)) return;
  stopJourney();
  if (d.n) { select("day", d.date); $("mp-now").innerHTML = nowHTML(d); }
  else toast(`No footage on ${fmtShort(d.date)}${d.country ? ` (you were in ${d.country})` : ""}`);
});

/* ---------- city names + street detail (baked in: the page can't load outside map tiles) ---------- */
const MAPX = (() => { try { return JSON.parse(document.getElementById("mapx").textContent); } catch { return {cities: [], regions: []}; } })();
const zOf = (k) => Math.log2(k * (M.W || 1000) / 256);
function decodeLine(a) { const o = []; let x = 0, y = 0; for (let i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; o.push([x / 1e5, y / 1e5]); } return o; }
function lineD(a) { let s = "", first = true; for (const p of decodeLine(a)) { const q = M.proj(p); s += `${first ? "M" : "L"}${q[0].toFixed(3)},${q[1].toFixed(3)}`; first = false; } return s; }
const polyD = (rings) => rings.map((r) => lineD(r) + "Z").join("");
function buildDetail(geo) {
  M.detail = []; M.dtKey = "";
  // sharp country outlines: drawn only while the whole view fits inside their window, so no edge ever shows
  M.hi = [];
  const hiD = (rings) => rings.map((r) => { let x = 0, y = 0, s = ""; for (let i = 0; i < r.length; i += 2) { x += r[i]; y += r[i + 1]; const q = M.proj([x / 1e3, y / 1e3]); s += `${i ? "L" : "M"}${q[0].toFixed(3)},${q[1].toFixed(3)}`; } return s + "Z"; }).join("");
  const seenCo = new Set(placedAll.filter((c) => showPre() || !c.pre).map((c) => niceCountry(c.country)));
  for (const r of MAPX.regions) {
    if (!r.hi) continue;
    const [x0, y0, x1, y1] = r.hi.w, a = M.proj([x0, y1]), b = M.proj([x1, y0]);
    const g = geo.append("g").attr("class", "hi").attr("display", "none");
    g.append("rect").attr("class", "hi-sea").attr("x", a[0]).attr("y", a[1]).attr("width", b[0] - a[0]).attr("height", b[1] - a[1]);
    for (const [name, polys] of r.hi.c) {
      const el = g.append("path").attr("class", "hi-c").attr("d", polys.map(hiD).join(""));
      if (seenCo.has(name)) el.attr("style", `fill:color-mix(in srgb, ${kc(name)} 10%, var(--land))`);
    }
    M.hi.push({g: g.node(), a, b, on: false});
  }
  for (const r of MAPX.regions) {
    const g = geo.append("g").attr("class", "dt").attr("display", "none");
    const add = (cls, d) => { if (d) g.append("path").attr("class", cls).attr("d", d); };
    const near = placedAll.find((c) => c.lon >= r.b[0] && c.lon <= r.b[2] && c.lat >= r.b[1] && c.lat <= r.b[3]);
    if (r.land.length) { const el = g.append("path").attr("class", "dt-land").attr("d", r.land.map(polyD).join("")); if (near) el.attr("style", `fill:color-mix(in srgb, ${kc(niceCountry(near.country))} 10%, var(--land))`); }
    add("dt-sea", r.sea.map(polyD).join(""));
    const layers = {green: g.append("path").attr("class", "dt-green").attr("d", r.green.map(polyD).join("")).node()};
    add("dt-beach", r.beach.map(polyD).join(""));
    add("dt-water", r.water.map(polyD).join(""));
    layers.canal = g.append("path").attr("class", "dt-canal").attr("d", r.canal.map(lineD).join("")).node();
    add("dt-river", r.river.map(lineD).join(""));
    layers.roads = [4, 3, 2, 1, 0].map((cl) => [cl, g.append("path").attr("class", `dt-rd dt-rd${cl}`).attr("d", r.roads[cl].map(lineD).join("")).node()]);
    layers.rail = g.append("path").attr("class", "dt-rail").attr("d", r.rail.map(lineD).join("")).node();
    M.detail.push({r, g: g.node(), layers, box: [M.proj([r.b[0], r.b[3]]), M.proj([r.b[2], r.b[1]])]});
  }
  if (!M.cityPts) M.cityPts = MAPX.cities.map((c) => ({n: c[0], lon: c[1], lat: c[2], z: c[3], cap: c[4]}));
  for (const c of M.cityPts) [c.px, c.py] = M.proj([c.lon, c.lat]);
  M.dtLabels = MAPX.regions.map((r) => r.labels.map((l) => { const [px, py] = M.proj([l[1], l[2]]); return {n: l[0], px, py, kind: l[3], z: l[4], a: l[5]}; }));
}
// Street-level basemap: once you zoom in past what the bundled outlines can show, real OpenStreetMap tiles fade in underneath so every pin sits on a recognisable street, river or district.
const TILE_FROM = 6.5;
const darkNow = () => { const th = document.documentElement.dataset.theme; return th === "dark" || (th !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); };
function updateTiles(t) {
  if (!M.tileG) return;
  const host = $("mp-svg"), z = zOf(t.k), W = M.W, H = M.H, on = z >= TILE_FROM;
  host.classList.toggle("tiles-on", on); host.classList.toggle("z-far", z < 7);
  host.classList.toggle("tiles-deep", z >= 9 && !M.tileErr);  // (a failed tile keeps the world outlines as a fallback)
  const at = $("mp-attr"); if (at) at.hidden = !on;
  M.tileG.attr("display", on ? null : "none");
  if (!on) return;
  const hi = (window.devicePixelRatio || 1) > 1, n = Math.min(19, Math.max(0, Math.round(z + (hi ? 0.7 : 0.3)))), N = 2 ** n, S = W / N, y0 = H / 2 - W / 2;
  const style = "osm"; host.classList.toggle("tiles-dark", darkNow());
  const i0 = Math.max(0, Math.floor(t.invertX(0) / S)), i1 = Math.min(N - 1, Math.floor(t.invertX(W) / S));
  const j0 = Math.max(0, Math.floor((t.invertY(0) - y0) / S)), j1 = Math.min(N - 1, Math.floor((t.invertY(H) - y0) / S));
  // same tiles as the last frame: nothing to add or remove. While the map is moving, look for new tiles at most every 150 ms (a long fly would otherwise ask for every zoom level on the way).
  const tk = `${n}|${i0}|${i1}|${j0}|${j1}`;
  if (tk === M.tileKey) return;
  const nowMs = performance.now();
  if (M.moving && nowMs - (M.tileAt || 0) < 150) return;
  M.tileKey = tk; M.tileAt = nowMs;
  const want = [];
  for (let j = j0; j <= j1 && want.length < 96; j++) for (let i = i0; i <= i1 && want.length < 96; i++) want.push({i, j, n, key: `${style}/${n}/${i}/${j}`, url: `https://tile.openstreetmap.org/${n}/${i}/${j}.png`});
  const have = new Set(M.tileG.selectAll("image").data().map((d) => d.key));
  const fresh = want.filter((d) => !have.has(d.key));
  if (fresh.length) M.tileG.selectAll("image.new").data(fresh, (d) => d.key).enter().append("image").attr("class", "tile").datum((d) => d)
    .on("error", () => { M.tileErr = true; $("mp-svg").classList.remove("tiles-deep"); }).attr("href", (d) => d.url).attr("x", (d) => d.i * S).attr("y", (d) => y0 + d.j * S).attr("width", S).attr("height", S).attr("preserveAspectRatio", "none").attr("decoding", "async");
  // keep the previous zoom level's tiles under the new ones until they have loaded, then drop them (and anything far off screen)
  if (M.tileN !== n) { M.tileN = n; clearTimeout(M.tileT); M.tileT = setTimeout(() => M.tileG.selectAll("image").filter((d) => d.n !== M.tileN).remove(), 900); }
  const keep = new Set(want.map((d) => d.key));
  M.tileG.selectAll("image").filter((d) => d.n === n && !keep.has(d.key)).remove();
}
function updateDetail(t) {
  const z = zOf(t.k), W = M.W, H = M.H;
  const mPerPx = 2 * Math.PI * 6371000 * Math.cos(toRad(M.proj.invert([t.invertX(W / 2), t.invertY(H / 2)])[1])) / (W * t.k);
  const host = $("mp-svg");
  host.style.setProperty("--rs", Math.max(.5, Math.min(3.4, 2 ** ((z - 14) / 2))).toFixed(2));
  host.style.setProperty("--rv", `${Math.max(1.6, 380 / mPerPx).toFixed(1)}px`);
  host.style.setProperty("--cv", `${Math.max(.8, 22 / mPerPx).toFixed(1)}px`);
  const vx0 = t.invertX(0), vx1 = t.invertX(W), vy0 = t.invertY(0), vy1 = t.invertY(H);
  const active = (M.hi || []).find((h) => vx0 >= h.a[0] && vx1 <= h.b[0] && vy0 >= h.a[1] && vy1 <= h.b[1]);
  for (const h of M.hi || []) { const on = h === active; if (on !== h.on) { h.on = on; h.g.setAttribute("display", on ? "inline" : "none"); } }
  const key = Math.floor(z * 2);
  for (const d of M.detail || []) {
    const x0 = t.applyX(d.box[0][0]), y0 = t.applyY(d.box[0][1]), x1 = t.applyX(d.box[1][0]), y1 = t.applyY(d.box[1][1]);
    const on = z >= 8.6 && x1 > 0 && x0 < W && y1 > 0 && y0 < H;
    if (on === d.on && key === d.key) continue;
    d.on = on; d.key = key;
    d.g.setAttribute("display", on ? "inline" : "none");
    if (!on) continue;
    const vis = (el, zmin) => el.setAttribute("display", z >= zmin ? "inline" : "none");
    vis(d.layers.green, 10); vis(d.layers.canal, 12); vis(d.layers.rail, 10.5);
    for (const [cl, el] of d.layers.roads) vis(el, [9, 10, 11, 12.2, 13.2][cl]);
  }
}
const PLACE_CLS = {place: "pl-place", road: "pl-road", water: "pl-water", park: "pl-park", station: "pl-poi", poi: "pl-poi", air: "pl-poi"};
function drawPlaces(t, boxes) {
  const z = zOf(t.k), W = M.W, H = M.H, out = [], names = new Set(), LIMIT = W < 560 ? 34 : 86;
  const hit = (b) => boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]));
  const tryAdd = (d, cls, size, dot) => {
    const key = d.n.toLowerCase();
    if (names.has(key) || out.length >= LIMIT) return;
    const x = t.applyX(d.px), y = t.applyY(d.py);
    if (x < 6 || x > W - 6 || y < 8 || y > H - 8) return;
    const w = d.n.length * size * .56 + (dot ? 10 : 4), h = size + 4;
    let b;
    if (d.a) { const r = Math.abs(toRad(d.a)), bw = Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * h, bh = Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * h; b = [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2]; }
    else b = dot ? [x - 5, y - h / 2, x + w, y + h / 2] : [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
    if (hit(b)) return;
    boxes.push(b); names.add(key);
    out.push({key: `${cls}|${d.n}`, n: d.n, x, y, a: d.a || 0, cls, dot, lon: d.lon});
  };
  // towns from OSM first where there is street detail, then world cities by importance
  const regionOn = (M.detail || []).map((d) => d.on);
  if (z >= 8.6) M.dtLabels.forEach((ls, i) => { if (!regionOn[i]) return; for (const l of ls) { if (l.z > z) break; if (l.kind === "place" || l.kind === "air") tryAdd(l, PLACE_CLS[l.kind], l.z < 11 ? 13 : 12, l.kind === "air"); } });
  for (const c of M.cityPts || []) {
    if (c.z > z + .6) break;
    tryAdd(c, c.cap ? "pl-cap" : c.z <= z - 2 ? "pl-city big" : "pl-city", c.cap ? 13 : 12, true);
  }
  if (z >= 10.5) M.dtLabels.forEach((ls, i) => { if (!regionOn[i]) return; for (const l of ls) { if (l.z > z) break; if (l.kind !== "place" && l.kind !== "air") tryAdd(l, PLACE_CLS[l.kind], l.kind === "road" ? 10.5 : 11, l.kind === "station" || l.kind === "poi"); } });
  const sel = M.plG.selectAll("g").data(out, (d) => d.key).join((en) => {
    const g = en.append("g"); g.append("rect"); g.append("text"); return g;
  });
  sel.attr("class", (d) => `pl ${d.cls}`).attr("transform", (d) => `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})${d.a ? ` rotate(${d.a})` : ""}`);
  sel.select("rect").attr("display", (d) => d.dot ? null : "none").attr("x", -2.5).attr("y", -2.5).attr("width", 5).attr("height", 5);
  sel.select("text").attr("x", (d) => d.dot ? 7 : 0).attr("y", 4).attr("text-anchor", (d) => d.dot ? "start" : "middle").text((d) => d.n);
}

/* ---------- play the journey: the route draws itself, a plane flies between countries, each clip replays ---------- */
const J = {on: false, playing: false, segs: [], i: 0, t: 0, speed: 1, raf: 0, last: 0, seen: new Set(), done: [], hops: [], flights: [], day: "", from: null, doneG: null, hopG: null, live: null};
function buildJourneyLayer(geo) {
  const g = geo.append("g");
  J.hopG = g.append("path").attr("class", "jr-hop").node();
  J.flyG = g.append("path").attr("class", "jr-live flight").node();
  J.doneG = g.append("path").attr("class", "jr-done").node();
  J.live = g.append("path").attr("class", "jr-live").node();
}
const lerpPt = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
function fitView(pts, maxK = 256 * 2 ** 14.8 / M.W) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const padX = Math.min(120, M.W * .16), padTop = 96, padBot = 112;
  const k = Math.max(M.minK, Math.min(maxK, (M.W - 2 * padX) / Math.max(1e-9, x1 - x0), (M.H - padTop - padBot) / Math.max(1e-9, y1 - y0)));
  // the frame is centred slightly high so the card at the bottom never covers the action
  return {cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + (padBot - padTop) / 2 / k, k};
}
const applyView = (v) => M.svg.call(M.zoom.transform, d3.zoomIdentity.translate(M.W / 2, M.H / 2).scale(v.k).translate(-v.cx, -v.cy));
function clipPath(c) {
  const home = {lat: c.lat, lon: c.lon};
  const parts = c.trk && c.trk.length > 1 ? cleanTrack(c.trk).filter((p) => km(home, {lat: p[0][1], lon: p[0][0]}) < 6) : [];
  const pts = parts.flat().map((p) => M.proj(p));
  return pts.length > 1 ? pts : [M.proj([c.lon, c.lat])];
}
function buildJourney() {
  const placed = mapClips().slice().sort((a, b) => a.t.localeCompare(b.t));
  const scale = Math.min(1, 300000 / Math.max(1, placed.length * 1500));  // long trips stay watchable: 5 minutes at most at 1×
  // a stretch = one day in one part of the world, so a day with a flight in it becomes two camera moves
  const byDay = [];
  for (const c of placed) {
    const cur = byDay[byDay.length - 1];
    if (cur && cur[0] === dkey(c) && km(cur[1][cur[1].length - 1], c) <= 400) cur[1].push(c);
    else byDay.push([dkey(c), [c]]);
  }
  const segs = [];
  let prev = null, prevC = null;
  for (const [day, cs] of byDay) {
    const paths = cs.map(clipPath);
    const view = fitView(paths.flat());
    const start = paths[0][0], c0 = cs[0];
    if (prev) {
      const dist = km(prevC, c0), flight = dist > 400;
      let ctrl = null;
      if (flight) {
        const dx = start[0] - prev[0], dy = start[1] - prev[1], len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len, ny = dx / len; if (ny > 0) { nx = -nx; ny = -ny; }
        ctrl = [(prev[0] + start[0]) / 2 + nx * len * .22, (prev[1] + start[1]) / 2 + ny * len * .22];
      }
      segs.push({type: "move", a: prev, b: start, ctrl, flight, view, day, c: c0, km: dist, dur: flight ? 5200 : Math.max(1100, Math.min(2200, 900 + dist * 20)) * Math.max(.6, scale)});
    } else segs.push({type: "move", a: start, b: start, view, day, c: c0, km: 0, dur: 1400});
    cs.forEach((c, n) => {
      const pts = paths[n];
      if (n) {
        const a = paths[n - 1][paths[n - 1].length - 1];
        if (Math.hypot(pts[0][0] - a[0], pts[0][1] - a[1]) > 1e-7) segs.push({type: "hop", a, b: pts[0], day, c, dur: 320 * Math.max(.6, scale)});
      }
      const lens = [0]; for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      segs.push({type: "clip", pts, lens, day, c, dur: Math.max(650, Math.min(2300, 700 + pts.length * 26)) * Math.max(.55, scale)});
    });
    const last = paths[paths.length - 1]; prev = last[last.length - 1]; prevC = cs[cs.length - 1];
  }
  J.segs = segs;
}
const segPoint = (s, u) => {
  if (s.type === "clip") {
    if (s.pts.length < 2) return s.pts[0];
    const L = s.lens[s.lens.length - 1] * u; let i = d3.bisectLeft(s.lens, L); i = Math.max(1, Math.min(s.pts.length - 1, i));
    const span = s.lens[i] - s.lens[i - 1] || 1;
    return lerpPt(s.pts[i - 1], s.pts[i], (L - s.lens[i - 1]) / span);
  }
  if (s.ctrl) { const v = 1 - u; return [v * v * s.a[0] + 2 * v * u * s.ctrl[0] + u * u * s.b[0], v * v * s.a[1] + 2 * v * u * s.ctrl[1] + u * u * s.b[1]]; }
  return lerpPt(s.a, s.b, u);
};
function segD(s, u = 1) {
  const f = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  if (s.type === "clip") {
    if (s.pts.length < 2) return "";
    const L = s.lens[s.lens.length - 1] * u; let d = `M${f(s.pts[0])}`;
    for (let i = 1; i < s.pts.length && s.lens[i] <= L; i++) d += `L${f(s.pts[i])}`;
    return u < 1 ? d + `L${f(segPoint(s, u))}` : d;
  }
  if (s.a === s.b) return "";
  if (s.ctrl) { let d = `M${f(s.a)}`; const n = Math.max(2, Math.ceil(40 * u)); for (let i = 1; i <= n; i++) d += `L${f(segPoint(s, u * i / n))}`; return d; }
  return `M${f(s.a)}L${f(segPoint(s, u))}`;
}
function journeyCard(s, u) {
  const c = s.c, card = $("mp-jcard");
  const frames = c.sp?.[2] || 0, fr = frames ? Math.min(frames - 1, Math.floor(u * frames)) : coverFrame(c);
  const sig = `${c.id}|${s.flight ? "f" : ""}`;
  if (card._sig !== sig) {
    card._sig = sig;
    const where = c.city && c.city !== areaOf(c) ? `${c.city}, ${areaOf(c)}` : areaOf(c);
    card.dataset.clip = c.id;
    card.innerHTML = `<div class="thumb" id="mp-jthumb"></div><div class="jc-t"><span class="label">${esc(dayLabel(s.day))} · ${esc(fmtShort(s.day))}</span>
      <b>${esc(s.flight ? `Flying to ${areaOf(c)}` : where || niceCountry(c.country))}</b>
      <small>${s.flight ? `${Math.round(s.km).toLocaleString()} km to ${esc(niceCountry(c.country))}` : `${esc(c.t.slice(11, 16))} · ${(c.dur || 0) < 60 ? `${Math.round(c.dur || 0)} s` : fmtMin(c.dur / 60)}${c.title ? ` · ${esc(c.title)}` : ""}`}</small></div>`;
    card._fr = -1;
  }
  if (card._fr !== fr) { card._fr = fr; const th = $("mp-jthumb"); if (th) th.setAttribute("style", thumbStyle(c, fr)); }
  const n = J.segs.length;
  card.style.setProperty("--jp", `${((J.i + u) / n * 100).toFixed(2)}%`);
}
function placeMarker() {
  if (!J.on || !J.pos) return;
  const el = $("mp-jm"), x = M.t.applyX(J.pos[0]), y = M.t.applyY(J.pos[1]);
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
  const ic = el.firstElementChild; if (ic && J.heading != null) ic.style.transform = `rotate(${J.heading.toFixed(1)}deg)`;
}
function setMarker(flight) {
  const el = $("mp-jm"), kind = flight ? "plane" : "dot";
  if (el.dataset.kind === kind) return;
  el.dataset.kind = kind;
  el.innerHTML = flight ? `<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.6c.9 0 1.5 1 1.5 2.4v5.3l8 4.7v2.2l-8-2.5v4.7l2.3 1.7v1.7L12 20.6l-3.800 1.200v-1.700l2.300-1.700v-4.700l-8 2.500V14l8-4.700V4c0-1.400.6-2.400 1.500-2.400z"/></svg>` : `<i></i>`;
}
function applySeg(s, u, ease) {
  const e = s.type === "move" ? ease : u;
  if (s.type === "move") {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!J.from) { const k = M.t.k; J.from = {cx: M.t.invertX(M.W / 2), cy: M.t.invertY(M.H / 2), k}; J.zi = d3.interpolateZoom([J.from.cx, J.from.cy, M.W / k], [s.view.cx, s.view.cy, M.W / s.view.k]); }
    const v = reduce ? [s.view.cx, s.view.cy, M.W / s.view.k] : J.zi(e);
    applyView({cx: v[0], cy: v[1], k: M.W / v[2]});
  }
  J.pos = segPoint(s, e);
  const ahead = segPoint(s, Math.min(1, e + .012));
  if (s.flight && (ahead[0] !== J.pos[0] || ahead[1] !== J.pos[1])) J.heading = Math.atan2(ahead[1] - J.pos[1], ahead[0] - J.pos[0]) * 180 / Math.PI + 90;
  setMarker(!!s.flight && e < .995);
  J.live.setAttribute("d", segD(s, e));
  J.live.setAttribute("class", "jr-live" + (s.flight ? " flight" : isLink(s) ? " link" : ""));
  journeyCard(s, s.type === "clip" ? u : 0);
  if (s.day !== J.day) {
    J.day = s.day;
    select("day", s.day, {fly: false, keepScroll: true});
    const d = M.days[M.dayIdx.get(s.day)]; if (d) $("mp-now").innerHTML = nowHTML(d);
  }
  if (s.type === "clip" && !J.seen.has(s.c.id)) { J.seen.add(s.c.id); setHot([s.c.id]); }
  placeMarker(); schedule();
}
// real GPS tracks stay solid; the gaps between clips (route unknown) are only a faint dotted link
const isLink = (s) => s.type !== "clip" && !s.flight;
function paintDone() { J.doneG.setAttribute("d", J.done.join("")); J.hopG.setAttribute("d", J.hops.join("")); J.flyG.setAttribute("d", J.flights.join("")); }
function addDone(s) { const d = segD(s, 1); if (d) (s.flight ? J.flights : isLink(s) ? J.hops : J.done).push(d); }
function finishSeg(s) { addDone(s); paintDone(); J.from = null; }
function journeyFrame(now) {
  J.raf = 0;
  if (!J.on || !J.playing) return;
  if ($("v-map").hidden) return pauseJourney();
  let dt = Math.min(100, now - J.last) * J.speed; J.last = now;
  while (dt > 0 && J.i < J.segs.length) {
    const s = J.segs[J.i], left = s.dur - J.t;
    if (dt >= left) { applySeg(s, 1, 1); finishSeg(s); J.i++; J.t = 0; dt -= left; }
    else { J.t += dt; dt = 0; const u = J.t / s.dur; applySeg(s, u, d3.easeCubicInOut(u)); }
  }
  if (J.i >= J.segs.length) return endJourney();
  J.raf = requestAnimationFrame(journeyFrame);
}
function setPlayLabel() {
  $("mp-play").textContent = J.on && J.playing ? "❚❚ Pause" : J.on ? "▶ Resume" : "▶ Play the journey";
  $("mp-speed").hidden = !J.on;
  $("mp-wrap").classList.toggle("journey", J.on);
  $("mp-jm").hidden = !J.on; $("mp-jcard").hidden = !J.on;
}
function startJourney(fromDay) {
  M.svg.interrupt();
  buildJourney();
  if (!J.segs.length) return;
  Object.assign(J, {on: true, playing: true, i: 0, t: 0, seen: new Set(), done: [], hops: [], flights: [], day: "", from: null, pos: null});
  paintDone(); J.live.setAttribute("d", "");
  $("mp-jcard")._sig = ""; $("mp-jm").dataset.kind = "";
  if (fromDay) skipTo(fromDay);
  setPlayLabel(); resumeLoop();
}
function resumeLoop() { J.last = performance.now(); if (!J.raf) J.raf = requestAnimationFrame(journeyFrame); }
function pauseJourney() { if (!J.on) return; J.playing = false; cancelAnimationFrame(J.raf); J.raf = 0; setPlayLabel(); }
function skipTo(day) {
  const idx = J.segs.findIndex((s) => s.day >= day); if (idx < 0) return false;
  J.done = []; J.hops = []; J.flights = []; J.seen = new Set();
  for (let n = 0; n < idx; n++) { addDone(J.segs[n]); if (J.segs[n].type === "clip") J.seen.add(J.segs[n].c.id); }
  paintDone(); J.live.setAttribute("d", "");
  J.i = idx; J.t = 0; J.from = null; J.day = "";
  return true;
}
function journeySeek(day) { if (!skipTo(day)) return false; J.playing = true; setPlayLabel(); schedule(); resumeLoop(); return true; }
function journeyRebuild() {
  const i = J.i, t = J.t, day = J.segs[i]?.day;
  buildJourney(); skipTo(day || ""); if (J.segs[i]?.day === day) { J.i = Math.max(J.i, Math.min(i, J.segs.length - 1)); J.t = t; }
  J.done = []; J.hops = []; J.flights = []; for (let n = 0; n < J.i; n++) addDone(J.segs[n]);
  paintDone();
  J.day = day || ""; J.from = null;
  const cur = J.segs[J.i];  // a resize redraws the map: put the half-drawn stretch and the marker back
  if (cur) { const e = cur.type === "move" ? d3.easeCubicInOut(J.t / cur.dur) : J.t / cur.dur; J.pos = segPoint(cur, e); J.live.setAttribute("d", segD(cur, e)); J.live.setAttribute("class", "jr-live" + (cur.flight ? " flight" : isLink(cur) ? " link" : "")); }
}
function endJourney() {
  J.playing = false; J.raf = 0; J.i = J.segs.length; setHot([]); setPlayLabel();
  $("mp-play").textContent = "↺ Play again";
  J.live.setAttribute("d", ""); $("mp-jm").hidden = true;
  const all = mapClips(); applyFit(all);
}
const applyFit = (cs) => { J.seen = new Set(cs.map((c) => c.id)); flyTo(cs, 2500, 1500); schedule(); };
function stopJourney() {
  clearInterval(M.timer); M.timer = null;
  if (!J.on) return;
  cancelAnimationFrame(J.raf); J.raf = 0;
  Object.assign(J, {on: false, playing: false, from: null, pos: null});
  J.done = []; J.hops = []; J.flights = []; if (J.doneG) paintDone(); J.live?.setAttribute("d", ""); setHot([]); setPlayLabel(); schedule();
}
$("mp-play").addEventListener("click", () => {
  if (!J.on || J.i >= J.segs.length) return startJourney(M.sel?.kind === "day" && !J.on ? M.sel.key : null);
  if (J.playing) return pauseJourney();
  J.playing = true; J.from = null; if (J.segs[J.i]?.type === "move") J.t = 0; setPlayLabel(); resumeLoop();
});
$("mp-speed").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.exit != null) return stopJourney();
  J.speed = +b.dataset.s;
  $("mp-speed").querySelectorAll("[data-s]").forEach((x) => x.setAttribute("aria-pressed", x === b));
});
$("mp-jcard").addEventListener("click", () => { const id = $("mp-jcard").dataset.clip; if (id) { pauseJourney(); openClip(id, mapClips()); } });

/* ---------- entry points ---------- */
function renderStats() {
  const visits = journeyVisits(), st = journeyStats(visits);
  const days = st.last ? daysBetween(JSTART, st.last) + 1 : 0;
  const today = daysBetween(JSTART, new Date().toISOString().slice(0, 10)) + 1;
  $("mp-tiles").innerHTML = [
    [days ? days.toLocaleString() : "—", "days on the road"],
    [st.countries || "—", st.countries === 1 ? "country" : "countries"],
    [st.areas || "—", st.areas === 1 ? "place" : "places"],
    [st.totalKm ? `${Math.round(st.totalKm).toLocaleString()} km` : "—", `${st.flights} flight${st.flights === 1 ? "" : "s"}`],
    [fmtMin(mins(placedAll.filter((c) => !c.pre))), "filmed"],
  ].map(([v, k]) => `<div><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join("");
  $("mp-sub").textContent = `From the GPS your GoPro recorded: ${placedAll.length.toLocaleString()} placed clips so far${waitingCount ? ", more as Colab processes the rest" : ""}. ${today.toLocaleString()} days since you set off. Scroll or pinch to zoom from the whole world down to the street.`;
}
let mapRO = null;
function renderMap(rebuild) {
  renderStats();
  if (!window.d3 || !window.topojson || !GEO) { $("mp-wrap").innerHTML = `<p class="empty">The map drawing tools didn't load. Check your connection and reload.</p>`; return; }
  if (rebuild) M.built = false;
  buildDays(); buildFinder();
  M.sel = makeSel(M.sel?.kind || "journey", M.sel?.key || "");
  if (!M.sel.clips.length && M.sel.kind !== "journey") M.sel = makeSel("journey", "");
  if (!M.built || M.W !== $("mp-wrap").clientWidth || M.H !== $("mp-wrap").clientHeight) buildMap();
  else M.items.sort((a, b) => prio(b.c) - prio(a.c));
  renderPanel(); renderCrumbs(); drawStrip(); schedule();
  $("mp-now").innerHTML = nowHTML(null);
  if (!mapRO && window.ResizeObserver) {
    let last = "";
    mapRO = new ResizeObserver(() => { if ($("v-map").hidden) return; const w = $("mp-wrap"), sz = `${w.clientWidth}x${w.clientHeight}`; if (sz !== last) { last = sz; if (M.built) { buildMap(); schedule(); } drawStrip(); } });
    mapRO.observe($("mp-wrap")); mapRO.observe($("mp-strip"));
  }
}
$("mp-tracks").addEventListener("change", () => {
  const g = M.tracks.values().next().value?.parentNode; if (!g) return;
  if ($("mp-tracks").checked) g.removeAttribute("display"); else g.setAttribute("display", "none");
});
function mapSoftRefresh() {
  if (!M.built || !M.sel) return;
  M.sel = makeSel(M.sel.kind, M.sel.key); M.items.sort((a, b) => prio(b.c) - prio(a.c));
  renderPanel(); schedule();
}
$("mp-pre").addEventListener("change", () => { stopJourney(); if (M.sel?.kind === "day" && M.sel.key < JSTART && !showPre()) M.sel = null; renderMap(true); });

/* ---------------- start ---------------- */
/* ---------------- HOME: the next thing that needs you ---------------- */
function todoCard(title, text, acts, lead) {
  return `<div class="todo${lead ? " lead" : ""}"><div style="display:grid;gap:4px"><h3>${title}</h3><p>${text}</p></div><div class="acts">${acts}</div></div>`;
}
const keptWithoutMoments = () => processed.filter((c) => ["best", "keep"].includes(markOf(c.id)?.r) && !momentsOf(c.id).length);
function renderHome() {
  const s = DATA.summary || {}, st = s.stages_done || {}, pr = DATA.progress || {};
  const total = s.videos || 0, done1 = st.meta || 0, left1 = Math.max(0, total - done1);
  const gbLeft = Math.max(0, (s.video_gb || 0) - (s.pass1_done_gb || 0));
  const rate = pr.pass_no === 1 && pr.rate_gb_h > 5 ? pr.rate_gb_h : 55;  // measured: ~55 GB/h on the free CPU runtime
  const hours = gbLeft / rate, sessions = Math.max(1, Math.ceil(hours / 11));
  const asOf = DATA.exported ? new Date(DATA.exported) : null;
  const mins = (iso) => asOf && iso ? Math.round((asOf - new Date(iso)) / 6e4) : null;
  const ago = (m) => m == null ? "" : m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
  const live = pr.state === "running" && mins(pr.updated) != null && mins(pr.updated) < 15;
  const lastRun = live ? `Colab was running when this page was last refreshed: pass ${pr.pass_no}, ${pr.done_clips} of ${pr.todo_clips} clips, about ${pr.eta_hours ?? "?"} h left.`
    : pr.state ? `The last Colab run ${pr.state === "finished" ? "finished" : pr.state === "time-budget" ? "reached its time limit" : "stopped before it finished (Colab disconnected or the tab was closed)"} ${ago(mins(pr.updated))} before this page was refreshed.` : "";
  const nb = DATA.colab ? `<a class="btn" href="${esc(DATA.colab)}" target="_blank" rel="noopener">Open the Colab notebook</a>` : "";
  const pct = total ? (done1 / total) * 100 : 0;
  $("hm-import").innerHTML = !left1 && (st.speech || 0) >= total
    ? `<h3>All ${total.toLocaleString()} clips are imported</h3><p>Every clip has its frames, place, transcript and tags.</p>`
    : `<div class="kv">
        <div><span class="label">Clips imported</span><b>${done1.toLocaleString()} / ${total.toLocaleString()}</b></div>
        <div><span class="label">Video read</span><b>${s.pass1_done_gb ?? 0} / ${s.video_gb ?? 0} GB</b></div>
        <div><span class="label">Transcripts + tags</span><b>${(st.speech || 0).toLocaleString()}</b></div>
        <div><span class="label">Colab time left</span><b>${left1 ? `≈ ${Math.ceil(hours)} h` : "pass 2 only"}</b></div>
      </div>
      <span class="bar"><i style="width:${pct.toFixed(1)}%"></i></span>
      <p>${lastRun} Your videos stay in Google Drive. Colab reads them there and saves only small files to the workspace (frames, audio, notes), so nothing is downloaded to your Mac.</p>
      <p><b>To continue:</b> open the notebook, then Runtime → Run all.${left1 ? ` The rest needs about ${sessions} run${sessions > 1 ? "s" : ""} of up to 11 h each.` : ""} On a free <b>T4 GPU</b> runtime (Runtime → Change runtime type) the same run also makes light playback copies and transcripts. Colab gives only a few free GPU hours a day; when they run out, the normal runtime keeps importing. If Colab disconnects, press Run all again and it carries on where it stopped. When a run ends, ask Claude to “refresh the Library”.</p>
      ${nb ? `<div class="row">${nb}</div>` : ""}`;

  const cards = [], lead = () => !cards.length;
  const unrev = processed.filter((c) => !markOf(c.id)?.r && !isJunk(c));
  if (unrev.length) {
    const c0 = unrev[0], day = c0.t.slice(0, 10), n = unrev.filter((c) => c.t.slice(0, 10) === day).length;
    cards.push(todoCard(`Review ${esc(dayTitle(c0))}`, `${n} clip${n > 1 ? "s" : ""} from ${esc(c0.region || c0.city || "this day")} to rate (${unrev.length.toLocaleString()} unreviewed in all; short, dark and pocket clips skipped). Rate with 1–4, press M to keep a suggested moment, A to add it to a post.`,
      `<button class="btn" data-review-day="${day}">Review this day</button>`, lead()));
  }
  const kwm = keptWithoutMoments();
  if (kwm.length) cards.push(todoCard(`Pick moments in ${kwm.length} kept clip${kwm.length > 1 ? "s" : ""}`, "You marked these keep or best but haven't chosen which seconds to use. Suggestions are ready; one click keeps one.",
    `<button class="btn${lead() ? "" : " ghost"}" data-open-clip="${esc(kwm[0].id)}">Start with the first</button>`, lead()));
  const posts = [...store.posts.values()].sort(postOrder);
  for (const p of posts.filter((p) => p.status === "cut")) cards.push(todoCard(`Watch the cut: ${esc(p.title)}`, "The final render is done. Watch it, then schedule it.", `<button class="btn" data-open="${esc(p.id)}">Watch the final</button>`, lead()));
  const building = posts.filter((p) => ["idea", "clips"].includes(p.status || "idea"));
  for (const p of building.slice(0, 3)) {
    const miss = postChecks({...p, items: postItems(p), brief: {...briefDefaults(p.kind || "reel"), ...(p.brief || {})}}).filter(([ok]) => !ok).map(([, t]) => t);
    cards.push(todoCard(`Finish the post: ${esc(p.title)}`, miss.length ? `Still open: ${esc(miss.slice(0, 2).join("; "))}.` : "Everything is in place: open the studio and let Claude make the edit.",
      `<button class="btn${lead() ? "" : " ghost"}" data-open="${esc(p.id)}">Open post</button>`, lead()));
  }
  if (building.length > 3) cards.push(todoCard(`${building.length - 3} more posts being built`, "They're on the Posts board under Idea and Picking clips.", `<a class="btn quiet" href="#posts">Open Posts</a>`));
  for (const p of posts.filter((p) => p.status === "edit").slice(0, 3)) cards.push(todoCard(`Keep editing: ${esc(p.title)}`, `${esc(nextStep(p))}.`, `<button class="btn${lead() ? "" : " ghost"}" data-open="${esc(p.id)}">Open the studio</button>`, lead()));
  const appr = posts.filter((p) => p.status === "render");
  if (appr.length) cards.push(todoCard(`${appr.length} approved edit${appr.length > 1 ? "s" : ""} waiting for the final render`, "Tell Claude Code <b>“render the approved posts”</b>. It queues them, and your next Colab run renders them from the original files (PASS = 4 renders only).", `<button class="btn ghost" id="hm-copy">Copy that request</button>`));
  if (!posts.length) cards.push(todoCard("Plan your first posts", "The Roadmap can plan a reel for every stop of the journey from your kept clips and the suggested moments.", `<a class="btn ghost" href="#roadmap">Open the Roadmap</a>`));
  const next = posts.filter((p) => p.scheduled && p.status !== "posted").sort((a, b) => a.scheduled.localeCompare(b.scheduled))[0];
  if (next) cards.push(todoCard(`Next post: ${fmtDay(next.scheduled)}`, `${esc(next.title)} · ${esc(STATUS_NAME[next.status] || "Idea")}`, `<button class="btn quiet" data-open="${esc(next.id)}">Open</button>`));
  const intake_status = DATA.intake || {};
  if (intake_status.waiting) {
    const n = intake_status.waiting, count = `${n.toLocaleString()}${intake_status.capped ? "+" : ""}`;
    cards.push(todoCard(`${count} new clip${n > 1 ? "s" : ""} in Drive`, "They are in your GoPro Travels folder and not imported yet. The next Colab run brings them in.", nb, lead()));
  }
  $("hm-next").innerHTML = cards.join("") || todoCard("Nothing is waiting on you", "Everything processed so far is reviewed and every post is with Claude or done.", "");
  $("hm-copy")?.addEventListener("click", (e) => copyText("Render the approved GoPro posts", e.target));
}
function fillDays() {
  const sel = $("rv-day"), cur = sel.value, by = new Map();
  for (const c of processed) {
    const d = c.t.slice(0, 10);
    if (!by.has(d)) by.set(d, {c, left: 0});
    if (!markOf(c.id)?.r) by.get(d).left++;
  }
  sel.innerHTML = `<option value="">All days</option>` + [...by].map(([d, x]) => `<option value="${d}">${x.c.pre ? "Before the trip" : "Day " + x.c.day} · ${fmtShort(d)}${x.c.region || x.c.city ? " · " + esc(x.c.region || x.c.city) : ""}${x.left ? ` · ${x.left} to review` : " · done"}</option>`).join("");
  if (by.has(cur)) sel.value = cur;
}
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-review-day]");
  if (d) { fillDays(); $("rv-day").value = d.dataset.reviewDay; $("rv-queue").value = "none"; rvIndex = 0; if (location.hash === "#review") renderReview(); else location.hash = "#review"; }
  const k = e.target.closest("[data-open-clip]");
  if (k) openClip(k.dataset.openClip, keptWithoutMoments());
});

header();
renderLibrary();
route();
connect();
