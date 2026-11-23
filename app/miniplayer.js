/* Mini player: a clip that is playing keeps playing in a small window, bottom right, when you close the clip window or leave the
   screen it was on. Drag it by its title bar, expand it back into the clip, or close it (×, or Esc while it has focus).
   It watches the inline videos made by inline.js (class gta-inl) and never touches the Library's own code.
   Public file: it must never contain footage data. */
(() => {
  "use strict";
  const POS_KEY = "gta-mini-pos";
  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const put = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const mk = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const css = mk("style", {textContent: `
    #gta-mini { position: fixed; z-index: 2147480000; width: min(340px, calc(100vw - 24px)); display: none; flex-direction: column;
      background: var(--surface, #172028); color: var(--ink, #e4ebf0); border: 1px solid var(--line, #26323c); border-radius: 10px; overflow: hidden; touch-action: none; }
    #gta-mini.on { display: flex; }
    #gta-mini .gm-bar { display: flex; align-items: center; gap: 4px; padding: 4px 4px 4px 10px; cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
    #gta-mini.drag .gm-bar { cursor: grabbing; }
    #gta-mini .gm-title { flex: 1; min-width: 0; font: 600 12px/1.3 var(--body, system-ui, sans-serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #gta-mini .gm-btn { flex: none; width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: inherit; font: 16px/1 system-ui, sans-serif; cursor: pointer; }
    #gta-mini .gm-btn:hover { background: var(--hover, rgba(127, 127, 127, .2)); }
    #gta-mini .gm-btn:focus-visible { outline: 2px solid var(--accent, #4f8cff); outline-offset: -2px; }
    #gta-mini video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
  `});
  document.head.append(css);

  const title = mk("span", {className: "gm-title"});
  const expand = mk("button", {type: "button", className: "gm-btn", textContent: "⤢", title: "Back to the clip", ariaLabel: "Back to the clip"});
  const close = mk("button", {type: "button", className: "gm-btn", textContent: "×", title: "Close mini player", ariaLabel: "Close mini player"});
  const bar = mk("div", {className: "gm-bar"}, title, expand, close);
  const video = mk("video", {controls: true, playsInline: true, preload: "auto"});
  video.setAttribute("aria-label", "Mini player");
  const box = mk("div", {id: "gta-mini", role: "region", ariaLabel: "Mini player", tabIndex: -1}, bar, video);
  document.body.append(box);

  let meta = null;  // {fileId, clipId, name} of what the mini player holds
  let retried = false;

  /* ---------- position ---------- */
  const clamp = () => {
    const r = box.getBoundingClientRect();
    const x = Math.min(Math.max(0, r.left), Math.max(0, innerWidth - r.width));
    const y = Math.min(Math.max(0, r.top), Math.max(0, innerHeight - r.height));
    box.style.left = `${x}px`; box.style.top = `${y}px`; box.style.right = "auto"; box.style.bottom = "auto";
  };
  const place = () => {
    let p = null; try { p = JSON.parse(get(POS_KEY)); } catch (e) {}
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      box.style.left = `${p.x * innerWidth}px`; box.style.top = `${p.y * innerHeight}px`; box.style.right = box.style.bottom = "auto";
      clamp();
    } else { // default: bottom right
      box.style.left = box.style.top = "auto"; box.style.right = "16px"; box.style.bottom = "16px";
    }
  };
  let drag = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.button > 0) return;
    const r = box.getBoundingClientRect();
    drag = {dx: e.clientX - r.left, dy: e.clientY - r.top};
    bar.setPointerCapture(e.pointerId);
    box.classList.add("drag");
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    box.style.left = `${e.clientX - drag.dx}px`; box.style.top = `${e.clientY - drag.dy}px`; box.style.right = box.style.bottom = "auto";
    clamp();
  });
  const drop = () => {
    if (!drag) return;
    drag = null; box.classList.remove("drag");
    const r = box.getBoundingClientRect();
    put(POS_KEY, JSON.stringify({x: r.left / innerWidth, y: r.top / innerHeight}));
  };
  bar.addEventListener("pointerup", drop);
  bar.addEventListener("pointercancel", drop);
  addEventListener("resize", () => { if (box.classList.contains("on")) { if (box.style.left === "auto" || !box.style.left) return; clamp(); } });

  /* ---------- open / close ---------- */
  function closeMini() {
    video.pause();
    video.removeAttribute("src"); video.load();
    box.classList.remove("on");
    meta = null; retried = false;
  }
  function openMini(m, src, at, from) {
    meta = m; retried = false;
    title.textContent = m.name || "Clip";
    title.title = m.name || "";
    expand.hidden = !m.clipId;
    if (from) { video.volume = from.volume; video.muted = from.muted; video.playbackRate = from.playbackRate; }
    const start = () => { if (at > 0 && at < (video.duration || Infinity)) video.currentTime = at; const p = video.play(); p?.catch?.(() => {}); };
    video.addEventListener("loadedmetadata", start, {once: true});
    video.src = src;
    place();
    box.classList.add("on");
  }
  close.onclick = closeMini;
  box.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeMini(); } });
  expand.onclick = () => {
    if (!meta?.clipId || typeof window.openClip !== "function") return;
    const id = meta.clipId, t = video.currentTime || 0;
    closeMini();
    window.openClip(id);
    const root = document.getElementById("dl-player");
    if (root?.__inl?.play) root.__inl.play(t);
  };
  video.addEventListener("error", async () => {
    if (!meta || retried || !meta.fileId) return;
    retried = true; // the sign-in may have been renewed: retry once with a fresh address
    const B = window.__gtaBridge, at = video.currentTime;
    if (!B) return;
    await B.token();
    video.addEventListener("loadedmetadata", () => { video.currentTime = at; video.play()?.catch?.(() => {}); }, {once: true});
    video.src = B.streamUrl(meta.fileId);
  });

  /* ---------- watching the inline videos ---------- */
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      const v = en.target;
      // gone from view while still playing (clip window closed, other screen opened, scrolled away): move it here
      if (!en.isIntersecting && v.isConnected && !v.paused && !v.ended && v.getAttribute("src")) {
        const root = v.closest(".player");
        const fileId = root?.__inl?.fileId || null;
        const at = v.currentTime || 0, src = v.getAttribute("src");
        v.pause();
        openMini({fileId, clipId: clipIdFor(root, fileId), name: nameFor(root, v)}, src, at, v);
      }
    }
  }, {threshold: 0}) : null;
  const watched = new WeakSet();

  function clipIdFor(root, fileId) {
    try {
      const c = root?.closest("#detail, #v-review")?.querySelector("[data-clip]")?.dataset.clip;
      if (c) return c;
      if (fileId && typeof DATA !== "undefined") return DATA.clips.find((x) => x.pv === fileId || x.hd === fileId || x.drive === fileId)?.id || null;
    } catch (e) {}
    return null;
  }
  function nameFor(root) {
    const n = root?.closest("#detail, #v-review")?.querySelector(".detail-head .name, .name");
    const t = (n?.textContent || "").trim();
    return t || "Clip";
  }

  // media events don't bubble: listen in the capture phase
  document.addEventListener("play", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement)) return;
    if (v === video) return;
    if (v.classList.contains("gta-inl")) {
      // a clip is playing in place: it takes over from the mini player so only one thing makes sound
      if (box.classList.contains("on")) closeMini();
      if (io && !watched.has(v)) { watched.add(v); io.observe(v); }
    }
  }, true);
})();
