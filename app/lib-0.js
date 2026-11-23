
/* shell: drawer on small screens, sidebar "New post", top search feeds the Library search */
(() => {
  const app = document.getElementById("app"), set = (o) => app.classList.toggle("open", o);
  document.getElementById("side-open").onclick = () => set(true);
  document.getElementById("side-close").onclick = () => set(false);
  document.getElementById("scrim").onclick = () => set(false);
  document.querySelectorAll(".tabs a").forEach((a) => a.addEventListener("click", () => set(false)));
  document.getElementById("side-create").onclick = () => { set(false); location.hash = "#posts"; setTimeout(() => document.getElementById("newpost")?.click(), 0); };
  const gq = document.getElementById("gq"), q = document.getElementById("q");
  const push = () => { if (!q) return; q.value = gq.value; q.dispatchEvent(new Event("input", {bubbles: true})); if (location.hash !== "#library") location.hash = "#library"; };
  document.getElementById("gsearch").addEventListener("submit", (e) => { e.preventDefault(); push(); });
  gq.addEventListener("input", () => { if (location.hash === "#library" || !location.hash) push(); });
  q?.addEventListener("input", () => { if (document.activeElement === q) gq.value = q.value; });

  /* Library: quick chips + Filters panel. The chips only set the existing controls and fire "change". */
  const el = (id) => document.getElementById(id);
  const fire = (id) => el(id).dispatchEvent(new Event("change", {bubbles: true}));
  const MARKS = [["none", "Not reviewed"], ["best", "★ Best"], ["keep", "Keep"], ["maybe", "Maybe"]];
  function drawChips() {
    const box = el("quick"); if (!box) return;
    const mk = el("mark").value, co = el("country").value;
    const countries = [...el("country").options].map((o) => o.value).filter((v) => v && v !== "?");
    const all = mk === "notreject" && !co && !el("talk").checked && !el("hl").checked;
    box.innerHTML = [`<button class="qchip" data-k="all" aria-pressed="${all}">All clips</button>`,
      ...MARKS.map(([v, n]) => `<button class="qchip" data-k="mark" data-v="${v}" aria-pressed="${mk === v}">${n}</button>`),
      `<button class="qchip" data-k="talk" aria-pressed="${el("talk").checked}">Talking</button>`,
      `<button class="qchip" data-k="hl" aria-pressed="${el("hl").checked}">Highlights</button>`,
      ...countries.map((v) => `<button class="qchip" data-k="country" data-v="${v.replace(/"/g, "&quot;")}" aria-pressed="${co === v}">${v.replace(/</g, "&lt;")}</button>`)].join("");
    const n = (el("scene").value ? 1 : 0) + (el("sort").value !== "old" ? 1 : 0) + (el("hidejunk").checked ? 1 : 0) + (window.tlActive?.() ? 1 : 0) + (!["notreject", ...MARKS.map((m) => m[0])].includes(mk) ? 1 : 0);
    el("fcount").hidden = !n; el("fcount").textContent = n;
  }
  function resetFilters() {
    el("mark").value = "notreject"; el("country").value = ""; el("scene").value = ""; el("sort").value = "old";
    el("talk").checked = false; el("hl").checked = false; el("hidejunk").checked = false; window.tlReset?.(); fire("mark");
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!el("quick")) return;
    el("quick").addEventListener("click", (e) => {
      const b = e.target.closest(".qchip"); if (!b) return;
      const on = b.getAttribute("aria-pressed") === "true", k = b.dataset.k;
      if (k === "all") return resetFilters();
      if (k === "mark") { el("mark").value = on ? "notreject" : b.dataset.v; fire("mark"); }
      if (k === "country") { el("country").value = on ? "" : b.dataset.v; fire("country"); }
      if (k === "talk" || k === "hl") { el(k).checked = !on; fire(k); }
    });
    el("fbtn").addEventListener("click", () => { const open = el("fpanel").hidden; el("fpanel").hidden = !open; el("fbtn").setAttribute("aria-expanded", open); });
    el("freset").addEventListener("click", resetFilters);
    ["mark", "country", "scene", "sort", "talk", "hl", "hidejunk"].forEach((id) => el(id).addEventListener("change", drawChips));
    ["tlmin", "tlmax"].forEach((id) => el(id).addEventListener("input", drawChips));
    drawChips();
  });

  /* Sidebar "Your work": posts in progress (badge = something waiting for you) and recently opened clips. */
  const RKEY = "gtl-recent";
  const readRecent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch { return []; } };
  const remember = (id) => { try { localStorage.setItem(RKEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 6))); } catch {} drawWork(true); };
  const WAITING = new Set(["edit", "cut", "ready"]);
  let lastSig = "";
  function drawWork(force) {
    if (typeof store === "undefined" || typeof byId === "undefined") return;
    const posts = [...store.posts.entries()].map(([id, p]) => ({id, ...p})).filter((p) => !["posted", "scheduled"].includes(p.status || "idea"))
      .sort((a, b) => (WAITING.has(b.status) - WAITING.has(a.status)) || ((b.updated || 0) - (a.updated || 0))).slice(0, 5);
    const recent = readRecent().filter((id) => byId.has(id));
    const sig = JSON.stringify([posts.map((p) => [p.id, p.title, p.status]), recent]);
    if (!force && sig === lastSig) return; lastSig = sig;
    const name = (s) => (typeof STATUS_NAME !== "undefined" && STATUS_NAME[s]) || s || "Idea";
    const waiting = [...store.posts.values()].filter((p) => WAITING.has(p.status)).length;
    el("w-badge").hidden = !waiting; el("w-badge").textContent = waiting;
    el("w-posts").innerHTML = posts.length ? posts.map((p) => {
      const first = byId.get((typeof postItems === "function" ? postItems(p) : [])[0]?.clip);
      const pic = first ? `<div class="thumb" style="${thumbStyle(first, coverFrame(first))}"></div>` : `<div class="dot">${WAITING.has(p.status) ? "●" : ""}</div>`;
      return `<button class="witem${WAITING.has(p.status) ? " hot" : ""}" data-post="${esc(p.id)}">${pic}<span>${esc(p.title || "Untitled post")}<small>${esc(name(p.status))}</small></span></button>`;
    }).join("") : `<p class="wempty">No posts yet.</p>`;
    el("w-recent").innerHTML = recent.length ? recent.map((id) => { const c = byId.get(id);
      return `<button class="witem" data-clip="${esc(id)}"><div class="thumb" style="${thumbStyle(c, coverFrame(c))}"></div><span>${esc(typeof clipTitle === "function" ? clipTitle(c) : c.name)}<small>${esc(c.file || "")}</small></span></button>`; }).join("")
      : `<p class="wempty">Clips you open show up here.</p>`;
  }
  window.addEventListener("load", () => {
    if (typeof openClip === "function") { const orig = openClip; window.openClip = function (id, ...rest) { remember(id); return orig.call(this, id, ...rest); }; }
    el("work").addEventListener("click", (e) => {
      const b = e.target.closest(".witem"); if (!b) return; set(false);
      if (b.dataset.clip) window.openClip(b.dataset.clip);
      if (b.dataset.post && typeof openPost === "function") openPost(b.dataset.post);
    });
    drawWork(true);
    if (typeof renderHome === "function") { const origHome = renderHome; window.renderHome = function (...a) { const r = origHome.apply(this, a); drawDashboard(true); return r; }; }
    el("v-home").addEventListener("click", (e) => {
      const g = e.target.closest("[data-goal]");
      if (g) { try { localStorage.setItem(GKEY, g.dataset.goal); } catch {} drawDashboard(true); return; }
      const ch = e.target.closest("[data-chapter]");
      if (ch && typeof renderLibrary === "function") { q.value = ch.dataset.chapter; gq.value = q.value; el("mark").value = ""; location.hash = "#library"; renderLibrary(); }
    });
    drawDashboard(true);
    setInterval(() => { drawWork(false); drawDashboard(false); if (q && document.activeElement !== gq && gq.value !== q.value) gq.value = q.value; }, 1500);
  });

  /* ---------- Home dashboard ---------- */
  const GKEY = "gtl-goal";
  const goal = () => { try { return +localStorage.getItem(GKEY) || 50; } catch { return 50; } };
  const dkey = (t) => new Date(t).toLocaleDateString("en-CA");
  const nf = (n) => Number(n || 0).toLocaleString();
  const shortDay = (iso) => iso ? new Date(iso.slice(0, 10) + "T12:00").toLocaleDateString("en-GB", {day: "numeric", month: "short"}) : "";
  const ICON = {
    eye: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>',
    cut: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v12M16 6v12"/></svg>',
    send: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12 16-8-6 16-2.5-6.5z"/></svg>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    flag: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  };
  let homeSig = "";
  // a two-part town name keeps its first part; a stop in a big city is named after the city area it's in (the city, not the district)
  const placeName = (s) => ((s.area || s.city || "").split(/[-,]/)[0] || "Unknown place").trim();
  // Hero globe: the trip on a 3D globe. Visited countries are lit, every stop is a dot, and the camera tours the countries one at a time, so there are never forty labels fighting each other.
function drawGlobe(stops, cur, started) {
  try { return drawGlobe3D(stops, cur, started); } catch (e) { console.warn("3D globe unavailable", e); return heroGlobe(stops, cur, started); }
}
function drawGlobe3D(stops, cur, started) {
  const focusStop = stops && (stops[cur >= 0 ? cur : stops.length - 1] || null);
  const cv = document.getElementById("hm-art");
  if (!cv) return;
  let gl = false; try { gl = !!document.createElement("canvas").getContext("webgl"); } catch (e) {}
  if (!window.THREE || !window.d3 || !window.topojson || !gl) return heroGlobe(stops, cur, started);
  const T = THREE, G = window.__g3 || (window.__g3 = {});
  for (const id of ["hm-cap", "hm-chips"]) { const n = document.getElementById(id); if (n) n.style.display = "none"; }
  const WORLD = G.world || (G.world = topojson.feature(GEO, GEO.objects.countries));
  // ---- which countries are lit: every country in the footage, matched to the map by name, so new ones appear on their own
  const norm = (x) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const ALIAS = {"united states": "United States of America", "usa": "United States of America", "us": "United States of America", "czech republic": "Czechia", "bosnia and herzegovina": "Bosnia and Herz.",
    "dominican republic": "Dominican Rep.", "democratic republic of the congo": "Dem. Rep. Congo", "congo kinshasa": "Dem. Rep. Congo", "republic of the congo": "Congo", "congo brazzaville": "Congo",
    "ivory coast": "Côte d'Ivoire", "cote d ivoire": "Côte d'Ivoire", "north macedonia": "Macedonia", "swaziland": "eSwatini", "eswatini": "eSwatini", "south sudan": "S. Sudan", "equatorial guinea": "Eq. Guinea",
    "western sahara": "W. Sahara", "solomon islands": "Solomon Is.", "central african republic": "Central African Rep.", "turkiye": "Turkey", "burma": "Myanmar", "russian federation": "Russia",
    "united kingdom": "United Kingdom", "great britain": "United Kingdom", "uk": "United Kingdom", "falkland islands": "Falkland Is.", "antigua and barbuda": "Antigua and Barb.", "saint kitts and nevis": "St. Kitts and Nevis",
    "northern cyprus": "N. Cyprus", "timor leste": "Timor-Leste", "east timor": "Timor-Leste", "korea republic of": "South Korea", "republic of korea": "South Korea", "holland": "Netherlands"};
  const topoBy = G.topoBy || (G.topoBy = new Map(WORLD.features.map((f) => [norm(f.properties.name), f.properties.name])));
  const resolve0 = (n) => { const k = norm(n); return topoBy.get(k) || (ALIAS[k] && topoBy.get(norm(ALIAS[k]))) || k; };
  // Countries on the route that have no clips imported yet: shown softer, and they switch to bold on their own once footage lands.
  // Edit this list to match the trip.
  const TRIP_PLAN = ["Thailand", "Vietnam", "China", "Japan", "Slovenia", "Laos", "Hong Kong"];
  const PLAN_PINS = {"Hong Kong": [114.17, 22.32]};   // places too small for the world map get a dot at these [lon, lat]
  const filmed = [...new Set((typeof COUNTRY_ORDER !== "undefined" ? COUNTRY_ORDER : []).filter(Boolean))];
  const planned = TRIP_PLAN.filter((n) => !filmed.some((f) => norm(f) === norm(n) || resolve0(f) === resolve0(n)));
  const order = [...filmed, ...planned];
  const resolve = (n) => { const k = norm(n); return topoBy.get(k) || (ALIAS[k] && topoBy.get(norm(ALIAS[k]))) || null; };
  const isFilmed = (n) => filmed.includes(n);
  // stable colours: a country keeps the colour it got the first time, new countries take the next free one
  const PAL = ["#ff4f8b", "#27e0e6", "#ffb020", "#b06bff", "#ff6a3d", "#4d8bff", "#7dff6a", "#ff7ad9", "#ffe14a", "#2fd1a0", "#ff5252", "#8aa4ff"];
  let saved = {}; try { saved = JSON.parse(localStorage.getItem("globeColors") || "{}"); } catch (e) {}
  for (const n of order) if (saved[n] == null) { const used = new Set(Object.values(saved)); let i = 0; while (used.has(i) && i < PAL.length) i++; saved[n] = i; }
  try { localStorage.setItem("globeColors", JSON.stringify(saved)); } catch (e) {}
  const colOf = (n) => PAL[(saved[n] || 0) % PAL.length];
  const key = order.join("|") + "#" + filmed.join("|");
  const sample = placedAll.filter((c) => c.lat != null), last = sample.length ? sample[sample.length - 1] : null;
  const pinsFor = (n) => { const cs = placedAll.filter((c) => niceCountry(c.country) === n); return cs.length ? [cs.reduce((a, c) => a + c.lon, 0) / cs.length, cs.reduce((a, c) => a + c.lat, 0) / cs.length] : null; };
  const paintOverlay = () => {   // equirectangular canvas: visited countries in colour + soft glow (tiny nations missing from the map get a glowing dot)
    const W = 4096, H = 2048, oc = G.ovc || (G.ovc = document.createElement("canvas")); oc.width = W; oc.height = H;
    const proj = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]), x = oc.getContext("2d"), path = d3.geoPath(proj, x);
    x.clearRect(0, 0, W, H); x.lineJoin = "round";
    const byName = new Map(WORLD.features.map((f) => [f.properties.name, f]));
    for (const n of order) {
      const col = colOf(n), tn = resolve(n), f = tn && byName.get(tn), bold = isFilmed(n);
      if (f) {
        x.save(); x.shadowColor = col; x.shadowBlur = bold ? 60 : 30; x.fillStyle = col; x.globalAlpha = bold ? 0.9 : 0.35; x.beginPath(); path(f); x.fill(); x.restore();
        x.beginPath(); path(f); x.fillStyle = col; x.globalAlpha = bold ? 1 : 0.5; x.fill(); x.strokeStyle = col; x.globalAlpha = bold ? 1 : 0.8; x.lineWidth = bold ? 3 : 2; x.stroke(); x.globalAlpha = 1;
      } else { const ll = (bold && pinsFor(n)) || PLAN_PINS[n]; if (!ll) continue; const [px, py] = proj(ll);
        x.save(); x.shadowColor = col; x.shadowBlur = 30; x.fillStyle = col; x.globalAlpha = bold ? 1 : 0.6; x.beginPath(); x.arc(px, py, bold ? 11 : 9, 0, 7); x.fill(); x.restore(); }
    }
    if (G.ov) G.ov.needsUpdate = true;
  };
  const legend = () => {   // small legend: one chip per country, so new ones show up by name
    const art = cv.parentElement; let lg = art.querySelector(".glegend");
    if (!lg) { lg = document.createElement("div"); lg.className = "glegend"; lg.style.cssText = "position:absolute;left:14px;right:14px;bottom:12px;display:flex;flex-wrap:wrap;gap:6px;pointer-events:none;font:600 12px Inter,sans-serif;color:#eaf1ff"; art.appendChild(lg); }
    const chip = (t, c, soft) => `<span ${soft ? 'title="On the route, no clips imported yet"' : ""} style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:99px;background:rgba(6,12,28,.62);backdrop-filter:blur(6px);${soft ? "opacity:.65" : ""}">${c ? `<i style="width:9px;height:9px;border-radius:50%;${soft ? `border:2px solid ${c}` : `background:${c}`};box-sizing:border-box"></i>` : ""}${esc(t)}</span>`;
    lg.innerHTML = order.slice(0, 10).map((n) => chip(n, colOf(n), !isFilmed(n))).join("") + (order.length > 10 ? chip(`+${order.length - 10} more`) : "");
  };
  legend();
  if (G.cv === cv && G.raf) { if (G.key !== key) { G.key = key; paintOverlay(); } return; }
  G.cv = cv; G.key = key;
  const renderer = new T.WebGLRenderer({canvas: cv, antialias: true, alpha: false, preserveDrawingBuffer: true}); renderer.setClearColor(0x000000, 1);
  const scene = new T.Scene(), cam = new T.PerspectiveCamera(24, 1, 0.1, 400);
  const tilt = new T.Group(), spin = new T.Group(); tilt.add(spin); scene.add(tilt);
  const loader = new T.TextureLoader(); loader.setCrossOrigin("anonymous");
  const IMG = "https://unpkg.com/three-globe@2.31.0/example/img/";
  let loaded = 0, failed = false;
  const need = 3, bail = () => { if (failed) return; failed = true; cancelAnimationFrame(G.raf); G.raf = 0; const nc = document.createElement("canvas"); nc.id = "hm-art"; cv.replaceWith(nc); renderer.dispose(); window.__g3 = null; heroGlobe(stops, cur, started); };
  const tex = (u) => { const t = loader.load(u, () => { if (++loaded === need) G.ready = true; }, undefined, bail); t.anisotropy = 8; t.colorSpace = T.NoColorSpace; return t; };
  const day = tex(IMG + "earth-blue-marble.jpg"), night = tex(IMG + "earth-night.jpg"), water = tex(IMG + "earth-water.png");
  G.ov = new T.CanvasTexture(G.ovc || (paintOverlay(), G.ovc)); G.ov.anisotropy = 8; paintOverlay();
  const sun = new T.Vector3(-0.55, 0.45, 0.7).normalize();
  const mat = new T.ShaderMaterial({
    uniforms: {dayT: {value: day}, nightT: {value: night}, waterT: {value: water}, ovT: {value: G.ov}, sun: {value: sun}},
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `precision highp float; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      uniform sampler2D dayT, nightT, waterT, ovT; uniform vec3 sun;
      void main(){
        vec3 N = normalize(vN), V = normalize(cameraPosition - vP);
        float ndl = dot(N, sun), lit = smoothstep(-0.04, 0.2, ndl);
        vec3 d = texture2D(dayT, vUv).rgb;
        d = pow(d, vec3(1.12)) * 1.25;
        float sea = 1.0 - smoothstep(0.35, 0.65, texture2D(waterT, vUv).r);
        vec4 ov = texture2D(ovT, vUv);
        d = mix(d, ov.rgb * (0.7 + 0.5 * dot(d, vec3(.33))), ov.a * 0.88);
        vec3 moon = d * vec3(0.012, 0.022, 0.05);                               // faint blue moonlight: the night side still shows land and sea
        vec3 col = d * 1.08 * lit + moon * (1.0 - lit);
        vec3 H = normalize(sun + V); float sp = pow(max(dot(N, H), 0.0), 90.0) * sea * lit;
        col += vec3(1.0, 0.93, 0.8) * sp * 0.9 * lit;
        float twi = smoothstep(-0.12, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.22, ndl));      // sunrise / sunset band: warm light skimming the surface
        col += vec3(1.0, 0.45, 0.18) * twi * 0.22 * dot(d, vec3(.33)) * 2.0;
        vec3 nl = texture2D(nightT, vUv).rgb; nl = pow(nl, vec3(0.85)) * vec3(1.0, 0.82, 0.55); col += nl * pow(1.0 - lit, 1.5) * 1.9;                   // city lights on the night side
        col += ov.rgb * ov.a * (0.14 + 0.30 * (1.0 - lit));   // visited countries stay lit, and glow on the dark side
        float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 sky = mix(vec3(1.0, 0.5, 0.25), vec3(0.3, 0.58, 1.0), smoothstep(-0.02, 0.3, ndl));
        col += sky * fr * (0.08 + 0.92 * smoothstep(-0.3, 0.45, ndl)) * 1.2;
        gl_FragColor = vec4(col, 1.0);
      }`});
  const earth = new T.Mesh(new T.SphereGeometry(1, 128, 96), mat); spin.add(earth);
  // atmosphere halo around the planet: brightest at the limb, fading out; blue by day, orange-red along the terminator, nearly gone at night
  const atmo = new T.Mesh(new T.SphereGeometry(1.14, 96, 64), new T.ShaderMaterial({transparent: true, side: T.BackSide, depthWrite: false, blending: T.AdditiveBlending,
    uniforms: {sun: {value: sun}},
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 wp = modelMatrix * vec4(position,1.); vP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 sun;
      void main(){ vec3 V = normalize(cameraPosition - vP); float e = clamp(-dot(vN, V), 0.0, 1.0);
        float f = pow(smoothstep(0.0, 0.52, e), 2.2) * (1.0 - smoothstep(0.52, 0.62, e) * 0.0);
        float ndl = dot(normalize(vP), sun); float l = smoothstep(-0.45, 0.5, ndl);
        vec3 c = mix(vec3(1.0, 0.42, 0.16), vec3(0.28, 0.56, 1.0), smoothstep(-0.05, 0.35, ndl));
        gl_FragColor = vec4(c * f * (0.06 + 0.94 * l) * 0.9, f * (0.06 + 0.94 * l)); }`}));
  tilt.add(atmo);
  const sg = new T.BufferGeometry(), sp = new Float32Array(900); for (let i = 0; i < 300; i++) { const a = Math.random() * 6.283, b = Math.acos(2 * Math.random() - 1), r = 120; sp.set([r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)], i * 3); }
  sg.setAttribute("position", new T.BufferAttribute(sp, 3)); scene.add(new T.Points(sg, new T.PointsMaterial({color: 0xcfe0ff, size: 0.6, sizeAttenuation: false, transparent: true, opacity: 0.7})));
  G.base = -0.004; G.vel = G.base; G.lon = last ? last.lon : 100; G.off = 150; G.latT = last ? Math.max(-30, Math.min(60, last.lat - 32)) : 0; G.lat = G.latT + 14;
  G.mode = "auto";
  // day / night control
  const art = cv.parentElement; let ctl = art.querySelector(".gmode");
  if (!ctl) { ctl = document.createElement("div"); ctl.className = "gmode"; ctl.style.cssText = "position:absolute;top:12px;right:12px;display:flex;gap:2px;padding:3px;border-radius:99px;background:rgba(6,12,28,.62);backdrop-filter:blur(6px);font:600 12px Inter,sans-serif;z-index:2"; art.appendChild(ctl); }
  ctl.innerHTML = [["auto", "Auto"], ["day", "Day"], ["night", "Night"]].map(([m, l]) => `<button data-m="${m}" style="all:unset;cursor:pointer;padding:5px 11px;border-radius:99px;color:#eaf1ff">${l}</button>`).join("");
  const paintMode = () => ctl.querySelectorAll("button").forEach((b) => { const on = b.dataset.m === G.mode; b.style.background = on ? "rgba(255,255,255,.92)" : "transparent"; b.style.color = on ? "#0a1020" : "#eaf1ff"; });
  ctl.onclick = (e) => { const b = e.target.closest("button"); if (b) { G.mode = b.dataset.m; paintMode(); } }; paintMode();
  cv.style.cursor = "grab";
  cv.addEventListener("pointerdown", (e) => { G.drag = {x: e.clientX, y: e.clientY, t: performance.now()}; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
  cv.addEventListener("pointermove", (e) => { if (!G.drag) return; const n = performance.now(), dx = e.clientX - G.drag.x, dt = Math.max(8, n - G.drag.t);
    G.lon -= dx * 0.3; G.vel = Math.max(-0.12, Math.min(0.12, -(dx * 0.3) / dt)); G.drag.x = e.clientX; G.drag.t = n; G.latT = Math.max(-30, Math.min(65, G.latT + (e.clientY - G.drag.y) * 0.2)); G.drag.y = e.clientY; });
  const up = () => { G.drag = null; cv.style.cursor = "grab"; }; cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  let prev = performance.now(), W0 = 0, H0 = 0; const tgt = new T.Vector3();
  const frame = (now) => {
    if (!cv.isConnected) { G.raf = 0; renderer.dispose(); window.__g3 = null; return; }
    G.raf = requestAnimationFrame(frame);
    const dt = Math.min(50, now - prev); prev = now;
    const box = cv.parentElement.getBoundingClientRect(), w = Math.round(box.width), h = Math.round(box.height);
    if (!w || !h || document.hidden || !G.ready) return;
    if (!G.drag) { G.lon += G.vel * dt; G.vel += (G.base - G.vel) * (1 - Math.exp(-dt / 900)); }
    G.off *= Math.exp(-dt / 900); if (G.off < 0.01) G.off = 0;
    G.lat += (G.latT - G.lat) * (1 - Math.exp(-dt / 400));
    // the sun: Auto slowly carries the planet through day, sunset, night and sunrise; Day / Night hold it there
    // the sun stays to the side so the planet is always part light, part dark; Auto slowly slides the day/night line across
    const az = G.mode === "day" ? 66 : G.mode === "night" ? 114 : 90 + 14 * Math.sin(now / 9000), ar = az * Math.PI / 180;
    tgt.set(Math.sin(ar) * -1, 0.22, Math.cos(ar));
    tgt.normalize(); sun.lerp(tgt, 1 - Math.exp(-dt / (G.mode === "auto" ? 120 : 500))).normalize();
    if (w !== W0 || h !== H0) {   // a big planet rising from the bottom edge, only its top in frame
      W0 = w; H0 = h; renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(w, h, false); cv.style.width = w + "px"; cv.style.height = h + "px";
      const Rpx = Math.min(w * 0.56, h * 0.95), fov = cam.fov * Math.PI / 180, a = Math.atan(Rpx * 2 * Math.tan(fov / 2) / h), d = 1 / Math.sin(a);
      cam.aspect = w / h; cam.position.set(0, 0, d); cam.lookAt(0, 0, 0); cam.setViewOffset(w, h, 0, -(h / 2 + Rpx * 0.12), w, h); cam.updateProjectionMatrix();
    }
    spin.rotation.y = -(Math.PI / 2 + (G.lon + G.off) * Math.PI / 180);
    tilt.rotation.x = (G.lat + Math.sin(now / 5200) * 2) * Math.PI / 180;
    renderer.render(scene, cam);
  };
  G.raf = requestAnimationFrame(frame);
}
  const HG = {};
  // the 50m outlines are far more detail than a 280px globe needs: thin them once so every frame stays cheap
  function hgThin(f, eps) {
    const ring = (r) => { const o = [r[0]]; for (let i = 1; i < r.length - 1; i++) { const p = r[i], q = o[o.length - 1]; if (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= eps) o.push(p); } o.push(r[r.length - 1]); return o.length >= 4 ? o : null; };
    const poly = (pg) => { const out = ring(pg[0]); return out ? [out, ...pg.slice(1).map(ring).filter(Boolean)] : null; };
    const g = f.geometry; if (!g) return null;
    if (g.type === "Polygon") { const c = poly(g.coordinates); return c ? {type: "Polygon", coordinates: c} : null; }
    if (g.type === "MultiPolygon") { const c = g.coordinates.map(poly).filter(Boolean); return c.length ? {type: "MultiPolygon", coordinates: c} : null; }
    return null;
  }
  const HG_FIX = {"Viet Nam": "Vietnam"};
  function heroGlobe(stops, cur, started) {
    HG.started = started;
    const cv = el("hm-art");
    if (!cv || !window.d3 || !window.topojson) return;
    const pts = [];
    stops.forEach((s, i) => {
      const cc = s.cs.filter((c) => c.lat != null && c.lon != null);
      if (!cc.length) return;
      const med = (k) => { const a = cc.map((c) => c[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
      pts.push({i, name: placeName(s), country: HG_FIX[s.country] || s.country || "Elsewhere", ll: [med("lon"), med("lat")], done: !!s.done, here: i === cur, clips: s.cs.length});
    });
    if (!HG.world) {
      try { HG.world = topojson.feature(GEO, GEO.objects.countries); } catch { return; }
      HG.grat = d3.geoGraticule10();
    }
    const groups = [];
    for (const p of pts) {
      let g = groups.find((x) => x.name === p.country);
      if (!g) groups.push(g = {name: p.country, pts: [], clips: 0});
      g.pts.push(p); g.clips += p.clips;
    }
    for (const g of groups) {
      g.c = d3.geoCentroid({type: "MultiPoint", coordinates: g.pts.map((p) => p.ll)});
      const far = Math.max(...g.pts.map((p) => d3.geoDistance(g.c, p.ll)));
      g.k = Math.max(1, Math.min(2.2, 0.55 / (far + 0.09)));
    }
    // light up every country that has a stop inside it (by position, so names never have to match)
    HG.lit = new Set(HG.world.features.filter((f) => {
      const b = d3.geoBounds(f);
      return pts.some((p) => p.ll[0] >= b[0][0] - 1 && p.ll[0] <= b[1][0] + 1 && p.ll[1] >= b[0][1] - 1 && p.ll[1] <= b[1][1] + 1 && d3.geoContains(f, p.ll))
        || groups.some((g) => g.name === f.properties.name);
    }));
    const thin = (lit, eps) => ({type: "GeometryCollection", geometries: HG.world.features.filter((f) => HG.lit.has(f) === lit).map((f) => hgThin(f, eps)).filter(Boolean)});
    HG.dim = thin(false, 0.7); HG.glow = thin(true, 0.15);
    HG.pts = pts; HG.groups = groups; HG.stopsTotal = pts.length;
    const hereG = Math.max(0, groups.findIndex((g) => g.pts.some((p) => p.here)));
    if (!HG.cam) { HG.focus = hereG; const g = groups[hereG]; if (g) HG.cam = {lon: g.c[0], lat: g.c[1], k: g.k}; HG.next = performance.now() + 5000; }
    if (HG.focus >= groups.length) HG.focus = 0;
    const cap = el("hm-cap"), chips = el("hm-chips");
    HG.paint = () => {
      const g = HG.groups[HG.focus]; if (!g || !cap) return;
      cap.innerHTML = `<span>${HG.groups.length} countr${HG.groups.length === 1 ? "y" : "ies"} · ${HG.stopsTotal} places</span><b>${esc(g.name)}</b><small>${g.pts.length} place${g.pts.length === 1 ? "" : "s"} · ${nf(g.clips)} clips</small>`;
      chips.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === HG.focus)));
    };
    chips.innerHTML = groups.map((g, i) => `<button data-g="${i}" aria-pressed="false">${esc(g.name)}</button>`).join("");
    if (!HG.wired) {
      HG.wired = true;
      chips.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; HG.focus = +b.dataset.g; HG.next = performance.now() + 12000; HG.paint(); });
      let drag = null;
      cv.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing"; });
      cv.addEventListener("pointermove", (e) => { if (!drag || !HG.cam) return; const s = 0.35 / HG.cam.k; HG.cam.lon -= (e.clientX - drag[0]) * s; HG.cam.lat = Math.max(-80, Math.min(80, HG.cam.lat + (e.clientY - drag[1]) * s)); drag = [e.clientX, e.clientY]; HG.next = performance.now() + 12000; HG.free = true; });
      const end = () => { drag = null; cv.style.cursor = ""; };
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
      HG.reduce = matchMedia("(prefers-reduced-motion: reduce)");
      requestAnimationFrame(hgFrame);
    }
    HG.paint();
    HG.cv = cv;
  }
  const cam0 = (v) => Math.round(v * 40);
  function hgFrame(t) {
    requestAnimationFrame(hgFrame);
    const cv = HG.cv, home = el("v-home");
    if (!cv || !HG.cam || document.hidden || !home || home.hidden) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    if (!HG.col || t - HG.colAt > 1500) { const cs = getComputedStyle(cv.parentElement); HG.col = {sky: cs.getPropertyValue("--sky").trim() || "#a9c4d6", sun: cs.getPropertyValue("--sun").trim() || "#f5b800", land: cs.getPropertyValue("--hero").trim() || "#f8f6f1"}; HG.colAt = t; }
    const reduce = HG.reduce && HG.reduce.matches, g = HG.groups[HG.focus];
    if (g && !HG.free && HG.cam) { // glide to the focused country (shortest way round)
      const a = reduce ? 1 : 0.07; let dl = g.c[0] - HG.cam.lon; dl = ((dl + 540) % 360) - 180;
      HG.cam.lon += dl * a; HG.cam.lat += (g.c[1] - HG.cam.lat) * a; HG.cam.k += (g.k - HG.cam.k) * a;
    }
    if (HG.free && Math.abs(HG.cam.k - (g ? g.k : 1)) > 0.01) HG.cam.k += ((g ? g.k : 1) - HG.cam.k) * 0.07;
    if (!reduce && t > HG.next && HG.groups.length > 1) { HG.focus = (HG.focus + 1) % HG.groups.length; HG.free = false; HG.next = t + 4800; HG.paint(); }
    const key = [cam0(HG.cam.lon), cam0(HG.cam.lat), cam0(HG.cam.k), W, H, HG.col.sun].join();
    const moved = key !== HG.key, pulse = !reduce && HG.pts.some((p) => p.here);
    if (!moved && !pulse) return;
    if (!moved && t - (HG.last || 0) < 40) return;
    HG.key = key; HG.last = t;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.44, cam = HG.cam, col = HG.col;
    const proj = d3.geoOrthographic().translate([W / 2, H / 2 + 6]).scale(R * cam.k).rotate([-cam.lon, -cam.lat]).clipAngle(90).precision(2);
    const path = d3.geoPath(proj, ctx), ocean = "#4d6f88";
    // ocean, graticule, land
    ctx.beginPath(); path({type: "Sphere"}); ctx.fillStyle = ocean; ctx.fill();
    ctx.beginPath(); path(HG.grat); ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); path(HG.dim); ctx.fillStyle = col.land; ctx.fill(); ctx.strokeStyle = ocean; ctx.lineWidth = 0.4; ctx.stroke();
    ctx.beginPath(); path(HG.glow); ctx.fillStyle = col.sun; ctx.fill(); ctx.strokeStyle = "rgba(32,33,36,.45)"; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); path({type: "Sphere"}); ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.5; ctx.stroke();
    // the route, leg by leg
    ctx.lineCap = "round"; ctx.strokeStyle = "#202124";
    for (let i = 1; i < HG.pts.length; i++) {
      const a = HG.pts[i - 1], b = HG.pts[i]; if (a.ll[0] === b.ll[0] && a.ll[1] === b.ll[1]) continue;
      const doneLeg = a.done && (b.done || b.here);
      ctx.beginPath(); path({type: "LineString", coordinates: [a.ll, b.ll]});
      ctx.setLineDash(doneLeg ? [] : [3, 5]); ctx.lineWidth = doneLeg ? 1.6 : 1.2; ctx.globalAlpha = doneLeg ? 0.85 : 0.5; ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    // stops
    const ctr = [cam.lon, cam.lat], front = (ll) => d3.geoDistance(ll, ctr) < Math.PI / 2 - 0.03;
    for (const p of HG.pts) {
      if (!front(p.ll)) continue; const [x, y] = proj(p.ll);
      ctx.beginPath(); ctx.arc(x, y, p.here ? 6 : 4.2, 0, 7); ctx.fillStyle = p.done || p.here ? "#202124" : "#fff"; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = p.done || p.here ? "#fff" : "#202124"; ctx.stroke();
    }
    const h = HG.pts.find((p) => p.here);
    if (h && front(h.ll)) {
      const [x, y] = proj(h.ll), ph = reduce ? 0.4 : (t % 1800) / 1800;
      ctx.beginPath(); ctx.arc(x, y, 9 + ph * 12, 0, 7); ctx.lineWidth = 2; ctx.strokeStyle = "#202124"; ctx.globalAlpha = 1 - ph; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.font = "600 12px Inter, sans-serif"; ctx.textAlign = x > W * 0.62 ? "right" : "left"; ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "#fff"; ctx.fillStyle = "#202124";
      const tx = x + (ctx.textAlign === "left" ? 14 : -14);
      ctx.strokeText(h.name, tx, y + 4); ctx.fillText(h.name, tx, y + 4);
      ctx.font = "500 10px Inter, sans-serif"; const lbl = HG.started ? "YOU'RE HERE" : "START HERE"; ctx.strokeText(lbl, tx, y - 9); ctx.fillText(lbl, tx, y - 9);
    }
  }
  function drawDashboard(force) {
    if (typeof store === "undefined" || typeof processed === "undefined" || !el("hm-stats")) return;
    const onHome = !el("v-home").hidden;
    const marks = [...store.marks.entries()], posts = [...store.posts.values()];
    const sig = JSON.stringify([marks.length, marks.reduce((a, [, m]) => a + (m?.at || 0), 0), posts.map((p) => [p.status, p.title]), store.moments?.size || 0, goal()]);
    if (!force && (!onHome || sig === homeSig)) return; homeSig = sig;

    const junk = (c) => typeof isJunk === "function" && isJunk(c);
    const elig = processed.filter((c) => !junk(c)), rOf = (c) => markOf(c.id)?.r;
    const done = elig.filter(rOf).length, total = elig.length, pct = total ? done / total : 0;
    const kept = processed.filter((c) => ["best", "keep"].includes(rOf(c))).length, best = processed.filter((c) => rOf(c) === "best").length;
    const momCount = typeof momentsOf === "function" ? processed.reduce((a, c) => a + momentsOf(c.id).length, 0) : 0;
    const momClips = typeof momentsOf === "function" ? processed.filter((c) => momentsOf(c.id).length).length : 0;
    const editedSet = typeof EDITED !== "undefined" ? EDITED : new Set(["cut", "approved", "scheduled", "posted"]);
    const made = posts.length, edited = posts.filter((p) => editedSet.has(p.status) || ["edit", "render"].includes(p.status)).length, posted = posts.filter((p) => p.status === "posted").length;

    // activity from your marks
    const perDay = new Map();
    for (const [, m] of marks) if (m?.at) { const k = dkey(m.at); perDay.set(k, (perDay.get(k) || 0) + 1); }
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
    let streak = 0, s0 = perDay.get(dkey(today)) ? 0 : 1;
    while (perDay.get(dkey(back(s0 + streak)))) streak++;
    const monday = back((today.getDay() + 6) % 7);
    let week = 0; for (let i = 0; i <= (today.getDay() + 6) % 7; i++) week += perDay.get(dkey(back(i))) || 0;
    void monday;

    // chapters (stops)
    const stops = (DATA.stops || []).map((s) => {
      const cs = processed.filter((c) => (c.region || c.city) === (s.area || s.city) && !!c.pre === !!s.before_trip);
      const ce = cs.filter((c) => !junk(c)), r = ce.filter(rOf).length;
      const ids = new Set(cs.map((c) => c.id));
      const np = posts.filter((p) => (typeof postItems === "function" ? postItems(p) : []).some((it) => ids.has(it.clip))).length;
      const cover = cs.find((c) => rOf(c) === "best" && c.sp) || [...cs].filter((c) => c.sp && !junk(c)).sort((a, b) => (b.luma || 0) - (a.luma || 0))[0] || cs.find((c) => c.sp);
      return {...s, cs, total: ce.length, rated: r, posts: np, cover, done: ce.length > 0 && r >= ce.length};
    }).filter((s) => s.cs.length);
    const cur = stops.findIndex((s) => !s.done);

    // hero
    const h = today.getHours ? new Date().getHours() : 12;
    el("hm-eyebrow").textContent = `${h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"}, ${window.__GTA_OWNER?.name || "there"}`;
    const nextC = elig.find((c) => !rOf(c));
    const nextPlace = nextC ? (nextC.region || nextC.city || "").split(/[-,]/)[0] : "";
    const nextDay = nextC ? nextC.t.slice(0, 10) : null, nextLbl = nextC ? (nextPlace ? `${nextPlace}${nextC.pre ? "" : " · Day " + nextC.day}` : nextC.pre ? "the first clips" : "Day " + nextC.day) : "";
    if (!total) { el("hm-title").textContent = "Your footage is on its way"; el("hm-sub").innerHTML = "Clips appear here as Colab imports them from Google Drive."; }
    else if (!done) { el("hm-title").textContent = "Your trip is waiting to be told"; el("hm-sub").innerHTML = `<b>${nf(total)} clips</b> are ready to review. Rating ten takes about two minutes, and every keeper brings the first post closer.`; }
    else if (done < total) { el("hm-title").textContent = `${Math.round(pct * 100)}% of your footage reviewed`; el("hm-sub").innerHTML = `<b>${nf(done)} of ${nf(total)}</b> clips rated and <b>${nf(kept)} keepers</b> found so far.${streak > 1 ? ` You're on a <b>${streak}-day streak</b>, keep it going.` : week ? ` <b>${week}</b> rated this week.` : ""}`; }
    else { el("hm-title").textContent = "Every clip so far is reviewed"; el("hm-sub").innerHTML = `All ${nf(total)} imported clips are rated, with <b>${nf(kept)} keepers</b>. Turn them into posts next.`; }
    el("hm-cta").innerHTML = (nextC ? `<button class="pill" data-review-day="${nextDay}">${ICON.eye.replace('width="18" height="18"', 'width="20" height="20"')}${done ? `Continue: ${esc(nextLbl)}` : `Start with ${esc(nextLbl)}`}</button>` : `<a class="pill" href="#posts">Build a post</a>`)
      + `<a class="pill ghost" href="#posts">Your posts${made ? ` (${made})` : ""}</a>`;

    // hero art: the trip on a 3D globe
    heroGlobe(stops, cur, done);

    // stat tiles
    const tile = (icon, k, v, of, bar, foot, cls = "") => `<div class="stile"><span class="k">${icon}${k}</span><span class="v">${v}${of ? `<small>/ ${of}</small>` : ""}</span>${bar != null ? `<span class="hbar ${cls}"><i style="width:${Math.min(100, bar * 100).toFixed(1)}%"></i></span>` : ""}<span class="f">${foot}</span></div>`;
    el("hm-stats").innerHTML = [
      tile(ICON.eye, "Clips reviewed", nf(done), nf(total), pct, week ? `<b>+${nf(week)}</b> this week` : "Nothing rated yet this week"),
      tile(ICON.star, "Keepers", nf(kept), "", done ? kept / Math.max(done, 1) : 0, `${nf(best)} marked ★ best`, "sun"),
      tile(ICON.cut, "Moments picked", nf(momCount), "", kept ? Math.min(1, momClips / kept) : 0, `${nf(momClips)} of ${nf(kept)} keepers have moments`, "good"),
      tile(ICON.send, "Posts live", nf(posted), made ? nf(made) : "", made ? posted / made : 0, made ? `${nf(made)} planned · ${nf(edited)} edited` : "Plan one from a trip chapter"),
    ].join("");

    // streak + activity heatmap (last 12 weeks)
    const weeks = 18, start = back(weeks * 7 - 1 + ((today.getDay() + 6) % 7) - 6);
    const cells = [];
    for (let i = 0; i < weeks * 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); const k = dkey(d), v = perDay.get(k) || 0, fut = d > today;
      cells.push(`<i class="${fut ? "" : v >= 40 ? "l4" : v >= 20 ? "l3" : v >= 8 ? "l2" : v ? "l1" : ""}${k === dkey(today) ? " today" : ""}" style="${fut ? "visibility:hidden" : ""}" title="${shortDay(k)}: ${v} rated"></i>`); }
    const activeDays = [...perDay.keys()].filter((k) => k >= dkey(back(6))).length;
    el("hm-streak").innerHTML = `<div class="streak"><span class="num${streak ? " on" : ""}">${streak}</span><span class="lbl"><b>day streak</b>${streak ? (perDay.get(dkey(today)) ? "You reviewed today." : "Review today to keep it.") : "Rate one clip to start one."}</span></div>
      <div class="heat">${cells.join("")}</div><div class="heatkey"><span>18 weeks ago</span><span>${activeDays} of the last 7 days active</span></div>`;

    // weekly goal
    const G = goal(), gp = Math.min(1, week / G), left = Math.max(0, G - week);
    el("hm-goal").innerHTML = `<h3>This week's goal</h3><div class="goalnums"><b>${nf(week)}</b><span>/ ${G} clips</span></div><span class="hbar good"><i style="width:${(gp * 100).toFixed(1)}%"></i></span>
      <p class="sub">${left ? `${left} more to hit your goal${nextC ? `. That's about ${Math.max(1, Math.round(left / 5))} min of rating.` : "."}` : "Goal reached. Great week."}</p>
      <div class="goalset">Goal: ${[25, 50, 100, 200].map((g) => `<button data-goal="${g}" aria-pressed="${g === G}">${g}</button>`).join("")}</div>`;

    // milestones
    const M = [["Rate your first clip", done, 1], ["Rate 50 clips", done, 50], ["Mark a ★ best clip", best, 1], ["Pick 10 moments", momCount, 10], ["Plan your first post", made, 1],
      ["Rate 250 clips", done, 250], ["Get your first edit from Claude", edited, 1], ["Publish your first post", posted, 1], ["Rate 1,000 clips", done, 1000], ["Publish 10 posts", posted, 10]];
    const got = M.filter(([, v, t]) => v >= t), todo = M.filter(([, v, t]) => v < t).slice(0, 3);
    el("hm-miles").innerHTML = `<div class="hm-h"><h3>Milestones</h3><span>${got.length} of ${M.length}</span></div>
      <div class="miles">${todo.map(([t, v, need], i) => `<div class="mile${i ? "" : " next"}"><span class="ic">${i ? ICON.lock : ICON.flag}</span><div class="t"><span>${t}<small>${need > 1 ? `${nf(Math.min(v, need))} / ${nf(need)}` : "next"}</small></span>${need > 1 ? `<span class="hbar sun"><i style="width:${(Math.min(1, v / need) * 100).toFixed(1)}%"></i></span>` : ""}</div></div>`).join("") || `<p class="sub">Every milestone unlocked. Legend.</p>`}</div>
      ${got.length ? `<div class="got">${got.map(([t]) => `<span>✓ ${t}</span>`).join("")}</div>` : ""}`;

    // trip chapters
    el("hm-chapters").innerHTML = stops.map((s, i) => `<button class="chap" data-chapter="${esc(s.area || s.city || "")}">
      <div class="thumb" style="${s.cover ? thumbStyle(s.cover, coverFrame(s.cover)) : ""}">${s.done ? `<span class="tag done">✓ Reviewed</span>` : i === cur ? `<span class="tag">Up next</span>` : ""}</div>
      <div class="b"><strong>${esc(placeName(s))}</strong><small>${esc(s.country || "")}${s.before_trip ? " · before the trip" : ""} · ${shortDay(s.start)} – ${shortDay(s.end)}</small>
      <span class="hbar${s.done ? " good" : ""}"><i style="width:${s.total ? (s.rated / s.total * 100).toFixed(1) : 0}%"></i></span>
      <span class="row2"><span>${nf(s.rated)} / ${nf(s.total)} rated</span><span>${s.posts ? `${s.posts} post${s.posts > 1 ? "s" : ""}` : "No post yet"}</span></span></div></button>`).join("")
      || `<p class="sub">Chapters appear once clips have places.</p>`;

    // import summary line
    const sm = DATA.summary || {}, imp = sm.stages_done?.meta || 0, all = sm.videos || 0;
    el("hm-import-sum").textContent = all ? (imp >= all ? `All ${nf(all)} clips imported` : `${nf(imp)} of ${nf(all)} clips imported · open for details`) : "";
    el("hm-import-bar").style.width = all ? `${(imp / all * 100).toFixed(1)}%` : "0";
  }
})();
