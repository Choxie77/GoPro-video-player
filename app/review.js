/* GoPro Travels app: frame-accurate review of a rendered cut. Notes are pinned to an exact frame and saved with the
   rest of the app's work in Drive. "Needs changes" queues the open notes for Claude Code through the same
   requests the Post Studio already uses. Public file: it must never contain footage data. */
(() => {
  "use strict";
  const B = window.__gtaBridge;
  if (!B) return;
  const FPS = 30, MAX_NOTE = 2000;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.flat().filter((k) => k != null)); return n; };
  const tc = (f) => { const s = Math.floor(f / FPS); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}:${String(f % FPS).padStart(2, "0")}`; };
  const safeId = (s) => /^[A-Za-z0-9_-]+$/.test(s || "");
  const day = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], {day: "numeric", month: "short"}); };

  const css = el("style", {textContent: `
    #gta-review { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: #161616; color: #eceff1; font: 14px/1.45 Inter, system-ui, sans-serif; }
    #gta-review::backdrop { background: #111; }
    #gta-review[open] { display: grid; grid-template-columns: minmax(0, 1fr) 360px; }
    #gta-review button, #gta-review select, #gta-review textarea { font: inherit; color: inherit; }
    #gta-review button { background: #262626; border: 1px solid #3a3a3a; border-radius: 8px; padding: 7px 12px; font-weight: 700; cursor: pointer; }
    #gta-review button:disabled { color: #777; cursor: not-allowed; }
    #gta-review button.gtar-main { background: #e9ecef; color: #17191c; border-color: #e9ecef; }
    #gta-review button.gtar-main:disabled { background: #262626; color: #777; border-color: #3a3a3a; }
    #gta-review button.gtar-link { background: none; border: 0; padding: 2px 0; font-weight: 400; color: #b6bdc2; text-decoration: underline; }
    #gta-review select, #gta-review textarea { background: #262626; border: 1px solid #3a3a3a; border-radius: 8px; padding: 7px 9px; }
    #gta-review :focus-visible { outline: 2px solid #4f8cff; outline-offset: 2px; }
    .gtar-stage { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px; }
    .gtar-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .gtar-title { font-weight: 800; font-size: 16px; margin-right: 4px; }
    .gtar-grow { flex: 1; }
    .gtar-players { flex: 1; min-height: 0; display: flex; justify-content: center; gap: 12px; }
    .gtar-pane { height: 100%; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .gtar-pane label { font-size: 12px; font-weight: 700; color: #b6bdc2; }
    .gtar-pane video { flex: 1; min-height: 0; aspect-ratio: 9 / 16; max-width: 100%; background: #000; border-radius: 8px; display: block; }
    .gtar-line { position: relative; height: 30px; background: #262626; border: 1px solid #3a3a3a; border-radius: 6px; cursor: pointer; touch-action: none; }
    .gtar-fill { position: absolute; left: 0; top: 0; bottom: 0; background: #34415f; border-radius: 5px 0 0 5px; pointer-events: none; }
    .gtar-head { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: #fff; pointer-events: none; }
    #gta-review .gtar-mark { position: absolute; top: 3px; bottom: 3px; width: 6px; margin-left: -3px; padding: 0; background: #4f8cff; border: 0; border-radius: 2px; }
    #gta-review .gtar-mark.done { background: #777; }
    .gtar-tc { min-width: 150px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .gtar-hint { color: #b6bdc2; font-size: 12px; }
    .gtar-side { min-height: 0; border-left: 1px solid #3a3a3a; display: flex; flex-direction: column; background: #1b1b1b; }
    .gtar-block { padding: 12px 14px; border-bottom: 1px solid #3a3a3a; }
    .gtar-block h3 { margin: 0 0 8px; font-size: 13px; }
    .gtar-block textarea { width: 100%; height: 72px; resize: vertical; display: block; margin-bottom: 8px; }
    .gtar-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .gtar-state { margin: 0 0 8px; color: #b6bdc2; }
    .gtar-notes { flex: 1; min-height: 0; overflow: auto; padding: 4px 14px 14px; }
    .gtar-note { padding: 10px 0; border-bottom: 1px solid #3a3a3a; }
    .gtar-note p { margin: 5px 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .gtar-note.done p { color: #8a9096; text-decoration: line-through; }
    .gtar-note .gtar-acts { display: flex; gap: 14px; }
    .gtar-empty, .gtar-msg { color: #b6bdc2; padding: 10px 0; }
    .gtar-msg { padding: 24px; grid-column: 1 / -1; }
    #gta-review-toast { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: calc(100% - 32px); background: #262626; border: 1px solid #4f8cff; border-radius: 8px; padding: 9px 14px; font-weight: 700; display: none; z-index: 3; }
    @media (max-width: 860px) {
      #gta-review[open] { display: block; overflow: auto; }
      .gtar-players { height: 62dvh; flex: none; }
      .gtar-side { border-left: 0; border-top: 1px solid #3a3a3a; }
      .gtar-notes { overflow: visible; }
    }
  `});
  document.head.append(css);

  let current = null; // the open session, so only one review exists at a time

  async function versionsOf(post) {
    const files = await B.find(`name contains '${post}-v' and name contains '-web.mp4'`);
    const re = new RegExp(`^${post.replace(/[-_]/g, "\\$&")}-v(\\d+)-web\\.mp4$`);
    const out = new Map();
    for (const f of files) { const m = f.name.match(re); if (m && !out.has(+m[1])) out.set(+m[1], f.id); }
    return out;
  }

  async function open(post, v) {
    if (current) current.close();
    const dlg = el("dialog", {id: "gta-review", ariaLabel: "Review the render"});
    const closeBtn = el("button", {type: "button", textContent: "Close"});
    document.querySelectorAll("dialog#gta-review").forEach((d) => d.remove());
    document.body.append(dlg);
    let inner = null, gone = false;
    const session = {
      close() { if (dlg.open) dlg.close(); finish(); },
      destroy() { inner?.destroy(); inner = null; },
    };
    function finish() { if (gone) return; gone = true; session.destroy(); dlg.remove(); if (current === session) current = null; }
    closeBtn.onclick = () => session.close();
    dlg.addEventListener("close", finish);
    const say = (text) => dlg.replaceChildren(el("div", {className: "gtar-msg"}, el("p", {textContent: text}), closeBtn));
    current = session;
    dlg.showModal();
    if (!safeId(post) || !Number.isInteger(v)) return say("This post can't be reviewed.");
    say("Finding the cut in Drive…");
    let files;
    try { files = await versionsOf(post); } catch (e) { return say("Couldn't look in Drive. Check your connection and try again."); }
    if (gone) return;
    if (!files.has(v)) return say(`The render of v${v} isn't in Drive yet. Once Colab has rendered it, it shows up here.`);
    inner = build(dlg, closeBtn, post, v, files);
  }

  function build(dlg, closeBtn, post, v, files) {
    const key = `${post}-v${v}`;
    const ref = B.db.collection("reviews").doc(key);
    const reqRef = B.db.collection("requests").doc(post);
    let rev = {post, v, notes: [], decision: null, decidedAt: null};
    let frames = 0, raf = 0, dragging = false, cmp = null, toastTimer = 0;
    const attach = (video, id) => {
      let retried = false;
      const set = () => { video.src = B.streamUrl(id); };
      video.addEventListener("error", async () => { // a sign-in token lasts about an hour: refresh it and carry on
        if (retried) return; retried = true;
        const at = video.currentTime; await B.token(); set(); video.addEventListener("loadedmetadata", () => { video.currentTime = at; }, {once: true});
      });
      set();
    };

    const a = el("video", {preload: "auto", playsInline: true});
    attach(a, files.get(v));
    let b = null;
    const frameNow = () => Math.min(Math.max(frames - 1, 0), Math.max(0, Math.floor(a.currentTime * FPS + 1e-3)));
    const syncB = () => { if (b) b.currentTime = Math.min(a.currentTime, b.duration || a.currentTime); };

    const tcEl = el("span", {className: "gtar-tc"}), fill = el("div", {className: "gtar-fill"}), head = el("div", {className: "gtar-head"}), marks = el("div");
    const line = el("div", {className: "gtar-line", role: "slider", ariaLabel: "Timeline", tabIndex: 0}, fill, marks, head);
    const playBtn = el("button", {type: "button", textContent: "Play"});
    const noteAt = el("h3");
    const paint = (f = frameNow()) => {
      const p = f / Math.max(1, frames - 1) * 100;
      fill.style.width = p + "%"; head.style.left = p + "%";
      tcEl.textContent = `${tc(f)}  ·  frame ${f}`; noteAt.textContent = `Note at ${tc(f)}`;
      line.setAttribute("aria-valuenow", f);
    };
    const seekFrame = (f) => { a.pause(); f = Math.min(Math.max(frames - 1, 0), Math.max(0, f)); a.currentTime = (f + 0.5) / FPS; paint(f); };
    const follow = () => { if (b && Math.abs(b.currentTime - a.currentTime) > 0.07) syncB(); paint(); if (!a.paused) raf = requestAnimationFrame(follow); };
    playBtn.onclick = () => (a.paused ? a.play() : a.pause());
    a.addEventListener("play", () => { playBtn.textContent = "Pause"; b?.play().catch(() => {}); follow(); });
    a.addEventListener("pause", () => { playBtn.textContent = "Play"; cancelAnimationFrame(raf); b?.pause(); syncB(); paint(); });
    a.addEventListener("seeked", () => { syncB(); paint(); });
    a.addEventListener("loadedmetadata", () => { frames = Math.round(a.duration * FPS); line.setAttribute("aria-valuemax", frames - 1); paint(0); drawNotes(); });
    const fromX = (e) => { const r = line.getBoundingClientRect(); return Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (frames - 1)); };
    line.addEventListener("pointerdown", (e) => { if (e.target.closest(".gtar-mark")) return; dragging = true; line.setPointerCapture(e.pointerId); seekFrame(fromX(e)); });
    line.addEventListener("pointermove", (e) => { if (dragging) seekFrame(fromX(e)); });
    line.addEventListener("pointerup", () => { dragging = false; });
    const onKey = (e) => {
      if (/TEXTAREA|SELECT/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " && e.target.tagName !== "BUTTON") { e.preventDefault(); a.paused ? a.play() : a.pause(); }
      else if (e.key === "," || e.key === "ArrowLeft") { e.preventDefault(); seekFrame(frameNow() - (e.shiftKey ? 10 : 1)); }
      else if (e.key === "." || e.key === "ArrowRight") { e.preventDefault(); seekFrame(frameNow() + (e.shiftKey ? 10 : 1)); }
      else if (e.key === "n") { e.preventDefault(); box.focus(); }
    };
    dlg.addEventListener("keydown", onKey);

    const others = [...files.keys()].filter((n) => n !== v).sort((x, y) => y - x);
    const cmpSel = el("select", {ariaLabel: "Compare with", disabled: !others.length},
      el("option", {value: "", textContent: others.length ? "Compare off" : "Only one version"}),
      ...others.map((n) => el("option", {value: n, textContent: `Compare v${n}`})));
    const players = el("div", {className: "gtar-players"});
    const pane = (label, node) => el("div", {className: "gtar-pane"}, el("label", {textContent: label}), node);
    const layout = () => players.replaceChildren(pane(`v${v}`, a), ...(b ? [pane(`v${cmp} (muted)`, b)] : []));
    cmpSel.onchange = () => {
      if (b) { b.pause(); b.removeAttribute("src"); b.load(); b = null; cmp = null; }
      if (cmpSel.value) { cmp = +cmpSel.value; b = el("video", {preload: "auto", playsInline: true, muted: true}); attach(b, files.get(cmp)); b.addEventListener("loadedmetadata", syncB, {once: true}); }
      layout();
    };
    layout();

    const box = el("textarea", {placeholder: "What should change on this frame?", maxLength: MAX_NOTE, ariaLabel: "Note"});
    box.addEventListener("focus", () => a.pause());
    box.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } });
    const addBtn = el("button", {type: "button", className: "gtar-main", textContent: "Add note"});
    const state = el("p", {className: "gtar-state"});
    const approve = el("button", {type: "button"}), revise = el("button", {type: "button"});
    const copy = el("button", {type: "button", className: "gtar-link", textContent: "Copy notes for Claude"});
    const list = el("div", {className: "gtar-notes"});
    const toast = el("div", {id: "gta-review-toast", role: "status"});
    const say = (t) => { toast.textContent = t; toast.style.display = "block"; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.style.display = "none"; }, 3600); };
    const open = () => rev.notes.filter((n) => !n.resolved);
    const notesText = () => [`Review of the rendered cut v${v}. Fix these, then render again:`, ...open().sort((x, y) => x.frame - y.frame).map((n) => `- ${tc(n.frame)} (frame ${n.frame}): ${n.text}`)].join("\n");
    const save = async () => { await ref.set(rev); };

    async function withdrawRequest() { // drop the queued request this review made, if Claude Code hasn't taken it yet
      const r = (await reqRef.get()).data();
      if (r && r.source === "review" && r.status === "waiting") await reqRef.delete();
    }
    async function addNote() {
      const text = box.value.trim();
      if (!text) { box.focus(); return say("Write a note first"); }
      if (!frames) return say("The video is still loading");
      const f = frameNow();
      rev.notes.push({id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), frame: f, t: Math.round(f / FPS * 1e4) / 1e4, text, resolved: false, at: new Date().toISOString()});
      if (rev.decision === "approved") { rev.decision = null; rev.decidedAt = null; }
      box.value = ""; await save();
    }
    async function decide(d) {
      if (d === "approved" && open().length) return say("Resolve the open notes before approving");
      if (d === "revise" && !open().length) return say("Add a note so the revision has something to fix");
      rev.decision = d; rev.decidedAt = d ? new Date().toISOString() : null;
      await save();
      if (d === "revise") { await reqRef.set({post, mode: "revise", note: notesText(), status: "waiting", at: new Date().toISOString(), source: "review", v}); say("Queued. Tell Claude Code: edit the requested posts"); }
      else await withdrawRequest();
    }
    approve.onclick = () => decide(rev.decision === "approved" ? null : "approved");
    revise.onclick = () => decide(rev.decision === "revise" ? null : "revise");
    addBtn.onclick = addNote;
    copy.onclick = async () => { try { await navigator.clipboard.writeText(notesText()); say(`Copied ${open().length} open note${open().length === 1 ? "" : "s"}`); } catch (e) { say("Couldn't copy to the clipboard"); } };

    function drawNotes() {
      const n = open().length;
      state.textContent = rev.decision === "approved" ? `Approved ${day(rev.decidedAt)}` : rev.decision === "revise" ? `Changes requested ${day(rev.decidedAt)}` : `${n} open note${n === 1 ? "" : "s"}, no decision`;
      approve.textContent = rev.decision === "approved" ? "Undo approve" : "Approve"; approve.className = rev.decision === "approved" ? "gtar-main" : ""; approve.disabled = n > 0 && rev.decision !== "approved";
      revise.textContent = rev.decision === "revise" ? "Undo changes" : "Needs changes"; revise.className = rev.decision === "revise" ? "gtar-main" : ""; revise.disabled = !n && rev.decision !== "revise";
      copy.disabled = !n;
      const sorted = [...rev.notes].sort((x, y) => x.frame - y.frame);
      marks.replaceChildren(...sorted.map((x) => el("button", {type: "button", className: "gtar-mark" + (x.resolved ? " done" : ""), title: `${tc(x.frame)} ${x.text}`, ariaLabel: `Go to note at ${tc(x.frame)}`, onclick: () => seekFrame(x.frame)})));
      sorted.forEach((x, i) => { marks.children[i].style.left = x.frame / Math.max(1, frames - 1) * 100 + "%"; });
      list.replaceChildren(...(sorted.length ? sorted.map((x) => el("div", {className: "gtar-note" + (x.resolved ? " done" : "")},
        el("button", {type: "button", textContent: tc(x.frame), onclick: () => seekFrame(x.frame)}),
        el("p", {textContent: x.text}),
        el("div", {className: "gtar-acts"},
          el("button", {type: "button", className: "gtar-link", textContent: x.resolved ? "Reopen" : "Resolve", onclick: async () => { x.resolved = !x.resolved; if (rev.decision === "revise" && !open().length) { rev.decision = null; rev.decidedAt = null; await withdrawRequest(); } await save(); }}),
          el("button", {type: "button", className: "gtar-link", textContent: "Delete", onclick: async () => { if (!confirm("Delete this note?")) return; rev.notes = rev.notes.filter((k) => k.id !== x.id); if (rev.decision === "revise" && !open().length) { rev.decision = null; rev.decidedAt = null; await withdrawRequest(); } await save(); }})
        ))) : [el("div", {className: "gtar-empty", textContent: "No notes on this version yet."})]));
    }
    const unsub = ref.onSnapshot((s) => { if (s.exists) rev = {post, v, notes: [], decision: null, decidedAt: null, ...s.data()}; drawNotes(); });

    dlg.replaceChildren(
      el("section", {className: "gtar-stage"},
        el("div", {className: "gtar-bar"}, el("span", {className: "gtar-title", textContent: `Review v${v}`}), cmpSel, el("span", {className: "gtar-grow"}), closeBtn),
        players, line,
        el("div", {className: "gtar-bar"}, playBtn,
          el("button", {type: "button", ariaLabel: "Back one frame", textContent: "−1 frame", onclick: () => seekFrame(frameNow() - 1)}),
          el("button", {type: "button", ariaLabel: "Forward one frame", textContent: "+1 frame", onclick: () => seekFrame(frameNow() + 1)}),
          tcEl, el("span", {className: "gtar-grow"}), el("span", {className: "gtar-hint", textContent: "Space play, , . step, N note"}))),
      el("aside", {className: "gtar-side"},
        el("div", {className: "gtar-block"}, noteAt, box, addBtn),
        el("div", {className: "gtar-block"}, el("h3", {textContent: "Decision"}), state, el("div", {className: "gtar-two"}, approve, revise), el("div", {style: "margin-top:8px"}, copy)),
        list),
      toast);
    paint(0); drawNotes();
    return {
      close() { dlg.close(); },
      destroy() { cancelAnimationFrame(raf); clearTimeout(toastTimer); unsub(); for (const x of [a, b]) if (x) { x.pause(); x.removeAttribute("src"); x.load(); } },
    };
  }

  document.addEventListener("click", (e) => {
    const t = e.target.closest?.("[data-gta-review]");
    if (t) { e.preventDefault(); open(t.dataset.gtaReview, +t.dataset.v); }
  });
  window.__gtaReview = {
    open,
    button: (post, v) => safeId(post) && Number.isInteger(v) ? `<button class="btn quiet" type="button" data-gta-review="${post}" data-v="${v}">Review the render frame by frame</button>` : "",
  };
})();
