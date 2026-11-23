/* GoPro Travels app: signs in to Google, loads the private library data from Drive, keeps saved work in one
   Drive file, then starts the Library screens. This file is public; it must never contain footage data. */
(() => {
  "use strict";
  const CLIENT_ID = "231539038852-tnr10gin3klaserl2h90qkrdeq1odskf.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
  const qs = new URLSearchParams(location.search);
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const TEST = isLocal && qs.get("api") ? new URL(qs.get("api"), location.href).href.replace(/\/$/, "") : null; // never honoured on the live site
  const API = TEST || "https://www.googleapis.com/drive/v3/files";
  const UPLOAD = TEST ? TEST.replace(/\/files$/, "/upload/files") : "https://www.googleapis.com/upload/drive/v3/files";
  const STATE_NAME = "gopro_app_state.json", FOLDER_NAME = "GoPro Travels App Data", PENDING_KEY = "gta-pending-v1";
  const COLLECTIONS = ["marks", "moments", "posts", "edits", "config", "requests"];
  const ACTIVE_MS = 10 * 60 * 1000;

  let token = null, expires = 0, tokenClient = null, tokenWait = null;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

  /* ---------- screen furniture ---------- */
  const css = el("style", {textContent: `
    #gta-gate { position: fixed; inset: 0; z-index: 2147482000; display: grid; place-items: center; padding: 16px; background: #1f1f1f; color: #eceff1; font: 16px/1.5 Inter, system-ui, sans-serif; }
    #gta-gate > div { max-width: 460px; display: grid; gap: 14px; }
    #gta-gate h1 { margin: 0; font-size: 28px; line-height: 1.15; }
    #gta-gate p { margin: 0; color: #b6bdc2; }
    .gta-btn { justify-self: start; padding: 10px 16px; font: 600 14px/1.3 Inter, system-ui, sans-serif; color: #17191c; background: #e9ecef; border: 1px solid #17191c; border-radius: 8px; cursor: pointer; }
    .gta-btn:focus-visible { outline: 2px solid #4f8cff; outline-offset: 2px; }
    #gta-bar { position: fixed; z-index: 2147481000; left: 50%; transform: translateX(-50%); top: calc(8px + env(safe-area-inset-top, 0px)); max-width: calc(100vw - 32px); display: flex; gap: 10px; align-items: center; padding: 8px 12px; color: #17191c; background: #f2c94c; border: 1px solid #17191c; border-radius: 8px; font: 500 13px/1.35 Inter, system-ui, sans-serif; }
    #gta-player { width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; background: #111; }
    #gta-player::backdrop { background: #111; }
    #gta-player iframe { display: block; width: 100%; height: 100%; border: 0; }
    #gta-close { position: absolute; z-index: 2; top: calc(10px + env(safe-area-inset-top, 0px)); right: max(12px, env(safe-area-inset-right, 0px)); }
  `});
  const gateTitle = el("h1", {textContent: "GoPro Travels"});
  const gateText = el("p", {textContent: "Sign in with the Google account that holds your footage."});
  const gateBtn = el("button", {className: "gta-btn", type: "button", textContent: "Sign in with Google"});
  const gate = el("div", {id: "gta-gate"}, el("div", {}, gateTitle, gateText, gateBtn));
  const bar = el("div", {id: "gta-bar", hidden: true, role: "status"});
  const gateSay = (title, text, showBtn) => { gateTitle.textContent = title; gateText.textContent = text; gateBtn.hidden = !showBtn; };
  function barSay(text, action) {
    bar.hidden = !text; bar.replaceChildren();
    if (!text) return;
    bar.append(el("span", {textContent: text}));
    if (action) { const b = el("button", {className: "gta-btn", type: "button", textContent: action[0]}); b.onclick = action[1]; bar.append(b); }
  }
  const saveLabel = (text) => { const s = document.getElementById("store"); if (s && libReady) s.textContent = text; };

  /* ---------- Google sign-in ---------- */
  function keepToken(t, seconds) {
    token = t; expires = Date.now() + (seconds - 60) * 1000;
    for (const key of ["gta-token", "gtp-token"]) { try { sessionStorage.setItem(key, JSON.stringify({token, tokenExpires: expires})); } catch (e) {} }
    sendWorkerConfig();
  }
  function loadSavedToken() {
    if (TEST) { keepToken(qs.get("token") || "test", 86400); return true; }
    try { const s = JSON.parse(sessionStorage.getItem("gta-token") || "null"); if (s && s.tokenExpires > Date.now() + 60e3) { token = s.token; expires = s.tokenExpires; return true; } } catch (e) {}
    return false;
  }
  function loadGoogle() {
    return new Promise((ok, bad) => {
      if (window.google?.accounts?.oauth2) return ok();
      const s = el("script", {src: "https://accounts.google.com/gsi/client", async: true});
      s.onload = () => ok(); s.onerror = () => bad(new Error("Google sign-in didn't load")); document.head.append(s);
    });
  }
  async function requestToken(prompt) {
    if (TEST) return token;
    if (tokenWait) return tokenWait;
    await loadGoogle();
    tokenWait = new Promise((ok, bad) => {
      tokenClient = tokenClient || google.accounts.oauth2.initTokenClient({client_id: CLIENT_ID, scope: SCOPE, callback: () => {}});
      tokenClient.callback = (r) => {
        tokenWait = null;
        if (r.error) return bad(new Error(r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPE.split(" "))) return bad(new Error("Allow both Drive permissions to continue"));
        keepToken(r.access_token, r.expires_in); ok(token);
      };
      tokenClient.error_callback = (e) => { tokenWait = null; bad(new Error(e?.type || "sign-in closed")); };
      tokenClient.requestAccessToken({prompt});
    });
    return tokenWait;
  }

  /* ---------- Drive ---------- */
  async function authed(url, opts = {}, retried) {
    if (!TEST && Date.now() > expires && !retried) await requestToken("").catch(() => {});
    const r = await fetch(url, {...opts, headers: {...(opts.headers || {}), Authorization: `Bearer ${token}`}});
    if (r.status === 401 && !retried && !TEST) { await requestToken(""); return authed(url, opts, true); }
    if (!r.ok) throw Object.assign(new Error(`Drive answered ${r.status}`), {status: r.status});
    return r;
  }
  const driveUrl = (path, params = {}) => `${API}${path ? "/" + path : ""}?${new URLSearchParams({supportsAllDrives: "true", ...params})}`;
  const meta = (id, fields) => authed(driveUrl(id, {fields})).then((r) => r.json());
  const media = (id) => authed(driveUrl(id, {alt: "media"})).then((r) => r.json());
  const find = (q, fields = "files(id,name,parents,modifiedTime)") =>
    authed(driveUrl("", {q: `${q} and trashed=false`, fields, orderBy: "modifiedTime desc", pageSize: "1000"})).then((r) => r.json()).then((j) => j.files || []);
  async function createJson(name, parent, body) {
    const boundary = "gta" + Math.random().toString(36).slice(2);
    const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name, parents: [parent], mimeType: "application/json"})}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n--${boundary}--`;
    const r = await authed(`${UPLOAD}?uploadType=multipart&fields=id,version`, {method: "POST", headers: {"Content-Type": `multipart/related; boundary=${boundary}`}, body: payload});
    return r.json();
  }
  async function createFolder(name) {
    const r = await authed(`${API}?fields=id`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name, mimeType: "application/vnd.google-apps.folder"})});
    return (await r.json()).id;
  }

  /* ---------- service worker: video streams and private thumbnails ---------- */
  let spriteIds = {};
  function workerConfig() { return {type: "gta-config", token, api: API, sprites: spriteIds}; }
  function sendWorkerConfig() { navigator.serviceWorker?.controller?.postMessage(workerConfig()); }
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.type === "gta-need-config") e.ports[0]?.postMessage(workerConfig()); });
  async function startWorker() {
    if (!("serviceWorker" in navigator)) throw new Error("This browser can't stream from Drive");
    const reg = await navigator.serviceWorker.register("sw.js", {updateViaCache: "none"});
    const worker = reg.active || reg.waiting || reg.installing;
    if (worker.state !== "activated") await new Promise((ok) => { worker.addEventListener("statechange", () => { if (worker.state === "activated") ok(); }); setTimeout(ok, 5000); });
    const ours = () => navigator.serviceWorker.controller?.scriptURL === new URL("sw.js", location.href).href; // the old player's worker may control this page at first
    if (!ours()) await new Promise((ok) => { navigator.serviceWorker.addEventListener("controllerchange", ok, {once: true}); setTimeout(ok, 3000); });
    if (!ours()) {
      if (sessionStorage.getItem("gta-sw-reload")) throw new Error("Video streaming couldn't start. Reload this page.");
      sessionStorage.setItem("gta-sw-reload", "1"); location.reload(); await new Promise(() => {});
    }
    sessionStorage.removeItem("gta-sw-reload");
    sendWorkerConfig();
  }

  /* ---------- saved work: one JSON file in Drive, same calls the Library already uses ---------- */
  let state = {format: 1, docs: {}}, fileId = null, version = null, flushing = false, flushAgain = false, timer = null;
  let pending = (() => { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]"); } catch (e) { return []; } })();
  const listeners = new Set();
  const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
  const keepPending = () => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) {} };
  const docOf = (path) => { const [c, id] = path.split("/"); return state.docs[c]?.[id]; };
  function applyOp(op) {
    const [c, id] = op.path.split("/");
    state.docs[c] = state.docs[c] || {};
    if (op.data === null) delete state.docs[c][id]; else state.docs[c][id] = op.data;
  }
  const meta0 = {fromCache: false, hasPendingWrites: false};
  const snapDoc = (path) => { const d = docOf(path); return {id: path.split("/").pop(), exists: d !== undefined, data: () => clone(d), metadata: meta0}; };
  const snapCol = (c) => { const docs = Object.keys(state.docs[c] || {}).sort().map((id) => snapDoc(`${c}/${id}`)); return {docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: meta0}; };
  const notify = () => setTimeout(() => listeners.forEach((l) => l.cb(l.kind === "doc" ? snapDoc(l.path) : snapCol(l.path))), 0);
  function write(path, data) {
    pending.push({path, data: data === null ? null : clone(data)}); keepPending();
    applyOp(pending.at(-1)); notify();
    saveLabel("● Saving…");
    clearTimeout(timer); timer = setTimeout(flush, 700);
  }
  async function pull() {
    state = await media(fileId); state.docs = state.docs || {};
    pending.forEach(applyOp);
    const m = await meta(fileId, "version"); version = String(m.version);
    notify();
  }
  async function flush() {
    if (flushing) { flushAgain = true; return; }
    if (!pending.length) return;
    flushing = true;
    const count = pending.length;
    try {
      const m = await meta(fileId, "version");
      if (String(m.version) !== version) await pull();
      const body = JSON.stringify({...state, savedAt: new Date().toISOString()});
      const r = await authed(`${UPLOAD}/${fileId}?uploadType=media&fields=version&supportsAllDrives=true`, {method: "PATCH", headers: {"Content-Type": "application/json"}, body});
      version = String((await r.json()).version);
      pending = pending.slice(count); keepPending();
      if (!pending.length) { saveLabel("● Saved to Drive"); if (!sessionShown) barSay(""); }
    } catch (e) {
      saveLabel("● Not saved yet");
      barSay("Your latest changes are safe in this browser but haven't reached Drive.", ["Reconnect", () => requestToken("").then(flush).catch(() => {})]);
      clearTimeout(timer); timer = setTimeout(flush, 15000);
    } finally {
      flushing = false;
      if (flushAgain) { flushAgain = false; flush(); }
      else if (pending.length && !timer) timer = setTimeout(flush, 700);
    }
  }
  const docRef = (path) => ({
    id: path.split("/").pop(), path,
    get: async () => snapDoc(path),
    set: async (data) => write(path, data),
    update: async (data) => { if (docOf(path) === undefined) throw {code: "not_found"}; write(path, {...docOf(path), ...data}); },
    delete: async () => write(path, null),
    onSnapshot: (cb) => { const l = {kind: "doc", path, cb}; listeners.add(l); setTimeout(() => cb(snapDoc(path)), 0); return () => listeners.delete(l); },
  });
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const colRef = (path) => ({
    path,
    doc: (id) => docRef(`${path}/${id || newId()}`),
    add: async (data) => { const r = docRef(`${path}/${newId()}`); await r.set(data); return r; },
    get: async () => snapCol(path),
    onSnapshot: (cb) => { const l = {kind: "col", path, cb}; listeners.add(l); setTimeout(() => cb(snapCol(path)), 0); return () => listeners.delete(l); },
  });
  const db = {doc: docRef, collection: colRef};
  window.claude = {use: async (name) => name === "db" ? db : null};
  // What review.js needs from this file: saved work, Drive lookups and a fresh stream address.
  window.__gtaBridge = {
    db, find,
    token: async () => { if (!TEST && Date.now() > expires) await requestToken("").catch(() => {}); return token; },
    streamUrl: (id) => `stream/${id}?t=${encodeURIComponent(token)}${TEST ? `&api=${encodeURIComponent(TEST + "/")}` : ""}`,
  };

  async function openState() {
    const found = await find(`name='${STATE_NAME}'`, "files(id,name,version,modifiedTime)");
    if (found.length) { fileId = found[0].id; await pull(); return; }
    const backups = (await find("name contains 'gopro-library-backup-'")).filter((f) => /^gopro-library-backup-\d{4}-\d{2}-\d{2}.*\.json$/.test(f.name));
    if (backups.length) {
      const b = await media(backups[0].id);
      if (b?.app !== "GoPro Travels Library" || b.format !== 1 || !b.data) throw new Error("The backup file isn't in the expected format");
      state = {format: 1, importedFrom: backups[0].name, importedAt: new Date().toISOString(), docs: b.data};
    }
    const folders = await find(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder'`);
    const folder = folders[0]?.id || await createFolder(FOLDER_NAME);
    const made = await createJson(STATE_NAME, folder, state);
    fileId = made.id; version = String(made.version ?? (await meta(fileId, "version")).version);
    pending.forEach(applyOp);
    if (pending.length) flush();
  }

  /* ---------- "another Claude session is working" ---------- */
  let sessionShown = false;
  async function checkSessions() {
    try {
      const f = (await find("name='active_session.json'"))[0];
      const s = f ? await media(f.id) : null;
      // active_session.json is either one session {title, at} or {sessions: {<id>: {title, at}}} written by tools/heartbeat.py
      const live = Object.values(s?.sessions || (s?.at ? {one: s} : {})).filter((x) => x?.at && Date.now() - Date.parse(x.at) < ACTIVE_MS);
      sessionShown = live.length > 0;
      if (sessionShown) barSay(`${live.length} Claude session${live.length > 1 ? "s" : ""} working: ${live.map((x) => String(x.title || x.session || "unnamed").slice(0, 40)).join(", ")}. Avoid starting another on this project.`);
      else if (!pending.length) barSay("");
    } catch (e) {}
  }

  /* ---------- player inside the app ---------- */
  const frame = el("iframe", {title: "Video player", allow: "autoplay; fullscreen"});
  const closeBtn = el("button", {id: "gta-close", className: "gta-btn", type: "button", textContent: "Close player"});
  const dialog = el("dialog", {id: "gta-player", "aria-label": "Video player"}, closeBtn, frame);
  const closePlayer = () => { if (dialog.open) dialog.close(); };
  closeBtn.onclick = closePlayer;
  dialog.addEventListener("close", () => { frame.src = "about:blank"; }); // unloads the player: stops the video and makes the next open start fresh
  function openPlayer(href) {
    const u = new URL(href, location.href);
    const params = new URLSearchParams({embed: "1"});
    if (TEST) { params.set("api", TEST + "/"); params.set("token", token); }
    frame.src = `player.html?${params}${u.hash}`;
    if (!dialog.open) dialog.showModal();
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[target="gopro-player"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault(); e.stopPropagation(); openPlayer(a.href);
  }, true);
  addEventListener("message", async (e) => {
    if (e.origin !== location.origin || e.source !== frame.contentWindow || e.data?.type !== "gta-action") return;
    const {action, orig, t} = e.data;
    const c = DATA.clips.find((x) => x.drive === orig);
    const reply = (text) => frame.contentWindow?.postMessage({type: "gta-done", text}, location.origin);
    if (!c) return reply("This clip isn't in your Library yet");
    if (["best", "keep", "maybe", "reject"].includes(action)) { await saveMark(c.id, {r: action}, true); return reply({best: "Marked Best", keep: "Marked Keep", maybe: "Marked Maybe", reject: "Marked Reject"}[action]); }
    if (action === "moment" && Number.isFinite(t)) {
      const r2 = (x) => Math.round(x * 100) / 100, end = c.dur || t + 4, items = store.moments.get(c.id)?.items || [];
      const a = r2(Math.max(0, t - 2)), b = r2(Math.min(end, t + 4));
      if (items.some((m) => m.a < b && (m.b ?? m.a) > a)) return reply("You already kept this moment");
      await saveMoments(c.id, [...items, {a, b, role: "", note: ""}], true);
      reply("Moment kept");
    }
  });
  window.__requestNote = (post) => {
    const r = state.docs.requests?.[post];
    if (r?.status !== "waiting") return "";
    const when = new Date(r.at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    return `Edit requested at ${when}. Tell Claude Code: edit the requested posts.`;
  };
  window.__requestInfo = (post) => state.docs.requests?.[post] || null;
  window.__requestCancel = async (post) => {
    const r = state.docs.requests?.[post]; if (r?.status !== "waiting") return;
    await db.collection("requests").doc(post).set({...r, status: "cancelled", cancelledAt: new Date().toISOString()});
    toast("Request cancelled");
  };
  window.__requestEdit = async (post, mode, note) => {
    await db.collection("requests").doc(post).set({post, mode, note: note || "", status: "waiting", at: new Date().toISOString()});
    toast("Edit requested. Tell Claude Code: edit the requested posts");
  };
  addEventListener("beforeunload", (e) => { if (pending.length && fileId) { flush(); e.preventDefault(); } });

  /* ---------- start ---------- */
  let libReady = false;
  async function startLibrary() {
    const heldReady = [], heldLoad = [], docAdd = document.addEventListener, winAdd = window.addEventListener;
    document.addEventListener = function (type, fn, o) { if (type === "DOMContentLoaded") heldReady.push(fn); else docAdd.call(document, type, fn, o); };
    window.addEventListener = function (type, fn, o) { if (type === "load") heldLoad.push(fn); else winAdd.call(window, type, fn, o); };
    try {
      for (const src of window.__GTA_SCRIPTS) await new Promise((ok, bad) => { const s = el("script", {src, async: false}); s.onload = ok; s.onerror = () => bad(new Error(`Couldn't load ${src}`)); document.body.append(s); });
    } finally { document.addEventListener = docAdd; window.addEventListener = winAdd; }
    heldReady.forEach((fn) => fn(new Event("DOMContentLoaded")));
    heldLoad.forEach((fn) => fn(new Event("load")));
    libReady = true;
  }
  let started = false;
  async function start() {
    if (started) return; started = true;
    try {
      gateSay("Loading your journey", "Reading your library from Drive.", false);
      await startWorker();
      const dataFile = (await find("name='app_data.json'"))[0];
      if (!dataFile) throw new Error("app_data.json isn't in your Drive yet");
      const parent = dataFile.parents?.[0];
      const [payload, sprites, geo] = await Promise.all([
        media(dataFile.id),
        parent ? find(`'${parent}' in parents and name contains 'gtl-sprite-'`, "files(id,name)") : [],
        fetch("geo.json").then((r) => { if (!r.ok) throw new Error("Map outlines didn't load"); return r.text(); }),
      ]);
      spriteIds = Object.fromEntries(sprites.map((s) => [s.name.replace("gtl-sprite-", ""), s.id]));
      sendWorkerConfig();
      await openState();
      window.__GTA_OWNER = payload.owner || {};
      for (const [id, key] of [["gta-trip", "trip"], ["gta-trip-sub", "sub"]]) { const n = document.getElementById(id); if (n) n.textContent = window.__GTA_OWNER[key] || ""; }
      document.getElementById("data").textContent = JSON.stringify({...payload.library, player: "player.html"});
      document.getElementById("mapx").textContent = JSON.stringify(payload.mapx);
      document.getElementById("geo").textContent = geo;
      await startLibrary();
      gate.remove();
      checkSessions(); setInterval(checkSessions, 30000);
      setInterval(async () => {
        if (document.hidden || flushing || pending.length) return;
        try { const m = await meta(fileId, "version"); if (String(m.version) !== version) await pull(); } catch (e) {}
      }, 30000);
    } catch (e) {
      started = false;
      gateSay("Couldn't open your library", e?.message || "Something went wrong.", true);
      gateBtn.textContent = "Try again";
    }
  }
  gateBtn.onclick = async () => {
    try { await requestToken(token ? "" : "consent"); start(); }
    catch (e) { gateSay("Sign-in didn't finish", e?.message || "Try again.", true); }
  };
  document.head.append(css);
  document.body.append(gate, bar, dialog);
  if (loadSavedToken()) start();
})();
