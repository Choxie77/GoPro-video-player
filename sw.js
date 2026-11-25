// Streams a Google Drive file to the page's <video> with HTTP range requests, adding the sign-in token.
// URL shape handled: <scope>/stream/<fileId>?t=<access token>[&api=<test api base>]
// Nothing is cached or written to disk beyond the browser's normal media buffer.
const API = "https://www.googleapis.com/drive/v3/files/";
const sizes = new Map(); // fileId -> total bytes (to rebuild Content-Range if the API hides it)

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const m = url.pathname.match(/\/stream\/([A-Za-z0-9_-]+)$/);
  if (!m || url.origin !== self.location.origin) return;
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
