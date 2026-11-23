/* Watch & rate: adds a button to the Review screen that plays the next unrated clips in the player, each starting at its
   best suggested moment. A rating key (B best, G keep, V maybe, X reject) saves and moves on; S skips; M keeps a moment.
   Uses the Review screen's own filters (queue, country, day, skip short/dark). Public file: no footage data. */
(() => {
  "use strict";
  const BATCH = 30;
  const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
  const startOf = (c) => { const best = [...(c.sug || [])].sort((x, y) => y[3] - x[3])[0]; return best ? Math.max(0, best[0]) : 0; };
  const ready = () => typeof reviewQueue === "function" && typeof pItem === "function" && typeof DATA !== "undefined" && document.getElementById("rv-skipjunk");

  function open(btn) {
    const list = reviewQueue().filter((c) => c.drive).slice(0, BATCH);
    if (!list.length) return toast("Nothing left in this queue. Pick another queue above.");
    try { sessionStorage.setItem("gta-rate", JSON.stringify({total: list.length, at: Date.now()})); } catch (e) {}
    const link = el("a", {href: `${DATA.player}#q=light&i=0&list=${encodeURIComponent(list.map((c) => pItem(c, startOf(c))).join("|"))}`, target: "gopro-player"});
    document.body.append(link); link.click(); link.remove();
  }

  function mount() {
    if (document.getElementById("gta-rate-btn")) return true;
    const anchor = document.getElementById("rv-skipjunk")?.closest("label");
    if (!anchor) return false;
    const btn = el("button", {id: "gta-rate-btn", type: "button", className: "btn", textContent: `▶ Watch & rate next ${BATCH}`, title: "Plays the next unrated clips from their best moment. B best, G keep, V maybe, X reject, S skip, M keep this moment."});
    btn.onclick = () => open(btn);
    anchor.insertAdjacentElement("afterend", btn);
    return true;
  }

  let tries = 0;
  const timer = setInterval(() => { if ((ready() && mount()) || ++tries > 200) clearInterval(timer); }, 300);
})();
