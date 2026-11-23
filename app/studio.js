/* GoPro Travels app: Post Studio workspace. One post, four steps (Brief, Moments, Edit, Publish), one clear next action.
   Replaces the Studio's screens only: posts, moments, requests and edits keep their saved shapes, and asking Claude,
   saving and the edit version screen still run through the Library's own functions.
   Public file: it must never contain footage data. */
(() => {
  "use strict";
  if (typeof drawPost !== "function" || typeof drawEdit !== "function") return;
  const baseEdit = drawEdit;
  const STEPS = [["brief", "Brief"], ["moments", "Moments"], ["edit", "Edit"], ["post", "Publish"]];
  const PAGE = 48;
  const FILTERS = [["all", "All"], ["kept", "Your picks"], ["best", "★ Best"], ["talk", "Talking"], ["action", "Action"], ["steady", "Steady"], ["change", "Scene change"]];
  const SHORT = {
    aspect: {"9:16": "9:16", "4:5": "4:5", "1:1": "1:1", "16:9": "16:9"},
    pace: {"": "Claude decides", calm: "Calm", medium: "Medium", fast: "Fast"},
    audio: {"": "Claude decides", original: "Original", voiceover: "Voiceover", music: "Music", mix: "Original + music"},
    captions: {"": "Claude decides", none: "None", keywords: "Key words", speech: "Subtitles", story: "Story lines"},
  };
  const ui = {post: null, view: "brief", sel: null, t: 0, filter: "all", day: "near", shown: PAGE, undo: [], sig: "", list: []};
  const q = (s, r = document) => r.querySelector(s);
  const len = (s) => s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : `${(+s || 0).toFixed(1)} s`;
  const clipName = (c) => c?.title || (c ? `${c.region || c.city || "Clip"} ${c.t.slice(11, 16)}` : "Missing clip");
  const dayName = (c) => c ? (c.pre ? "Before" : `Day ${c.day}`) : "";
  const total = (p) => p.items.reduce((a, it) => a + itemLen(it), 0);
  const approved = (p) => !!p.edit && EDITED.has(p.status);
  const waiting = (p) => !!(p.id && window.__requestNote?.(p.id));
  const copy = async (text, done) => { try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast(`Copy this: ${text}`, true); } };

  const css = document.createElement("style");
  css.textContent = `
    html body dialog#pdlg.studio { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; border: 0; border-radius: 0; padding: 0; background: var(--bg); overflow: hidden; }
    html body #pdlg.studio #pdetail { height: 100%; padding: 0; gap: 0; display: grid; grid-template-rows: auto auto minmax(0, 1fr); overflow: hidden; }
    .sx-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line); min-width: 0; }
    .sx-title { flex: 1 1 200px; min-width: 120px; font-size: 18px; font-weight: 700; color: var(--ink); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 6px 8px; }
    .sx-title:hover, .sx-title:focus { border-color: var(--line); background: var(--bg); }
    .sx-head select, .sx-head input[type=date] { padding: 6px 8px; font-size: 13px; }
    .sx-saved { font-size: 12px; color: var(--muted); white-space: nowrap; min-width: 48px; }
    .sx-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 6px 12px; font: inherit; font-size: 13px; font-weight: 650; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; text-decoration: none; white-space: nowrap; }
    .sx-btn:hover { border-color: var(--ink); }
    .sx-btn:disabled { opacity: .45; cursor: not-allowed; }
    .sx-btn.main { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .sx-btn.bad { color: var(--warn); }
    .sx-rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); background: var(--surface); border-bottom: 1px solid var(--line); }
    .sx-rail button { display: grid; grid-template-columns: 24px minmax(0, 1fr); column-gap: 8px; align-items: center; min-width: 0; padding: 8px 16px; text-align: left; color: var(--muted); background: none; border: 0; border-bottom: 2px solid transparent; cursor: pointer; font: inherit; }
    .sx-rail button[aria-current="step"] { color: var(--ink); border-bottom-color: var(--ink); }
    .sx-rail i { grid-row: span 2; display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--line); border-radius: 6px; font-style: normal; font-size: 12px; font-weight: 700; }
    .sx-rail .done i { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .sx-rail b { font-size: 13px; }
    .sx-rail span { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #sx-view { min-height: 0; overflow: auto; }
    .sx-page { max-width: 1040px; margin: 0 auto; padding: 22px 20px 40px; display: grid; gap: 18px; }
    .sx-two { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); gap: 24px; align-items: start; }
    .sx-stack { display: grid; gap: 14px; min-width: 0; }
    .sx-page h2 { margin: 0; font-size: 20px; }
    .sx-f { display: grid; gap: 5px; font-size: 13px; font-weight: 600; min-width: 0; }
    .sx-f small { font-weight: 400; color: var(--muted); }
    .sx-f textarea, .sx-f input { width: 100%; font: inherit; font-weight: 400; }
    .sx-f textarea { min-height: 76px; }
    #b-story { min-height: 112px; font-size: 15px; }
    .sx-seg { display: flex; flex-wrap: wrap; gap: 4px; }
    .sx-seg button { padding: 6px 10px; font: inherit; font-size: 13px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
    .sx-seg button[aria-pressed="true"] { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .sx-seg input { width: 76px; padding: 5px 8px; }
    #st-moments { height: 100%; min-height: 560px; display: grid; grid-template-columns: minmax(320px, 1fr) minmax(420px, 1.25fr); grid-template-rows: minmax(0, 1fr) auto; }
    .sx-pool { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); border-right: 1px solid var(--line); }
    .sx-tools { display: grid; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--surface); }
    .sx-tools .sx-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .sx-tools select { padding: 5px 8px; font-size: 13px; max-width: 190px; }
    .sx-chips { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
    .sx-chips button { flex: none; padding: 4px 9px; font: inherit; font-size: 12px; font-weight: 600; color: var(--muted); background: none; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
    .sx-chips button[aria-pressed="true"] { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .sx-grid { overflow: auto; padding: 10px 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(142px, 1fr)); gap: 8px; align-content: start; }
    .sx-card { position: relative; display: grid; gap: 3px; min-width: 0; padding: 3px 3px 5px; text-align: left; color: var(--ink); background: var(--surface); border: 2px solid transparent; border-radius: 7px; cursor: pointer; font: inherit; }
    .sx-card:hover { border-color: var(--line); }
    .sx-card.on { border-color: var(--ink); }
    .sx-th { aspect-ratio: 16 / 9; border-radius: 4px; background-color: var(--thumb-bg); background-repeat: no-repeat; }
    .sx-card b, .sx-card span { padding: 0 3px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sx-card b { font-weight: 650; }
    .sx-card span { color: var(--muted); }
    .sx-plus { position: absolute; top: 7px; right: 7px; display: grid; place-items: center; width: 28px; height: 28px; font-size: 17px; font-weight: 700; color: #17191c; background: #fff; border: 1px solid #17191c; border-radius: 5px; cursor: pointer; }
    .sx-more { grid-column: 1 / -1; justify-self: center; }
    .sx-empty { grid-column: 1 / -1; padding: 28px 12px; text-align: center; color: var(--muted); font-size: 13px; }
    .sx-ins { min-height: 0; overflow: auto; padding: 14px 18px; display: grid; gap: 10px; align-content: start; }
    .sx-stage { position: relative; width: min(100%, calc((100dvh - 430px) * 16 / 9)); min-width: 280px; aspect-ratio: 16 / 9; justify-self: center; overflow: hidden; border-radius: 6px; background-color: #111; background-repeat: no-repeat; }
    .sx-shade { position: absolute; top: 0; bottom: 0; background: rgba(0, 0, 0, .58); }
    .sx-tc { position: absolute; left: 7px; bottom: 7px; padding: 2px 6px; color: #fff; background: rgba(0, 0, 0, .75); border-radius: 4px; font-size: 12px; font-variant-numeric: tabular-nums; }
    .sx-strip { position: relative; height: 54px; display: flex; overflow: hidden; border-radius: 5px; background: var(--thumb-bg); cursor: ew-resize; touch-action: none; user-select: none; }
    .sx-strip > div { flex: 1; min-width: 0; background-repeat: no-repeat; opacity: .5; pointer-events: none; }
    .sx-range { position: absolute; top: 0; bottom: 0; border: 2px solid #fff; outline: 1px solid #17191c; box-sizing: border-box; pointer-events: none; }
    .sx-range u { position: absolute; top: -2px; bottom: -2px; width: 12px; background: #fff; pointer-events: auto; cursor: col-resize; }
    .sx-range u:first-child { left: -2px; } .sx-range u:last-child { right: -2px; }
    .sx-play { position: absolute; top: 0; bottom: 0; width: 2px; background: #ffd23f; pointer-events: none; }
    .sx-info { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 2px 12px; }
    .sx-info b { font-size: 15px; } .sx-info span { font-size: 12px; color: var(--muted); }
    .sx-say { margin: 0; font-size: 13px; color: var(--muted); }
    .sx-acts { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .sx-acts input.t { width: 72px; padding: 6px; font-variant-numeric: tabular-nums; }
    .sx-acts select { padding: 6px; font-size: 13px; }
    .sx-note { flex: 1 1 180px; min-width: 0; padding: 7px 9px; font: inherit; font-size: 13px; }
    kbd { padding: 0 4px; font: 11px ui-monospace, monospace; border: 1px solid var(--line); border-radius: 3px; }
    .sx-keys { font-size: 12px; color: var(--muted); }
    .sx-tl { grid-column: 1 / -1; display: grid; gap: 6px; padding: 8px 12px 10px; background: var(--surface); border-top: 1px solid var(--line); min-width: 0; }
    .sx-tlhead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-size: 13px; }
    .sx-tlhead b { font-variant-numeric: tabular-nums; }
    .sx-meter { flex: 1 1 120px; height: 6px; border-radius: 3px; overflow: hidden; background: var(--line); }
    .sx-meter i { display: block; height: 100%; background: var(--ink); }
    .sx-meter.over i { background: var(--warn); }
    .sx-track { display: flex; gap: 3px; height: 62px; overflow-x: auto; }
    .sx-shot { position: relative; flex: var(--g) 0 72px; min-width: 72px; padding: 0; overflow: hidden; color: #fff; background-color: var(--thumb-bg); background-repeat: no-repeat; border: 2px solid transparent; border-radius: 5px; cursor: grab; font: inherit; }
    .sx-shot.on { border-color: var(--ink); outline: 1px solid var(--surface); }
    .sx-shot.drop { border-left: 3px solid #ffd23f; }
    .sx-shot span { position: absolute; left: 2px; bottom: 2px; padding: 0 4px; font-size: 11px; font-weight: 700; background: rgba(0, 0, 0, .78); border-radius: 3px; white-space: nowrap; }
    .sx-shot em { position: absolute; top: 2px; right: 2px; padding: 0 4px; font-size: 10px; font-style: normal; font-weight: 700; color: #17191c; background: #ffd23f; border-radius: 3px; }
    .sx-edit { max-width: 1080px; margin: 0 auto; padding: 20px; display: grid; gap: 14px; }
    .sx-wait { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--ink); border-radius: 7px; font-size: 14px; }
    .sx-count { justify-self: end; font-size: 12px; font-weight: 400; color: var(--muted); }
    @media (max-width: 900px) {
      .sx-head { flex-wrap: wrap; } .sx-title { order: 3; flex-basis: 100%; }
      .sx-rail button { grid-template-columns: 1fr; padding: 7px 4px; justify-items: center; } .sx-rail i { grid-row: auto; } .sx-rail span { display: none; }
      .sx-two { grid-template-columns: minmax(0, 1fr); }
      #st-moments { display: flex; flex-direction: column; height: auto; }
      .sx-pool { border-right: 0; order: 2; } .sx-grid { max-height: 52dvh; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sx-ins { order: 1; padding: 12px 16px; } .sx-tl { order: 3; position: sticky; bottom: 0; }
      .sx-stage { width: 100%; min-width: 0; } .sx-keys { display: none; }
    }
  `;
  document.head.append(css);

  /* ---------- where the post stands ---------- */
  const bestRange = (c) => {
    const m = momentsOf(c?.id)[0]; if (m) return [m.a, m.b, m.role || ""];
    const s = topSug(c); return s ? [s[0], s[1], KIND_ROLE[s[2]] || ""] : null;
  };
  const untrimmed = (p) => p.items.filter((it) => it.a == null && bestRange(byId.get(it.clip))).length;
  function homeView(p) {
    if (p.status === "scheduled" || p.status === "posted") return "post";
    if (["edit", "render", "cut"].includes(p.status) || (p.id && editsOf(p.id).length) || waiting(p)) return "edit";
    return p.items.length ? "moments" : "brief";
  }
  function nextAction(p) {
    const need = p.kind === "reel" ? 2 : 1, vers = p.id ? editsOf(p.id) : [], cur = vers.find((e) => e.v === studio.ver) || vers.at(-1);
    if (!(p.title || "").trim()) return ["Name this post", () => q("#p-title").focus()];
    if (p.status === "posted") return null;
    if (p.status === "scheduled") return ["Mark as posted", () => { setPostStatus("posted"); show("post"); }];
    if (p.status === "cut") return ["Schedule it", () => { setPostStatus("scheduled"); show("post"); }];
    if (approved(p)) return ["Copy render command", () => copy("render the approved posts", "Copied. Paste it into Claude Code")];
    if (cur) return [`Approve v${cur.v}`, () => { show("edit"); q("#ed-approve")?.click(); }];
    if (waiting(p)) return ["Copy edit command", () => copy("edit the requested posts", "Copied. Paste it into Claude Code")];
    if (p.items.length < need) return ["Add moments", () => show("moments")];
    if (untrimmed(p)) return [`Pick best seconds (${untrimmed(p)})`, () => { show("moments"); autoPick(); }];
    return ["Request edit", async () => { show("edit"); await askClaude("first"); }];
  }
  function stepNote(k, p) {
    const vers = p.id ? editsOf(p.id) : [];
    if (k === "brief") return (p.brief.story || "").trim() ? `${p.brief.length ? p.brief.length + " s · " : ""}${p.brief.aspect}` : "Story not written";
    if (k === "moments") return p.items.length ? `${p.items.length} · ${len(total(p))}${untrimmed(p) ? ` · ${untrimmed(p)} untrimmed` : ""}` : "None yet";
    if (k === "edit") return approved(p) ? `v${p.edit} approved` : waiting(p) ? "Waiting for Claude Code" : vers.length ? `${vers.length} version${vers.length > 1 ? "s" : ""} to review` : "Not requested";
    return p.status === "posted" ? "Posted" : p.status === "scheduled" ? `Scheduled${p.scheduled ? " " + fmtShort(p.scheduled) : ""}` : p.scheduled ? `Planned ${fmtShort(p.scheduled)}` : "No date";
  }
  const stepDone = (k, p) => k === "brief" ? !!(p.brief.story || "").trim() : k === "moments" ? p.items.length > 0 && !untrimmed(p) : k === "edit" ? approved(p) : p.status === "posted";
  function drawChrome() {
    const p = draft, rail = q("#sx-rail"), slot = q("#sx-next"); if (!p || !rail) return;
    rail.innerHTML = STEPS.map(([k, n], i) => `<button data-v="${k}" class="${stepDone(k, p) ? "done" : ""}" ${ui.view === k ? 'aria-current="step"' : ""}><i>${stepDone(k, p) ? "✓" : i + 1}</i><b>${n}</b><span>${esc(stepNote(k, p))}</span></button>`).join("");
    const a = nextAction(p);
    slot.innerHTML = a ? `<button class="sx-btn main" id="sx-go">${esc(a[0])}</button>` : "";
    if (a) q("#sx-go").onclick = a[1];
    if (!canSave() && a) q("#sx-go").disabled = true;
    ui.sig = signature(p);
  }
  const signature = (p) => [p.status, p.edit, waiting(p), p.id ? editsOf(p.id).length : 0].join("|");

  /* ---------- frame ---------- */
  drawPost = function () {
    const p = draft;
    if (ui.post !== p) Object.assign(ui, {post: p, view: homeView(p), sel: null, t: 0, filter: "all", day: "near", shown: PAGE, undo: []});
    $("pdlg").classList.add("studio");
    $("pdetail").innerHTML = `
      <header class="sx-head">
        <button class="sx-btn" id="p-close">← Posts</button>
        <input class="sx-title" id="p-title" value="${esc(p.title)}" placeholder="Name this post" aria-label="Post title">
        <select id="p-kind" aria-label="Format">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${p.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <input type="date" id="p-sched" value="${esc(p.scheduled || "")}" aria-label="Planned post date">
        <span class="sx-saved" id="p-saved" role="status">${p.id ? "Saved" : ""}</span>
        <span id="sx-next"></span>
      </header>
      <nav class="sx-rail" id="sx-rail" aria-label="Post steps"></nav>
      <main id="sx-view"></main>`;
    $("p-close").onclick = () => $("pdlg").close();
    $("p-title").oninput = () => { draft.title = $("p-title").value.trim(); queueSave(); drawChrome(); };
    $("p-kind").onchange = () => {
      const old = briefDefaults(draft.kind || "reel").aspect, kind = $("p-kind").value;
      if (draft.brief.aspect === old) draft.brief.aspect = briefDefaults(kind).aspect;
      draft.kind = kind; queueSave(); show(ui.view);
    };
    $("p-sched").onchange = () => { draft.scheduled = $("p-sched").value; queueSave(); drawChrome(); };
    $("sx-rail").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) show(b.dataset.v); };
    show(ui.view);
  };
  function show(v) {
    ui.view = v;
    const box = $("sx-view");
    box.innerHTML = v === "moments" ? `<div id="st-moments"></div>` : v === "edit" ? `<section class="sx-edit" id="st-edit"></section>` : `<div id="st-brief"></div>`;
    box.scrollTop = 0;
    if (v === "moments") drawMoments(); else if (v === "edit") drawEdit(); else drawBrief();
    drawChrome();
    if (!canSave()) $("pdetail").querySelectorAll("input,select,textarea,button:not(#p-close):not([data-v])").forEach((x) => { x.disabled = true; });
  }
  setPostStatus = function (s) { draft.status = s; queueSave(); drawChrome(); if (ui.view === "edit") drawEdit(); };

  /* ---------- brief and publish ---------- */
  const seg = (k, v) => `<div class="sx-seg" role="group" data-seg="${k}">${BRIEF_OPTS[k].map(([x]) => `<button type="button" data-x="${x}" aria-pressed="${String(v ?? "") === x}">${esc(SHORT[k][x])}</button>`).join("")}</div>`;
  drawBrief = function () {
    const box = $("st-brief"), p = draft; if (!box) return;
    if (ui.view === "post") return drawPublish(box, p);
    const br = p.brief;
    box.innerHTML = `<div class="sx-page"><div class="sx-two">
      <div class="sx-stack">
        <h2>What is this post?</h2>
        <label class="sx-f">The story <small>One or two sentences. This is what Claude cuts toward.</small><textarea id="b-story" data-b="story" placeholder="Overwhelmed on the first night, then I find the street food and fall for the city.">${esc(br.story || "")}</textarea></label>
        <div class="sx-f">Length<div class="sx-seg" data-len>${[15, 30, 45, 60, 90].map((n) => `<button type="button" data-n="${n}" aria-pressed="${+br.length === n}">${n} s</button>`).join("")}<input type="number" id="b-length" min="3" max="3600" value="${esc(br.length ?? "")}" aria-label="Custom length in seconds"></div></div>
        <div class="sx-f">Shape${seg("aspect", br.aspect)}</div>
        <div class="sx-f">Pace${seg("pace", br.pace)}</div>
        <div class="sx-f">Sound${seg("audio", br.audio)}</div>
        <div class="sx-f">Text on screen${seg("captions", br.captions)}</div>
      </div>
      <div class="sx-stack">
        <h2>Direction</h2>
        <label class="sx-f">Mood<input data-b="mood" value="${esc(br.mood || "")}" placeholder="Chill, then energetic"></label>
        <label class="sx-f">Must include<input data-b="include" value="${esc(br.include || "")}" placeholder="End on the sunset"></label>
        <label class="sx-f">Avoid<input data-b="avoid" value="${esc(br.avoid || "")}" placeholder="The blurry tuk-tuk shot"></label>
        <label class="sx-f">Reels you like <small>Paste links, one per line.</small><textarea data-b="refs">${esc(br.refs || "")}</textarea></label>
        <label class="sx-f">Anything else for Claude<textarea data-p="notes">${esc(p.notes || "")}</textarea></label>
      </div>
    </div></div>`;
    box.oninput = (e) => {
      const t = e.target;
      if (t.dataset.b) draft.brief[t.dataset.b] = t.value;
      else if (t.dataset.p) draft[t.dataset.p] = t.value;
      else if (t.id === "b-length") { draft.brief.length = t.value === "" ? "" : Math.max(1, +t.value); box.querySelectorAll("[data-n]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.n === +t.value)); }
      else return;
      queueSave(); drawChrome();
    };
    box.onclick = (e) => {
      const n = e.target.closest("[data-n]"), x = e.target.closest("[data-x]");
      if (n) { draft.brief.length = +n.dataset.n; $("b-length").value = n.dataset.n; n.parentNode.querySelectorAll("[data-n]").forEach((b) => b.setAttribute("aria-pressed", b === n)); }
      else if (x) { draft.brief[x.parentNode.dataset.seg] = x.dataset.x; x.parentNode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === x)); }
      else return;
      queueSave(); drawChrome();
    };
  };
  function drawPublish(box, p) {
    box.innerHTML = `<div class="sx-page"><div class="sx-two">
      <div class="sx-stack">
        <h2>Publish</h2>
        <label class="sx-f">Hook <small>The first two seconds.</small><input data-p="hook" value="${esc(p.hook || "")}" placeholder="The line that stops the scroll"></label>
        <label class="sx-f"><span style="display:flex;justify-content:space-between">Caption <span class="sx-count" id="sx-count">${(p.caption || "").length} / 2200</span></span><textarea data-p="caption" maxlength="2200" style="min-height:170px">${esc(p.caption || "")}</textarea></label>
        <div class="sx-acts"><button class="sx-btn" id="sx-copy">Copy caption</button></div>
        <label class="sx-f">Instagram link once posted<input type="url" data-p="igUrl" value="${esc(p.igUrl || "")}" placeholder="https://www.instagram.com/reel/…"></label>
      </div>
      <div class="sx-stack"><h2>Suggestions</h2>${ideasHTML(p)}
        ${p.id ? `<button class="sx-btn bad" id="p-del" style="justify-self:start">Delete post</button>` : ""}</div>
    </div></div>`;
    box.onclick = null;
    box.oninput = (e) => {
      const f = e.target.dataset.p; if (!f) return;
      draft[f] = e.target.value; if (f === "caption") $("sx-count").textContent = `${e.target.value.length} / 2200`;
      queueSave();
    };
    $("sx-copy").onclick = () => (draft.caption ? copy(draft.caption, "Caption copied") : toast("Write a caption first", true));
    box.querySelectorAll("button.use").forEach((b) => { b.onclick = () => { draft[b.dataset.field] = b.dataset.text; queueSave(); drawBrief(); }; });
    if ($("p-del")) {
      let armed = false;
      $("p-del").onclick = async (e) => {
        if (!armed) { armed = true; e.target.textContent = "Click again to delete this post"; return; }
        clearTimeout(studio.timer); const id = draft.id; draft = null; await deletePost(id); $("pdlg").close();
      };
    }
  }

  /* ---------- moments ---------- */
  const remember = () => { ui.undo.push(JSON.stringify(draft.items)); if (ui.undo.length > 50) ui.undo.shift(); };
  function changed(redrawPool) { queueSave(); drawTimeline(); drawInspector(); if (redrawPool) drawPool(); drawChrome(); }
  function undo() {
    const s = ui.undo.pop(); if (!s) return toast("Nothing to undo");
    draft.items = JSON.parse(s); ui.sel = null; queueSave(); drawMoments(); drawChrome(); toast("Undone");
  }
  function autoPick() {
    const n = untrimmed(draft); if (!n) return;
    remember();
    for (const it of draft.items) {
      if (it.a != null) continue;
      const r = bestRange(byId.get(it.clip)); if (!r) continue;
      it.a = r[0]; it.b = r[1]; if (!it.role && r[2]) it.role = r[2];
    }
    ui.sel = null; queueSave(); drawMoments(); drawChrome();
    toast(`Picked the best seconds in ${n} clip${n > 1 ? "s" : ""}. ⌘Z undoes it`);
  }
  function fromDay(p, day) {
    const out = [], overlap = (id, a, b) => p.items.some((it) => it.clip === id && (it.a == null || Math.min(it.b ?? 1e9, b) - Math.max(it.a, a) > 0.5 * (b - a)));
    for (const c of processed) {
      if (c.t.slice(0, 10) !== day || markOf(c.id)?.r === "reject" || isJunk(c)) continue;
      for (const m of momentsOf(c.id)) if (!overlap(c.id, m.a, m.b)) out.push({c, a: m.a, b: m.b, kind: "kept", role: m.role || "", note: m.note || "", score: 2});
      for (const s of c.sug || []) if (!overlap(c.id, s[0], s[1]) && !momentsOf(c.id).some((m) => Math.abs(m.a - s[0]) < 0.5)) out.push({c, a: s[0], b: s[1], kind: s[2], role: KIND_ROLE[s[2]] || "", note: "", score: s[3]});
    }
    return out.sort((x, y) => y.score - x.score);
  }
  function poolList() {
    const near = candidates(draft); studio.candList = near.list;  // Claude's alternates, as before
    const base = ui.day === "near" ? near.list : fromDay(draft, ui.day), f = ui.filter;
    return base.filter((x) => f === "all" || (f === "kept" ? x.kind === "kept" : f === "best" ? markOf(x.c.id)?.r === "best" : x.kind === f));
  }
  drawMoments = function () {
    const box = $("st-moments"); if (!box) return;
    const days = [...new Set(processed.map((c) => c.t.slice(0, 10)))].sort();
    box.innerHTML = `
      <section class="sx-pool" aria-label="Footage">
        <div class="sx-tools">
          <div class="sx-line"><b style="font-size:14px">Footage <span class="muted" id="sx-found" style="font-weight:400"></span></b>
            <select id="sx-day" aria-label="Footage day"><option value="near">Around this post</option>${days.map((d) => `<option value="${d}" ${ui.day === d ? "selected" : ""}>${esc(fmtShort(d))}</option>`).join("")}</select></div>
          <div class="sx-chips" id="sx-chips">${FILTERS.map(([k, n]) => `<button data-f="${k}" aria-pressed="${ui.filter === k}">${n}</button>`).join("")}</div>
        </div>
        <div class="sx-grid" id="sx-grid"></div>
      </section>
      <section class="sx-ins" id="sx-ins" aria-label="Selected moment"></section>
      <section class="sx-tl" id="sx-tl" aria-label="Post timeline"></section>`;
    $("sx-day").onchange = (e) => { ui.day = e.target.value; ui.shown = PAGE; drawPool(); };
    $("sx-chips").onclick = (e) => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      ui.filter = b.dataset.f; ui.shown = PAGE;
      $("sx-chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); drawPool();
    };
    $("sx-grid").onclick = (e) => {
      if (e.target.closest("#sx-more")) { ui.shown += PAGE; return drawPool(); }
      const card = e.target.closest(".sx-card"); if (!card) return;
      const x = ui.list[+card.dataset.k]; if (!x) return;
      if (e.target.closest(".sx-plus")) return addCand(x);
      pick({kind: "cand", x});
    };
    drawPool(); drawTimeline();
    if (!ui.sel && draft.items.length) ui.sel = {kind: "item", i: 0};
    if (!ui.sel && ui.list[0]) ui.sel = {kind: "cand", x: ui.list[0]};
    if (ui.sel) ui.t = rangeOf()?.a ?? 0;
    drawInspector(); markSel();
  };
  function drawPool() {
    const grid = $("sx-grid"); if (!grid) return;
    ui.list = poolList();
    $("sx-found").textContent = `· ${ui.list.length}`;
    grid.innerHTML = ui.list.slice(0, ui.shown).map((x, k) => `<div class="sx-card" role="button" tabindex="0" data-k="${k}" aria-label="${esc(clipName(x.c))}, ${fmtT(x.a)}">
      <div class="sx-th" style="${thumbStyle(x.c, nearestFrame(x.c, (x.a + x.b) / 2))}"></div>
      <button class="sx-plus" aria-label="Add to post" title="Add to post (A)">+</button>
      <b>${esc(clipName(x.c))}</b><span>${x.kind === "kept" ? "Your pick" : esc(KIND_NAME[x.kind] || x.kind)} · ${(x.b - x.a).toFixed(1)} s · ${esc(dayName(x.c))}${markOf(x.c.id)?.r === "best" ? " · ★" : ""}</span></div>`).join("")
      + (ui.list.length > ui.shown ? `<button class="sx-btn sx-more" id="sx-more">Show more</button>` : "")
      || `<p class="sx-empty">${draft.items.length || ui.day !== "near" ? "Nothing matches this filter." : "Choose a day above to see its footage."}</p>`;
    markSel();
  }
  function markSel() {
    const x = ui.sel?.kind === "cand" ? ui.sel.x : null;
    document.querySelectorAll("#sx-grid .sx-card").forEach((n) => n.classList.toggle("on", !!x && ui.list[+n.dataset.k] === x));
    document.querySelectorAll("#sx-track .sx-shot").forEach((n) => n.classList.toggle("on", ui.sel?.kind === "item" && +n.dataset.i === ui.sel.i));
  }
  function pick(sel) { ui.sel = sel; ui.t = rangeOf()?.a ?? 0; drawInspector(); markSel(); }
  function addCand(x) {
    remember();
    draft.items.push({clip: x.c.id, a: x.a, b: x.b, role: x.role || "", note: x.note || ""});
    if (["idea", undefined, ""].includes(draft.status)) draft.status = "clips";
    const at = ui.list.indexOf(x);
    ui.list = poolList();
    const next = ui.list[Math.min(at, ui.list.length - 1)];
    ui.sel = next ? {kind: "cand", x: next} : {kind: "item", i: draft.items.length - 1};
    ui.t = rangeOf()?.a ?? 0;
    changed(true);
  }
  function rangeOf() {
    const s = ui.sel; if (!s) return null;
    if (s.kind === "cand") return {c: s.x.c, a: s.x.a, b: s.x.b};
    const it = draft.items[s.i]; if (!it) return null;
    const c = byId.get(it.clip);
    return {c, it, a: it.a ?? 0, b: it.b ?? c?.dur ?? 0, whole: it.a == null};
  }
  function setRange(a, b, final) {
    const r = rangeOf(); if (!r) return;
    const dur = r.c?.dur || b; a = clamp(r2(a), 0, Math.max(0, dur - 0.5)); b = clamp(r2(b), a + 0.5, dur);
    if (ui.sel.kind === "cand") { ui.sel.x.a = a; ui.sel.x.b = b; }
    else { const it = draft.items[ui.sel.i]; it.a = a; it.b = b; if (final) changed(); }
    paintStrip();
  }
  function paintStrip() {
    const r = rangeOf(), strip = $("sx-strip"); if (!r || !strip) return;
    const d = r.c?.dur || 1;
    const range = q(".sx-range", strip); range.style.left = `${(r.a / d) * 100}%`; range.style.width = `${((r.b - r.a) / d) * 100}%`;
    q(".sx-play", strip).style.left = `${(ui.t / d) * 100}%`;
    $("sx-stage").setAttribute("style", `${thumbStyle(r.c, nearestFrame(r.c, ui.t))};background-size:${S.per_clip * 100}% ${S.per_sheet * 100}%`);
    $("sx-tc").textContent = `${fmtT(ui.t)} · ${(r.b - r.a).toFixed(1)} s selected`;
    if ($("sx-in")) { if (document.activeElement !== $("sx-in")) $("sx-in").value = fmtT(r.a); if (document.activeElement !== $("sx-out")) $("sx-out").value = fmtT(r.b); }
  }
  function drawInspector() {
    const box = $("sx-ins"); if (!box) return;
    const r = rangeOf();
    if (!r?.c) { box.innerHTML = `<p class="sx-empty">Pick a moment from the footage to preview it here.</p>`; return; }
    const {c, it} = r, [w, h] = (ASPECT[draft.brief.aspect] || ASPECT["9:16"]), win = Math.min(1, (w / h) / (16 / 9)), side = ((1 - win) / 2) * 100;
    const words = (c.txs || []).filter(([s, e]) => e > r.a && s < r.b).map((x) => x[2]).join(" ").slice(0, 150);
    const link = DATA.player && c.drive ? itemsLink([{clip: c.id, a: r.a}], "light") : "";
    box.innerHTML = `
      <div class="sx-stage" id="sx-stage">${side > 0 ? `<div class="sx-shade" style="left:0;width:${side}%"></div><div class="sx-shade" style="right:0;width:${side}%"></div>` : ""}<span class="sx-tc" id="sx-tc"></span></div>
      <div class="sx-strip" id="sx-strip">${(c.ft || [0]).map((_, k) => `<div style="${thumbStyle(c, k)}"></div>`).join("")}<div class="sx-range" style="opacity:1"><u data-h="a"></u><u data-h="b"></u></div><i class="sx-play"></i></div>
      <div class="sx-info"><b>${esc(clipName(c))}</b><span>${esc([dayName(c), c.region || c.city, c.t.slice(11, 16), len(c.dur || 0) + " clip"].filter(Boolean).join(" · "))}</span></div>
      ${words ? `<p class="sx-say">“${esc(words)}”</p>` : ""}
      <div class="sx-acts">
        <input class="t" id="sx-in" aria-label="Start" value="${fmtT(r.a)}">–<input class="t" id="sx-out" aria-label="End" value="${fmtT(r.b)}">
        ${link ? `<a class="sx-btn" href="${esc(link)}" target="gopro-player" rel="noopener">▶ Watch</a>` : ""}
        ${it ? `<select id="sx-role" aria-label="Role">${roleOpts(it.role)}</select>
          <button class="sx-btn" id="sx-left" aria-label="Move earlier">←</button><button class="sx-btn" id="sx-right" aria-label="Move later">→</button><button class="sx-btn bad" id="sx-rm">Remove</button>`
        : `<button class="sx-btn main" id="sx-add">Add to post</button>`}
      </div>
      ${it ? `<div class="sx-acts"><input class="sx-note" id="sx-note" value="${esc(it.note || "")}" placeholder="Note for Claude, e.g. keep the sound" aria-label="Note for Claude"></div>` : ""}
      <div class="sx-keys"><kbd>A</kbd> add · <kbd>I</kbd> <kbd>O</kbd> set start and end at the yellow line · <kbd>←</kbd> <kbd>→</kbd> next moment · <kbd>⌫</kbd> remove · <kbd>⌘Z</kbd> undo</div>`;
    paintStrip(); wireStrip();
    const time = (id, key) => { $(id).onchange = (e) => {
      const t = parseT(e.target.value), now = rangeOf();
      if (t == null || t < 0 || t > (now.c.dur || 1e9)) { toast("Use seconds (12.5) or minutes:seconds (1:05), inside the clip", true); e.target.value = fmtT(now[key]); return; }
      if (now.it) remember();
      setRange(key === "a" ? t : now.a, key === "b" ? t : now.b, true);
    }; };
    time("sx-in", "a"); time("sx-out", "b");
    if ($("sx-add")) $("sx-add").onclick = () => addCand(ui.sel.x);
    if (it) {
      $("sx-role").onchange = (e) => { it.role = e.target.value; queueSave(); };
      $("sx-note").oninput = (e) => { it.note = e.target.value; queueSave(); };
      $("sx-left").onclick = () => moveItem(-1); $("sx-right").onclick = () => moveItem(1); $("sx-rm").onclick = removeItem;
    }
  }
  function wireStrip() {
    const strip = $("sx-strip"), toT = (e) => { const b = strip.getBoundingClientRect(); return clamp((e.clientX - b.left) / b.width, 0, 1) * (rangeOf()?.c?.dur || 0); };
    strip.onpointerdown = (e) => {
      const h = e.target.dataset?.h; strip.setPointerCapture(e.pointerId);
      if (h && rangeOf()?.it) remember();
      const move = (ev) => { const t = toT(ev), r = rangeOf(); ui.t = t; if (h === "a") setRange(t, r.b); else if (h === "b") setRange(r.a, t); else paintStrip(); };
      move(e);
      strip.onpointermove = move;
      strip.onpointerup = strip.onpointercancel = () => { strip.onpointermove = strip.onpointerup = strip.onpointercancel = null; if (h && ui.sel?.kind === "item") { const r = rangeOf(); setRange(r.a, r.b, true); } };
    };
  }
  function moveItem(d) {
    const i = ui.sel.i, j = i + d, l = draft.items; if (j < 0 || j >= l.length) return;
    remember(); [l[i], l[j]] = [l[j], l[i]]; ui.sel.i = j; changed();
  }
  function removeItem() {
    remember(); draft.items.splice(ui.sel.i, 1);
    ui.sel = draft.items.length ? {kind: "item", i: Math.min(ui.sel.i, draft.items.length - 1)} : null;
    if (ui.sel) ui.t = rangeOf().a;
    changed(true);
  }
  function drawTimeline() {
    const box = $("sx-tl"); if (!box) return;
    const p = draft, sum = total(p), target = +p.brief.length || 0, spare = untrimmed(p), pct = target ? Math.min(100, (sum / target) * 100) : 0;
    const say = !p.items.length ? "Add moments from the footage" : !target ? `${len(sum)} selected` : sum < target ? `${len(target - sum)} short of ${target} s` : sum <= target * 2 ? `Good: Claude can cut this to ${target} s` : `${len(sum)} is a lot for ${target} s`;
    const all = DATA.player && p.items.length ? itemsLink(p.items, "light", 0) : "";
    box.innerHTML = `<div class="sx-tlhead"><b>${p.items.length} moment${p.items.length === 1 ? "" : "s"} · ${len(sum)}</b><span class="muted">${esc(say)}</span>
        ${target ? `<div class="sx-meter ${sum > target * 2 ? "over" : ""}"><i style="width:${pct}%"></i></div>` : `<span style="flex:1"></span>`}
        ${spare ? `<button class="sx-btn main" id="sx-auto">Pick best seconds (${spare})</button>` : ""}
        ${all ? `<a class="sx-btn" href="${esc(all)}" target="gopro-player" rel="noopener">▶ Play all</a>` : ""}</div>
      <div class="sx-track" id="sx-track">${p.items.map((it, i) => { const c = byId.get(it.clip), whole = it.a == null; return `<button class="sx-shot" draggable="true" data-i="${i}" style="--g:${clamp(itemLen(it), 2, 10).toFixed(1)};${thumbStyle(c, whole ? coverFrame(c) : nearestFrame(c, (it.a + (it.b ?? it.a)) / 2))}" aria-label="Moment ${i + 1}, ${esc(clipName(c))}"><span>${i + 1} · ${len(itemLen(it))}</span>${whole ? "<em>untrimmed</em>" : ""}</button>`; }).join("")}</div>`;
    if ($("sx-auto")) $("sx-auto").onclick = autoPick;
    const track = $("sx-track"); let from = null;
    track.onclick = (e) => { const b = e.target.closest(".sx-shot"); if (b) pick({kind: "item", i: +b.dataset.i}); };
    track.ondragstart = (e) => { const b = e.target.closest(".sx-shot"); if (!b) return; from = +b.dataset.i; e.dataTransfer.effectAllowed = "move"; };
    track.ondragover = (e) => { if (from == null) return; e.preventDefault(); const o = e.target.closest(".sx-shot"); track.querySelectorAll(".sx-shot").forEach((x) => x.classList.toggle("drop", x === o)); };
    track.ondragend = () => { from = null; track.querySelectorAll(".drop").forEach((x) => x.classList.remove("drop")); };
    track.ondrop = (e) => {
      e.preventDefault(); const o = e.target.closest(".sx-shot"); if (from == null || !o) return;
      const to = +o.dataset.i; if (to !== from) { remember(); const [m] = draft.items.splice(from, 1); draft.items.splice(to, 0, m); ui.sel = {kind: "item", i: to}; changed(); }
      from = null;
    };
    markSel();
  }
  $("pdlg").addEventListener("keydown", (e) => {
    if (!draft || ui.view !== "moments" || e.target.matches("input,textarea,select")) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); return undo(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const r = rangeOf();
    if (k === "a" && ui.sel?.kind === "cand") { e.preventDefault(); addCand(ui.sel.x); }
    else if (k === "i" && r) { if (r.it) remember(); setRange(ui.t, Math.max(r.b, ui.t + 0.5), true); }
    else if (k === "o" && r) { if (r.it) remember(); setRange(Math.min(r.a, ui.t - 0.5), ui.t, true); }
    else if ((k === "backspace" || k === "delete") && ui.sel?.kind === "item") { e.preventDefault(); removeItem(); }
    else if (k === "arrowright" || k === "arrowleft") {
      e.preventDefault();
      const d = k === "arrowright" ? 1 : -1;
      if (ui.sel?.kind === "item") { const i = clamp(ui.sel.i + d, 0, draft.items.length - 1); pick({kind: "item", i}); }
      else { const at = ui.list.indexOf(ui.sel?.x), x = ui.list[clamp(at + d, 0, Math.min(ui.shown, ui.list.length) - 1)]; if (x) { pick({kind: "cand", x}); q("#sx-grid .sx-card.on")?.scrollIntoView({block: "nearest"}); } }
    }
  });

  /* ---------- edit step ---------- */
  drawEdit = function () {
    if (!draft) return;
    if (!$("st-edit")) { drawChrome(); return; }
    baseEdit();
    const intro = q("#st-edit .ed-intro > p.muted");
    if (intro) intro.textContent = "Claude Code reads your brief and moments, then writes the shot order, in and out points, framing, speed and any on-screen text. Each result appears here as a version.";
    if (waiting(draft)) {
      q("#st-edit .ed-intro .row")?.remove(); q("#st-edit .ed-intro > h3")?.remove(); intro?.remove();
      const msg = q("#st-edit #ed-msg"); if (msg) msg.textContent = "";
      const bar = document.createElement("div"); bar.className = "sx-wait";
      bar.innerHTML = `<span><b>Waiting for Claude Code.</b> Paste the command there and this version appears here.</span><button class="sx-btn main">Copy command</button>`;
      q("button", bar).onclick = () => copy("edit the requested posts", "Copied. Paste it into Claude Code");
      q("#st-edit").prepend(bar);
    }
    drawChrome();
  };
  const request = window.__requestEdit;
  if (request) window.__requestEdit = async (...args) => {
    await request(...args);
    if (draft && ["idea", "clips", "", undefined].includes(draft.status)) { draft.status = "edit"; queueSave(); }
    drawChrome();
  };
  // Results from Claude Code arrive through the saved-data sync; show them without a reload.
  setInterval(() => {
    if (!draft || !$("pdlg").open || !q("#sx-rail") || signature(draft) === ui.sig) return;
    if (ui.view === "edit" && !document.activeElement?.matches("textarea,input")) drawEdit(); else drawChrome();
  }, 2000);
})();
