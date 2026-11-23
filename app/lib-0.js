
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

    // hero art: the journey as a route, stops you've finished are filled in
    const pts = stops.length ? stops : [{city: "Start"}];
    const n = pts.length, P = pts.map((_, i) => { const t = n > 1 ? i / (n - 1) : 0.5; return [46 + t * 308, 212 - t * 140 + Math.sin(t * Math.PI * 2) * 18]; });
    let path = "", donePath = "";
    for (let i = 1; i < n; i++) { const [x0, y0] = P[i - 1], [x1, y1] = P[i], seg = `M${x0} ${y0}C${x0 + 40} ${y0} ${x1 - 40} ${y1} ${x1} ${y1}`; if (pts[i].done || i <= cur && pts[i - 1].done) donePath += seg; else path += seg; }
    const lab = (s) => esc(placeName(s));
    el("hm-art").innerHTML = `<rect width="400" height="300" style="fill:var(--sky)"/>
      <path d="M0 300V200c70-24 120 14 180-14s120-80 220-56v170z" style="fill:var(--sun)"/>
      <path d="M0 300v-46c80-12 150 26 230 8s110-34 170-26v64z" style="fill:var(--hero)"/>
      <path d="${path}" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="6 7" stroke-linecap="round"/>
      <path d="${donePath}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      ${P.map(([x, y], i) => { const s = pts[i], here = i === cur;
        const anchor = i === 0 ? "start" : i === n - 1 ? "end" : "middle", tx = i === 0 ? x - 8 : i === n - 1 ? x + 8 : x;
        return `${here ? `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="#202124" stroke-width="2"/>` : ""}<circle cx="${x}" cy="${y}" r="${here ? 8 : 6}" fill="${s.done || here ? "#fff" : "#a9c4d6"}" stroke="#fff" stroke-width="2.5"/>
        <text x="${tx}" y="${y - (here ? 22 : 16)}" text-anchor="${anchor}" font-family="Inter, sans-serif" font-size="${here ? 14 : 12}" font-weight="${here ? 700 : 600}" fill="#202124">${lab(s)}</text>
        ${here ? `<text x="${tx}" y="${y - 40}" text-anchor="${anchor}" font-family="Inter, sans-serif" font-size="11" font-weight="500" fill="#202124" opacity=".7">${done ? "YOU'RE HERE" : "START HERE"}</text>` : ""}`; }).join("")}`;

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
