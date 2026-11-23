/* GoPro Travels app: the Hooks tab. Shows which hooks broke out on viral travel reels, which of your own clips could carry
   each one, starts a post from that hook, and logs your posted reels so the playbook can learn what works for you.
   Reads trends_data.json from Drive (written by tools/trends.py export); logged reels go to the app's saved state (db "trendlog").
   Public file: it must never contain footage data. */
(() => {
  "use strict";
  const B = window.__gtaBridge;
  if (!B) return;
  const API = window.__GTA_API || "https://www.googleapis.com/drive/v3";
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.flat().filter((k) => k != null && k !== false)); return n; };
  const LABEL = {
    "warning": "Warning", "aspirational-future": "“One day you’ll…”", "question": "Question", "pov": "POV", "day-journal": "Day journal",
    "challenge-or-itinerary": "Challenge or itinerary", "destination-declaration": "“I’m in…”", "danger-awe": "Danger or awe", "pure-visual": "Pure visual", "other": "Other",
  };
  const label = (k) => LABEL[k] || k;
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n ?? "");
  const code = (s) => { const m = String(s || "").match(/(?:reel|reels|p)\/([A-Za-z0-9_-]+)/); const c = m ? m[1] : String(s || "").trim(); return /^[A-Za-z0-9_-]{4,40}$/.test(c) ? c : ""; };
  const toast = (m, bad) => (typeof window.toast === "function" ? window.toast(m, bad) : console.log(m));

  const css = el("style", {textContent: `
    #v-hooks .gtat-sum { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0 6px; }
    #v-hooks .gtat-note { color: var(--muted); font-size: 13px; margin: 6px 0 0; }
    #v-hooks .gtat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 14px; margin-top: 14px; }
    #v-hooks .gtat-card { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: var(--surface); display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    #v-hooks .gtat-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
    #v-hooks .gtat-top h3 { font-size: 16px; }
    #v-hooks .gtat-line { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
    #v-hooks .gtat-sub { color: var(--muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 4px; }
    #v-hooks .gtat-ex { font-size: 13px; margin: 2px 0; overflow-wrap: anywhere; }
    #v-hooks .gtat-ex a { color: var(--link, var(--accent)); }
    #v-hooks .gtat-clip { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
    #v-hooks .gtat-clip b { overflow-wrap: anywhere; }
    #v-hooks .gtat-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    #v-hooks .gtat-empty { color: var(--muted); font-size: 13px; }
    #v-hooks .gtat-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 10px 0; }
    #v-hooks .gtat-form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted); font-weight: 600; }
    #v-hooks .gtat-form input, #v-hooks .gtat-form select { font: inherit; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; min-width: 0; }
    #v-hooks table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    #v-hooks th, #v-hooks td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
    #v-hooks th { color: var(--muted); font-weight: 600; }
    #v-hooks .gtat-scroll { overflow-x: auto; }
  `});
  document.head.append(css);

  let data = null, loading = null, view = null, link = null;

  async function load(force) {
    if (data && !force) return data;
    if (loading) return loading;
    loading = (async () => {
      const f = (await B.find("name='trends_data.json'"))[0];
      if (!f) throw new Error("trends_data.json isn't in Drive yet. Ask Claude Code to run: python3 -I tools/trends.py refresh");
      const r = await fetch(`${API}/files/${f.id}?alt=media&supportsAllDrives=true`, {headers: {Authorization: `Bearer ${await B.token()}`}});
      if (!r.ok) throw new Error(`Couldn't read trends_data.json (${r.status})`);
      data = await r.json();
      return data;
    })().finally(() => { loading = null; });
    return loading;
  }

  // Fill a template like "DAY {N} IN {PLACE}" from the matched clip. strict: leave "" if anything stays unknown.
  const fill = (tpl, c, strict) => {
    const place = c && (c.city || c.region || c.country), day = c && c.day;
    if (strict && (/\{PLACE\}/.test(tpl) && !place || /\{N\}/.test(tpl) && !day)) return "";
    return String(tpl || "").replace(/\{PLACE\}/g, place || "[place]").replace(/\{N\}/g, day || "[day]");
  };
  const templateOf = (type) => (data.types.find((t) => t.name === type) || {}).template || "";
  const clipOf = (id) => (typeof byId !== "undefined" && byId.get ? byId.get(id) : null);
  const logged = async () => {
    try { const s = await B.db.collection("trendlog").get(); return s.docs.map((d) => ({id: d.id, ...d.data()})); } catch (e) { return []; }
  };

  function bestFor(type) {
    const all = (data.matches || []).filter((m) => m.hook_type === type);
    let best = null;
    for (const m of all) for (const c of m.candidates || []) if (!best || c.score > best.c.score) best = {m, c};
    return best;
  }

  async function startPost(type, ex, best) {
    const c = clipOf(best.c.clip);
    if (!c) return toast("That clip isn't in your library any more", true);
    if (typeof savePost !== "function" || typeof canSave !== "function" || !canSave()) return toast("Sign in and wait for your library to load first", true);
    const a = Math.max(0, best.c.start_s || 0), b = Math.min(c.dur || a + 3, +(a + 3).toFixed(1));
    const line = fill(templateOf(type), c, true);
    const why = `Hook pattern: ${label(type)}. Seen on @${ex.handle}: ${ex.hook_text || "no text, the shot is the hook"}.`;
    const id = await savePost(null, {...newPostSeed(c, [{clip: c.id, a, b, role: "hook", note: "Opener: " + why}]), kind: "reel", status: "clips",
      hook: line, caption: "", notes: why, brief: typeof briefDefaults === "function" ? briefDefaults("reel") : undefined});
    if (id) { toast("Post started with this hook as the opener"); location.hash = "#posts"; }
  }

  function card(t) {
    const ex = t.reels.slice(0, 2), best = bestFor(t.name);
    const c = best ? clipOf(best.c.clip) : null;
    const line = fill(t.template, c);
    const play = c && c.drive && typeof itemsLink === "function"
      ? el("a", {className: "btn quiet", href: itemsLink([{clip: c.id, a: best.c.start_s}], "light"), target: "gopro-player", rel: "noopener", textContent: "▶ Watch it"}) : null;
    return el("article", {className: "gtat-card"},
      el("div", {className: "gtat-top"}, el("h3", {textContent: label(t.name)}),
        el("span", {className: "chip", textContent: `${t.median}× typical views · ${t.n} reel${t.n > 1 ? "s" : ""}`})),
      el("div", {className: "gtat-line", textContent: line}),
      el("div", {}, el("p", {className: "gtat-sub", textContent: "Seen on"}),
        ex.map((r) => el("p", {className: "gtat-ex"}, el("a", {href: r.url, target: "_blank", rel: "noopener noreferrer", textContent: `@${r.handle}`}),
          ` · ${r.hook_text ? "“" + r.hook_text + "”" : "no text, the shot is the hook"} · ${fmt(r.views)} views`))),
      el("div", {}, el("p", {className: "gtat-sub", textContent: "Your footage for it"}),
        best && c ? el("div", {className: "gtat-clip"},
          el("b", {textContent: c.title || c.name || best.c.name}),
          el("span", {className: "muted", textContent: `${[best.c.place, `from ${Math.floor(best.c.start_s / 60)}:${String(Math.floor(best.c.start_s % 60)).padStart(2, "0")}`].filter(Boolean).join(" · ")} · scene match ${Math.round(Math.min(best.c.score, 1) * 100)}%`}),
          el("div", {className: "gtat-row"}, play,
            el("button", {className: "btn", type: "button", textContent: "Start a post from this", onclick: (e) => { e.target.disabled = true; startPost(t.name, ex[0], best).finally(() => { e.target.disabled = false; }); }})))
        : el("p", {className: "gtat-empty", textContent: `No tagged clip fits yet (${data.clips_considered} scanned). This fills in as clips get scene tags.`})));
  }

  function ownSection(rows) {
    const an = data.own_analysis || {};
    const box = el("div", {className: "section"}, el("h2", {textContent: "Your posted reels"}),
      el("p", {className: "gtat-note", textContent: "Log each reel you post, then add its numbers a day or two later. Comparisons appear from 3 reels and update when Claude Code runs the playbook."}));
    const num = (k, ph) => el("input", {type: "number", step: "any", min: "0", name: k, placeholder: ph || ""});
    const form = el("form", {className: "gtat-form"},
      el("label", {}, "Reel link or code", el("input", {name: "ref", required: true, placeholder: "instagram.com/reel/…"})),
      el("label", {}, "Hook text on screen", el("input", {name: "hook_text", placeholder: "first 3 seconds; leave empty if none"})),
      el("label", {}, "Length (seconds)", num("duration")),
      el("label", {}, "Pacing", Object.assign(el("select", {name: "pacing"}, ...["", "slow", "moderate", "fast"].map((v) => el("option", {value: v, textContent: v || "—"}))))),
      el("label", {}, "Views", num("views")), el("label", {}, "Reach", num("reach")),
      el("label", {}, "Shares", num("shares")), el("label", {}, "Saves", num("saved")),
      el("label", {}, "Avg watched (0–1)", num("avg_watch_pct", "0.42")), el("label", {}, "Skip rate (0–1)", num("skip_rate", "0.38")),
      el("div", {className: "gtat-row", style: "align-self:end"}, el("button", {className: "btn", type: "submit", textContent: "Save reel"})));
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form), id = code(fd.get("ref"));
      if (!id) return toast("Paste the reel link or its code (letters, numbers, - and _)", true);
      if (!window.canSave?.()) return toast("Wait for your library to finish loading", true);
      const row = {};
      for (const [k, v] of fd.entries()) if (k !== "ref" && String(v).trim() !== "") row[k] = ["hook_text", "pacing"].includes(k) ? String(v).trim() : Number(v);
      const old = rows.find((r) => r.id === id) || {};
      const {id: _x, ...rest} = old;
      await B.db.doc(`trendlog/${id}`).set({...rest, ...row, url: `https://www.instagram.com/reel/${id}`, loggedAt: rest.loggedAt || new Date().toISOString()});
      toast("Saved. Claude Code reads it next time it runs the playbook.");
      form.reset(); render();
    };
    box.append(el("details", {open: rows.length === 0}, el("summary", {textContent: "Log or update a reel"}), form));
    if (rows.length) {
      box.append(el("div", {className: "gtat-scroll"}, el("table", {},
        el("thead", {}, el("tr", {}, ...["Reel", "Hook", "Length", "Views", "Shares", "Saves", "Watched", "Skip"].map((h) => el("th", {textContent: h})))),
        el("tbody", {}, ...rows.map((r) => el("tr", {},
          el("td", {}, el("a", {href: r.url || "#", target: "_blank", rel: "noopener noreferrer", textContent: r.id})),
          el("td", {textContent: r.hook_text || "—"}), el("td", {textContent: r.duration ? r.duration + "s" : "—"}),
          el("td", {textContent: r.views ?? "—"}), el("td", {textContent: r.shares ?? "—"}), el("td", {textContent: r.saved ?? "—"}),
          el("td", {textContent: r.avg_watch_pct != null ? Math.round(r.avg_watch_pct * 100) + "%" : "—"}),
          el("td", {textContent: r.skip_rate != null ? Math.round(r.skip_rate * 100) + "%" : "—"})))))));
    }
    const groups = Object.entries(an.groups || {}).filter(([, g]) => g.n >= 3);
    if (groups.length) {
      box.append(el("div", {className: "gtat-scroll"}, el("table", {},
        el("thead", {}, el("tr", {}, ...["Group", "Reels", "Views vs your median", "Watched vs median", "Skip vs median"].map((h) => el("th", {textContent: h})))),
        el("tbody", {}, ...groups.map(([k, g]) => el("tr", {}, el("td", {textContent: k.replace("hook_type=", "hook: ").replace("_", " ")}), el("td", {textContent: g.n}),
          el("td", {textContent: g.views_vs_baseline != null ? g.views_vs_baseline + "×" : "—"}),
          el("td", {textContent: g.avg_watch_pct_vs_baseline != null ? g.avg_watch_pct_vs_baseline + "×" : "—"}),
          el("td", {textContent: g.skip_rate_vs_baseline != null ? g.skip_rate_vs_baseline + "×" : "—"})))))));
    } else {
      box.append(el("p", {className: "gtat-empty", textContent: rows.length < 3 ? `${rows.length} reel${rows.length === 1 ? "" : "s"} logged. Comparisons start at 3, and each group needs 3 to count. One reel is noise, not a pattern.` : "Not enough reels in any one group yet to compare."}));
    }
    return box;
  }

  async function render(force) {
    if (!view) return;
    view.replaceChildren(el("p", {className: "gtat-empty", textContent: "Loading hooks from Drive…"}));
    try {
      await load(force);
      const rows = await logged();
      const refresh = el("button", {className: "btn quiet", type: "button", textContent: "Reload", onclick: () => render(true)});
      view.replaceChildren(
        el("div", {className: "page-head"}, el("div", {}, el("h1", {textContent: "Hooks"}),
          el("p", {textContent: "What opens the travel reels that break out, and which of your clips could open yours."})), refresh),
        el("div", {className: "gtat-sum"},
          el("span", {className: "chip", textContent: `${data.viral_count} viral reels studied`}), el("span", {className: "chip", textContent: `${data.types.length} hook types`}),
          el("span", {className: "chip" + (data.clips_considered < 100 ? " flag" : ""), textContent: `${data.clips_considered} of your clips scanned`})),
        el("p", {className: "gtat-note", textContent: `Updated ${String(data.generated).slice(0, 10)}. Numbers are how far each reel beat its creator’s usual views. Small sample, so treat each hook as something to test.`}),
        el("div", {className: "gtat-grid"}, ...data.types.map(card)),
        ownSection(rows));
    } catch (e) {
      view.replaceChildren(el("div", {className: "page-head"}, el("div", {}, el("h1", {textContent: "Hooks"}))), el("p", {className: "gtat-empty", textContent: e.message || "Couldn't load hooks."}),
        el("button", {className: "btn quiet", type: "button", textContent: "Try again", onclick: () => render(true)}));
    }
  }

  function apply() {
    if (!view) return;
    const on = location.hash === "#hooks";
    if (on) {
      document.querySelectorAll('[id^="v-"]').forEach((s) => { s.hidden = s !== view; });
      document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a === link ? "page" : "false"));
      if (!view.dataset.ready) { view.dataset.ready = "1"; render(); }
    } else view.hidden = true;
  }

  function mount() {
    const tabs = document.querySelector(".tabs"), anchor = document.getElementById("v-roadmap");
    if (!tabs || !anchor) return false;
    if (document.getElementById("v-hooks")) return true;
    link = el("a", {href: "#hooks"});
    link.dataset.view = "hooks";
    link.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 5 13h6l-1 8 8-11h-6z"/></svg>Hooks';
    tabs.append(link);
    link.addEventListener("click", () => { document.getElementById("side-close")?.click?.(); });
    view = el("section", {id: "v-hooks", className: "section", hidden: true});
    anchor.insertAdjacentElement("afterend", view);
    // Run after the app's own router has drawn its view.
    addEventListener("hashchange", () => setTimeout(apply, 0));
    apply();
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => { if (mount() || ++tries > 200) clearInterval(timer); }, 300);
})();
