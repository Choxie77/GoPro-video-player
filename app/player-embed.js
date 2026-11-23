/* Runs inside player.html when it is opened by the app: adds rating and moment controls that save to the Library.
   In "Watch & rate" mode (started by rate.js) a rating moves on to the next clip by itself. Public file: no footage data. */
(() => {
  if (new URLSearchParams(location.search).get("embed") !== "1" || window.parent === window) return;
  let rate = null; // read once, so a later normal open of the player isn't in rating mode
  try { rate = JSON.parse(sessionStorage.getItem("gta-rate") || "null"); sessionStorage.removeItem("gta-rate"); } catch (e) {}
  if (rate && !(Date.now() - rate.at < 30000)) rate = null;
  const style = document.createElement("style");
  style.textContent = `
    header h1, header .tabs, header #who { display: none !important; }
    #gta-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
    #gta-actions button { padding: 8px 12px; font: 600 13px/1.3 Inter, system-ui, sans-serif; color: #17191c; background: #e9ecef; border: 1px solid #17191c; border-radius: 8px; cursor: pointer; }
    #gta-actions button:focus-visible { outline: 2px solid #4f8cff; outline-offset: 2px; }
    #gta-said, #gta-count { color: #cfd6da; font: 500 13px/1.3 Inter, system-ui, sans-serif; }
    #gta-count { margin-left: auto; font-variant-numeric: tabular-nums; }`;
  document.head.append(style);
  const box = document.createElement("div"); box.id = "gta-actions";
  const said = document.createElement("span"); said.id = "gta-said"; said.setAttribute("role", "status");
  const count = document.createElement("span"); count.id = "gta-count";
  let rated = 0, pendingAdvance = false;
  const showCount = () => { count.textContent = rate ? `Rating ${Math.min(idx + 1, items.length)} of ${items.length} · ${rated} rated` : ""; };
  const advance = () => {
    if (!rate) return;
    if (idx < items.length - 1) { document.getElementById("next").click(); showCount(); }
    else said.textContent = `Queue finished. ${rated} rated.`;
  };
  const send = (action) => {
    const it = items[idx]; if (!it) return;
    pendingAdvance = !!rate && ["best", "keep", "maybe", "reject"].includes(action);
    window.parent.postMessage({type: "gta-action", action, orig: it.orig, t: va().currentTime}, location.origin);
  };
  const buttons = [["moment", "Keep this moment (M)"], ["best", "Best (B)"], ["keep", "Keep (G)"], ["maybe", "Maybe (V)"], ["reject", "Reject (X)"]];
  if (rate) buttons.push(["skip", "Skip (S)"]);
  for (const [action, label] of buttons) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label;
    b.onclick = () => action === "skip" ? advance() : send(action); box.append(b);
  }
  box.append(said, count);
  document.getElementById("vbox").insertAdjacentElement("afterend", box);
  showCount();
  if (rate) setInterval(showCount, 500); // the queue arrives after this script runs
  addEventListener("message", (e) => {
    if (e.origin !== location.origin || e.source !== window.parent || e.data?.type !== "gta-done") return;
    said.textContent = e.data.text;
    if (pendingAdvance) { pendingAdvance = false; rated++; showCount(); setTimeout(advance, 450); }
  });
  addEventListener("keydown", (e) => {
    if (view !== "play" || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (rate && k === "s") { e.preventDefault(); return advance(); }
    const action = {m: "moment", b: "best", g: "keep", v: "maybe", x: "reject"}[k];
    if (action) { e.preventDefault(); send(action); }
  });
})();
