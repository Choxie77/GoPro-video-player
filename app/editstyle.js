/* GoPro Travels app: the "Edit style" tab. Tweak how edits look (captions, cuts, colour, sound) with a live preview,
   save it, keep named presets. Saved to the app's state (db "editstyle": doc "current" plus presets "p-<name>").
   tools/style_edit.py --style state reads "current". Public file: no footage or personal data here. */
(() => {
  "use strict";
  const B = window.__gtaBridge;
  if (!B) return;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.flat().filter((k) => k != null && k !== false)); return n; };
  const toast = (m, bad) => (typeof window.toast === "function" ? window.toast(m, bad) : console.log(m));
  const DEFAULT = {
    name: "Talk-cut yellow",
    cuts: {max_gap: 0.45, pad_before: 0.10, pad_after: 0.18, min_segment: 1.2, min_words: 3, remove_fillers: true, max_seconds: 45, drop_ranges: []},
    captions: {on: true, words_per_caption: 3, fill: "#FFD60A", stroke: "#000000", stroke_px: 9, size: 96, y: 0.70, uppercase: true, font: "Arial Black"},
    color: {auto: true, target_brightness: 0.42, contrast: 1.08, saturation: 1.12, warmth: 0.04, gamma: 1.0},
    framing: {x: 0.5},
    sound: {denoise: true, loudness: -14},
    days: {title_cards: true, title_seconds: 1.2},
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const merge = (a, b) => { for (const k in b) a[k] = b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) ? merge(a[k] || {}, b[k]) : b[k]; return a; };
  // [group, key, label, min, max, step, hint]
  const SLIDERS = [
    ["cuts", "max_gap", "Pause that gets cut (s)", 0.15, 1.2, 0.05, "Silences longer than this are removed. Lower = punchier."],
    ["cuts", "pad_before", "Breath before a line (s)", 0, 0.4, 0.02, ""],
    ["cuts", "pad_after", "Breath after a line (s)", 0, 0.5, 0.02, ""],
    ["cuts", "min_words", "Fewest words in a kept line", 1, 8, 1, "Drops stray one-word bits."],
    ["cuts", "max_seconds", "Longest reel (s)", 10, 120, 1, ""],
    ["captions", "words_per_caption", "Words on screen at once", 1, 6, 1, ""],
    ["captions", "size", "Caption size", 50, 150, 2, ""],
    ["captions", "stroke_px", "Black outline thickness", 0, 18, 1, ""],
    ["captions", "y", "Caption height (0 top, 1 bottom)", 0.3, 0.85, 0.01, "Stay above Instagram's buttons: about 0.70 or higher up."],
    ["color", "contrast", "Contrast", 0.8, 1.4, 0.01, ""],
    ["color", "saturation", "Saturation", 0.6, 1.6, 0.01, ""],
    ["color", "warmth", "Warmth", -0.1, 0.15, 0.005, "Positive = warmer, negative = cooler."],
    ["color", "target_brightness", "Brightness each clip is pulled to", 0.3, 0.6, 0.01, "Used when auto brightness is on, so clips match."],
    ["framing", "x", "Where the 9:16 window sits (0 left, 1 right)", 0, 1, 0.05, ""],
    ["sound", "loudness", "Loudness (LUFS)", -20, -10, 1, ""],
  ];
  const TOGGLES = [["captions", "on", "Captions"], ["captions", "uppercase", "CAPITAL LETTERS"], ["cuts", "remove_fillers", "Cut “um / uh”"],
    ["color", "auto", "Auto brightness per clip"], ["sound", "denoise", "Remove background noise"], ["days", "title_cards", "“Day N” title when the day changes"]];

  const css = el("style", {textContent: `
    #v-estyle .gtae { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; margin-top: 14px; align-items: start; }
    @media (max-width: 820px) { #v-estyle .gtae { grid-template-columns: 1fr; } #v-estyle .gtae-prev { order: -1; position: static; } }
    #v-estyle .gtae-prev { position: sticky; top: 12px; }
    #v-estyle .gtae-phone { position: relative; width: 270px; max-width: 100%; aspect-ratio: 9/16; margin: 0 auto; border-radius: 14px; overflow: hidden; background: #6b7280; container-type: size; }
    #v-estyle .gtae-scene { position: absolute; inset: 0; }
    #v-estyle .gtae-cap { position: absolute; left: 0; right: 0; text-align: center; font-family: "Arial Black", Arial, sans-serif; font-weight: 900; line-height: 1.15; padding: 0 7%; paint-order: stroke fill; }
    #v-estyle .gtae-ctrl { display: grid; gap: 12px; }
    #v-estyle .gtae-grp { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--surface); display: grid; gap: 10px; }
    #v-estyle .gtae-grp h3 { font-size: 15px; margin: 0; }
    #v-estyle .gtae-row { display: grid; grid-template-columns: 1fr 90px; gap: 4px 10px; align-items: center; font-size: 13px; }
    #v-estyle .gtae-row small { grid-column: 1 / -1; color: var(--muted); }
    #v-estyle .gtae-row input[type=range] { width: 100%; }
    #v-estyle .gtae-row output { text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
    #v-estyle .gtae-tog { display: flex; gap: 8px; align-items: center; font-size: 13px; }
    #v-estyle .gtae-btns { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    #v-estyle .gtae-btns input[type=text], #v-estyle select { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; min-width: 0; }
    #v-estyle .gtae-note { color: var(--muted); font-size: 13px; margin: 6px 0 0; }

    #v-estyle .gtae-rules { margin-top: 14px; }
    #v-estyle .gtae-rgrp { display: grid; gap: 8px; }
    #v-estyle .gtae-rgrp h4 { margin: 6px 0 0; font-size: 14px; }
    #v-estyle .gtae-rgrp > .btn { justify-self: start; }
    #v-estyle .gtae-rule { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: start; }
    #v-estyle .gtae-rule input[type=checkbox] { margin-top: 9px; }
    #v-estyle .gtae-rule textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 14px; line-height: 1.4; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; resize: vertical; overflow: hidden; }
    #v-estyle .gtae-rule small { color: var(--muted); font-size: 12px; }
  `});
  document.head.append(css);

  let cfg = clone(DEFAULT), presets = [], view = null, link = null, dirty = false, built = false;

  // Editing rules: the style Claude follows on every edit (tools/auto_editor.py reads editstyle/playbook,
  // else config/edit_playbook.json). Defaults are the same list as that file.
  const PLAYBOOK = [{"id": "story-one", "group": "Story", "text": "One story per video. Find the single thread in what was said (e.g. 'trying not to look like a tourist') and build around it; drop lines that don't serve it. A string of unrelated remarks feels like rambling even when each line is fine.", "from": "Bangkok post, v5 to v6"}, {"id": "story-seen", "group": "Story", "text": "Keep talk about things the viewer can see, or show them right after. Talking about something that never appears on screen is boring.", "from": "Bangkok post, v4 feedback"}, {"id": "story-open", "group": "Story", "text": "Open on the strongest picture or line, with the hook title over it. Hold the opening long enough to read the hook (about 2.5-3 s).", "from": "Bangkok post, v8"}, {"id": "story-end", "group": "Story", "text": "End on a calm picture held 3-4 s (scenery with its own sound), not on a clipped word.", "from": "Bangkok post, v8"}, {"id": "pace-land", "group": "Pacing", "text": "Let every statement land: end a talking shot 0.4-0.8 s after the last word when there is a pause. Never cut on the last syllable or mid-thought.", "from": "Bangkok post, v8"}, {"id": "pace-fewer", "group": "Pacing", "text": "Fewer, longer moments over many quick cuts, so the viewer can take each clip in. Shots under 0.7 s read as glitches.", "from": "Bangkok post, v8"}, {"id": "pace-breather", "group": "Pacing", "text": "When a line runs straight into the next sentence, put a B-roll or scenery shot with its own sound after it as the breather.", "from": "Bangkok post, v8"}, {"id": "broll-show", "group": "B-roll", "text": "When he talks about something (the heat, a market, the traffic, a joke about the area), show it: either as a cover over the talking shot while his voice continues (2.5-3.5 s), or as its own shot right after the line (2.5-4 s).", "from": "Bangkok post, v4 feedback"}, {"id": "broll-dose", "group": "B-roll", "text": "Use B-roll a few times per video, not on every line. Keep his face on screen for the punchline of a joke.", "from": "Bangkok post, v5"}, {"id": "broll-level", "group": "B-roll", "text": "B-roll must be level and steady: straight walls, poles and horizon; not pointing at sky or ceiling; no swinging camera; nobody staring into the lens. Skip tilted footage even if it shows the right thing. Mark B-roll level: auto so a slight tilt is straightened.", "from": "Bangkok post, v6 to v7"}, {"id": "broll-hide", "group": "B-roll", "text": "Use a cover to hide a bad moment in a talking shot (camera looking away, something blocking the lens), starting just before it.", "from": "Bangkok post, v5"}, {"id": "look-cuts", "group": "Look", "text": "Hard cuts only. No fades, zooms, glows, speed ramps or other gimmicks. No emojis.", "from": "standing rule"}, {"id": "look-face", "group": "Look", "text": "Talking to camera: face tracking on so his face stays framed. Showing something or scenery: tracking off and frame the thing.", "from": "Bangkok post, v3 to v4"}, {"id": "look-hook", "group": "Look", "text": "Hook title: at most 6 words at the top, plus an optional short second line for context (e.g. week and place). The key word goes in the theme colour.", "from": "Bangkok post, v5"}, {"id": "subs-theme", "group": "Subtitles", "text": "Theme look: Poppins ExtraBold, capitals, white with a black outline. The 1-2 words that carry each sentence go in the theme colour (yellow #FFD43B), the same colour as the hook's key word.", "from": "Bangkok post, v4 feedback"}, {"id": "subs-lines", "group": "Subtitles", "text": "At most 3 words and one row per line. Never two lines on screen at once. No lone short word on its own line, no line ending on a weak word (a, the, to, I), and a sentence finishes on its own line. No punctuation shown.", "from": "Bangkok post, v4 to v8", "auto": true}, {"id": "subs-pop", "group": "Subtitles", "text": "Lines pop in very slightly (three frames growing to full size). Nothing more animated than that.", "from": "Bangkok post, v7", "auto": true}, {"id": "sound-sfx", "group": "Sound", "text": "Sound effects stay quiet: a soft tick on the hook, a soft whoosh before a few big changes of scene, not on every cut. B-roll keeps its own street sound.", "from": "Bangkok post, v3"}, {"id": "sound-level", "group": "Sound", "text": "Final loudness about -15 to -14 LUFS, background noise removed from his voice.", "from": "standing rule", "auto": true}];
  let rules = null, rulesDirty = false;
  const mergeRules = (saved) => {
    const base = PLAYBOOK.map((r) => ({...r, on: true}));
    if (!Array.isArray(saved) || !saved.length) return base;
    const out = saved.map((r) => ({...r}));
    for (const r of base) if (!out.some((x) => x.id === r.id)) out.push(r);
    return out;
  };
  const fit = (t) => { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; };
  function rulesSection() {
    if (!rules) rules = mergeRules(null);
    const saveBtn = el("button", {className: "btn primary", textContent: rulesDirty ? "Save rules" : "Rules saved", onclick: async () => {
      await B.db.doc("editstyle/playbook").set({rules, savedAt: new Date().toISOString()});
      rulesDirty = false; toast("Editing rules saved. Claude follows them on the next edit."); render();
    }});
    const markR = () => { rulesDirty = true; saveBtn.textContent = "Save rules"; };
    const row = (r) => {
      const ta = el("textarea", {rows: 2, value: r.text, placeholder: "Write the rule in your own words"});
      ta.style.opacity = r.on === false ? 0.5 : 1;
      ta.addEventListener("input", () => { r.text = ta.value; fit(ta); markR(); });
      const cb = el("input", {type: "checkbox", checked: r.on !== false, disabled: !!r.auto, title: r.auto ? "The renderer always does this" : "Claude follows this rule"});
      cb.addEventListener("change", () => { r.on = cb.checked; ta.style.opacity = r.on ? 1 : 0.5; markR(); });
      const del = r.custom && el("button", {className: "btn", textContent: "Remove", onclick: () => { rules = rules.filter((x) => x !== r); rulesDirty = true; render(); }});
      const hint = r.auto ? "The renderer does this by itself" : r.custom ? "Your rule" : r.from ? `Learned from: ${r.from}` : "";
      return el("div", {className: "gtae-rule"}, cb, el("div", {}, ta, hint && el("small", {}, hint)), del || el("span"));
    };
    requestAnimationFrame(() => view.querySelectorAll(".gtae-rules textarea").forEach(fit));
    const groups = [...new Set(rules.map((r) => r.group))];
    const add = (g) => el("button", {className: "btn", textContent: "+ Add a rule", onclick: () => {
      rules.push({id: "u-" + Date.now().toString(36), group: g, text: "", on: true, custom: true}); rulesDirty = true; render();
      const t = view.querySelectorAll(".gtae-rules textarea"); t[t.length - 1]?.focus();
    }});
    const reset = el("button", {className: "btn", textContent: "Back to the learned rules", onclick: () => { rules = mergeRules(null); rulesDirty = true; render(); }});
    return el("div", {className: "gtae-grp gtae-rules"},
      el("h3", {}, "Editing rules Claude follows"),
      el("p", {className: "gtae-note"}, "Your style, learned from your notes on past edits. Claude reads these on every edit: switch one off, reword it or add your own, then save."),
      el("div", {className: "gtae-btns"}, saveBtn, reset),
      ...groups.map((g) => el("div", {className: "gtae-rgrp"}, el("h4", {}, g), ...rules.filter((r) => r.group === g).map(row), add(g))));
  }
  const SAMPLE = ["WANT TO TALK", "ABOUT THIS STREET", "I WENT THERE"];

  async function loadSaved() {
    try {
      const s = (await B.db.collection("editstyle").get()).docs.map((d) => ({id: d.id, ...d.data()}));
      const cur = s.find((x) => x.id === "current");
      if (cur) { const {id, ...rest} = cur; cfg = merge(clone(DEFAULT), rest); }
      rules = mergeRules((s.find((x) => x.id === "playbook") || {}).rules);
      presets = s.filter((x) => x.id.startsWith("p-")).map(({id, ...r}) => ({id, ...r}));
    } catch (e) { /* first run: nothing saved yet */ }
  }
  const save = async () => { await B.db.doc("editstyle/current").set(cfg); dirty = false; toast("Edit style saved. Claude Code uses it on the next edit."); render(); };

  function preview() {
    const c = cfg.captions, col = cfg.color;
    const phone = view.querySelector(".gtae-phone"); if (!phone) return;
    const scene = phone.querySelector(".gtae-scene");
    const br = 0.55 + (col.target_brightness - 0.42) * 1.2, warm = col.warmth * 400;
    scene.style.background = `rgb(${Math.min(255, 118 + warm)}, ${112}, ${Math.max(0, 125 - warm)})`;
    scene.style.filter = `contrast(${col.contrast}) saturate(${col.saturation}) brightness(${br + 0.45})`;
    const cap = phone.querySelector(".gtae-cap");
    const words = SAMPLE.join(" ").split(" ").slice(0, c.words_per_caption).join(" ");
    cap.hidden = !c.on;
    cap.textContent = c.uppercase ? words.toUpperCase() : words.toLowerCase();
    cap.style.color = c.fill; cap.style.webkitTextStroke = `${c.stroke_px * 2 / 1920 * 100}cqh ${c.stroke}`;
    cap.style.fontSize = `${c.size / 1920 * 100}cqh`; cap.style.top = `calc(${c.y * 100}% - 0.6em)`;
    const win = phone.querySelector(".gtae-win"); if (win) win.style.left = `${cfg.framing.x * 100}%`;
  }

  function slider([g, k, label, min, max, step, hint]) {
    const out = el("output", {textContent: cfg[g][k]});
    const inp = el("input", {type: "range", min, max, step, value: cfg[g][k]});
    inp.addEventListener("input", () => { cfg[g][k] = +inp.value; out.textContent = inp.value; dirty = true; preview(); mark(); });
    return el("div", {className: "gtae-row"}, el("label", {}, label), out, inp, hint && el("small", {}, hint));
  }
  function toggle([g, k, label]) {
    const inp = el("input", {type: "checkbox", checked: !!cfg[g][k]});
    inp.addEventListener("change", () => { cfg[g][k] = inp.checked; dirty = true; preview(); mark(); });
    return el("label", {className: "gtae-tog"}, inp, label);
  }
  function colour(label, g, k) {
    const inp = el("input", {type: "color", value: cfg[g][k]});
    inp.addEventListener("input", () => { cfg[g][k] = inp.value; dirty = true; preview(); mark(); });
    return el("label", {className: "gtae-tog"}, inp, label);
  }
  const mark = () => { const b = view.querySelector("#gtae-save"); if (b) b.textContent = dirty ? "Save changes" : "Saved"; };

  function render() {
    view.replaceChildren();
    const sec = (title, ...kids) => el("div", {className: "gtae-grp"}, el("h3", {}, title), ...kids);
    const sl = (g) => SLIDERS.filter((s) => s[0] === g).map(slider), tg = (g) => TOGGLES.filter((t) => t[0] === g).map(toggle);
    const sel = el("select", {}, el("option", {value: ""}, "Presets…"), ...presets.map((p) => el("option", {value: p.id, textContent: p.name || p.id})));
    sel.addEventListener("change", () => { const p = presets.find((x) => x.id === sel.value); if (p) { const {id, ...r} = p; cfg = merge(clone(DEFAULT), r); dirty = true; render(); } });
    const nm = el("input", {type: "text", placeholder: "Name this look", value: ""});
    const saveAs = el("button", {className: "btn", textContent: "Save as preset", onclick: async () => {
      const n = nm.value.trim(); if (!n) return toast("Give the preset a name first", true);
      const id = "p-" + n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      await B.db.doc(`editstyle/${id}`).set({...clone(cfg), name: n}); await loadSaved(); toast(`Saved preset “${n}”`); render();
    }});
    const reset = el("button", {className: "btn", textContent: "Reset", onclick: () => { cfg = clone(DEFAULT); dirty = true; render(); }});
    view.append(el("h2", {}, "Edit style"), el("p", {className: "gtae-note"}, "How edits look and cut. Change something, watch the preview, save. Claude Code reads the saved style for every edit (python3 tools/style_edit.py <video> <out.mp4> --style state)."),
      rulesSection(),
      el("div", {className: "gtae"},
        el("div", {className: "gtae-ctrl"},
          el("div", {className: "gtae-btns"}, el("button", {id: "gtae-save", className: "btn primary", textContent: dirty ? "Save changes" : "Saved", onclick: save}), sel, nm, saveAs, reset),
          sec("Cuts: what stays", ...sl("cuts"), tg("cuts")),
          sec("Captions", colour("Text colour", "captions", "fill"), colour("Outline colour", "captions", "stroke"), ...sl("captions"), tg("captions")),
          sec("Colour", ...sl("color"), tg("color")),
          sec("Framing and sound", ...sl("framing"), ...sl("sound"), tg("sound")),
          sec("Several days in one video", tg("days"))),
        el("div", {className: "gtae-prev"}, el("div", {className: "gtae-phone"}, el("div", {className: "gtae-scene"}), el("div", {className: "gtae-cap"})),
          el("p", {className: "gtae-note"}, "Preview is a stand-in picture so the app never holds your footage. Real renders: styled/ in Drive."))));
    preview();
  }

  async function apply() {
    const on = location.hash === "#estyle";
    document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a === link && on ? "page" : "false"));
    if (on) {
      document.querySelectorAll("main .section, .section[id^='v-']").forEach((s) => { if (s !== view) s.hidden = true; });
      view.hidden = false;
      if (!built) { built = true; await loadSaved(); }
      render();
    } else view.hidden = true;
  }

  function mount() {
    const tabs = document.querySelector(".tabs"), anchor = document.getElementById("v-roadmap");
    if (!tabs || !anchor) return false;
    if (document.getElementById("v-estyle")) return true;
    link = el("a", {href: "#estyle"}); link.dataset.view = "estyle";
    link.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>Edit style';
    tabs.append(link);
    link.addEventListener("click", () => { document.getElementById("side-close")?.click?.(); });
    view = el("section", {id: "v-estyle", className: "section", hidden: true});
    anchor.insertAdjacentElement("afterend", view);
    addEventListener("hashchange", () => setTimeout(apply, 0));
    apply();
    return true;
  }
  let tries = 0;
  const timer = setInterval(() => { if (mount() || ++tries > 200) clearInterval(timer); }, 300);
})();
