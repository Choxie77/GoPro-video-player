// Streams Drive video with range requests and serves private thumbnails after sign-in.
// Routes: <scope>/stream/<fileId>?t=<token>[&api=<test api>] and <scope>/sprites/sNNN.jpg
// Holds the sign-in token in memory only.
const DRIVE_API = "https://www.googleapis.com/drive/v3/files/";
const sizes = new Map();
let config = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => {
  if (e.origin === self.location.origin && e.data?.type === "gta-config") config = e.data;
});

async function getConfig() {
  if (config?.token) return config;
  for (const client of await self.clients.matchAll({type: "window"})) {
    const answer = await new Promise((ok) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (m) => ok(m.data);
      client.postMessage({type: "gta-need-config"}, [ch.port2]);
      setTimeout(() => ok(null), 800);
    });
    if (answer?.token) return (config = answer);
  }
  return null;
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  const stream = url.pathname.match(/\/stream\/([A-Za-z0-9_-]+)$/);
  if (stream) {
    const api = allowedApi(url.searchParams.get("api"));
    return e.respondWith(streamFile(stream[1], url.searchParams.get("t"), api, e.request.headers.get("Range")));
  }
  const sprite = url.pathname.match(/\/sprites\/(s\d{3}\.jpg)$/);
  if (sprite) e.respondWith(spriteFile(sprite[1]));
});

// A test API is accepted only when the app itself runs on this computer.
function allowedApi(api) {
  const local = ["localhost", "127.0.0.1"].includes(self.location.hostname);
  return local && api ? api : DRIVE_API;
}

async function spriteFile(name) {
  const c = await getConfig();
  const id = c?.sprites?.[name];
  if (!id) return new Response("not available", {status: 404});
  const base = c.api.endsWith("/") ? c.api : c.api + "/";
  const r = await fetch(`${base}${id}?alt=media&supportsAllDrives=true`, {headers: {Authorization: `Bearer ${c.token}`}});
  if (!r.ok) return new Response("not available", {status: r.status});
  return new Response(r.body, {status: 200, headers: {"Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600"}});
}

async function totalSize(id, token, api) {
  if (sizes.has(id)) return sizes.get(id);
  const r = await fetch(`${api}${id}?fields=size&supportsAllDrives=true`, {headers: {Authorization: `Bearer ${token}`}});
  if (!r.ok) return null;
  const size = Number((await r.json()).size);
  sizes.set(id, size);
  return size;
}

async function streamFile(id, token, api, range) {
  const headers = {Authorization: `Bearer ${token}`};
  if (range) headers.Range = range;
  let r;
  try { r = await fetch(`${api}${id}?alt=media&supportsAllDrives=true`, {headers}); }
  catch (err) { return new Response("network error", {status: 502}); }
  if (!r.ok && r.status !== 206) return new Response(r.statusText || "error", {status: r.status});
  const out = new Headers();
  const ct = r.headers.get("Content-Type") || "";
  out.set("Content-Type", ct.startsWith("video/") ? ct : "video/mp4"); // GoPro .LRV files are MP4 inside
  out.set("Accept-Ranges", "bytes");
  const len = r.headers.get("Content-Length");
  if (len) out.set("Content-Length", len);
  if (r.status === 206) {
    let cr = r.headers.get("Content-Range");
    if (!cr) {
      const start = Number((range || "bytes=0-").replace(/bytes=(\d+)-.*/, "$1"));
      const size = await totalSize(id, token, api);
      if (len && size) cr = `bytes ${start}-${start + Number(len) - 1}/${size}`;
    }
    if (cr) out.set("Content-Range", cr);
  }
  return new Response(r.body, {status: r.status, statusText: r.statusText, headers: out});
}
