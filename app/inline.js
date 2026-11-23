/* Real video inside the Review screen and the clip window, in place of the still-frame flipbook.
   It wraps the Library's wirePlayer(): the flipbook stays underneath (button "Frames") and every control the Library already
   has keeps working, because the video keeps the player's data-t (current second) up to date: the M key, "keep a moment here",
   and the Space key (play / pause). Plays the Light copy, else HD, else the original, streamed from Drive by sw.js.
   Loaded after the Library's own scripts (build_app.py). Public file: it must never contain footage data. */
(() => {
  "use strict";
  const B = window.__gtaBridge;
  if (!B || typeof wirePlayer !== "function") return;
  const original = wirePlayer;
  const KEY = "gta-inline-mode";
  const prefersVideo = () => { try { return localStorage.getItem(KEY) !== "frames"; } catch (e) { return true; } };
  const remember = (v) => { try { localStorage.setItem(KEY, v ? "video" : "frames"); } catch (e) {} };
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const drive = (c) => c?.pv || c?.hd || c?.drive || null;

  const css = document.createElement("style");
  css.textContent = ".gta-inl { display: block; width: 100%; max-width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; }" +
    ".gta-inl-note { margin: 4px 0 0; font-size: 12px; opacity: .8; }";
  document.head.append(css);

  window.wirePlayer = function (id, frames, autoplay) {
    const root = document.getElementById(id);
    const c = frames?.[0]?.c, fileId = drive(c);
    // one clip only: the map panel mixes clips, so it keeps the flipbook
    const single = !!root && !!fileId && frames.length > 0 && frames.every((f) => f.c === c);
    const wantVideo = single && prefersVideo();
    original.call(this, id, frames, autoplay && !wantVideo);
    if (!single) return;

    const screen = root.querySelector(".screen"), range = root.querySelector("input[type=range]");
    const btn = root.querySelector("[data-play]"), pos = root.querySelector("[data-pos]"), controls = root.querySelector(".controls");
    if (!screen || !range || !btn || !pos || !controls) return;
    const flip = {play: btn.onclick, input: range.oninput, max: range.max, value: range.value, pos: pos.textContent, label: btn.textContent};

    const video = Object.assign(document.createElement("video"), {className: "gta-inl", controls: true, playsInline: true, preload: "metadata"});
    video.setAttribute("aria-label", "Clip video");
    const note = Object.assign(document.createElement("p"), {className: "gta-inl-note muted", hidden: true});
    screen.insertAdjacentElement("beforebegin", video);
    video.insertAdjacentElement("afterend", note);
    const toggle = Object.assign(document.createElement("button"), {type: "button", className: "btn quiet"});
    controls.append(toggle);

    let on = false, retried = false, startAt = 0;
    const duration = () => (isFinite(video.duration) ? video.duration : c.dur || 0);
    const sync = () => {
      const t = video.currentTime || 0;
      root.dataset.t = t.toFixed(2);
      pos.textContent = `${mmss(t)} / ${mmss(duration())}`;
      range.value = Math.round(t * 10);
    };
    const setVideo = (v) => {
      on = v;
      video.style.display = v ? "" : "none";
      screen.style.display = v ? "none" : "";
      note.hidden = true;
      toggle.textContent = v ? "Frames" : "Video";
      toggle.title = v ? "Show the still frames" : "Play the real video";
      if (v) {
        startAt = parseFloat(root.dataset.t) || 0;
        range.max = Math.max(1, Math.round(duration() * 10));
        btn.textContent = video.paused ? "▶ Play" : "❚❚ Pause";
        btn.onclick = () => { if (video.paused) { const p = video.play(); p?.catch?.(() => {}); } else video.pause(); };
        range.oninput = () => { video.currentTime = range.value / 10; };
        if (!video.getAttribute("src")) video.src = B.streamUrl(fileId);
        else sync();
      } else {
        video.pause();
        range.max = flip.max; range.value = flip.value; pos.textContent = flip.pos; btn.textContent = flip.label;
        btn.onclick = flip.play; range.oninput = flip.input;
      }
    };
    video.addEventListener("loadedmetadata", () => {
      range.max = Math.max(1, Math.round(duration() * 10));
      if (startAt > 0 && startAt < duration()) video.currentTime = startAt;
      startAt = 0;
      sync();
    });
    video.addEventListener("timeupdate", () => { if (on) sync(); });
    video.addEventListener("play", () => { if (on) btn.textContent = "❚❚ Pause"; });
    video.addEventListener("pause", () => { if (on) btn.textContent = "▶ Play"; });
    video.addEventListener("error", async () => {
      if (!on) return;
      if (!retried) { // the sign-in may have been renewed since this page loaded: try once with a fresh address
        retried = true;
        const at = video.currentTime || startAt;
        await B.token();
        startAt = at;
        video.src = B.streamUrl(fileId);
        return;
      }
      setVideo(false);
      note.hidden = false;
      note.textContent = "This clip's video can't play here yet (its smaller copy may not be made). Showing frames.";
    });
    toggle.onclick = () => { remember(!on); setVideo(!on); };
    setVideo(wantVideo);
  };

  // The Library draws the first Review player at the end of its own script, before this file loads: draw it again.
  // It can fail while the Library is still starting, so it retries for a few seconds.
  let tries = 0;
  const redraw = setInterval(() => {
    const review = document.getElementById("v-review"), player = document.getElementById("rv-player");
    if (++tries > 40 || !review || review.hidden || !prefersVideo()) return tries > 40 || (review && review.hidden) ? clearInterval(redraw) : undefined;
    if (player?.querySelector("video.gta-inl")) return clearInterval(redraw);
    if (player && typeof renderReview === "function") { try { renderReview(true); } catch (e) {} }
  }, 250);
})();
