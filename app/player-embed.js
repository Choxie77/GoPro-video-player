/* Runs inside player.html when it is opened by the app: adds rating and moment controls that save to the Library. */
(() => {
  if (new URLSearchParams(location.search).get("embed") !== "1" || window.parent === window) return;
  const style = document.createElement("style");
  style.textContent = `
    header h1, header .tabs, header #who { display: none !important; }
    #gta-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 10px 0; }
    #gta-actions button { padding: 8px 12px; font: 600 13px/1.3 Inter, system-ui, sans-serif; color: #17191c; background: #e9ecef; border: 1px solid #17191c; border-radius: 8px; cursor: pointer; }
    #gta-actions button:focus-visible { outline: 2px solid #4f8cff; outline-offset: 2px; }
    #gta-said { color: #cfd6da; font: 500 13px/1.3 Inter, system-ui, sans-serif; }`;
  document.head.append(style);
  const box = document.createElement("div"); box.id = "gta-actions";
  const said = document.createElement("span"); said.id = "gta-said"; said.setAttribute("role", "status");
  const send = (action) => {
    const it = items[idx]; if (!it) return;
    window.parent.postMessage({type: "gta-action", action, orig: it.orig, t: va().currentTime}, location.origin);
  };
  for (const [action, label] of [["moment", "Keep this moment (M)"], ["best", "Best (B)"], ["keep", "Keep (G)"], ["reject", "Reject (X)"]]) {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = () => send(action); box.append(b);
  }
  box.append(said);
  document.getElementById("vbox").insertAdjacentElement("afterend", box);
  addEventListener("message", (e) => { if (e.origin === location.origin && e.source === window.parent && e.data?.type === "gta-done") said.textContent = e.data.text; });
  addEventListener("keydown", (e) => {
    if (view !== "play" || ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    const action = {m: "moment", b: "best", g: "keep", x: "reject"}[e.key.toLowerCase()];
    if (action) { e.preventDefault(); send(action); }
  });
})();
