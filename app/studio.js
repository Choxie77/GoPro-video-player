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
  const FILTERS = [["all", "All"], ["unused", "Not used"], ["kept", "Your picks"], ["best", "★ Best"], ["talk", "Talking"], ["action", "Action"], ["steady", "Steady"], ["change", "Scene change"]];
  const SHORT = {
    aspect: {"9:16": "9:16", "4:5": "4:5", "1:1": "1:1", "16:9": "16:9"},
    pace: {"": "Claude decides", calm: "Calm", medium: "Medium", fast: "Fast"},
    audio: {"": "Claude decides", original: "Original", voiceover: "Voiceover", music: "Music", mix: "Original + music"},
    captions: {"": "Claude decides", none: "None", keywords: "Key words", speech: "Subtitles", story: "Story lines"},
  };
  const ui = {post: null, view: "brief", sel: null, t: 0, filter: "all", day: "near", shown: PAGE, undo: [], redo: [], sig: "", list: [], reqNote: "", how: "claude", query: "", sort: "best", week: 0};
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
    .sx-th { position: relative; aspect-ratio: 16 / 9; border-radius: 4px; background-color: var(--thumb-bg); background-repeat: no-repeat; }
    .sx-card .sx-dur { position: absolute; left: 5px; bottom: 5px; padding: 1px 5px; color: #fff; background: rgba(0, 0, 0, .78); border-radius: 3px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .sx-card .sx-star { position: absolute; left: 5px; top: 5px; padding: 0 4px; color: #17191c; background: #ffd23f; border-radius: 3px; font-size: 11px; font-weight: 700; }
    .sx-chips button i { margin-left: 4px; font-style: normal; font-weight: 400; opacity: .7; }
    .sx-chips button.none { opacity: .45; }
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
    .sx-shot { max-width: 240px; }
    .sx-shot.on { border-color: var(--ink); outline: 1px solid var(--surface); }
    .sx-shot.drop { border-left: 3px solid #ffd23f; }
    .sx-shot span { position: absolute; left: 2px; bottom: 2px; padding: 0 4px; font-size: 11px; font-weight: 700; background: rgba(0, 0, 0, .78); border-radius: 3px; white-space: nowrap; }
    .sx-shot em { position: absolute; top: 2px; right: 2px; padding: 0 4px; font-size: 10px; font-style: normal; font-weight: 700; color: #17191c; background: #ffd23f; border-radius: 3px; }
    .sx-edit { max-width: 1080px; margin: 0 auto; padding: 20px; display: grid; gap: 14px; }
    .sx-wait { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--ink); border-radius: 7px; font-size: 14px; }
    .sx-count { justify-self: end; font-size: 12px; font-weight: 400; color: var(--muted); }
    .sx-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .sx-flow li { display: grid; gap: 1px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); font-size: 12px; }
    .sx-flow li b { font-size: 13px; }
    .sx-flow li.now { color: var(--ink); border-color: var(--ink); }
    .sx-flow li.done { color: var(--ink); background: var(--surface); }
    .sx-req { max-width: 1040px; margin: 0 auto; padding: 20px; display: grid; gap: 16px; }
    .sx-req h2 { margin: 0; font-size: 20px; } .sx-req h3 { margin: 0 0 6px; font-size: 14px; }
    .sx-req .lede { margin: 4px 0 0; color: var(--muted); font-size: 14px; max-width: 70ch; }
    .sx-ready { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .sx-ready li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; font-size: 13px; }
    .sx-ready i { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 5px; font-style: normal; font-size: 12px; font-weight: 700; border: 1px solid var(--line); }
    .sx-ready .ok i { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .sx-ready .block { border-color: var(--warn); } .sx-ready .block i { color: var(--warn); border-color: var(--warn); }
    .sx-ready .tip i { color: var(--ink); }
    .sx-card2 { padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); display: grid; gap: 10px; }
    .sx-sum { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; margin: 0; font-size: 13px; }
    .sx-sum dt { color: var(--muted); } .sx-sum dd { margin: 0; overflow-wrap: anywhere; } .sx-sum dd.auto { color: var(--muted); font-style: italic; }
    .sx-mini { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; font-size: 13px; }
    .sx-mini li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--line); }
    .sx-mini li span:last-child { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sx-ctl { display: grid; gap: 4px; font-size: 13px; font-weight: 600; } .sx-ctl small { font-weight: 400; color: var(--muted); }
    .sx-wait.big { align-items: flex-start; padding: 16px; } .sx-wait.big p { margin: 4px 0; color: var(--muted); font-size: 13px; }
    .sx-wait pre { margin: 8px 0 0; padding: 8px 10px; white-space: pre-wrap; font: 12px/1.5 ui-monospace, monospace; background: var(--bg); border-radius: 6px; }
    @media (max-width: 900px) {
      .sx-head { flex-wrap: wrap; } .sx-title { order: 3; flex-basis: 100%; }
      .sx-rail button { grid-template-columns: 1fr; padding: 7px 4px; justify-items: center; } .sx-rail i { grid-row: auto; } .sx-rail span { display: none; }
      .sx-two { grid-template-columns: minmax(0, 1fr); } .sx-flow { grid-template-columns: 1fr; }
      #st-moments { display: flex; flex-direction: column; height: auto; }
      .sx-pool { border-right: 0; order: 2; } .sx-grid { max-height: 52dvh; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sx-ins { order: 1; padding: 12px 16px; } .sx-tl { order: 3; position: sticky; bottom: 0; }
      .sx-stage { width: 100%; min-width: 0; } .sx-keys { display: none; }
    }
  `;
  document.head.append(css);

  /* ---------- shared tools: real video, zoomable trimmer, proportional timeline ---------- */
  const css2 = document.createElement("style");
  css2.textContent = `
    #st-moments { grid-template-columns: minmax(340px, .9fr) minmax(460px, 1.3fr); }
    .sx-search { width: 100%; padding: 7px 10px; font: inherit; font-size: 13px; }
    .sx-daynav { display: flex; gap: 3px; align-items: center; min-width: 0; }
    .sx-daynav .sx-btn { min-height: 30px; padding: 3px 8px; }
    .sx-sort { padding: 5px 6px; font-size: 12px; }
    .sx-card .sx-used { position: absolute; left: 5px; top: 5px; min-width: 20px; padding: 1px 5px; text-align: center; color: #17191c; background: #fff; border-radius: 3px; font-size: 11px; font-weight: 800; }
    .sx-card.used .sx-th { opacity: .62; }
    .sx-plus { opacity: 0; } .sx-card:hover .sx-plus, .sx-card.on .sx-plus, .sx-plus:focus-visible { opacity: 1; }
    @media (hover: none) { .sx-plus { opacity: 1; } }
    .sx-stage { width: min(100%, calc((100dvh - 610px) * 16 / 9)); min-width: 340px; cursor: pointer; }
    .sx-stage video, .ex-phone video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; background: transparent; opacity: 0; }
    .sx-stage video.ready, .ex-phone video.ready { opacity: 1; }
    .sx-shade { z-index: 1; pointer-events: none; } .sx-tc { z-index: 2; }
    .sx-bigplay { position: absolute; z-index: 2; right: 8px; bottom: 8px; padding: 3px 9px; color: #fff; background: rgba(0, 0, 0, .75); border: 0; border-radius: 4px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
    .tr { display: grid; gap: 4px; user-select: none; }
    .tr-over { position: relative; height: 12px; background: var(--line); border-radius: 3px; cursor: pointer; overflow: hidden; touch-action: none; }
    .tr-over i { position: absolute; top: 0; bottom: 0; background: color-mix(in srgb, var(--ink) 24%, transparent); }
    .tr-over b { position: absolute; top: 2px; bottom: 2px; min-width: 3px; background: #ffd23f; border-radius: 1px; }
    .tr-over u { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ink); }
    .tr-zoom { position: relative; height: 66px; margin: 0 15px; border-radius: 4px; background: var(--thumb-bg); cursor: text; touch-action: none; }
    .tr-cells { position: absolute; inset: 0; display: flex; overflow: hidden; border-radius: 4px; }
    .tr-cells div { flex: none; height: 100%; aspect-ratio: 16 / 9; background-repeat: no-repeat; opacity: .42; }
    .tr-ticks { position: absolute; left: 0; right: 0; bottom: 0; height: 15px; overflow: hidden; pointer-events: none; }
    .tr-ticks span { position: absolute; bottom: 1px; padding-left: 3px; border-left: 1px solid rgba(255, 255, 255, .65); color: #fff; font-size: 10px; line-height: 12px; text-shadow: 0 0 2px #000; font-variant-numeric: tabular-nums; }
    .tr-sel { position: absolute; top: -2px; bottom: -2px; background: rgba(255, 255, 255, .13); border-top: 2px solid #ffd23f; border-bottom: 2px solid #ffd23f; cursor: grab; }
    .tr-sel u { position: absolute; top: -2px; bottom: -2px; width: 15px; display: grid; place-items: center; color: #17191c; background: #ffd23f; font-size: 11px; font-weight: 800; text-decoration: none; cursor: ew-resize; }
    .tr-sel u[data-h=a] { left: -15px; border-radius: 4px 0 0 4px; } .tr-sel u[data-h=b] { right: -15px; border-radius: 0 4px 4px 0; }
    .tr-head { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px #000; pointer-events: none; }
    .tr-bar { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--muted); }
    .tr-bar button { min-width: 26px; padding: 1px 6px; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
    .sx-lines { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 2px; }
    .sx-lines button { flex: none; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 3px 8px; font: inherit; font-size: 12px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }
    .sx-acts .sx-btn.tiny { min-height: 30px; padding: 3px 8px; }
    .sx-track { position: relative; display: block; height: 68px; white-space: nowrap; padding-top: 2px; }
    .sx-shot { display: inline-flex; overflow: hidden; position: relative; flex: none; height: 62px; min-width: 0; max-width: none; margin-right: 3px; vertical-align: top; background: var(--bg); }
    .sx-shot .tk { flex: none; height: 100%; aspect-ratio: 16 / 9; background-repeat: no-repeat; pointer-events: none; }
    .sx-shot span { z-index: 1; } .sx-shot em { z-index: 1; }
    .sx-shot.on { border-color: #ffd23f; outline: 0; }
    .sx-shot.drop { border-left: 2px solid transparent; } .sx-shot.drop::before { content: ""; position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; width: 3px; background: #ffd23f; }
    .sx-shot.dropr::before { content: ""; position: absolute; z-index: 2; top: 0; bottom: 0; right: 0; width: 3px; background: #ffd23f; }
    .sx-shot .x { position: absolute; z-index: 2; top: 2px; left: 2px; display: none; width: 18px; height: 18px; place-items: center; color: #fff; background: rgba(0, 0, 0, .8); border-radius: 3px; font-size: 11px; font-style: normal; }
    .sx-shot:hover .x { display: grid; }
    .sx-target { position: absolute; z-index: 3; top: 0; bottom: 0; width: 2px; background: #ffd23f; pointer-events: none; }
    .ex { display: grid; grid-template-rows: minmax(0, 1fr) auto; height: 100%; min-height: 620px; }
    .ex-main { min-height: 0; display: grid; grid-template-columns: minmax(230px, 300px) minmax(380px, 1fr) minmax(280px, 340px); }
    .ex-col { min-width: 0; min-height: 0; overflow: auto; padding: 14px 16px; display: grid; gap: 10px; align-content: start; }
    .ex-col + .ex-col { border-left: 1px solid var(--line); }
    .ex-phone { position: relative; width: 100%; max-height: calc(100dvh - 370px); overflow: hidden; justify-self: center; border-radius: 8px; background: #000; cursor: pointer; }
    .ex-phone .ci { position: absolute; top: 0; bottom: 0; width: calc(var(--r) * 100%); left: calc((1 - var(--r)) * var(--x) * 100%); background-repeat: no-repeat; }
    .ex-text { position: absolute; z-index: 2; left: 8%; right: 8%; top: 62%; text-align: center; color: #fff; font-weight: 800; font-size: 17px; line-height: 1.2; text-shadow: 0 1px 3px #000; pointer-events: none; }
    .ex-hd { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .ex-hd h3 { margin: 0; font-size: 14px; }
    .ex-vers { display: flex; flex-wrap: wrap; gap: 4px; }
    .ex-vers button { padding: 3px 9px; font: inherit; font-size: 12px; font-weight: 650; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }
    .ex-vers button[aria-pressed=true] { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .ex-side .ed-chat, .ex-side .ed-approve { padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); display: grid; gap: 8px; }
    .ex-side .ed-chat .row { flex-wrap: wrap; gap: 6px; } .ex-side .btn { min-height: 34px; padding: 6px 12px; font-size: 13px; border-radius: 6px; } .ex-side textarea { min-height: 70px; width: 100%; font: inherit; font-size: 13px; }
    .ex-tl { display: grid; gap: 6px; padding: 8px 12px 10px; background: var(--surface); border-top: 1px solid var(--line); min-width: 0; }
    .sx-how { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .sx-how button { display: grid; gap: 3px; padding: 12px 14px; text-align: left; font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
    .sx-how button[aria-pressed=true] { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
    .sx-how b { font-size: 14px; } .sx-how span { font-size: 12px; color: var(--muted); }
    .px { max-width: 1180px; margin: 0 auto; padding: 18px 20px 48px; display: grid; gap: 16px; }
    .px-flow { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--surface); }
    .px-flow li { display: grid; gap: 1px; padding: 9px 13px; font-size: 12px; color: var(--muted); border-left: 1px solid var(--line); }
    .px-flow li:first-child { border-left: 0; } .px-flow b { font-size: 13px; }
    .px-flow li.done { color: var(--ink); } .px-flow li.now { color: var(--surface); background: var(--ink); }
    .px-grid { display: grid; grid-template-columns: 270px minmax(0, 1fr) 320px; gap: 18px; align-items: start; }
    .px-phone { position: sticky; top: 12px; display: grid; gap: 8px; }
    .px-screen { position: relative; aspect-ratio: 9 / 16; overflow: hidden; border-radius: 12px; background: #000; border: 1px solid var(--line); }
    .px-screen .ex-phone { position: absolute; inset: 0; max-height: none; border-radius: 0; }
    .px-over { position: absolute; z-index: 3; left: 0; right: 42px; bottom: 0; padding: 10px; color: #fff; font-size: 12px; line-height: 1.35; text-shadow: 0 1px 2px #000; pointer-events: none; }
    .px-rail { position: absolute; z-index: 3; right: 8px; bottom: 14px; display: grid; gap: 12px; color: #fff; font-size: 16px; text-align: center; text-shadow: 0 1px 2px #000; pointer-events: none; }
    .px-safe { position: absolute; z-index: 2; left: 0; right: 0; top: 14.84%; bottom: 14.84%; border-top: 1px dashed rgba(255, 255, 255, .6); border-bottom: 1px dashed rgba(255, 255, 255, .6); pointer-events: none; }
    .px-covers { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 3px; }
    .px-covers button { position: relative; flex: none; width: 48px; aspect-ratio: 9 / 16; padding: 0; overflow: hidden; background: #000; border: 2px solid transparent; border-radius: 4px; cursor: pointer; }
    .px-covers button[aria-pressed=true] { border-color: #ffd23f; }
    .px-covers .ci { position: absolute; top: 0; bottom: 0; width: 316%; left: calc(-216% * var(--x)); background-repeat: no-repeat; }
    .px-count { font-weight: 400; color: var(--muted); } .px-count.over { color: var(--warn); }
    .px-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
    .px-week button { display: grid; gap: 1px; justify-items: center; padding: 5px 0; font: inherit; font-size: 11px; color: var(--muted); background: var(--surface); border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }
    .px-week button b { font-size: 14px; color: var(--ink); } .px-week button i { height: 5px; width: 5px; background: transparent; }
    .px-week button.busy i { background: var(--warn); } .px-week button[aria-pressed=true] { background: var(--ink); color: var(--surface); border-color: var(--ink); } .px-week button[aria-pressed=true] b { color: var(--surface); }
    .px-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .px-row input[type=time], .px-row input[type=date] { padding: 6px 8px; font: inherit; font-size: 13px; }
    .px-plat { display: grid; gap: 6px; padding: 9px 0; border-top: 1px solid var(--line); }
    .px-plat:first-of-type { border-top: 0; } .px-plat input[type=url] { width: 100%; padding: 6px 8px; font: inherit; font-size: 13px; }
    .px-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
    .px-stats label { display: grid; gap: 2px; font-size: 11px; color: var(--muted); } .px-stats input { width: 100%; padding: 4px 6px; font: inherit; font-size: 13px; }
    @media (max-width: 1180px) { .ex-main { grid-template-columns: 240px minmax(0, 1fr); } .ex-side { grid-column: 1 / -1; border-left: 0 !important; border-top: 1px solid var(--line); } .px-grid { grid-template-columns: 230px minmax(0, 1fr); } .px-right { grid-column: 1 / -1; } }
    @media (max-width: 900px) { #st-moments, .sx-pool, .sx-ins, .sx-tl, .sx-ins > *, .sx-tools, .sx-tools > * { min-width: 0; max-width: 100%; } .sx-tools .sx-line { flex-wrap: wrap; } .sx-daynav { flex-wrap: wrap; } .tr-bar { flex-wrap: wrap; } .tr-bar span:last-child, .tr-bar span[style*="flex:1"] { display: none; } .ex { height: auto; } .ex-main, .px-grid, .sx-how { grid-template-columns: minmax(0, 1fr); } .ex-col + .ex-col { border-left: 0; border-top: 1px solid var(--line); } .ex-phone { max-width: 240px; } .px-phone { position: static; max-width: 240px; justify-self: center; width: 100%; } .px-flow { grid-template-columns: 1fr 1fr; } .sx-stage { min-width: 0; width: 100%; } }
  `;
  document.head.append(css2);

  const css3 = document.createElement("style");
  css3.textContent = `
    .ex-stage { display: grid; gap: 10px; justify-items: center; min-width: 0; width: 100%; }
    .ex-scrub { position: relative; width: 100%; height: 26px; display: flex; align-items: center; cursor: pointer; touch-action: none; border-radius: 6px; }
    .ex-scrub:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
    .ex-segs { display: flex; gap: 2px; width: 100%; height: 8px; transition: height .12s; }
    .ex-scrub:hover .ex-segs, .ex-scrub:focus-visible .ex-segs { height: 12px; }
    .ex-segs b { position: relative; display: block; min-width: 3px; height: 100%; border-radius: 3px; overflow: hidden; background: var(--line); }
    .ex-segs b i { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--ink); opacity: .55; }
    .ex-segs b.on { outline: 1px solid var(--ink); outline-offset: 1px; }
    .ex-head { position: absolute; top: 2px; bottom: 2px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--ink); pointer-events: none; }
    .ex-more { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: var(--surface); }
    .ex-more summary { cursor: pointer; font-size: 13px; font-weight: 650; }
    .ex-moreb { display: grid; gap: 10px; margin-top: 10px; }
    .ex-nudge { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; }
    .sx-btn[aria-pressed=true] { color: var(--surface); background: var(--ink); border-color: var(--ink); }
    .ex-stage:fullscreen, .ex-stage:-webkit-full-screen { background: #000; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 16px; width: 100vw; height: 100vh; }
    .ex-stage:fullscreen .ex-phone, .ex-stage:-webkit-full-screen .ex-phone { width: auto !important; max-width: 100%; height: calc(100vh - 150px); max-height: none; flex: 0 1 auto; min-height: 0; }
    .ex-stage:fullscreen .ex-scrub, .ex-stage:-webkit-full-screen .ex-scrub { max-width: min(94vw, 760px); }
    .ex-stage:fullscreen .ex-segs b { background: #4a4a4a; }
    .ex-stage:fullscreen .ex-segs b i, .ex-stage:fullscreen .ex-head { background: #fff; }
    .ex-stage:fullscreen .ex-segs b.on { outline-color: #fff; }
    .ex-stage:fullscreen .muted { color: #bbb; }
    .dk-spin { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px; background: rgba(0,0,0,.75); color: #fff; font: 600 12px/1 system-ui, sans-serif; pointer-events: none; z-index: 6; white-space: nowrap; }
    .dk-spin[hidden] { display: none; }
    .dk-spin i { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: dkspin .8s linear infinite; }
    @keyframes dkspin { to { transform: rotate(360deg); } }
    .dk-off { position: absolute !important; width: 1px !important; height: 1px !important; opacity: 0 !important; pointer-events: none !important; }
  `;
  document.head.append(css3);

  const BR = window.__gtaBridge;
  const fileOf = (c) => c?.pv || c?.hd || c?.drive || null;
  // One visible <video> that can show a moment, loop a range, or play a list of shots in order. The still frame stays underneath while it loads.
  // Playing a list is double-buffered: while one shot plays, the next AHEAD shots load into hidden spare <video>s, so the cut is instant.
  // A "Loading" badge shows whenever the visible video is waiting for data.
  function makeDeck(video, onTick) {
    const AHEAD = 2, host = video.parentElement, pool = [video];
    let cur = video, seq = null, at = 0, end = null, start = 0, loop = false, raf = 0, settling = false, done = null, step = null, since = 0, note = "", noteT = 0;
    const spin = document.createElement("div"); spin.className = "dk-spin"; spin.hidden = true; spin.setAttribute("role", "status"); spin.innerHTML = "<i></i><span></span>"; host?.append(spin);
    const ready = (v) => v.classList.add("ready");
    const showBusy = (b) => { if (b === !spin.hidden && !note) return; spin.hidden = !(b || note); spin.lastChild.textContent = note || (seq && at > 0 ? "Loading next shot…" : "Loading…"); };
    const load = (v, c, t) => {
      const f = fileOf(c);
      if (!f || !BR) { v._f = null; v._i = -1; v.classList.remove("ready"); v.removeAttribute("src"); return false; }
      v._t = t;
      if (v._f !== f) { v._f = f; v._retried = false; v.classList.remove("ready"); v.src = BR.streamUrl(f); v._p = t; v.load(); }
      else if (v.readyState >= 1) { if (Math.abs(v.currentTime - t) >= .01) v.currentTime = t; }
      else v._p = t;
      return true;
    };
    const wire = (v) => {
      v.addEventListener("loadedmetadata", () => { if (v._p != null) { v.currentTime = Math.min(v._p, v.duration || v._p); v._p = null; } });
      v.addEventListener("seeked", () => { if (v === cur) { settling = false; ready(v); } });
      v.addEventListener("loadeddata", () => { if (v === cur) ready(v); });
      v.addEventListener("error", async () => {
        if (!v._f) return;
        if (v._retried || !BR) { if (v === cur) { settling = false; note = "Could not load this clip"; showBusy(false); clearTimeout(noteT); noteT = setTimeout(() => { note = ""; showBusy(false); }, 3000); } v._f = null; return; }
        v._retried = true; const t = v._p ?? (v === cur ? start : v._t ?? 0); await BR.token(); v.src = BR.streamUrl(v._f); v._p = t;
        if (v === cur && (!v.paused || seq)) v.play().catch(() => {});
      });
      if (v !== video) for (const n of ["play", "pause"]) v.addEventListener(n, () => { if (v === cur) video.dispatchEvent(new Event(n)); });
    };
    wire(video); video._i = -1;
    const spare = () => {
      const v = video.cloneNode(false); v.removeAttribute("id"); v.classList.remove("ready"); v.classList.add("dk-off"); v.muted = true; v.preload = "auto"; v._i = -1;
      video.after(v); wire(v); pool.push(v); return v;
    };
    const put = (c, t) => {
      const f = fileOf(c); if (!f || !BR) { load(cur, c, t); settling = false; return false; }
      settling = true; cur._i = -1;
      const same = cur._f === f && cur.readyState >= 1 && Math.abs(cur.currentTime - t) < .01;
      load(cur, c, t);
      if (same) { settling = false; ready(cur); }
      if (!raf) raf = nextFrame(tick);
      return true;
    };
    // Fill the spare videos with the shots that come next.
    const preload = (list, from) => {
      if (!list || !BR) return;
      for (let k = 1; k <= AHEAD; k++) {
        const i = from + k; if (i >= list.length) break;
        const s = list[i]; if (!fileOf(s.c)) continue;
        if (pool.some((v) => v !== cur && v._i === i && v._t === s.a)) continue;
        let v = pool.find((x) => x !== cur && (x._i < 0 || x._i <= from || x._i > from + AHEAD));
        if (!v) { if (pool.length >= 1 + AHEAD) break; v = spare(); }
        v._i = i; v.muted = true; v.preload = "auto"; load(v, s.c, s.a);
      }
    };
    // Animation frames stop in a background tab, so a short timer backs them up and the playlist keeps moving.
    const nextFrame = (fn) => { let d = false, a = 0, t = 0; const go = () => { if (d) return; d = true; cancelAnimationFrame(a); clearTimeout(t); fn(); }; a = requestAnimationFrame(go); t = setTimeout(go, 50); return () => { d = true; cancelAnimationFrame(a); clearTimeout(t); }; };
    const stopLoop = () => { if (raf) raf(); raf = 0; };
    const tick = () => {
      if (cur.paused && !settling) { stopLoop(); since = 0; showBusy(false); return; }
      if (cur !== video) cur.muted = video.muted;
      const now = performance.now();
      if (settling || (!cur.paused && cur.readyState < 3)) { since ||= now; if (now - since > 150) showBusy(true); } else { since = 0; showBusy(false); }
      if (!settling) {
        const t = cur.currentTime;
        if (end != null && t >= end - .02) {
          if (seq) { at++; if (at >= seq.length) { const d = done; api.stop(); d?.(); return; } shot(); }
          else if (loop) cur.currentTime = start;
          else { cur.pause(); cur.currentTime = end; }
        } else onTick?.(t, at);
      }
      raf = nextFrame(tick);
    };
    const run = () => { if (!raf) raf = nextFrame(tick); cur.play().catch(() => {}); };
    const shot = () => {
      const s = seq[at]; start = s.a; end = s.b;
      const pre = pool.find((v) => v !== cur && v._i === at && v._t === s.a && v._f === fileOf(s.c));
      if (pre) {
        const old = cur; old.pause(); old.classList.add("dk-off"); pre.classList.remove("dk-off"); pre._i = -1; cur = pre;
        cur.muted = video.muted; cur.volume = video.volume;
        settling = !(cur._p == null && !cur.seeking && cur.readyState >= 2);
        if (!settling) ready(cur);
      } else put(s.c, s.a);
      cur.playbackRate = s.speed || 1; step?.(at, s); run(); preload(seq, at);
    };
    const api = {
      get playing() { return !cur.paused || (!!seq && !!raf); }, get list() { return !!seq; }, get el() { return cur; },
      seek(c, t) { seq = null; end = null; loop = false; cur.pause(); cur.playbackRate = 1; return put(c, t); },
      range(c, a, b, from) { seq = null; start = a; end = b; loop = true; cur.playbackRate = 1; if (!put(c, from ?? a)) return false; run(); return true; },
      playList(list, onStep, onEnd, first = 0) { if (!list.length || !list.some((s) => fileOf(s.c))) return false; seq = list; at = first; step = onStep; done = onEnd; shot(); return true; },
      // Load the shots after `first` quietly in the background so Play starts and cuts instantly.
      warm(list, first = 0) { if (!seq) preload(list, first); },
      pause() { cur.pause(); },
      stop() { seq = null; end = null; loop = false; done = null; step = null; cur.pause(); cur.playbackRate = 1; stopLoop(); since = 0; showBusy(false); },
      kill() { api.stop(); clearTimeout(noteT); note = ""; pool.slice(1).forEach((v) => v.remove()); pool.length = 1; cur = video; cur.classList.remove("dk-off"); video._f = null; video.removeAttribute("src"); video.load(); spin.remove(); },
    };
    return api;
  }
  const framing = (id, x) => $(id)?.parentElement.querySelectorAll("video").forEach((v) => { v.style.objectPosition = `${(x ?? .5) * 100}% 50%`; });
  const decks = new Set();
  const newDeck = (v, f) => { const d = makeDeck(v, f); decks.add(d); return d; };
  const killDecks = () => { decks.forEach((d) => d.kill()); decks.clear(); };
  $("pdlg").addEventListener("close", killDecks);

  // Two-level trimmer: a thin bar for the whole clip, and a zoomed strip around the selection so even a 1 s cut has grabbable handles.
  function makeTrimmer(box, o) {
    let c = null, v0 = 0, v1 = 1;
    box.className = "tr";
    box.innerHTML = `<div class="tr-over" title="Whole clip. Click to jump"><i></i><b></b><u></u></div>
      <div class="tr-zoom"><div class="tr-cells"></div><div class="tr-ticks"></div><div class="tr-sel"><u data-h="a" title="Drag the start">‹</u><u data-h="b" title="Drag the end">›</u></div><div class="tr-head"></div></div>
      <div class="tr-bar"><button data-z="out" aria-label="Zoom out">−</button><button data-z="in" aria-label="Zoom in">+</button><button data-z="fit">Fit cut</button><button data-z="all">Whole clip</button><span data-l style="margin-left:4px"></span><span style="flex:1"></span><span>Drag the yellow edges. Drag the middle to slide. Scroll to zoom.</span></div>`;
    const over = q(".tr-over", box), zoom = q(".tr-zoom", box), cells = q(".tr-cells", box), ticks = q(".tr-ticks", box), sel = q(".tr-sel", box), head = q(".tr-head", box), label = q("[data-l]", box);
    const dur = () => Math.max(.5, c?.dur || 1), pct = (t) => `${((t - v0) / (v1 - v0)) * 100}%`;
    const setView = (a, b) => { const d = dur(), w = clamp(b - a, Math.min(2, d), d); a = clamp(a, 0, d - w); v0 = a; v1 = a + w; paintCells(); api.paint(); };
    const fit = () => { const r = o.range(); if (!r) return; const w = Math.max(8, (r.b - r.a) * 3); setView((r.a + r.b) / 2 - w / 2, (r.a + r.b) / 2 + w / 2); };
    function paintCells() {
      if (!c) return;
      const cw = (zoom.clientHeight || 66) * 16 / 9, n = Math.ceil((zoom.clientWidth || 600) / cw);
      cells.innerHTML = Array.from({length: n}, (_, i) => `<div style="${thumbStyle(c, nearestFrame(c, v0 + ((i + .5) * cw / (zoom.clientWidth || 600)) * (v1 - v0)))}"></div>`).join("");
      const span = v1 - v0, step = [.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => span / s <= 9) || 600;
      let h = ""; for (let t = Math.ceil(v0 / step) * step; t < v1; t += step) h += `<span style="left:${pct(t)}">${fmtT(r2(t))}</span>`;
      ticks.innerHTML = h;
    }
    const toT = (e) => { const b = zoom.getBoundingClientRect(); return v0 + clamp((e.clientX - b.left) / b.width, 0, 1) * (v1 - v0); };
    zoom.onpointerdown = (e) => {
      const r0 = o.range(); if (!r0) return;
      const h = e.target.dataset?.h, body = !h && e.target === sel, t0 = toT(e); let moved = false;
      zoom.setPointerCapture(e.pointerId);
      if (h || body) o.begin?.();
      if (!h && !body) o.seek(t0);
      const move = (ev) => {
        const b = zoom.getBoundingClientRect();
        if (h || body) { const p = (v1 - v0) * .02; if (ev.clientX < b.left + 4 && v0 > 0) setView(v0 - p, v1 - p); else if (ev.clientX > b.right - 4 && v1 < dur()) setView(v0 + p, v1 + p); }
        const t = toT(ev); moved = moved || Math.abs(ev.clientX - e.clientX) > 2;
        if (h === "a") { o.set(Math.min(t, r0.b - .3), r0.b); o.seek(Math.min(t, r0.b - .3), true); }
        else if (h === "b") { o.set(r0.a, Math.max(t, r0.a + .3)); o.seek(Math.max(t, r0.a + .3), true); }
        else if (body) { const w = r0.b - r0.a, a = clamp(r0.a + t - t0, 0, dur() - w); o.set(a, a + w); o.seek(a, true); }
        else o.seek(t);
      };
      zoom.onpointermove = move;
      zoom.onpointerup = zoom.onpointercancel = () => { zoom.onpointermove = zoom.onpointerup = zoom.onpointercancel = null; if (h || body) { if (body && !moved) o.seek(t0); const r = o.range(); o.set(r.a, r.b, true); } };
    };
    zoom.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const d = (e.deltaX / zoom.clientWidth) * (v1 - v0); return setView(v0 + d, v1 + d); }
      const at = toT(e), k = e.deltaY > 0 ? 1.18 : 1 / 1.18; setView(at - (at - v0) * k, at + (v1 - at) * k);
    }, {passive: false});
    over.onpointerdown = (e) => { const b = over.getBoundingClientRect(), t = clamp((e.clientX - b.left) / b.width, 0, 1) * dur(), w = v1 - v0; setView(t - w / 2, t + w / 2); o.seek(t); };
    q(".tr-bar", box).onclick = (e) => {
      const z = e.target.dataset?.z; if (!z) return; const m = (v0 + v1) / 2, w = v1 - v0;
      if (z === "in") setView(m - w / 3, m + w / 3); else if (z === "out") setView(m - w * .75, m + w * .75); else if (z === "all") setView(0, dur()); else fit();
    };
    const ro = new ResizeObserver(() => paintCells()); ro.observe(zoom);
    const api = {
      load(clip) { if (clip !== c) { c = clip; fit(); } else api.paint(); },
      fit,
      paint() {
        const r = o.range(); if (!r || !c) return; const d = dur();
        sel.style.left = pct(r.a); sel.style.width = `${((r.b - r.a) / (v1 - v0)) * 100}%`;
        const t = o.time(); head.style.left = pct(t); head.style.display = t < v0 || t > v1 ? "none" : "";
        const oi = q("i", over), ob = q("b", over), ou = q("u", over);
        oi.style.left = `${(v0 / d) * 100}%`; oi.style.width = `${((v1 - v0) / d) * 100}%`; ob.style.left = `${(r.a / d) * 100}%`; ob.style.width = `${((r.b - r.a) / d) * 100}%`; ou.style.left = `${(t / d) * 100}%`;
        label.textContent = `Showing ${fmtT(r2(v0))} to ${fmtT(r2(v1))}`;
        if (t > v1 || t < v0) { if (o.follow?.()) { const w = v1 - v0; setView(t - w * .2, t + w * .8); } }
      },
    };
    return api;
  }

  // Timeline where width follows length. Drag to reorder, with a line showing where the shot lands.
  function drawTrack(track, list, o) {
    const keep = track.scrollLeft, W = Math.max(320, track.clientWidth || 900), span = Math.max(o.target || 0, list.reduce((a, s) => a + s.len, 0), 1), scale = Math.max(8, (W - 6 - list.length * 3) / span);
    const w = (s) => Math.max(46, s.len * scale);
    track.innerHTML = list.map((s, i) => `<button class="sx-shot" draggable="true" data-i="${i}" style="width:${w(s)}px" aria-label="Shot ${i + 1}, ${esc(clipName(s.c))}, ${s.len.toFixed(1)} seconds">${`<i class="tk" style="${thumbStyle(s.c, s.frame)}"></i>`.repeat(Math.ceil(w(s) / 104))}<span>${i + 1} · ${len(s.len)}</span>${s.badge ? `<em>${esc(s.badge)}</em>` : ""}<i class="x" data-x title="Remove">✕</i></button>`).join("");
    if (o.target && list.length) {
      let x = 0, left = o.target, hit = null;
      for (const s of list) { if (left <= s.len) { hit = x + (left / s.len) * w(s); break; } left -= s.len; x += w(s) + 3; }
      if (hit != null) { const m = document.createElement("div"); m.className = "sx-target"; m.style.left = `${hit}px`; m.title = `${o.target} s target`; track.append(m); }
    }
    track.scrollLeft = keep;
    let from = null, to = null;
    const clear = () => track.querySelectorAll(".drop,.dropr").forEach((x) => x.classList.remove("drop", "dropr"));
    track.onclick = (e) => { const b = e.target.closest(".sx-shot"); if (!b) return; if (e.target.closest("[data-x]")) o.remove(+b.dataset.i); else o.pick(+b.dataset.i); };
    track.ondragstart = (e) => { const b = e.target.closest(".sx-shot"); if (!b) return; from = +b.dataset.i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(from)); };
    track.ondragover = (e) => {
      if (from == null) return; e.preventDefault(); const b = e.target.closest(".sx-shot"); if (!b) return;
      const r = b.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2, i = +b.dataset.i; clear(); b.classList.add(after ? "dropr" : "drop"); to = after ? i + 1 : i;
    };
    track.ondragend = () => { from = to = null; clear(); };
    track.ondrop = (e) => { e.preventDefault(); clear(); if (from != null && to != null) { const dest = to > from ? to - 1 : to; if (dest !== from) o.move(from, dest); } from = to = null; };
  }

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
    return ["Make the edit", () => show("edit")];
  }
  function stepNote(k, p) {
    const vers = p.id ? editsOf(p.id) : [];
    if (k === "brief") return (p.brief.story || "").trim() ? `${p.brief.length ? p.brief.length + " s · " : ""}${p.brief.aspect}` : "Story not written";
    if (k === "moments") return p.items.length ? `${p.items.length} · ${len(total(p))}${untrimmed(p) ? ` · ${untrimmed(p)} untrimmed` : ""}` : "None yet";
    if (k === "edit") return approved(p) ? `v${p.edit} approved` : waiting(p) ? ({editing: "Claude is editing", rendering: "Rendering"}[window.__requestInfo?.(p.id)?.stage] || "Waiting for the auto-editor") : vers.length ? `${vers.length} version${vers.length > 1 ? "s" : ""} to review` : "Not requested";
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
    if (ui.post !== p) Object.assign(ui, {post: p, view: homeView(p), sel: null, t: 0, filter: "all", day: "near", shown: PAGE, undo: [], redo: [], reqNote: "", how: "claude", query: "", week: 0});
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
    flushEdit(); killDecks();
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
  const PLATS = [["instagram", "Instagram", 2200], ["tiktok", "TikTok", 4000], ["youtube", "YouTube Shorts", 5000]];
  const STATS = [["views", "Views"], ["likes", "Likes"], ["comments", "Comments"], ["shares", "Shares"], ["saves", "Saves"], ["follows", "Follows"]];
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cleanTags = (s) => { const seen = new Set(), out = []; for (let t of String(s || "").split(/[\s,]+/)) { t = t.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""); if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push("#" + t); } } return out; };
  const fullCaption = (p) => [(p.caption || "").trim(), cleanTags(p.tags).join(" ")].filter(Boolean).join("\n\n");
  const pubEdit = (p) => { const v = p.id ? editsOf(p.id) : []; return v.find((e) => e.v === p.edit) || v.at(-1) || null; };
  const whereOf = (p) => { p.where ||= {}; for (const [k] of PLATS) p.where[k] ||= {on: k === "instagram"}; if (p.igUrl && !p.where.instagram.url) p.where.instagram.url = p.igUrl; return p.where; };
  function otherPosts(p) { return [...store.posts.entries()].filter(([id, x]) => id !== p.id && x.scheduled && x.status !== "posted").map(([, x]) => x); }
  function coverChoices(p) {
    const e = pubEdit(p)?.edl;
    const l = e?.shots?.length ? e.shots.map((s) => ({clip: s.clip, t: r2((s.in + s.out) / 2), x: s.x ?? .5})) : p.items.map((it) => { const r = spanOf(it); return {clip: it.clip, t: r2((r.a + r.b) / 2), x: .5}; });
    return l.slice(0, 24);
  }
  function drawPublish(box, p) {
    const edit = pubEdit(p), where = whereOf(p), covers = coverChoices(p);
    if (!p.cover && covers[0]) p.cover = null;
    const shown = p.cover || covers[0] || null;
    const isApproved = approved(p), rendered = ["cut", "scheduled", "posted"].includes(p.status) || !!p.renderUrl;
    const stage = p.status === "posted" ? 4 : p.status === "scheduled" ? 3 : rendered ? 2 : isApproved ? 1 : 0;
    const flowItems = [["Approved", isApproved ? `v${p.edit}` : edit ? `v${edit.v} to approve` : "No edit yet"], ["Final video", rendered ? "Ready" : isApproved ? "Waiting for render" : "After approval"], ["Scheduled", p.scheduled ? `${fmtShort(p.scheduled)}${p.time ? " · " + p.time : ""}` : "No date"], ["Posted", p.status === "posted" ? (p.postedAt ? fmtShort(p.postedAt) : "Done") : "Not yet"]];
    const checks = [
      [isApproved, "An edit is approved", isApproved ? "" : "edit"], [rendered, "Final video is rendered", rendered ? "" : "edit"],
      [!!(p.hook || "").trim(), "Hook written", "px-hook"], [!!(p.caption || "").trim(), "Caption written", "px-cap"],
      [!!p.cover, "Cover chosen", "px-covers"], [!!p.scheduled, "Post date set", "px-date"],
    ];
    const left = checks.filter((c) => !c[0]).length;
    const start = new Date(); start.setDate(start.getDate() + (ui.week || 0) * 7);
    const week = Array.from({length: 7}, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const others = otherPosts(p);
    box.innerHTML = `<div class="px">
      <ol class="px-flow" aria-label="Publishing progress">${flowItems.map(([t, n], i) => `<li class="${i < stage ? "done" : i === stage ? "now" : ""}"><b>${i < stage ? "✓ " : ""}${t}</b><span>${esc(n)}</span></li>`).join("")}</ol>
      <div class="px-grid">
        <div class="px-phone">
          <div class="px-screen"><div class="ex-phone" id="px-ph" style="--r:3.1605;--x:${shown?.x ?? .5}"><div class="ci" id="px-ci" style="${shown ? thumbStyle(byId.get(shown.clip), nearestFrame(byId.get(shown.clip), shown.t)) : ""}"></div><video id="px-vid" playsinline></video></div>
            <div class="px-safe" id="px-safe"></div><div class="px-rail" aria-hidden="true"><span>♡</span><span>◌</span><span>➤</span></div><div class="px-over" id="px-over"></div></div>
          <div class="sx-acts"><button class="sx-btn" id="px-play" ${edit ? "" : "disabled"}>▶ Play the cut</button><label class="muted small" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="px-gd" checked> Grid crop</label></div>
          ${p.renderUrl ? `<a class="sx-btn" href="${esc(p.renderUrl)}" target="_blank" rel="noopener">Open final video</a>` : ""}
        </div>
        <div class="sx-stack">
          <div class="sx-card2"><div class="ex-hd"><h3>Words</h3><button class="sx-btn tiny" id="px-draft" title="Starts the caption from your hook and story. No AI used">Draft from story</button></div>
            <label class="sx-f">Hook <small>The line on screen in the first two seconds.</small><input id="px-hook" data-p="hook" value="${esc(p.hook || "")}" maxlength="90" placeholder="The line that stops the scroll"></label>
            <label class="sx-f"><span class="ex-hd">Caption <span class="px-count" id="px-capn"></span></span><textarea id="px-cap" data-p="caption" maxlength="2200" style="min-height:150px" placeholder="First line shows before “more”, so make it count.">${esc(p.caption || "")}</textarea></label>
            <label class="sx-f"><span class="ex-hd">Hashtags <span class="px-count" id="px-tagn"></span></span><input id="px-tags" data-p="tags" value="${esc(p.tags || "")}" placeholder="#travel #solotravel #asia"></label>
            <label class="sx-f">First comment <small>Optional. Pin it after posting.</small><input data-p="firstComment" value="${esc(p.firstComment || "")}" maxlength="400"></label>
            <div class="sx-acts"><button class="sx-btn main" id="px-copy">Copy caption + hashtags</button><button class="sx-btn" id="px-copy1">Copy first comment</button></div>
          </div>
          <div class="sx-card2"><div class="ex-hd"><h3>Cover</h3><span class="muted small">Pick a frame from the cut</span></div>
            ${covers.length ? `<div class="px-covers" id="px-covers">${covers.map((f, i) => { const c = byId.get(f.clip), on = p.cover && p.cover.clip === f.clip && Math.abs(p.cover.t - f.t) < .01; return `<button data-c="${i}" aria-pressed="${!!on}" aria-label="Cover option ${i + 1}" style="--x:${f.x}"><span class="ci" style="${thumbStyle(c, nearestFrame(c, f.t))}"></span></button>`; }).join("")}</div>` : `<p class="muted small">Add moments first.</p>`}
          </div>
          <div class="sx-card2"><div class="ex-hd"><h3>When</h3><span class="sx-acts"><button class="sx-btn tiny" id="px-wp" ${(ui.week || 0) <= 0 ? "disabled" : ""} aria-label="Earlier week">‹</button><button class="sx-btn tiny" id="px-wn" aria-label="Later week">›</button></span></div>
            <div class="px-week" id="px-week">${week.map((d) => { const k = isoDay(d), n = others.filter((x) => x.scheduled === k); return `<button data-d="${k}" class="${n.length ? "busy" : ""}" aria-pressed="${p.scheduled === k}" title="${n.length ? esc("Also planned: " + n.map((x) => x.title).join(", ")) : "Free"}">${d.toLocaleDateString([], {weekday: "short"})}<b>${d.getDate()}</b><i></i></button>`; }).join("")}</div>
            <div class="px-row"><input type="date" id="px-date" value="${esc(p.scheduled || "")}" aria-label="Post date"><input type="time" id="px-time" value="${esc(p.time || "18:00")}" aria-label="Post time">
              <button class="sx-btn tiny" id="px-free">Next free day</button>${p.scheduled ? `<button class="sx-btn tiny" id="px-unsched">Clear</button>` : ""}</div>
            ${p.scheduled && others.some((x) => x.scheduled === p.scheduled) ? `<p class="muted small" style="margin:0;color:var(--warn)">Another post is planned that day.</p>` : ""}
            <p class="muted small" style="margin:0">This is your plan. Nothing is posted for you.</p>
          </div>
          <div class="sx-card2"><h3>Free AI suggestions</h3>${ideasHTML(p)}</div>
        </div>
        <div class="sx-stack px-right">
          <div class="sx-card2"><div class="ex-hd"><h3>Ready to post?</h3><span class="muted small">${left ? `${left} left` : "All set"}</span></div>
            <ul class="sx-ready">${checks.map(([ok, t, go]) => `<li class="${ok ? "ok" : "tip"}"><i>${ok ? "✓" : "·"}</i><span>${t}</span>${ok ? "<span></span>" : `<button class="sx-btn tiny" data-fix="${go}">Fix</button>`}</li>`).join("")}</ul></div>
          <div class="sx-card2"><h3>Where it goes</h3>${PLATS.map(([k, name, lim]) => { const w = where[k]; return `<div class="px-plat" data-k="${k}"><div class="ex-hd"><label style="display:flex;gap:6px;align-items:center;font-size:13px;font-weight:650"><input type="checkbox" data-on ${w.on ? "checked" : ""}> ${name}</label><span class="px-count" data-lim="${lim}"></span></div>
            ${w.on ? `<input type="url" data-url value="${esc(w.url || "")}" placeholder="Link once it is live" aria-label="${name} link">
            <div class="sx-acts"><button class="sx-btn tiny ${w.posted ? "" : "main"}" data-post>${w.posted ? `✓ Posted${w.at ? " " + fmtShort(w.at) : ""} · undo` : "Mark as posted"}</button>${w.url ? `<a class="sx-btn tiny" href="${esc(w.url)}" target="_blank" rel="noopener">Open</a>` : ""}</div>
            ${w.posted ? `<div class="px-stats">${STATS.map(([s, n]) => `<label>${n}<input type="number" min="0" data-stat="${s}" value="${esc(w.stats?.[s] ?? "")}"></label>`).join("")}</div>` : ""}` : ""}</div>`; }).join("")}</div>
          ${p.id ? `<button class="sx-btn bad" id="p-del" style="justify-self:start">Delete post</button>` : ""}
        </div>
      </div></div>`;
    const paintWords = () => {
      const cap = fullCaption(p), first = (p.caption || "").trim().split("\n")[0] || "", tags = cleanTags(p.tags).length;
      $("px-capn").textContent = `${(p.caption || "").length} / 2200 · first line ${first.length} of 125`; $("px-capn").classList.toggle("over", first.length > 125);
      $("px-tagn").textContent = `${tags} tag${tags === 1 ? "" : "s"}`; $("px-tagn").classList.toggle("over", tags > 5);
      box.querySelectorAll("[data-lim]").forEach((n) => { n.textContent = `${cap.length} / ${n.dataset.lim}`; n.classList.toggle("over", cap.length > +n.dataset.lim); });
      $("px-over").innerHTML = `<b>you</b> ${esc(first.length > 70 ? first.slice(0, 70) + "…" : first || "Your caption shows here")}${(p.caption || "").includes("\n") || first.length > 70 ? ` <span style="opacity:.75">more</span>` : ""}`;
    };
    paintWords();
    const redraw = () => { const y = $("sx-view").scrollTop; drawPublish(box, p); $("sx-view").scrollTop = y; };
    const setDay = (d) => { p.scheduled = d; if (!p.time) p.time = $("px-time")?.value || "18:00"; if ($("p-sched")) $("p-sched").value = d; queueSave(); drawChrome(); redraw(); };
    box.onclick = (e) => {
      const fix = e.target.closest("[data-fix]"), day = e.target.closest("[data-d]"), cov = e.target.closest("[data-c]");
      if (fix) { const g = fix.dataset.fix; if (g === "edit") show("edit"); else { const t = $(g); t?.scrollIntoView({block: "center", behavior: "smooth"}); t?.focus?.(); } }
      else if (day) setDay(p.scheduled === day.dataset.d ? "" : day.dataset.d);
      else if (cov) { p.cover = covers[+cov.dataset.c]; queueSave(); redraw(); }
    };
    box.oninput = (e) => {
      const t = e.target, f = t.dataset.p;
      if (f) { p[f] = t.value; paintWords(); queueSave(); return; }
      const row = t.closest("[data-k]"); if (!row) return; const w = where[row.dataset.k];
      if (t.dataset.url !== undefined) { w.url = t.value.trim(); if (row.dataset.k === "instagram") p.igUrl = w.url; queueSave(); }
      else if (t.dataset.stat) { w.stats ||= {}; if (t.value === "") delete w.stats[t.dataset.stat]; else w.stats[t.dataset.stat] = Math.max(0, +t.value); queueSave(); }
    };
    box.querySelectorAll("button.use").forEach((b) => { b.onclick = () => { draft[b.dataset.field] = b.dataset.text; queueSave(); redraw(); }; });
    box.querySelectorAll("[data-on]").forEach((c) => { c.onchange = () => { where[c.closest("[data-k]").dataset.k].on = c.checked; queueSave(); redraw(); }; });
    box.querySelectorAll("[data-post]").forEach((b) => { b.onclick = () => {
      const k = b.closest("[data-k]").dataset.k, w = where[k]; w.posted = !w.posted; w.at = w.posted ? isoDay(new Date()) : null;
      const any = Object.values(where).some((x) => x.posted);
      if (any) { p.postedAt ||= isoDay(new Date()); setPostStatus("posted"); } else if (p.status === "posted") { p.postedAt = null; setPostStatus(p.scheduled ? "scheduled" : p.renderUrl ? "cut" : p.edit ? "render" : "edit"); }
      else queueSave();
      redraw();
    }; });
    $("px-draft").onclick = () => {
      if ((p.caption || "").trim() && !confirm("Replace the caption with a draft from your hook and story?")) return;
      p.caption = [(p.hook || "").trim(), (p.brief.story || "").trim()].filter(Boolean).join("\n\n");
      if (!p.caption) return toast("Write a hook or a story first", true);
      $("px-cap").value = p.caption; paintWords(); queueSave();
    };
    $("px-copy").onclick = () => { const t = fullCaption(p); t ? copy(t, "Caption and hashtags copied") : toast("Write a caption first", true); };
    $("px-copy1").onclick = () => (p.firstComment ? copy(p.firstComment, "First comment copied") : toast("No first comment yet", true));
    $("px-gd").onchange = (e) => { $("px-safe").hidden = !e.target.checked; };
    $("px-date").onchange = (e) => setDay(e.target.value);
    $("px-time").onchange = (e) => { p.time = e.target.value; queueSave(); drawChrome(); };
    $("px-wp").onclick = () => { ui.week = Math.max(0, (ui.week || 0) - 1); redraw(); };
    $("px-wn").onclick = () => { ui.week = (ui.week || 0) + 1; redraw(); };
    $("px-free").onclick = () => { const d = new Date(); for (let i = 0; i < 365; i++) { const k = isoDay(d); if (!others.some((x) => x.scheduled === k)) { ui.week = Math.floor(i / 7); return setDay(k); } d.setDate(d.getDate() + 1); } };
    if ($("px-unsched")) $("px-unsched").onclick = () => setDay("");
    killDecks();
    const deck = newDeck($("px-vid"));
    $("px-vid").addEventListener("pause", () => { if ($("px-play")) $("px-play").textContent = "▶ Play the cut"; });
    $("px-vid").addEventListener("play", () => { if ($("px-play")) $("px-play").textContent = "❚❚ Stop"; });
    $("px-play").onclick = () => {
      if (deck.playing) return deck.stop();
      const l = (edit?.edl.shots || []).map((s) => ({c: byId.get(s.clip), a: s.in, b: s.out, speed: s.speed, x: s.x}));
      if (!deck.playList(l, (_, s) => { framing("px-vid", s.x); }, () => {})) toast("Nothing playable yet", true);
    };
    if (shown) framing("px-vid", shown.x);
    if ($("p-del")) {
      let armed = false;
      $("p-del").onclick = async (e) => {
        if (!armed) { armed = true; e.target.textContent = "Click again to delete this post"; return; }
        clearTimeout(studio.timer); const id = draft.id; draft = null; await deletePost(id); $("pdlg").close();
      };
    }
  }

  /* ---------- moments ---------- */
  const remember = () => { ui.undo.push(JSON.stringify(draft.items)); if (ui.undo.length > 50) ui.undo.shift(); ui.redo = []; };
  function changed(redrawPool) { queueSave(); if (redrawPool) drawPool(); drawTimeline(); drawInspector(); drawChrome(); }
  function undo() {
    const s = ui.undo.pop(); if (!s) return toast("Nothing to undo");
    ui.redo.push(JSON.stringify(draft.items));
    draft.items = JSON.parse(s); ui.sel = null; queueSave(); drawMoments(); drawChrome(); toast("Undone");
  }
  function redo() {
    const s = ui.redo.pop(); if (!s) return toast("Nothing to redo");
    ui.undo.push(JSON.stringify(draft.items));
    draft.items = JSON.parse(s); ui.sel = null; queueSave(); drawMoments(); drawChrome(); toast("Redone");
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
  const sameX = (y, x) => !!y && !!x && y.c === x.c && (y.oa ?? y.a) === (x.oa ?? x.a) && (y.ob ?? y.b) === (x.ob ?? x.b);  // the pool is rebuilt often, so compare by clip and seconds
  const matches = (x, f) => f === "all" || (f === "unused" ? usedIndex(x) < 0 : f === "kept" ? x.kind === "kept" : f === "best" ? markOf(x.c.id)?.r === "best" : x.kind === f);
  function poolBase() {
    const near = candidates(draft); studio.candList = near.list;  // Claude's alternates, as before
    return ui.day === "near" ? near.list : fromDay(draft, ui.day);
  }
  const poolList = () => poolBase().filter((x) => matches(x, ui.filter));
  // Top picks until the post reaches its target length: one per clip first (variety), then the rest, shown in day order.
  function chooseTop(base, goal, minCount) {
    let sum = total(draft), count = draft.items.length;
    const chosen = [], seen = new Set(draft.items.map((it) => it.clip));
    for (const pass of [0, 1]) for (const x of base) {
      if (sum >= goal && count >= minCount) break;
      if (chosen.includes(x) || (pass === 0 && seen.has(x.c.id))) continue;
      if (chosen.some((y) => y.c.id === x.c.id && Math.min(y.b, x.b) - Math.max(y.a, x.a) > 0)) continue;
      chosen.push(x); seen.add(x.c.id); sum += x.b - x.a; count++;
    }
    chosen.sort((x, y) => x.c.t.localeCompare(y.c.t) || x.a - y.a);
    return {chosen, sum};
  }
  function fillToTarget() {
    const target = +draft.brief.length || 0, base = ui.base || poolBase();
    if (!target || total(draft) >= target) return;
    const {chosen, sum} = chooseTop(base, target, 0);
    if (!chosen.length) return toast("No more footage to add here. Pick another day above");
    remember();
    for (const x of chosen) draft.items.push({clip: x.c.id, a: x.a, b: x.b, role: x.role || "", note: x.note || ""});
    if (["idea", undefined, ""].includes(draft.status)) draft.status = "clips";
    ui.sel = {kind: "item", i: draft.items.length - chosen.length}; ui.t = rangeOf()?.a ?? 0;
    queueSave(); drawMoments(); drawChrome();
    toast(`Added ${chosen.length} moment${chosen.length > 1 ? "s" : ""} (${len(sum)} total). ⌘Z undoes it`);
  }
  /* ---------- auto-prepare: moments, seconds, name and story with no manual picking ---------- */
  // With no place or days set yet, start from the day whose best footage scores highest.
  const placeKey = (c) => c.region || c.city || c.country || "";
  function bestDay() {  // best day AND place, so one post never mixes cities
    const by = new Map();
    for (const c of processed) { if (c.pre || markOf(c.id)?.r === "reject" || isJunk(c)) continue; const k = c.t.slice(0, 10) + "|" + placeKey(c); (by.get(k) || by.set(k, []).get(k)).push(...(c.sug || []).map((s) => s[3] || 0)); }
    let best = null, bs = -1;
    for (const [k, l] of by) { const s = l.sort((a, b) => b - a).slice(0, 8).reduce((a, b) => a + b, 0); if (s > bs) { bs = s; best = k; } }
    return best ? best.split("|") : null;
  }
  function autoMoments() {
    const need = draft.kind === "reel" ? 2 : 1;
    if (!+draft.brief.length) draft.brief.length = 30;
    const target = +draft.brief.length;
    let base = candidates(draft).list;
    if (!base.length) { const g = bestDay(); base = g ? fromDay(draft, g[0]).filter((x) => placeKey(x.c) === g[1]) : []; }
    const {chosen, sum} = chooseTop(base, target * 1.5, need);  // 1.5x leaves Claude room to cut
    if (!chosen.length) return 0;
    remember();
    for (const x of chosen) draft.items.push({clip: x.c.id, a: x.a, b: x.b, role: x.role || "", note: x.note || ""});
    if (["idea", undefined, ""].includes(draft.status)) draft.status = "clips";
    return chosen.length;
  }
  const mainPlace = (p) => { const m = new Map(); for (const it of p.items) { const v = byId.get(it.clip); if (v && placeKey(v)) m.set(placeKey(v), (m.get(placeKey(v)) || 0) + 1); } return p.place || [...m].sort((a, b) => b[1] - a[1])[0]?.[0] || ""; };
  function autoName(p) {
    const c = byId.get(p.items[0]?.clip);
    return [mainPlace(p), c ? (c.pre ? "Before the trip" : `Day ${c.day}`) : ""].filter(Boolean).join(" · ");
  }
  // Prefers the free-model (Qwen) summary from Colab pass 2 when it exists; otherwise a plain draft from the chosen clips.
  function autoStory(p) {
    const ai = (typeof storiesFor === "function" ? storiesFor(p) : []).map(([, s]) => s?.summary).find(Boolean);
    if (ai) return {text: ai, ai: true};
    const cl = p.items.map((it) => byId.get(it.clip)).filter(Boolean);
    const place = mainPlace(p);
    const first = cl[0], when = first ? (first.pre ? "before the trip" : `day ${first.day}`) : "";
    const NOUN = {hook: "a strong opener", scenery: "the scenery", action: "the action", talk: "me talking to camera", story: "a story beat", ending: "the ending"};
    const label = (it) => { const c = byId.get(it.clip), t = c?.title || c?.scenes?.[0]; return (t ? String(t).replace(/\.$/, "") : NOUN[it.role] || "a moment").toLowerCase(); };
    const ls = p.items.map(label), n = ls.length, mid = [...new Set(ls.slice(1, -1))].slice(0, 2);
    const head = [place, when].filter(Boolean).join(", ") || "A short post";
    const text = n < 2 ? `${head}.` : `${head}: starts with ${ls[0]}${mid.length ? `, moves through ${mid.join(" and ")}` : ""}, and finishes on ${ls[n - 1]}.`;
    return {text, ai: false};
  }
  // Fixes everything the checklist flags. Only fills what is missing; never overwrites what the user already wrote or picked.
  function autoPrepare() {
    const did = [];
    if (untrimmed(draft)) { autoPick(); did.push("best seconds"); }
    if (draft.items.length < (draft.kind === "reel" ? 2 : 1) || total(draft) < (+draft.brief.length || 0)) { const n = autoMoments(); if (n) did.push(`${n} moment${n > 1 ? "s" : ""}`); }
    if (!(draft.title || "").trim() && draft.items.length) { draft.title = autoName(draft); const t = q("#p-title"); if (t) t.value = draft.title; did.push("a name"); }
    if (!(draft.brief.story || "").trim() && draft.items.length) { const s = autoStory(draft); draft.brief.story = s.text; did.push(s.ai ? "a story (free AI)" : "a basic story"); }
    if (!did.length) return toast("Nothing left to fix");
    queueSave(); drawEdit(); drawChrome();
    toast(`Added ${did.join(", ")}. ⌘Z undoes the moments${did.includes("a basic story") ? ". The story is a plain draft: Colab pass 2 writes a better one" : ""}`);
  }
  drawMoments = function () {
    const box = $("st-moments"); if (!box) return;
    killDecks();
    const days = [...new Set(processed.map((c) => c.t.slice(0, 10)))].sort();
    box.innerHTML = `
      <section class="sx-pool" aria-label="Footage">
        <div class="sx-tools">
          <input class="sx-search" id="sx-q" type="search" value="${esc(ui.query || "")}" placeholder="Search all footage: place, scene, or what you said  ( / )" aria-label="Search footage">
          <div class="sx-line"><b style="font-size:14px;white-space:nowrap">Footage <span class="muted" id="sx-found" style="font-weight:400"></span></b>
            <div class="sx-daynav"><button class="sx-btn" id="sx-dp" aria-label="Previous day">‹</button><select id="sx-day" aria-label="Footage day"><option value="near">Around this post</option>${days.map((d) => `<option value="${d}" ${ui.day === d ? "selected" : ""}>${esc(fmtShort(d))}</option>`).join("")}</select><button class="sx-btn" id="sx-dn" aria-label="Next day">›</button>
            <select class="sx-sort" id="sx-sort" aria-label="Sort"><option value="best" ${ui.sort !== "time" ? "selected" : ""}>Best first</option><option value="time" ${ui.sort === "time" ? "selected" : ""}>By time</option></select></div></div>
          <div class="sx-chips" id="sx-chips">${FILTERS.map(([k, n]) => `<button data-f="${k}" aria-pressed="${ui.filter === k}">${n}<i></i></button>`).join("")}</div>
        </div>
        <div class="sx-grid" id="sx-grid"></div>
      </section>
      <section class="sx-ins" id="sx-ins" aria-label="Selected moment">
        <div class="sx-stage" id="sx-stage"><video id="sx-vid" playsinline muted></video><div id="sx-shades"></div><span class="sx-tc" id="sx-tc"></span><button class="sx-bigplay" id="sx-pp">▶ Play</button></div>
        <div id="sx-trim"></div>
        <div id="sx-ctl" style="display:grid;gap:8px"></div>
      </section>
      <section class="sx-tl" id="sx-tl" aria-label="Post timeline"></section>`;
    const vid = $("sx-vid");
    vid.muted = ui.muted !== false;
    ui.deck = newDeck(vid, (t) => { ui.t = t; paintStrip(); });
    const label = () => { const b = $("sx-pp"); if (b) b.textContent = ui.deck.playing ? "❚❚ Pause" : "▶ Play"; const a = $("sx-all"); if (a) a.textContent = ui.deck.list && ui.deck.playing ? "❚❚ Stop" : "▶ Play all"; };
    vid.addEventListener("play", label); vid.addEventListener("pause", label);
    ui.tr = makeTrimmer($("sx-trim"), {
      range: () => rangeOf(), time: () => ui.t, follow: () => ui.deck.playing,
      begin: () => { if (rangeOf()?.it) remember(); },
      seek: (t, quiet) => seekTo(t, quiet),
      set: (a, b, final) => setRange(a, b, final),
    });
    $("sx-stage").onclick = (e) => { if (e.target.id !== "sx-pp") { togglePlay(); return; } togglePlay(); };
    $("sx-q").oninput = (e) => { ui.query = e.target.value; ui.shown = PAGE; clearTimeout(ui.qT); ui.qT = setTimeout(drawPool, 160); };
    $("sx-q").onkeydown = (e) => { if (e.key === "Escape" && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ""; ui.query = ""; drawPool(); } else if (e.key === "Enter" || e.key === "Escape") e.target.blur(); };
    const stepDay = (d) => { const s = $("sx-day"), i = clamp(s.selectedIndex + d, 0, s.options.length - 1); if (i === s.selectedIndex) return; s.selectedIndex = i; ui.day = s.value; ui.shown = PAGE; drawPool(); };
    $("sx-dp").onclick = () => stepDay(-1); $("sx-dn").onclick = () => stepDay(1);
    $("sx-day").onchange = (e) => { ui.day = e.target.value; ui.shown = PAGE; drawPool(); e.target.blur(); };
    $("sx-sort").onchange = (e) => { ui.sort = e.target.value; drawPool(); e.target.blur(); };
    $("sx-chips").onclick = (e) => {
      const b = e.target.closest("[data-f]"); if (!b) return;
      ui.filter = b.dataset.f; ui.shown = PAGE;
      $("sx-chips").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); drawPool();
    };
    const grid = $("sx-grid");
    grid.onclick = (e) => {
      if (e.target.closest("#sx-more")) { ui.shown += PAGE; return drawPool(); }
      const card = e.target.closest(".sx-card"); if (!card) return;
      const x = ui.list[+card.dataset.k]; if (!x) return;
      if (e.target.closest(".sx-plus")) { const u = usedIndex(x); return u >= 0 ? pick({kind: "item", i: u}) : quickAdd(x); }
      pick({kind: "cand", x});
    };
    grid.ondblclick = (e) => { const card = e.target.closest(".sx-card"); if (!card || e.target.closest(".sx-plus")) return; const x = ui.list[+card.dataset.k]; if (x && usedIndex(x) < 0) addCand(x); };
    grid.onmousemove = (e) => { const th = e.target.closest?.(".sx-th"), card = th?.closest(".sx-card"), x = card && ui.list[+card.dataset.k]; if (!x?.c?.ft) return; const b = th.getBoundingClientRect(), k = clamp(Math.floor(((e.clientX - b.left) / b.width) * x.c.ft.length), 0, x.c.ft.length - 1); th.style.backgroundPosition = thumbPos(x.c, k); };
    grid.onmouseout = (e) => { const th = e.target.closest?.(".sx-th"); if (!th || th.contains(e.relatedTarget)) return; const x = ui.list[+th.closest(".sx-card").dataset.k]; if (x) th.style.backgroundPosition = thumbPos(x.c, nearestFrame(x.c, (x.a + x.b) / 2)); };
    drawPool(); drawTimeline();
    if (!ui.sel && draft.items.length) ui.sel = {kind: "item", i: 0};
    if (!ui.sel && ui.list[0]) ui.sel = {kind: "cand", x: ui.list[0]};
    if (ui.sel) { ui.t = rangeOf()?.a ?? 0; ui.deck.seek(rangeOf()?.c, ui.t); }
    drawInspector(); markSel();
  };
  const thumbPos = (c, k) => { const x = S.per_clip > 1 ? (k / (S.per_clip - 1)) * 100 : 0, y = S.per_sheet > 1 ? (c.sp[1] / (S.per_sheet - 1)) * 100 : 0; return `${x}% ${y}%`; };
  const usedIndex = (x) => draft.items.findIndex((it) => it.clip === x.c.id && (it.a == null || Math.min(it.b ?? 1e9, x.b) - Math.max(it.a, x.a) > .5 * Math.min(x.b - x.a, (it.b ?? 1e9) - it.a)));
  function searchPool(raw) {
    const words = raw.toLowerCase().split(/\s+/).filter(Boolean), out = [];
    for (const c of processed) {
      if (markOf(c.id)?.r === "reject") continue;
      const hay = [c.title, c.region, c.city, c.country, c.desc, ...(c.scenes || []), ...(c.tags || []), ...(c.txs || []).map((x) => x[2])].filter(Boolean).join(" ").toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const said = (c.txs || []).filter((x) => words.some((w) => String(x[2]).toLowerCase().includes(w)));
      if (said.length) for (const l of said.slice(0, 3)) out.push({c, a: r2(l[0]), b: r2(Math.max(l[1], l[0] + 1)), kind: "talk", role: "talk", note: "", score: 3});
      else if ((c.sug || []).length) for (const s of c.sug.slice(0, 2)) out.push({c, a: s[0], b: s[1], kind: s[2], role: KIND_ROLE[s[2]] || "", note: "", score: s[3]});
      else out.push({c, a: 0, b: Math.min(5, c.dur || 5), kind: "steady", role: "", note: "", score: 0});
      if (out.length > 300) break;
    }
    return out.sort((x, y) => y.score - x.score);
  }
  function drawPool() {
    const grid = $("sx-grid"); if (!grid) return;
    const query = (ui.query || "").trim();
    ui.base = query ? searchPool(query) : poolBase();
    ui.list = ui.base.filter((x) => matches(x, ui.filter));
    if (ui.sort === "time") ui.list = [...ui.list].sort((x, y) => x.c.t.localeCompare(y.c.t) || x.a - y.a);
    $("sx-found").textContent = `· ${ui.list.length}`;
    document.querySelectorAll("#sx-chips button").forEach((b) => {
      const n = ui.base.filter((x) => matches(x, b.dataset.f)).length;
      b.querySelector("i").textContent = n; b.classList.toggle("none", !n);
    });
    grid.innerHTML = ui.list.slice(0, ui.shown).map((x, k) => { const u = usedIndex(x); return `<div class="sx-card ${u >= 0 ? "used" : ""}" role="button" tabindex="0" data-k="${k}" aria-label="${esc(clipName(x.c))}, ${fmtT(x.a)}">
      <div class="sx-th" style="${thumbStyle(x.c, nearestFrame(x.c, (x.a + x.b) / 2))}"><span class="sx-dur">${(x.b - x.a).toFixed(1)} s</span>${u >= 0 ? `<span class="sx-used">${u + 1}</span>` : markOf(x.c.id)?.r === "best" ? `<span class="sx-star">★</span>` : ""}</div>
      <button class="sx-plus" aria-label="${u >= 0 ? "Show in timeline" : "Add to post"}" title="${u >= 0 ? "Already in the post. Show it" : "Add to post"}">${u >= 0 ? "✓" : "+"}</button>
      <b>${esc(clipName(x.c))}</b><span>${x.kind === "kept" ? "Your pick" : esc(KIND_NAME[x.kind] || x.kind)} · ${esc(dayName(x.c))} · ${fmtT(x.a)}</span></div>`; }).join("")
      + (ui.list.length > ui.shown ? `<button class="sx-btn sx-more" id="sx-more">Show ${Math.min(PAGE, ui.list.length - ui.shown)} more</button>` : "")
      || `<p class="sx-empty">${query ? `Nothing found for “${esc(query)}”.` : draft.items.length || ui.day !== "near" ? "Nothing matches this filter." : "Choose a day above, or search, to see footage."}</p>`;
    markSel();
  }
  function markSel() {
    const x = ui.sel?.kind === "cand" ? ui.sel.x : null;
    document.querySelectorAll("#sx-grid .sx-card").forEach((n) => n.classList.toggle("on", !!x && sameX(ui.list[+n.dataset.k], x)));
    document.querySelectorAll("#sx-track .sx-shot").forEach((n) => n.classList.toggle("on", ui.sel?.kind === "item" && +n.dataset.i === ui.sel.i));
  }
  function pick(sel) { ui.deck?.stop(); ui.sel = sel; ui.t = rangeOf()?.a ?? 0; ui.deck?.seek(rangeOf()?.c, ui.t); drawInspector(); markSel(); q("#sx-track .sx-shot.on")?.scrollIntoView({block: "nearest", inline: "nearest"}); }
  function seekTo(t, quiet) {
    const r = rangeOf(); if (!r?.c) return;
    ui.t = clamp(t, 0, r.c.dur || t);
    if (ui.deck?.playing && !quiet) ui.deck.range(r.c, r.a, r.b, clamp(ui.t, r.a, r.b)); else { if (ui.deck?.playing) ui.deck.stop(); ui.deck?.seek(r.c, ui.t); }
    paintStrip();
  }
  function togglePlay() {
    const r = rangeOf(); if (!r?.c || !ui.deck) return;
    if (ui.deck.playing) { ui.deck.stop(); return; }
    if (!fileOf(r.c)) return toast("This clip has no playable copy yet", true);
    ui.deck.range(r.c, r.a, r.b, ui.t >= r.a && ui.t < r.b - .05 ? ui.t : r.a);
  }
  function playAll() {
    if (ui.deck.list && ui.deck.playing) { ui.deck.stop(); return; }
    const list = draft.items.map((it) => spanOf(it)).filter((s) => s.c);
    const ok = ui.deck.playList(list, (i) => { ui.sel = {kind: "item", i}; ui.t = list[i].a; drawInspector(); markSel(); q("#sx-track .sx-shot.on")?.scrollIntoView({block: "nearest", inline: "nearest"}); }, () => toast("End of the post"));
    if (!ok) toast("Nothing playable yet", true);
  }
  function spanOf(it) {
    const c = byId.get(it.clip); if (it.a != null) return {c, a: it.a, b: it.b ?? c?.dur ?? it.a};
    const r = bestRange(c); return r ? {c, a: r[0], b: r[1]} : {c, a: 0, b: Math.min(5, c?.dur || 5)};
  }
  function pushItem(x) {
    remember();
    draft.items.push({clip: x.c.id, a: x.a, b: x.b, role: x.role || "", note: x.note || ""});
    if (["idea", undefined, ""].includes(draft.status)) draft.status = "clips";
  }
  function quickAdd(x) { pushItem(x); queueSave(); drawPool(); drawTimeline(); drawChrome(); const tr = $("sx-track"); if (tr) tr.scrollLeft = tr.scrollWidth; toast(`Added · ${len(total(draft))} so far`); }
  function addCand(x) {
    pushItem(x);
    ui.sel = {kind: "item", i: draft.items.length - 1}; ui.t = x.a;
    changed(true); markSel();
    const tr = $("sx-track"); if (tr) tr.scrollLeft = tr.scrollWidth;
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
    const dur = r.c?.dur || b; a = clamp(r2(a), 0, Math.max(0, dur - 0.3)); b = clamp(r2(b), a + 0.3, dur);
    if (ui.sel.kind === "cand") { const x = ui.sel.x; x.oa ??= x.a; x.ob ??= x.b; x.a = a; x.b = b; }
    else { const it = draft.items[ui.sel.i]; it.a = a; it.b = b; if (final) { queueSave(); drawTimeline(); drawChrome(); } }
    paintStrip();
  }
  function paintStrip() {
    const r = rangeOf(), st = $("sx-stage"); if (!r || !st) return;
    st.style.backgroundImage = ""; const f = thumbStyle(r.c, nearestFrame(r.c, ui.t));
    st.style.cssText = `${f};background-size:${S.per_clip * 100}% ${S.per_sheet * 100}%`;
    $("sx-tc").textContent = `${fmtT(r2(ui.t))} · ${(r.b - r.a).toFixed(1)} s cut`;
    ui.tr?.paint();
    if ($("sx-in")) { if (document.activeElement !== $("sx-in")) $("sx-in").value = fmtT(r.a); if (document.activeElement !== $("sx-out")) $("sx-out").value = fmtT(r.b); }
    if ($("sx-lenv")) $("sx-lenv").textContent = `${(r.b - r.a).toFixed(1)} s`;
  }
  function drawInspector() {
    const box = $("sx-ctl"); if (!box) return;
    const r = rangeOf();
    if (!r?.c) { box.innerHTML = `<p class="sx-empty">Pick a moment from the footage to preview it here.</p>`; $("sx-trim").style.visibility = "hidden"; return; }
    $("sx-trim").style.visibility = "";
    const {c, it} = r, [w, h] = (ASPECT[draft.brief.aspect] || ASPECT["9:16"]), win = Math.min(1, (w / h) / (16 / 9)), side = ((1 - win) / 2) * 100;
    $("sx-shades").innerHTML = side > 0 ? `<div class="sx-shade" style="left:0;width:${side}%"></div><div class="sx-shade" style="right:0;width:${side}%"></div>` : "";
    ui.tr.load(c);
    const lines = (c.txs || []).filter(([s, e]) => e > r.a - 25 && s < r.b + 25).slice(0, 14);
    const used = it ? -1 : usedIndex({c, a: r.a, b: r.b});
    box.innerHTML = `
      <div class="sx-info"><b>${esc(clipName(c))}</b><span>${esc([dayName(c), c.region || c.city, c.t.slice(11, 16), len(c.dur || 0) + " clip"].filter(Boolean).join(" · "))}</span></div>
      ${lines.length ? `<div class="sx-lines" aria-label="What is said here">${lines.map((l, i) => `<button data-line="${i}" title="Cut to this line">“${esc(l[2])}”</button>`).join("")}</div>` : ""}
      <div class="sx-acts">
        ${it ? "" : used >= 0 ? `<button class="sx-btn" id="sx-goto">Already in post: show #${used + 1}</button>` : `<button class="sx-btn main" id="sx-add" title="Add to post (A)">Add to post</button>`}
        <button class="sx-btn tiny" data-nudge="a,-0.1" aria-label="Start earlier">−</button><input class="t" id="sx-in" aria-label="Start" value="${fmtT(r.a)}"><button class="sx-btn tiny" data-nudge="a,0.1" aria-label="Start later">+</button>
        <span class="muted">to</span>
        <button class="sx-btn tiny" data-nudge="b,-0.1" aria-label="End earlier">−</button><input class="t" id="sx-out" aria-label="End" value="${fmtT(r.b)}"><button class="sx-btn tiny" data-nudge="b,0.1" aria-label="End later">+</button>
        <b id="sx-lenv" style="font-size:13px;font-variant-numeric:tabular-nums"></b>
        ${[2, 3, 5, 8].map((n) => `<button class="sx-btn tiny" data-preset="${n}" title="Make this cut ${n} seconds">${n}s</button>`).join("")}
        <button class="sx-btn tiny" id="sx-sound" title="Sound on or off in this preview">${ui.muted === false ? "Sound on" : "Sound off"}</button>
      </div>
      ${it ? `<div class="sx-acts"><select id="sx-role" aria-label="Role">${roleOpts(it.role)}</select>
        <button class="sx-btn tiny" id="sx-left" aria-label="Move earlier">←</button><button class="sx-btn tiny" id="sx-right" aria-label="Move later">→</button>
        <button class="sx-btn tiny" id="sx-split" title="Cut in two at the white line (S)">Split</button><button class="sx-btn tiny" id="sx-dup" title="Duplicate (D)">Duplicate</button><button class="sx-btn tiny bad" id="sx-rm">Remove</button>
        <input class="sx-note" id="sx-note" value="${esc(it.note || "")}" placeholder="Note for the edit, e.g. keep the sound" aria-label="Note for the edit"></div>` : ""}
      <div class="sx-keys"><kbd>Space</kbd> play · <kbd>←</kbd> <kbd>→</kbd> shot · <kbd>J</kbd> <kbd>L</kbd> back / forward 1 s · <kbd>F</kbd> fullscreen · <kbd>I</kbd> <kbd>O</kbd> start / end here · <kbd>R</kbd> loop · <kbd>M</kbd> sound · <kbd>,</kbd> <kbd>.</kbd> step · <kbd>S</kbd> split · <kbd>D</kbd> duplicate · <kbd>⌫</kbd> remove · <kbd>⌘Z</kbd> undo</div>`;
    paintStrip();
    const time = (id, key) => { $(id).onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (e.key === "Escape") e.target.value = fmtT(rangeOf()[key]); e.target.blur(); } }; $(id).onchange = (e) => {
      const t = parseT(e.target.value), now = rangeOf();
      if (t == null || t < 0 || t > (now.c.dur || 1e9)) { toast("Use seconds (12.5) or minutes:seconds (1:05), inside the clip", true); e.target.value = fmtT(now[key]); return; }
      if (now.it) remember();
      setRange(key === "a" ? t : now.a, key === "b" ? t : now.b, true); ui.tr.fit(); seekTo(key === "a" ? rangeOf().a : Math.max(rangeOf().a, rangeOf().b - 1), true);
    }; };
    time("sx-in", "a"); time("sx-out", "b");
    box.onclick = (e) => {
      const n = e.target.closest("[data-nudge]"), p = e.target.closest("[data-preset]"), l = e.target.closest("[data-line]"), now = rangeOf(); if (!now) return;
      if (n) { const [k, d] = n.dataset.nudge.split(","); if (now.it) remember(); setRange(k === "a" ? now.a + +d : now.a, k === "b" ? now.b + +d : now.b, true); seekTo(k === "a" ? rangeOf().a : rangeOf().b - .05, true); }
      else if (p) { if (now.it) remember(); setRange(now.a, now.a + +p.dataset.preset, true); ui.tr.fit(); }
      else if (l) { const x = lines[+l.dataset.line]; if (now.it) remember(); setRange(x[0], Math.max(x[1], x[0] + .5), true); ui.tr.fit(); seekTo(rangeOf().a, true); togglePlay(); }
    };
    if ($("sx-add")) $("sx-add").onclick = () => addCand(ui.sel.x);
    if ($("sx-goto")) $("sx-goto").onclick = () => pick({kind: "item", i: used});
    $("sx-sound").onclick = (e) => { const v = $("sx-vid"); v.muted = !v.muted; ui.muted = v.muted; e.target.textContent = v.muted ? "Sound off" : "Sound on"; };
    if (it) {
      $("sx-role").onchange = (e) => { it.role = e.target.value; queueSave(); e.target.blur(); };
      $("sx-note").oninput = (e) => { it.note = e.target.value; queueSave(); };
      $("sx-note").onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.target.blur(); } };
      $("sx-left").onclick = () => moveItem(-1); $("sx-right").onclick = () => moveItem(1); $("sx-rm").onclick = removeItem;
      $("sx-split").onclick = splitItem; $("sx-dup").onclick = dupItem;
    }
  }
  function moveItem(d) {
    const i = ui.sel.i, j = i + d, l = draft.items; if (j < 0 || j >= l.length) return;
    remember(); const [m] = l.splice(i, 1); l.splice(j, 0, m); ui.sel.i = j; changed();
  }
  function removeItem(at) {
    const i = Number.isInteger(at) ? at : ui.sel.i; remember(); draft.items.splice(i, 1);
    ui.deck?.stop();
    ui.sel = draft.items.length ? {kind: "item", i: Math.min(i, draft.items.length - 1)} : null;
    ui.t = rangeOf()?.a ?? 0; if (ui.sel) ui.deck?.seek(rangeOf().c, ui.t);
    changed(true); markSel(); toast("Removed. ⌘Z brings it back");
  }
  function splitItem() {
    const r = rangeOf(); if (!r?.it) return;
    const a = r.a, b = r.b, t = r2(ui.t); if (t < a + .3 || t > b - .3) return toast("Move the white line inside the cut first", true);
    remember(); const i = ui.sel.i; r.it.a = a; r.it.b = t;
    draft.items.splice(i + 1, 0, {...r.it, a: t, b}); ui.sel = {kind: "item", i: i + 1}; ui.t = t;
    changed(); markSel(); toast("Split in two");
  }
  function dupItem() { const r = rangeOf(); if (!r?.it) return; remember(); const i = ui.sel.i; draft.items.splice(i + 1, 0, {...r.it}); ui.sel = {kind: "item", i: i + 1}; changed(); markSel(); }
  function drawTimeline() {
    const box = $("sx-tl"); if (!box) return;
    const p = draft, sum = total(p), target = +p.brief.length || 0, spare = untrimmed(p), pct = target ? Math.min(100, (sum / target) * 100) : 0;
    const say = !p.items.length ? "Press + on any footage to add it" : !target ? `${len(sum)} selected` : sum < target ? `${len(target - sum)} short of ${target} s` : sum <= target * 2 ? `Good: enough to cut to ${target} s` : `${len(sum)} is a lot for ${target} s`;
    box.innerHTML = `<div class="sx-tlhead"><b>${p.items.length} moment${p.items.length === 1 ? "" : "s"} · ${len(sum)}</b><span class="muted">${esc(say)}</span>
        ${target ? `<div class="sx-meter ${sum > target * 2 ? "over" : ""}"><i style="width:${pct}%"></i></div>` : `<span style="flex:1"></span>`}
        <button class="sx-btn" id="sx-undo" ${ui.undo.length ? "" : "disabled"} title="Undo (⌘Z)">Undo</button><button class="sx-btn" id="sx-redo" ${ui.redo?.length ? "" : "disabled"} title="Redo (⇧⌘Z)">Redo</button>
        ${p.items.length > 1 ? `<button class="sx-btn" id="sx-sort-t" title="Put the moments in the order they were filmed">Sort by time</button>` : ""}
        ${p.items.length ? `<button class="sx-btn bad" id="sx-clear">Clear</button>` : ""}
        ${spare ? `<button class="sx-btn main" id="sx-auto">Pick best seconds (${spare})</button>` : ""}
        ${target && sum < target ? `<button class="sx-btn ${spare ? "" : "main"}" id="sx-fill" title="Add the top picks until the post reaches ${target} s">Fill to ${target} s</button>` : ""}
        ${p.items.length ? `<button class="sx-btn" id="sx-all">${ui.deck?.list && ui.deck?.playing ? "❚❚ Stop" : "▶ Play all"}</button><button class="sx-btn main" id="sx-toedit">Next: Edit →</button>` : ""}</div>
      <div class="sx-track" id="sx-track"></div>`;
    const on = (id, f) => { if ($(id)) $(id).onclick = f; };
    on("sx-auto", autoPick); on("sx-fill", fillToTarget); on("sx-undo", undo); on("sx-redo", redo); on("sx-all", playAll); on("sx-toedit", () => show("edit"));
    on("sx-sort-t", () => { remember(); const cur = draft.items[ui.sel?.i]; draft.items.sort((x, y) => (byId.get(x.clip)?.t || "").localeCompare(byId.get(y.clip)?.t || "") || (x.a || 0) - (y.a || 0)); if (ui.sel?.kind === "item") ui.sel.i = Math.max(0, draft.items.indexOf(cur)); changed(true); });
    on("sx-clear", () => { remember(); draft.items = []; ui.deck?.stop(); ui.sel = ui.list[0] ? {kind: "cand", x: ui.list[0]} : null; ui.t = rangeOf()?.a ?? 0; changed(true); toast("Cleared. ⌘Z brings them back"); });
    drawTrack($("sx-track"), p.items.map((it) => { const c = byId.get(it.clip), w = it.a == null; return {c, len: w ? spanOf(it).b - spanOf(it).a : itemLen(it), frame: w ? coverFrame(c) : nearestFrame(c, (it.a + (it.b ?? it.a)) / 2), badge: w ? "auto" : ""}; }), {
      target, pick: (i) => pick({kind: "item", i}), remove: (i) => removeItem(i),
      move: (a, b) => { remember(); const [m] = draft.items.splice(a, 1); draft.items.splice(b, 0, m); ui.sel = {kind: "item", i: b}; changed(); },
    });
    markSel();
  }
  $("pdlg").addEventListener("cancel", (e) => { if (ui.view === "moments" && ui.deck?.playing) { e.preventDefault(); ui.deck.stop(); } });
  $("pdlg").addEventListener("keydown", (e) => {
    if (!draft || ui.view !== "moments" || e.target.matches("input,textarea,select")) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const r = rangeOf();
    const stepT = e.shiftKey ? 1 : 1 / 10;
    if (k === " ") { e.preventDefault(); togglePlay(); }
    else if (k === "/") { e.preventDefault(); $("sx-q")?.focus(); }
    else if (k === "p") { e.preventDefault(); playAll(); }
    else if (k === "a" && ui.sel?.kind === "cand") { e.preventDefault(); if (usedIndex(ui.sel.x) < 0) addCand(ui.sel.x); }
    else if (k === "i" && r) { if (r.it) remember(); setRange(ui.t, Math.max(r.b, ui.t + 0.3), true); }
    else if (k === "o" && r) { if (r.it) remember(); setRange(Math.min(r.a, ui.t - 0.3), ui.t, true); }
    else if (k === "s" && r?.it) { e.preventDefault(); splitItem(); }
    else if (k === "d" && r?.it) { e.preventDefault(); dupItem(); }
    else if ((k === "," || k === "<") && r) { e.preventDefault(); seekTo(ui.t - stepT, true); }
    else if ((k === "." || k === ">") && r) { e.preventDefault(); seekTo(ui.t + stepT, true); }
    else if ((k === "backspace" || k === "delete") && ui.sel?.kind === "item") { e.preventDefault(); removeItem(); }
    else if (["arrowright", "arrowleft", "arrowdown", "arrowup"].includes(k)) {
      e.preventDefault();
      const vert = k.endsWith("down") || k.endsWith("up"), cols = vert && ui.sel?.kind !== "item" ? (getComputedStyle($("sx-grid")).gridTemplateColumns.split(" ").length || 1) : 1;
      const d = (k === "arrowright" || k === "arrowdown" ? 1 : -1) * cols;
      if (ui.sel?.kind === "item") { if (draft.items.length) pick({kind: "item", i: clamp(ui.sel.i + d, 0, draft.items.length - 1)}); }
      else { const at = ui.list.findIndex((y) => sameX(y, ui.sel?.x)), x = ui.list[clamp(at + d, 0, Math.min(ui.shown, ui.list.length) - 1)]; if (x) { pick({kind: "cand", x}); q("#sx-grid .sx-card.on")?.scrollIntoView({block: "nearest"}); } }
    }
  });

  /* ---------- edit step ---------- */
  const ORDER = [["", "Claude decides"], ["keep", "Keep my order"], ["free", "Claude may reorder"]];
  const SCOPE = [["", "Claude decides"], ["mine", "Only my moments"], ["add", "May add B-roll"]];
  /* which Claude cuts this edit and how hard it thinks; "" = automatic (the Mac picks from config/edit_models.json) */
  const MODEL = [["", "Automatic"], ["haiku", "Haiku · fastest"], ["sonnet", "Sonnet · balanced"], ["opus", "Opus · best"]];
  const EFFORT = [["", "Automatic"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]];
  const TRACK = [["", "Smart: follow my face when I talk"], ["off", "Off: fixed framing"]];
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return Number.isFinite(m) ? (m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`) : ""; };
  // What the material really comes to: a whole clip counts as the best seconds Claude (or "Pick best seconds") would take, not its full length.
  const material = (p) => p.items.reduce((a, it) => { if (it.a != null) return a + itemLen(it); const r = bestRange(byId.get(it.clip)); return a + (r ? r[1] - r[0] : itemLen(it)); }, 0);
  function readiness(p) {
    const need = p.kind === "reel" ? 2 : 1, target = +p.brief.length || 0, have = material(p), n = untrimmed(p), out = [];
    out.push((p.title || "").trim() ? {s: "ok", t: "The post has a name"} : {s: "block", t: "Give the post a name", a: ["Name it for me", () => autoPrepare()]});
    out.push(p.items.length >= need ? {s: "ok", t: `${p.items.length} moment${p.items.length === 1 ? "" : "s"} chosen`} : {s: "block", t: `Add at least ${need} moment${need > 1 ? "s" : ""}`, a: ["Pick for me", autoPrepare]});
    out.push((p.brief.story || "").trim() ? {s: "ok", t: "The story is written"} : {s: "tip", t: "No story yet. Claude cuts toward the story, so this is the most useful thing to add.", a: ["Write it for me", autoPrepare]});
    out.push(n ? {s: "tip", t: `${n} clip${n > 1 ? "s have" : " has"} no seconds picked. Claude will choose, or you can now.`, a: ["Pick seconds", () => { autoPick(); drawEdit(); }]} : {s: "ok", t: "Every moment has its seconds picked"});
    if (!target) out.push({s: "tip", t: "No target length, so Claude decides.", a: ["Set length", () => show("brief")]});
    else if (have < target) out.push({s: "tip", t: `${len(have)} of material for a ${target} s post: a little short.`, a: ["Add more for me", autoPrepare]});
    else if (have > target * 3) out.push({s: "tip", t: `${len(have)} of material for a ${target} s post. Claude has to drop most of it, so trim or remove moments you don't need.`, a: ["Review moments", () => show("moments")]});
    else out.push({s: "ok", t: `${len(have)} of material for a ${target} s post`});
    return out;
  }
  const mark = {ok: "✓", block: "!", tip: "·"};
  function noteText(p) {
    const b = p.brief, c = [];
    if (b.order === "keep") c.push("Keep my moments in the order I put them.");
    if (b.order === "free") c.push("You may reorder the moments for the best story.");
    if (b.scope === "mine") c.push("Use only my moments, no other footage.");
    if (b.scope === "add") c.push("You may add B-roll from the same days where it helps.");
    return [ui.reqNote.trim(), c.length ? "Controls: " + c.join(" ") : ""].filter(Boolean).join("\n\n");
  }
  const flow = (step) => `<ol class="sx-flow" aria-label="How an edit happens">${[["Prepare", "Brief and moments, on this page"], ["Send", "The auto-editor on your Mac edits and renders it"], ["Review", "The finished video appears here"]].map(([t, d], i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}"><b>${i + 1} · ${t}</b><span>${d}</span></li>`).join("")}</ol>`;
  function waitBox(p, big) {
    const info = window.__requestInfo?.(p.id), sent = (info?.note || "").trim();
    const el = document.createElement("div"); el.className = "sx-wait" + (big ? " big" : "");
    const STAGE = {editing: ["Claude is editing this post now.", "It picks the order, the seconds and the framing from your brief. Usually 2–4 minutes."], rendering: ["Edit done. Rendering the video now.", "Made from the 4K originals on your Mac. Usually 1 minute per 2 seconds of video."]};
    const st = STAGE[info?.stage], since = info?.pickedAt ? ` · started ${esc(ago(info.pickedAt))}` : "";
    el.innerHTML = st ? `<div style="min-width:0"><b>${st[0]}</b>${big ? `<p>${st[1]}${since}. This page updates by itself; you can close it.</p>` : ""}</div>` : `<div style="min-width:0"><b>Waiting for the auto-editor.</b> ${big ? "" : "It starts within a minute when it is running on your Mac."}
      ${big ? `<p>When the auto-editor is running on your Mac it starts within a minute, edits, renders and puts the finished video here. If nothing happens, open Claude Code and paste <b>edit the requested posts</b>. This page updates by itself, no reload needed.</p>` : ""}
      ${info?.at ? `<p>Requested ${esc(new Date(info.at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}))} · ${esc(ago(info.at))}${info.mode && info.mode !== "first" ? ` · ${esc(info.mode)}` : ""}</p>` : ""}
      ${big && sent ? `<details><summary class="muted small">What you sent</summary><pre>${esc(sent)}</pre></details>` : ""}</div>
      <div class="sx-acts"><button class="sx-btn main" data-w="copy">Copy command</button>${window.__requestCancel ? `<button class="sx-btn" data-w="cancel">Cancel request</button>` : ""}</div>`;
    const cp = q('[data-w="copy"]', el);
    if (cp) cp.onclick = () => copy("edit the requested posts", "Copied. Paste it into Claude Code");
    const c = q('[data-w="cancel"]', el);
    if (c) c.onclick = async () => { c.disabled = true; await window.__requestCancel(p.id); drawEdit(); drawChrome(); };
    return el;
  }
  function drawRequest(p) {
    const box = $("st-edit"), br = p.brief, rd = readiness(p), blocked = rd.some((r) => r.s === "block"), isWaiting = waiting(p);
    const dv = (v, f) => (v ? `<dd>${esc(f ? f(v) : v)}</dd>` : `<dd class="auto">Claude decides</dd>`);
    const sum = [["Story", dv((br.story || "").trim())], ["Length", dv(br.length, (v) => `${v} s`)], ["Shape", dv(br.aspect, (v) => SHORT.aspect[v] || v)], ["Pace", dv(br.pace, (v) => SHORT.pace[v] || v)],
      ["Sound", dv(br.audio, (v) => SHORT.audio[v] || v)], ["Text", dv(br.captions, (v) => SHORT.captions[v] || v)], ["Mood", dv((br.mood || "").trim())], ["Include", dv((br.include || "").trim())], ["Avoid", dv((br.avoid || "").trim())]]
      .map(([k, v]) => `<dt>${k}</dt>${v}`).join("");
    const mini = p.items.slice(0, 14).map((it, i) => {
      const c = byId.get(it.clip), r = it.a == null ? bestRange(c) : null;
      const span = it.a != null ? `${fmtT(it.a)}–${fmtT(it.b ?? c?.dur ?? it.a)} · ${len(itemLen(it))}` : `whole ${len(itemLen(it))}${r ? ` → best ${len(r[1] - r[0])}` : ""}`;
      return `<li><span class="muted">${i + 1}</span><span>${esc(clipName(c))}${it.role ? ` <span class="muted">· ${esc(ROLES[it.role] || it.role)}</span>` : ""}</span><span>${esc(span)}</span></li>`;
    }).join("") + (p.items.length > 14 ? `<li><span></span><span class="muted">+ ${p.items.length - 14} more</span><span></span></li>` : "");
    const ctl = (k, opts) => `<div class="sx-seg" data-ctl="${k}">${opts.map(([x, n]) => `<button type="button" data-x="${x}" aria-pressed="${String(br[k] ?? "") === x}">${n}</button>`).join("")}</div>`;
    const failed = window.__requestInfo?.(p.id);
    const left = isWaiting ? `<div id="sx-waitslot"></div>` : `
      ${failed?.status === "failed" ? `<div class="sx-wait"><div style="min-width:0"><b>The last automatic edit failed.</b><p class="muted small" style="margin:4px 0 0">${esc(failed.error || "No reason given")}</p></div></div>` : ""}
      <div class="sx-card2"><h3>Do it all for me</h3><p class="muted small" style="margin:0 0 10px">Fills in anything missing (moments, best seconds, name, story), sends it, and the auto-editor on your Mac edits and renders it. The finished video appears here.</p>
        <div class="sx-acts"><button class="sx-btn main" id="sx-all">✦ Do it all for me</button></div></div>
      <div class="sx-card2"><h3>Before you send</h3>${rd.some((r) => r.s !== "ok") ? `<div class="sx-acts"><button class="sx-btn main" id="sx-prep" title="Picks the moments and their best seconds, names the post and drafts the story. Only fills what is missing.">Make it ready for me</button><span class="muted small">Or fix each item below yourself.</span></div>` : ""}<ul class="sx-ready">${rd.map((r, i) => `<li class="${r.s}"><i>${mark[r.s]}</i><span>${esc(r.t)}</span>${r.a ? `<button class="sx-btn" data-r="${i}">${esc(r.a[0])}</button>` : "<span></span>"}</li>`).join("")}</ul></div>
      <div class="sx-card2"><h3>How much control to give Claude</h3>
        <div class="sx-ctl">Moment order${ctl("order", ORDER)}</div>
        <div class="sx-ctl">Footage${ctl("scope", SCOPE)}</div>
        <label class="sx-ctl">Anything else for this edit <small>Optional. For example: open on the tuk-tuk, end on the sunset.</small><textarea id="sx-reqnote" style="min-height:70px">${esc(ui.reqNote)}</textarea></label></div>
      <div class="sx-card2"><h3>Claude and framing for this edit</h3>
        <div class="sx-ctl">Claude model${ctl("model", MODEL)}</div>
        <div class="sx-ctl">Effort <small>Higher thinks longer: better cuts, slower, more of your plan.</small>${ctl("effort", EFFORT)}</div>
        <div class="sx-ctl">Face tracking <small>Follows your face while you talk to camera. Holds still when you show something or your face is covered.</small>${ctl("track", TRACK)}</div></div>
      <div class="sx-acts"><button class="sx-btn main" id="sx-send" ${blocked ? "disabled" : ""}>Send edit request</button><span class="muted small">${blocked ? "Fix the items marked ! first." : "Nothing is edited yet: this asks Claude Code to make a version for you to review."}</span></div>`;
    box.innerHTML = `<div class="sx-req">
      <div><h2>${isWaiting ? "Edit requested" : "Make the edit"}</h2><p class="lede">${isWaiting ? "Claude reads your brief and moments and writes the cut, then your Mac renders it. The finished video appears here, and you can still change it by hand." : "Every route makes a version you can fine-tune by hand, compare and approve."}</p></div>
      ${isWaiting ? flow(2) : `<div class="sx-how" id="sx-how">${[["claude", "✦ Edit with Claude", "AI picks the order, cuts, framing and text from your brief."], ["quick", "Instant auto-cut", "Free, no AI. Fits your moments to the target length now."], ["hand", "Edit by hand", "Start from your moments and cut it yourself."]].map(([k, t, d]) => `<button data-how="${k}" aria-pressed="${ui.how === k}"><b>${t}</b><span>${d}</span></button>`).join("")}</div>`}
      ${!isWaiting && ui.how === "quick" ? `<div class="sx-card2"><h3>Pace of the cut</h3><div class="sx-acts">${[["calm", "Calm"], ["medium", "Medium"], ["fast", "Fast"]].map(([k, n]) => `<button class="sx-btn ${(br.pace || "medium") === k ? "main" : ""}" data-quick="${k}" ${p.items.length ? "" : "disabled"}>Cut it ${n.toLowerCase()}</button>`).join("")}${p.items.length ? "" : `<button class="sx-btn" data-go="moments">Add moments first</button>`}</div></div>`
      : !isWaiting && ui.how === "hand" ? `<div class="sx-card2"><h3>Start from your ${p.items.length} moment${p.items.length === 1 ? "" : "s"}</h3><div class="sx-acts"><button class="sx-btn main" id="sx-hand" ${p.items.length ? "" : "disabled"}>Open the editor</button>${p.items.length ? "" : `<button class="sx-btn" data-go="moments">Add moments first</button>`}</div></div>` : ""}
      ${!isWaiting && ui.how !== "claude" ? "" : `<div class="sx-two"><div class="sx-stack">${left}</div>
        <div class="sx-stack"><div class="sx-card2"><h3>What Claude will receive</h3><dl class="sx-sum">${sum}</dl><div class="sx-acts"><button class="sx-btn" data-go="brief">Change brief</button></div></div>
          <div class="sx-card2"><h3>Moments · ${p.items.length} · ${len(total(p))} as picked</h3>${p.items.length ? `<ul class="sx-mini">${mini}</ul>` : `<p class="muted small">None yet.</p>`}<div class="sx-acts"><button class="sx-btn" data-go="moments">Change moments</button></div></div></div></div>`}</div>`;
    if ($("sx-how")) $("sx-how").onclick = (e) => { const b = e.target.closest("[data-how]"); if (b) { ui.how = b.dataset.how; drawRequest(draft); } };
    box.querySelectorAll("[data-quick]").forEach((b) => { b.onclick = () => newVersion(quickShots(draft, b.dataset.quick), `Instant auto-cut (${b.dataset.quick})`); });
    if ($("sx-hand")) $("sx-hand").onclick = () => newVersion(shotsFromMoments(draft), "Made by hand");
    if (isWaiting) q("#sx-waitslot").replaceWith(waitBox(p, true));
    box.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => show(b.dataset.go); });
    box.querySelectorAll("[data-r]").forEach((b) => { b.onclick = () => rd[+b.dataset.r].a[1](); });
    box.querySelectorAll("[data-ctl]").forEach((g) => { g.onclick = (e) => { const b = e.target.closest("[data-x]"); if (!b) return; draft.brief[g.dataset.ctl] = b.dataset.x; g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b)); queueSave(); }; });
    if ($("sx-reqnote")) $("sx-reqnote").oninput = (e) => { ui.reqNote = e.target.value; };
    if ($("sx-prep")) $("sx-prep").onclick = autoPrepare;
    if ($("sx-all")) $("sx-all").onclick = async () => {
      const b = $("sx-all"); b.disabled = true; b.textContent = "Preparing…";
      if (readiness(draft).some((r) => r.s !== "ok")) autoPrepare();
      if (readiness(draft).some((r) => r.s === "block")) { b.disabled = false; b.textContent = "✦ Do it all for me"; return toast("Couldn't fill everything in. Fix the items marked ! below", true); }
      await persist();
      if (!draft.id) { b.disabled = false; b.textContent = "✦ Do it all for me"; return toast("The post couldn't be saved yet. Try again in a moment", true); }
      await window.__requestEdit(draft.id, "first", noteText(draft));
      drawEdit(); drawChrome();
    };
    if ($("sx-send")) $("sx-send").onclick = async () => {
      const b = $("sx-send"); b.disabled = true;
      await persist();
      if (!draft.id) { toast("Name the post first so it can be saved", true); b.disabled = false; return; }
      await window.__requestEdit(draft.id, "first", noteText(draft));
      drawEdit(); drawChrome();
    };
  }
  /* ---------- the editor: by hand, instant auto-cut, or with Claude; all make normal versions ---------- */
  const ex = {key: "", i: 0, t: 0, undo: [], redo: [], saveT: 0, cur: null, deck: null, tr: null, forked: false, loop: false, more: false};
  const exSig = () => [draft.id, editsOf(draft.id).map((e) => e.v).join(","), draft.edit, draft.status, waiting(draft)].join("|");
  const shotSpan = (s) => ({c: byId.get(s.clip), a: s.in, b: s.out, speed: s.speed || 1, x: s.x ?? .5});
  function shotsFromMoments(p) { return p.items.map((it, i) => { const r = spanOf(it); return r.c ? {clip: it.clip, in: r2(r.a), out: r2(r.b), speed: 1, x: .5, text: "", why: it.note || "", m: String(i + 1)} : null; }).filter(Boolean); }
  function quickShots(p, pace) {
    const T = +p.brief.length || 30, per = {fast: 1.8, medium: 2.8, calm: 4.5}[pace] || 2.8;
    let l = p.items.map((it, i) => ({...spanOf(it), role: it.role || "", i, note: it.note || ""})).filter((x) => x.c && x.b > x.a);
    if (p.brief.order !== "keep") { const rank = (x) => x.role === "hook" ? 0 : x.role === "ending" ? 2 : 1; l = l.map((x, n) => [x, n]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]); }
    const said = (x) => (x.c.txs || []).find(([s, e]) => e > x.a && s < x.b);
    const shots = l.map((x) => {
      const room = x.b - x.a, line = said(x); let a, b;
      if (line) { a = Math.max(x.a, line[0]); b = Math.min(x.b, Math.max(line[1], a + 1)); }
      else { const w = Math.min(room, per); a = x.a + (room - w) / 2; b = a + w; }
      return {x, a, b};
    });
    const sum = () => shots.reduce((n, s) => n + s.b - s.a, 0);
    for (let pass = 0; pass < 12 && sum() < T; pass++) { let grew = false; for (const s of shots) { if (sum() >= T) break; const add = Math.min(.8, s.x.b - s.b), back = Math.min(.8 - add, s.a - s.x.a); if (add + back > .01) { s.b += add; s.a -= back; grew = true; } } if (!grew) break; }
    while (sum() > T * 1.08 && shots.length > 2) { let at = -1, low = 1e9; for (let i = 1; i < shots.length - 1; i++) { const n = shots[i].b - shots[i].a; if (shots[i].x.role !== "hook" && n < low) { low = n; at = i; } } if (at < 0) break; shots.splice(at, 1); }
    const over = sum() - T, last = shots.at(-1); if (over > 0 && last && last.b - last.a - over >= 1) last.b -= over;
    const cap = p.brief.captions;
    return shots.map((s, i) => ({clip: s.x.c.id, in: r2(s.a), out: r2(s.b), speed: 1, x: .5,
      text: cap === "none" ? "" : i === 0 && (p.hook || "").trim() ? p.hook.trim().slice(0, 90) : cap === "speech" ? String(said({...s.x, a: s.a, b: s.b})?.[2] || "").slice(0, 90) : "",
      why: s.x.note, m: String(s.x.i + 1)}));
  }
  async function newVersion(shots, request) {
    if (!shots.length) return toast("Add moments first", true);
    if (!(draft.title || "").trim()) { draft.title = autoName(draft) || "New post"; const t = q("#p-title"); if (t) t.value = draft.title; }
    await persist();
    if (!draft.id) return toast("Could not save the post yet", true);
    const vs = editsOf(draft.id), v = (vs.at(-1)?.v || 0) + 1, aspect = draft.brief.aspect || "9:16", [w, h] = ASPECT[aspect] || ASPECT["9:16"];
    const edl = {title: draft.title.slice(0, 60), summary: "", shots, audio: "", questions: [], aspect, format: {w, h, fps: 30}};
    edl.length = r2(edlLen(edl));
    await saveEdit({post: draft.id, v, by: "adam", mode: "manual", request, tier: "manual", created: Date.now(), edl});
    studio.ver = v;
    if (["idea", "clips", "", undefined].includes(draft.status)) { draft.status = "edit"; queueSave(); }
    drawEdit(); drawChrome();
    toast(`v${v} is ready to fine-tune`);
  }
  function mine() {
    const c = ex.cur, locked = draft.edit === c.v && EDITED.has(draft.status);
    if (c.by === "adam" && !locked) return c;
    const vs = editsOf(draft.id), v = vs.at(-1).v + 1, n = {...JSON.parse(JSON.stringify(c)), v, by: "adam", mode: "manual", request: `Hand edit of v${c.v}`, created: Date.now()};
    delete n.approved; delete n.renderUrl;
    store.edits.set(`${n.post}-v${v}`, n); studio.ver = v; ex.cur = n; ex.key = `${draft.id}:${v}`; ex.forked = true;
    toast(`Saved your changes as v${v}. v${c.v} is untouched`);
    return n;
  }
  const flushEdit = () => { if (ex.saveT && ex.cur) { clearTimeout(ex.saveT); ex.saveT = 0; saveEdit(ex.cur); } };
  function exSaved() { const c = ex.cur; c.edl.length = r2(edlLen(c.edl)); clearTimeout(ex.saveT); ex.saveT = setTimeout(() => { ex.saveT = 0; saveEdit(c); }, 450); }
  function settle() { if (ex.forked && !document.activeElement?.matches("#ex-fields input")) { ex.forked = false; flushEdit(); drawEdit(); drawChrome(); return true; } return false; }
  function mutate(fn) {
    const c = mine(); ex.undo.push(JSON.stringify(c.edl.shots)); if (ex.undo.length > 60) ex.undo.shift(); ex.redo = [];
    fn(c.edl.shots); ex.i = clamp(ex.i, 0, Math.max(0, c.edl.shots.length - 1)); exSaved();
    if (!settle()) { drawExTrack(); drawShot(); paintPhone(); drawExStats(); }
  }
  function exHistory(from, to, word) {
    const s = from.pop(); if (!s) return toast(`Nothing to ${word}`);
    to.push(JSON.stringify(ex.cur.edl.shots)); ex.cur.edl.shots = JSON.parse(s); ex.i = clamp(ex.i, 0, Math.max(0, ex.cur.edl.shots.length - 1)); exSaved();
    ex.deck?.stop(); drawExTrack(); drawShot(); paintPhone(); drawExStats();
  }
  const exShot = () => ex.cur?.edl.shots[ex.i];
  function paintPhone() {
    const s = exShot(), ph = $("ex-phone"); if (!ph) return;
    const c = s && byId.get(s.clip), t = s ? clamp(ex.t, s.in, s.out) : 0;
    ph.style.setProperty("--x", s?.x ?? .5);
    if (s) $("ex-ci").setAttribute("style", thumbStyle(c, nearestFrame(c, t)));
    framing("ex-vid", s?.x);
    $("ex-text").textContent = s?.text || "";
    const list = ex.cur.edl.shots; let before = 0; for (let i = 0; i < ex.i; i++) before += shotLen(list[i]);
    $("ex-time").textContent = `${fmtT(r2(before + (s ? (t - s.in) / (s.speed || 1) : 0)))} / ${fmtT(r2(edlLen(ex.cur.edl)))}`;
    ex.tr?.paint(); paintScrub();
  }
  function exPick(i, keepPlaying) {
    ex.i = i; const s = exShot(); if (!s) return;
    if (!keepPlaying) { ex.deck?.stop(); ex.t = s.in; ex.deck?.seek(byId.get(s.clip), s.in); ex.deck?.warm(ex.cur.edl.shots.map(shotSpan), i); }
    drawShot(); paintPhone();
    document.querySelectorAll("#ex-track .sx-shot").forEach((n) => n.classList.toggle("on", +n.dataset.i === i));
    q("#ex-track .sx-shot.on")?.scrollIntoView({block: "nearest", inline: "nearest"});
  }
  function exPlay() {
    if (ex.deck.playing) return ex.deck.stop();
    if (ex.loop) { const s = exShot(); if (s && ex.deck.range(byId.get(s.clip), s.in, s.out, clamp(ex.t, s.in, s.out - .05))) return; }
    const l = ex.cur.edl.shots.map(shotSpan);
    if (!ex.deck.playList(l, (i) => { ex.t = l[i].a; exPick(i, true); }, () => { exPick(0); }, ex.i)) toast("Nothing playable yet", true);
  }
  function exSplit() { const s = exShot(); if (!s) return; const t = r2(ex.t); if (t < s.in + .3 || t > s.out - .3) return toast("Move the white line inside the shot first", true); const i = ex.i; mutate((l) => { const o = l[i]; const b = o.out; o.out = t; l.splice(i + 1, 0, {...o, in: t, out: b, text: ""}); ex.i = i + 1; }); }
  function exDup() { const i = ex.i; if (exShot()) mutate((l) => { l.splice(i + 1, 0, {...l[i]}); ex.i = i + 1; }); }
  function exRemove(at) { const i = Number.isInteger(at) ? at : ex.i; if (ex.cur.edl.shots.length <= 1) return toast("A version needs at least one shot", true); ex.deck?.stop(); mutate((l) => { l.splice(i, 1); }); const s = exShot(); if (s) { ex.t = s.in; ex.deck?.seek(byId.get(s.clip), s.in); paintPhone(); } }
  // Whole-edit navigation: one scrub bar across every shot, fullscreen, and edit-time seeking.
  const edTotal = () => Math.max(.01, edlLen(ex.cur.edl));
  function edNow() { const l = ex.cur.edl.shots; let b = 0; for (let i = 0; i < ex.i; i++) b += shotLen(l[i]); const s = l[ex.i]; return b + (s ? (clamp(ex.t, s.in, s.out) - s.in) / (s.speed || 1) : 0); }
  function drawScrub() {
    const box = $("ex-segs"); if (!box || !ex.cur) return;
    box.innerHTML = ex.cur.edl.shots.map((s, i) => `<b data-i="${i}" style="flex:${shotLen(s).toFixed(3)} 1 0" title="Shot ${i + 1} · ${shotLen(s).toFixed(1)} s"><i></i></b>`).join("");
    paintScrub();
  }
  function paintScrub() {
    const box = $("ex-segs"), head = $("ex-head"); if (!box || !head || !ex.cur) return;
    const T = edTotal(), now = edNow(), s = exShot();
    head.style.left = `${clamp(now / T, 0, 1) * 100}%`;
    const frac = s ? clamp((ex.t - s.in) / Math.max(.01, s.out - s.in), 0, 1) : 0;
    [...box.children].forEach((b, i) => { b.firstChild.style.width = i < ex.i ? "100%" : i === ex.i ? `${frac * 100}%` : "0"; b.classList.toggle("on", i === ex.i); });
    $("ex-scrub").setAttribute("aria-valuetext", `${fmtT(r2(now))} of ${fmtT(r2(T))}`);
  }
  function exSeekEdit(T) {
    const l = ex.cur.edl.shots; if (!l.length) return;
    T = clamp(T, 0, edTotal()); let acc = 0, i = 0;
    for (; i < l.length - 1; i++) { const d = shotLen(l[i]); if (T < acc + d) break; acc += d; }
    const s = l[i], t = clamp(r2(s.in + (T - acc) * (s.speed || 1)), s.in, s.out);
    ex.deck.stop(); if (ex.i !== i) exPick(i, true);
    ex.t = t; ex.deck.seek(byId.get(s.clip), t); paintPhone();
  }
  function bindScrub() {
    const el = $("ex-scrub"); let drag = false, was = false;
    const at = (e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * edTotal(); };
    el.onpointerdown = (e) => { drag = true; was = ex.deck.playing; el.setPointerCapture(e.pointerId); exSeekEdit(at(e)); };
    el.onpointermove = (e) => { if (drag) exSeekEdit(at(e)); };
    const up = () => {
      if (!drag) return; drag = false;
      if (was) { const i = ex.i, t = ex.t, l = ex.cur.edl.shots.map(shotSpan); ex.deck.playList(l, (k) => { ex.t = l[k].a; exPick(k, true); }, () => exPick(0), i); const v = ex.deck.el; if (v.readyState >= 1) v.currentTime = t; }
    };
    el.onpointerup = up; el.onpointercancel = up;
    el.onkeydown = (e) => { const d = e.shiftKey ? 5 : 1; if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); exSeekEdit(edNow() - d); } else if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); exSeekEdit(edNow() + d); } };
  }
  function exFull() {
    const st = $("ex-stage"); if (!st) return;
    const el = document.fullscreenElement || document.webkitFullscreenElement;
    if (el) return (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    const go = st.requestFullscreen || st.webkitRequestFullscreen;
    if (!go) return toast("Fullscreen isn't available in this browser", true);
    Promise.resolve(go.call(st)).catch(() => toast("Fullscreen was blocked. Try the button again", true));
  }
  const exSkip = (d) => { const was = ex.deck.playing; exSeekEdit(edNow() + d); if (was) exPlay(); };
  function exSetEdge(k) {
    const s = exShot(); if (!s) return; const t = r2(ex.t), i = ex.i;
    if (k === "in" ? t >= s.out - .3 : t <= s.in + .3) return toast("Move the white line inside the shot first", true);
    mutate((l) => { l[i][k] = t; }); ex.tr.fit();
  }
  function exNudge(k, d) {
    const s = exShot(); if (!s) return; const dur = byId.get(s.clip)?.dur || 1e9, i = ex.i;
    const v = r2(clamp(s[k] + d, k === "in" ? 0 : s.in + .3, k === "in" ? s.out - .3 : dur)); if (v === s[k]) return;
    mutate((l) => { l[i][k] = v; }); ex.tr.fit();
  }
  function exFit() {
    const T = +draft.brief.length || 0, L = edlLen(ex.cur.edl); if (!T) return toast("Set a length in the Brief first", true);
    if (Math.abs(L - T) < .2) return toast("Already on target");
    const r = T / L; mutate((l) => { l.forEach((s) => { const d = byId.get(s.clip)?.dur || s.out; s.out = clamp(r2(s.in + (s.out - s.in) * r), r2(s.in + .3), d); }); });
    toast(`Now ${len(edlLen(ex.cur.edl))} for a ${T} s target`);
  }
  function exAll(k) { const v = exShot()?.[k]; if (v == null) return; mutate((l) => { l.forEach((s) => { s[k] = v; }); }); toast(`${k === "speed" ? "Speed" : "Framing"} applied to every shot`); }
  function exLoop() { ex.loop = !ex.loop; const b = $("ex-loop"); if (b) b.setAttribute("aria-pressed", String(ex.loop)); if (ex.deck.playing) { ex.deck.stop(); exPlay(); } toast(ex.loop ? "Looping this shot" : "Loop off"); }
  function drawExTrack() {
    const tr = $("ex-track"); if (!tr) return;
    drawTrack(tr, ex.cur.edl.shots.map((s) => { const c = byId.get(s.clip); return {c, len: shotLen(s), frame: nearestFrame(c, (s.in + s.out) / 2), badge: s.speed > 1 ? `${s.speed}×` : s.text ? "T" : ""}; }), {
      target: +draft.brief.length || 0, pick: (i) => exPick(i), remove: (i) => exRemove(i),
      move: (a, b) => mutate((l) => { const [m] = l.splice(a, 1); l.splice(b, 0, m); ex.i = b; }),
    });
    tr.querySelectorAll(".sx-shot").forEach((n) => n.classList.toggle("on", +n.dataset.i === ex.i));
    drawScrub();
  }
  function drawExStats() {
    const n = $("ex-stats"); if (!n) return; const L = edlLen(ex.cur.edl), T = +draft.brief.length || 0, off = T && Math.abs(L - T) > Math.max(1, T * .05);
    n.innerHTML = `<b>${ex.cur.edl.shots.length} shots · ${len(L)}</b><span class="muted">${T ? (Math.abs(L - T) <= Math.max(1, T * .05) ? `On target (${T} s)` : L > T ? `${len(L - T)} over ${T} s` : `${len(T - L)} under ${T} s`) : ""}</span>${T ? `<div class="sx-meter ${L > T * 1.1 ? "over" : ""}"><i style="width:${Math.min(100, (L / T) * 100)}%"></i></div>` : `<span style="flex:1"></span>`}${off ? `<button class="sx-btn tiny" id="ex-fit" title="Trim or extend every shot a little so the cut lands on ${T} s">Fit to ${T} s</button>` : ""}<button class="sx-btn tiny" id="ex-undo" ${ex.undo.length ? "" : "disabled"} title="Undo (⌘Z)">Undo</button><button class="sx-btn tiny" id="ex-redo" ${ex.redo.length ? "" : "disabled"} title="Redo (⇧⌘Z)">Redo</button>`;
    if ($("ex-fit")) $("ex-fit").onclick = exFit;
    $("ex-undo").onclick = () => exHistory(ex.undo, ex.redo, "undo"); $("ex-redo").onclick = () => exHistory(ex.redo, ex.undo, "redo");
  }
  function drawShot() {
    const box = $("ex-fields"), s = exShot(); if (!box) return;
    if (!s) { box.innerHTML = `<p class="sx-empty">No shots.</p>`; return; }
    const c = byId.get(s.clip); ex.tr.load(c);
    const words = (c?.txs || []).filter(([a, b]) => b > s.in && a < s.out).map((x) => x[2]).join(" ").slice(0, 160);
    box.innerHTML = `
      <div class="sx-info"><b>Shot ${ex.i + 1} · ${esc(clipName(c))}</b><span>${esc([dayName(c), len(c?.dur || 0) + " clip"].join(" · "))}</span></div>
      ${s.why ? `<p class="sx-say">${esc(s.why)}</p>` : ""}${words ? `<p class="sx-say">“${esc(words)}”</p>` : ""}
      <div class="sx-acts"><input class="t" id="ex-in" value="${fmtT(s.in)}" aria-label="Start">–<input class="t" id="ex-out" value="${fmtT(s.out)}" aria-label="End"><b style="font-size:13px">${shotLen(s).toFixed(1)} s</b></div>
      <div class="sx-ctl">Speed<div class="sx-seg" id="ex-speed">${[1, 1.25, 1.5, 2].map((v) => `<button data-v="${v}" aria-pressed="${+s.speed === v}">${v}×</button>`).join("")}</div></div>
      <div class="sx-ctl">Framing<div class="sx-acts"><input type="range" id="ex-x" min="0" max="1" step="0.01" value="${s.x ?? .5}" style="flex:1;min-width:120px" aria-label="Framing"><span class="sx-seg" id="ex-xp">${[["Left", 0], ["Centre", .5], ["Right", 1]].map(([n, v]) => `<button data-v="${v}" aria-pressed="${+s.x === v}">${n}</button>`).join("")}</span></div></div>
      <label class="sx-ctl">Text on screen<input id="ex-txt" maxlength="90" value="${esc(s.text || "")}" placeholder="None"></label>
      <div class="sx-acts"><button class="sx-btn tiny" id="ex-l" ${ex.i ? "" : "disabled"}>← Earlier</button><button class="sx-btn tiny" id="ex-r" ${ex.i < ex.cur.edl.shots.length - 1 ? "" : "disabled"}>Later →</button><button class="sx-btn tiny" id="ex-split">Split</button><button class="sx-btn tiny" id="ex-dup">Duplicate</button><button class="sx-btn tiny bad" id="ex-rm">Remove</button></div>
      <details class="ex-more" id="ex-more" ${ex.more ? "open" : ""}><summary>More tools</summary><div class="ex-moreb">
        <div class="sx-ctl">Edges<div class="sx-acts"><span class="ex-nudge">Start <button class="sx-btn tiny" data-n="in:-0.1" aria-label="Start 0.1 s earlier">−0.1</button><button class="sx-btn tiny" data-n="in:0.1" aria-label="Start 0.1 s later">+0.1</button></span><span class="ex-nudge">End <button class="sx-btn tiny" data-n="out:-0.1" aria-label="End 0.1 s earlier">−0.1</button><button class="sx-btn tiny" data-n="out:0.1" aria-label="End 0.1 s later">+0.1</button></span></div><div class="sx-acts"><button class="sx-btn tiny" id="ex-seti" title="I">Start at playhead</button><button class="sx-btn tiny" id="ex-seto" title="O">End at playhead</button></div></div>
        <div class="sx-ctl">Fine speed<div class="sx-acts"><input type="range" id="ex-sp" min="0.25" max="3" step="0.05" value="${s.speed || 1}" style="flex:1;min-width:120px" aria-label="Fine speed"><b id="ex-spv" style="font-size:13px;min-width:44px">${(+s.speed || 1).toFixed(2)}×</b></div></div>
        <div class="sx-ctl">Copy this shot's look to every shot<div class="sx-acts"><button class="sx-btn tiny" id="ex-allsp">Speed</button><button class="sx-btn tiny" id="ex-allx">Framing</button></div></div>
      </div></details>
      <div class="sx-keys"><kbd>Space</kbd> play · <kbd>←</kbd> <kbd>→</kbd> shot · <kbd>,</kbd> <kbd>.</kbd> step · <kbd>S</kbd> split · <kbd>D</kbd> duplicate · <kbd>⌫</kbd> remove · <kbd>⌘Z</kbd> undo</div>`;
    const time = (id, k) => { $(id).onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.target.blur(); } }; $(id).onchange = (e) => {
      const t = parseT(e.target.value); if (t == null || t < 0 || t > (c?.dur || 1e9)) { toast("Use seconds (12.5) or minutes:seconds (1:05), inside the clip", true); e.target.value = fmtT(s[k]); return; }
      const i = ex.i; mutate((l) => { l[i][k] = r2(t); if (l[i].out <= l[i].in + .3) { if (k === "in") l[i].out = Math.min(c?.dur || t + 1, r2(t + 1)); else l[i].in = Math.max(0, r2(t - 1)); } }); ex.tr.fit();
    }; };
    time("ex-in", "in"); time("ex-out", "out");
    const setF = (k, v) => { const i = ex.i; mutate((l) => { l[i][k] = v; }); };
    $("ex-speed").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) setF("speed", +b.dataset.v); };
    $("ex-xp").onclick = (e) => { const b = e.target.closest("[data-v]"); if (b) setF("x", +b.dataset.v); };
    $("ex-x").oninput = (e) => { const cur = exShot(); cur.x = +e.target.value; paintPhone(); };
    $("ex-x").onpointerdown = () => { const before = exShot().x; $("ex-x").onchange = (e) => { const v = +e.target.value, i = ex.i; exShot().x = before; setF("x", v); void i; }; };
    let typing = false;
    $("ex-txt").oninput = (e) => { const v = e.target.value; if (!typing) { typing = true; const c0 = mine(); ex.undo.push(JSON.stringify(c0.edl.shots)); ex.redo = []; } exShot().text = v; exSaved(); $("ex-text").textContent = v; };
    $("ex-txt").onblur = () => { typing = false; drawExTrack(); drawExStats(); settle(); };
    $("ex-txt").onkeydown = (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.target.blur(); } };
    $("ex-l").onclick = () => { const i = ex.i; mutate((l) => { [l[i - 1], l[i]] = [l[i], l[i - 1]]; ex.i = i - 1; }); };
    $("ex-r").onclick = () => { const i = ex.i; mutate((l) => { [l[i + 1], l[i]] = [l[i], l[i + 1]]; ex.i = i + 1; }); };
    $("ex-more").ontoggle = (e) => { ex.more = e.target.open; };
    $("ex-more").onclick = (e) => { const b = e.target.closest("[data-n]"); if (b) { const [k, d] = b.dataset.n.split(":"); exNudge(k, +d); } };
    $("ex-seti").onclick = () => exSetEdge("in"); $("ex-seto").onclick = () => exSetEdge("out");
    $("ex-sp").oninput = (e) => { $("ex-spv").textContent = `${(+e.target.value).toFixed(2)}×`; };
    $("ex-sp").onchange = (e) => setF("speed", +e.target.value);
    $("ex-allsp").onclick = () => exAll("speed"); $("ex-allx").onclick = () => exAll("x");
    $("ex-split").onclick = exSplit; $("ex-dup").onclick = exDup; $("ex-rm").onclick = () => exRemove();
  }
  function drawEditor(cur) {
    killDecks();
    const box = $("st-edit"), key = `${draft.id}:${cur.v}`;
    if (ex.key !== key) { ex.key = key; ex.i = 0; ex.undo = []; ex.redo = []; ex.t = cur.edl.shots[0]?.in || 0; }
    ex.cur = cur; ex.sig = exSig(); ex.forked = false; ex.i = clamp(ex.i, 0, Math.max(0, cur.edl.shots.length - 1));
    const appr = q(".ed-approve", box), chat = q(".ed-chat", box), vers = editsOf(draft.id), [w, h] = ASPECT[cur.edl.aspect || "9:16"] || ASPECT["9:16"];
    const by = {adam: "by hand", claude: "by Claude", "claude+adam": "Claude + you"}[cur.by] || cur.by;
    const unused = draft.items.map((it, i) => ({it, i})).filter(({it}) => !cur.edl.shots.some((s) => s.clip === it.clip && (it.a == null || Math.min(s.out, it.b ?? 1e9) - Math.max(s.in, it.a) > 0)));
    box.className = "ex";
    box.innerHTML = `<div class="ex-main">
        <div class="ex-col">
          <div class="ex-stage" id="ex-stage"><div class="ex-phone" id="ex-phone" style="aspect-ratio:${w} / ${h};width:min(100%, calc((100dvh - 380px) * ${(w / h).toFixed(4)}));--r:${cropR(cur.edl)};--x:.5"><div class="ci" id="ex-ci"></div><video id="ex-vid" playsinline></video><div class="ex-text" id="ex-text"></div></div>
          <div class="ex-scrub" id="ex-scrub" role="slider" aria-label="Position in the edit. Drag to scrub" tabindex="0"><div class="ex-segs" id="ex-segs"></div><i class="ex-head" id="ex-head"></i></div>
          <div class="sx-acts" style="justify-content:center;flex-wrap:wrap"><button class="sx-btn tiny" id="ex-prev" aria-label="Previous shot">⏮</button><button class="sx-btn main" id="ex-play">▶ Play</button><button class="sx-btn tiny" id="ex-next" aria-label="Next shot">⏭</button><button class="sx-btn tiny" id="ex-snd">Sound on</button><button class="sx-btn tiny" id="ex-loop" aria-pressed="false" title="Loop this shot (R)">↻ Loop</button><button class="sx-btn tiny" id="ex-fs" title="Fullscreen (F)">⛶ Fullscreen</button></div>
          <div class="muted small" id="ex-time" style="text-align:center;font-variant-numeric:tabular-nums"></div></div>
        </div>
        <div class="ex-col"><div id="ex-trim"></div><div id="ex-fields" style="display:grid;gap:10px"></div></div>
        <div class="ex-col ex-side" id="ex-side">
          <div class="ex-hd"><h3>Versions</h3><span class="muted small">v${cur.v} · ${esc(by)}</span></div>
          <div class="ex-vers" id="ex-vers">${vers.map((e) => `<button data-v="${e.v}" aria-pressed="${e.v === cur.v}">v${e.v}${draft.edit === e.v && EDITED.has(draft.status) ? " ✓" : ""}</button>`).join("")}</div>
          ${cur.edl.summary ? `<p class="sx-say">${esc(cur.edl.summary)}</p>` : ""}
          ${(cur.edl.questions || []).length ? `<div class="sx-card2"><b style="font-size:13px">Claude asks</b>${cur.edl.questions.map((x) => `<p class="sx-say">${esc(x)}</p>`).join("")}</div>` : ""}
          <div class="sx-card2"><h3>Auto re-cut</h3><p class="sx-say">Instant and free. Rebuilds from your moments as a new version.</p><div class="sx-seg" id="ex-auto"><button data-p="calm">Calm</button><button data-p="medium">Medium</button><button data-p="fast">Fast</button></div></div>
          <div id="ex-chat"></div><div id="ex-appr"></div>
          ${unused.length ? `<div class="sx-card2"><h3>Moments not in this cut</h3><div class="sx-acts" id="ex-unused">${unused.slice(0, 12).map(({it, i}) => `<button class="sx-btn tiny" data-u="${i}" title="Add after this shot">+ ${i + 1} · ${esc(clipName(byId.get(it.clip))).slice(0, 18)}</button>`).join("")}</div></div>` : ""}
        </div>
      </div>
      <div class="ex-tl"><div class="sx-tlhead" id="ex-stats"></div><div class="sx-track" id="ex-track"></div></div>`;
    if (chat) { const h3 = document.createElement("b"); h3.textContent = "Ask Claude to change it"; h3.style.fontSize = "14px"; chat.prepend(h3); const lbl = q("label > span", chat); if (lbl) lbl.hidden = true; $("ex-chat").replaceWith(chat); }
    if (appr) { appr.addEventListener("click", flushEdit, true); $("ex-appr").replaceWith(appr); }
    if (waiting(draft)) { const m = q("#ed-msg", box); if (m) m.textContent = ""; q("#ex-side").prepend(waitBox(draft, false)); }
    const vid = $("ex-vid"); vid.muted = ui.exMuted === true;
    $("ex-snd").textContent = vid.muted ? "Sound off" : "Sound on";
    $("ex-snd").onclick = (e) => { vid.muted = !vid.muted; ui.exMuted = vid.muted; e.target.textContent = vid.muted ? "Sound off" : "Sound on"; };
    ex.deck = newDeck(vid, (t) => { ex.t = t; paintPhone(); });
    const lab = () => { if ($("ex-play")) $("ex-play").textContent = ex.deck.playing ? "❚❚ Pause" : "▶ Play"; };
    vid.addEventListener("play", lab); vid.addEventListener("pause", lab);
    ex.tr = makeTrimmer($("ex-trim"), {
      range: () => { const s = exShot(); return s ? {a: s.in, b: s.out} : null; }, time: () => ex.t, follow: () => ex.deck.playing,
      begin: () => { const c = mine(); ex.undo.push(JSON.stringify(c.edl.shots)); ex.redo = []; },
      seek: (t, quiet) => { const s = exShot(); if (!s) return; ex.t = t; if (ex.deck.playing && !quiet) ex.deck.stop(); ex.deck.seek(byId.get(s.clip), t); paintPhone(); },
      set: (a, b, final) => { const s = exShot(), d = byId.get(s.clip)?.dur || b; s.in = clamp(r2(a), 0, d - .3); s.out = clamp(r2(b), s.in + .3, d); paintPhone(); if (final) { exSaved(); if (!settle()) { drawExTrack(); drawShot(); drawExStats(); } } },
    });
    $("ex-play").onclick = exPlay; $("ex-phone").onclick = exPlay; $("ex-phone").ondblclick = exFull;
    $("ex-fs").onclick = exFull; $("ex-loop").onclick = exLoop; $("ex-loop").setAttribute("aria-pressed", String(ex.loop)); bindScrub();
    $("ex-prev").onclick = () => exPick(Math.max(0, ex.i - 1)); $("ex-next").onclick = () => exPick(Math.min(cur.edl.shots.length - 1, ex.i + 1));
    $("ex-vers").onclick = (e) => { const b = e.target.closest("[data-v]"); if (!b) return; flushEdit(); studio.ver = +b.dataset.v; drawEdit(); drawChrome(); };
    $("ex-auto").onclick = (e) => { const b = e.target.closest("[data-p]"); if (b) { flushEdit(); newVersion(quickShots(draft, b.dataset.p), `Auto re-cut (${b.dataset.p})`); } };
    if ($("ex-unused")) $("ex-unused").onclick = (e) => { const b = e.target.closest("[data-u]"); if (!b) return; const [s] = shotsFromMoments({items: [draft.items[+b.dataset.u]]}), i = ex.i; mutate((l) => { l.splice(i + 1, 0, {...s, m: String(+b.dataset.u + 1)}); ex.i = i + 1; }); };
    drawExTrack(); drawShot(); drawExStats();
    const s = exShot(); if (s) { ex.t = clamp(ex.t, s.in, s.out); ex.deck.seek(byId.get(s.clip), ex.t); ex.deck.warm(ex.cur.edl.shots.map(shotSpan), ex.i); }
    paintPhone();
  }
  $("pdlg").addEventListener("close", flushEdit);
  $("pdlg").addEventListener("keydown", (e) => {
    if (!draft || ui.view !== "edit" || !$("ex-phone") || e.target.matches("input,textarea,select")) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); return e.shiftKey ? exHistory(ex.redo, ex.undo, "redo") : exHistory(ex.undo, ex.redo, "undo"); }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const s = exShot(), d = e.shiftKey ? 1 : .1;
    if (k === " ") { e.preventDefault(); exPlay(); }
    else if (k === "arrowleft") { e.preventDefault(); exPick(Math.max(0, ex.i - 1)); }
    else if (k === "arrowright") { e.preventDefault(); exPick(Math.min(ex.cur.edl.shots.length - 1, ex.i + 1)); }
    else if ((k === "," || k === "<" || k === "." || k === ">") && s) { e.preventDefault(); ex.deck.stop(); ex.t = clamp(ex.t + (k === "," || k === "<" ? -d : d), 0, byId.get(s.clip)?.dur || ex.t); ex.deck.seek(byId.get(s.clip), ex.t); paintPhone(); }
    else if (k === "f") { e.preventDefault(); exFull(); }
    else if (k === "k") { e.preventDefault(); exPlay(); }
    else if (k === "j") { e.preventDefault(); exSkip(e.shiftKey ? -5 : -1); }
    else if (k === "l") { e.preventDefault(); exSkip(e.shiftKey ? 5 : 1); }
    else if (k === "home") { e.preventDefault(); exPick(0); }
    else if (k === "end") { e.preventDefault(); exPick(ex.cur.edl.shots.length - 1); }
    else if (k === "i") { e.preventDefault(); exSetEdge("in"); }
    else if (k === "o") { e.preventDefault(); exSetEdge("out"); }
    else if (k === "r") { e.preventDefault(); exLoop(); }
    else if (k === "m") { e.preventDefault(); $("ex-snd")?.click(); }
    else if (k === "s") { e.preventDefault(); exSplit(); }
    else if (k === "d") { e.preventDefault(); exDup(); }
    else if (k === "backspace" || k === "delete") { e.preventDefault(); exRemove(); }
  });
  drawEdit = function () {
    if (!draft) return;
    const box = $("st-edit");
    if (!box) { drawChrome(); return; }
    // Our own autosave comes back through the data sync: don't rebuild the editor (it would stop playback and lose focus).
    const now = curEdit();
    if ($("ex-phone") && ex.cur && now?.v === ex.cur.v && ex.sig === exSig()) { drawChrome(); return; }
    flushEdit();
    box.className = "sx-edit";
    baseEdit();
    const cur = curEdit();
    if (!cur) { ex.cur = null; killDecks(); drawRequest(draft); drawChrome(); return; }
    drawEditor(cur);
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
