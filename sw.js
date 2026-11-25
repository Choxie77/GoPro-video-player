// Streams a Google Drive file to the page's <video> with HTTP range requests, adding the sign-in token.
// URL shape handled: <scope>/stream/<fileId>?t=<access token>[&api=<test api base>]
// Also: keeps the app pages (player, explore) so they open with no signal, and holds clips people chose to "Save offline"
// (the small Light copy) in the browser's Cache Storage; those play back from there with no network.
const API = "https://www.googleapis.com/drive/v3/files/";
const sizes = new Map(); // fileId -> total bytes (to rebuild Content-Range if the API hides it)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const SHELL = "gtp-shell-v1", OFF = "gtp-offline-v1";
const offKey = (id) => new Request(self.registration.scope + "offline/" + id);
async function fromOffline(id, range) {
  const hit = await (await caches.open(OFF)).match(offKey(id));
  if (!hit) return null;
  const blob = await hit.blob(), size = blob.size, h = {"Content-Type": "video/mp4", "Accept-Ranges": "bytes"};
  const m = /bytes=(\d*)-(\d*)/.exec(range || "");
  if (!m) return new Response(blob, {status: 200, headers: {...h, "Content-Length": size}});
  const a = m[1] === "" ? Math.max(0, size - Number(m[2])) : Number(m[1]), b = m[1] !== "" && m[2] !== "" ? Math.min(size - 1, Number(m[2])) : size - 1;
  return new Response(blob.slice(a, b + 1), {status: 206, headers: {...h, "Content-Range": `bytes ${a}-${b}/${size}`, "Content-Length": b - a + 1}});
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const m = url.pathname.match(/\/stream\/([A-Za-z0-9_-]+)$/);
  if (!m) {   // app pages and small static files: newest from the network, the saved copy when there is no signal
    if (e.request.method !== "GET" || !/(\/|\.html|\.json|\.svg|\.webmanifest)$/.test(url.pathname) || url.searchParams.get("api")) return;
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(SHELL).then((ch) => ch.put(e.request, c)); } return r; })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then((r) => r || Response.error())));
    return;
  }
  if (!url.searchParams.get("dl")) {
    e.respondWith(fromOffline(m[1], e.request.headers.get("Range")).then((r) => r || stream(m[1], url.searchParams.get("t"), url.searchParams.get("api") || API, e.request.headers.get("Range"), null)));
    return;
  }
  e.respondWith(stream(m[1], url.searchParams.get("t"), url.searchParams.get("api") || API, e.request.headers.get("Range"), url.searchParams.get("dl")));
});

async function totalSize(id, token, api) {
  if (sizes.has(id)) return sizes.get(id);
  const r = await fetch(`${api}${id}?fields=size&supportsAllDrives=true`, {headers: {Authorization: `Bearer ${token}`}});
  if (!r.ok) return null;
  const size = Number((await r.json()).size);
  sizes.set(id, size);
  return size;
}

async function stream(id, token, api, range, dl) {
  const headers = {Authorization: `Bearer ${token}`};
  if (range && !dl) headers.Range = range;
  let r;
  try {
    r = await fetch(`${api}${id}?alt=media&supportsAllDrives=true`, {headers});
  } catch (err) {
    return new Response("network error", {status: 502});
  }
  if (!r.ok && r.status !== 206) return new Response(r.statusText || "error", {status: r.status});
  const out = new Headers();
  const ct = r.headers.get("Content-Type") || "";
  // GoPro .LRV files come back as unknown binary; they are MP4 inside, and Safari won't play them unless told so
  out.set("Content-Type", ct.startsWith("video/") ? ct : "video/mp4");
  out.set("Accept-Ranges", "bytes");
  if (dl) out.set("Content-Disposition", `attachment; filename="${dl.replace(/[^\w .()-]/g, "_")}"`); // "Download" button: save to disk, streamed
  const len = r.headers.get("Content-Length");
  if (len) out.set("Content-Length", len);
  if (r.status === 206) {
    let cr = r.headers.get("Content-Range");
    if (!cr) { // the API didn't expose it to scripts: rebuild it from the request and the file size
      const start = Number((range || "bytes=0-").replace(/bytes=(\d+)-.*/, "$1"));
      const size = await totalSize(id, token, api);
      if (len && size) cr = `bytes ${start}-${start + Number(len) - 1}/${size}`;
    }
    if (cr) out.set("Content-Range", cr);
  }
  return new Response(r.body, {status: r.status, statusText: r.statusText, headers: out});
}

// Messages from the pages: {type:"save", id, token, api} / {type:"unsave", id} / {type:"list"}; answers {type:"offline", ids:[...]} (and "saving" / "error")
async function offlineIds() { return (await (await caches.open(OFF)).keys()).map((r) => r.url.split("/offline/")[1]); }
async function tell(msg) { for (const c of await self.clients.matchAll()) c.postMessage(msg); }
self.addEventListener("message", (e) => {
  const d = e.data || {};
  e.waitUntil((async () => {
    if (d.type === "save") {
      await tell({type: "saving", id: d.id});
      try {
        const r = await fetch(`${d.api || API}${d.id}?alt=media&supportsAllDrives=true`, {headers: {Authorization: `Bearer ${d.token}`}});
        if (!r.ok) throw new Error(r.status);
        await (await caches.open(OFF)).put(offKey(d.id), new Response(await r.blob(), {headers: {"Content-Type": "video/mp4"}}));
      } catch (err) { await tell({type: "error", id: d.id}); }
    } else if (d.type === "unsave") await (await caches.open(OFF)).delete(offKey(d.id));
    await tell({type: "offline", ids: await offlineIds()});
  })());
});
