// Find YouTube videos and playlists in anything you paste or import:
// links in any form, a Google Takeout playlist CSV ("Video ID" column) or JSON,
// or a plain list of ids. Pure functions, so Node tests can import them.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_RE = /^[A-Za-z0-9_-]{12,64}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);

export const isVideoId = (s) => ID_RE.test(String(s || ''));
export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const shortUrl = (id, t = 0) => `https://youtu.be/${id}${t ? `?t=${Math.max(0, Math.floor(t))}` : ''}`;

function parseUrl(text) {
  let s = String(text || '').trim();
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** The 11-character video id from a link, or null. */
export function videoIdFrom(text) {
  const raw = String(text || '').trim();
  if (ID_RE.test(raw)) return raw;
  const u = parseUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const cand = u.pathname.split('/').filter(Boolean)[0] || '';
    return ID_RE.test(cand) ? cand : null;
  }
  if (!HOSTS.has(host)) return null;
  if (u.pathname === '/watch') {
    const v = u.searchParams.get('v') || '';
    return ID_RE.test(v) ? v : null;
  }
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) return ID_RE.test(parts[1]) ? parts[1] : null;
  return null;
}

/** A public playlist id from a link, or null. Watch Later (WL) and Liked (LL) are private and cannot be read. */
export function playlistIdFrom(text) {
  const u = parseUrl(text);
  if (!u || !HOSTS.has(u.hostname.toLowerCase())) return null;
  const list = u.searchParams.get('list') || '';
  return PLAYLIST_RE.test(list) && !['WL', 'LL'].includes(list) ? list : null;
}

/** A bare token is taken as an id only if it looks like one (mixed case, a digit, - or _), so "information" is not a video. */
function plausibleBareId(tok) {
  return ID_RE.test(tok) && (/[0-9_-]/.test(tok) || (/[a-z]/.test(tok) && /[A-Z]/.test(tok)));
}

/** Minimal CSV row splitter for the header check and the "Video ID" column. */
function csvCells(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Everything found in `text`.
 * Returns {videos: [{id, url}], playlists: [id], watchLater: bool, skipped: n}, in first-seen order, without duplicates.
 */
export function extractLinks(text) {
  const src = String(text || '');
  const videos = new Map();
  const playlists = new Set();
  let skipped = 0;
  let watchLater = false;
  const add = (id) => { if (!videos.has(id)) videos.set(id, { id, url: watchUrl(id) }); };

  // Google Takeout playlist CSV: a header row with a "Video ID" column.
  const lines = src.split(/\r?\n/);
  const headerAt = lines.findIndex((l) => /(^|,)\s*"?video id"?\s*(,|$)/i.test(l));
  if (headerAt >= 0) {
    const col = csvCells(lines[headerAt]).findIndex((c) => c.toLowerCase() === 'video id');
    for (const line of lines.slice(headerAt + 1)) {
      const cell = csvCells(line)[col] || '';
      if (ID_RE.test(cell)) add(cell);
      else if (line.trim()) skipped++;
    }
  }
  // Takeout or API JSON: "videoId": "…"
  for (const m of src.matchAll(/"video_?id"\s*:\s*"([A-Za-z0-9_-]{11})"/gi)) add(m[1]);

  for (const tok of src.split(/[\s,;"'<>()[\]{}|]+/)) {
    if (!tok) continue;
    const looksLikeUrl = /[./]/.test(tok);
    if (looksLikeUrl) {
      const id = videoIdFrom(tok);
      const pl = playlistIdFrom(tok);
      if (/[?&]list=(WL|LL)\b/.test(tok)) watchLater = true;
      if (id) add(id);
      if (pl) playlists.add(pl);
      if (!id && !pl && /youtu/i.test(tok) && !/[?&]list=(WL|LL)\b/.test(tok)) skipped++;
    } else if (headerAt < 0 && plausibleBareId(tok)) {
      add(tok);
    }
  }
  return { videos: [...videos.values()], playlists: [...playlists], watchLater, skipped };
}
