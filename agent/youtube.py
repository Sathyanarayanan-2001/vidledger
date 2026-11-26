"""YouTube helpers: parse ids, read metadata, expand playlists.

Metadata comes from the YouTube Data API when YOUTUBE_API_KEY is set (exact
duration, publish date, privacy, captions). Without it the agent falls back to
oEmbed, which needs no key and gives the title and channel; Gemini then reports
the duration during triage.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass, field

from . import http

ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
PLAYLIST_RE = re.compile(r"^[A-Za-z0-9_-]{12,64}$")
DURATION_RE = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")
HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"}
DATA_API = "https://www.googleapis.com/youtube/v3"


def video_id(text: str) -> str | None:
    """The 11-character id from a URL or a bare id; None if there is none."""
    s = (text or "").strip()
    if ID_RE.match(s):
        return s
    if not re.match(r"^[a-z]+://", s, re.I):
        s = "https://" + s
    try:
        u = urllib.parse.urlparse(s)
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if host == "youtu.be":
        cand = u.path.strip("/").split("/")[0]
        return cand if ID_RE.match(cand) else None
    if host not in HOSTS:
        return None
    q = urllib.parse.parse_qs(u.query)
    if u.path == "/watch" and q.get("v"):
        cand = q["v"][0]
        return cand if ID_RE.match(cand) else None
    parts = [p for p in u.path.split("/") if p]
    if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v", "e"}:
        return parts[1] if ID_RE.match(parts[1]) else None
    return None


def playlist_id(text: str) -> str | None:
    s = (text or "").strip()
    if not re.match(r"^[a-z]+://", s, re.I):
        s = "https://" + s
    try:
        u = urllib.parse.urlparse(s)
    except ValueError:
        return None
    if (u.hostname or "").lower() not in HOSTS:
        return None
    cand = (urllib.parse.parse_qs(u.query).get("list") or [""])[0]
    # Watch Later (WL) and liked videos (LL) are private lists the API cannot read.
    return cand if PLAYLIST_RE.match(cand) and cand not in {"WL", "LL"} else None


def watch_url(vid: str) -> str:
    return f"https://www.youtube.com/watch?v={vid}"


def parse_duration(iso: str) -> int | None:
    """ISO 8601 duration from the Data API (PT1H2M3S) to seconds."""
    m = DURATION_RE.match(iso or "")
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return d * 86400 + h * 3600 + mi * 60 + s


@dataclass
class Meta:
    id: str
    title: str = ""
    channel: str = ""
    published: str = ""
    duration_s: int | None = None
    privacy: str = ""  # public | unlisted | private | missing
    captions: bool | None = None
    language: str = ""
    description: str = ""
    source: str = ""
    error: str = ""
    tags: list[str] = field(default_factory=list)


def _safe(msg: str, key: str | None) -> str:
    return msg.replace(key, "***") if key else msg


def fetch_metadata(ids: list[str], key: str) -> dict[str, Meta]:
    """Data API videos.list, 50 ids per call (1 quota unit each). Missing ids come back as privacy=missing."""
    out: dict[str, Meta] = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i : i + 50]
        try:
            data = http.get_json(f"{DATA_API}/videos", params={
                "part": "snippet,contentDetails,status", "id": ",".join(chunk), "key": key, "maxResults": "50",
            })
        except http.HttpError as exc:
            msg = _safe(exc.message, key)
            for vid in chunk:
                out[vid] = Meta(vid, source="youtube_api", error=f"YouTube Data API: {msg or exc.status}")
            continue
        seen = set()
        for item in data.get("items", []) if isinstance(data, dict) else []:
            vid = item.get("id")
            if not isinstance(vid, str) or vid not in chunk:
                continue
            seen.add(vid)
            sn = item.get("snippet") or {}
            cd = item.get("contentDetails") or {}
            st = item.get("status") or {}
            out[vid] = Meta(
                id=vid,
                title=str(sn.get("title", ""))[:300],
                channel=str(sn.get("channelTitle", ""))[:200],
                published=str(sn.get("publishedAt", ""))[:10],
                duration_s=parse_duration(str(cd.get("duration", ""))),
                privacy=str(st.get("privacyStatus", "")),
                captions=str(cd.get("caption", "")).lower() == "true" if cd.get("caption") is not None else None,
                language=str(sn.get("defaultAudioLanguage") or sn.get("defaultLanguage") or "")[:12],
                description=str(sn.get("description", ""))[:3000],
                tags=[str(t)[:40] for t in (sn.get("tags") or [])[:15]],
                source="youtube_api",
            )
        for vid in chunk:
            if vid not in seen and vid not in out:
                out[vid] = Meta(vid, privacy="missing", source="youtube_api", error="YouTube says this video does not exist or is private.")
    return out


def oembed(vid: str) -> Meta:
    """Title and channel without a key. 401/403 means private; 400/404 means gone."""
    try:
        data = http.get_json("https://www.youtube.com/oembed", params={"url": watch_url(vid), "format": "json"}, retries=2)
    except http.HttpError as exc:
        if exc.status in (401, 403):
            return Meta(vid, privacy="private", source="oembed", error="This video is private, so Gemini cannot watch it.")
        if exc.status in (400, 404):
            return Meta(vid, privacy="missing", source="oembed", error="This video no longer exists on YouTube.")
        return Meta(vid, source="oembed", error=f"Could not read the title (HTTP {exc.status}).")
    if not isinstance(data, dict):
        return Meta(vid, source="oembed")
    return Meta(vid, title=str(data.get("title", ""))[:300], channel=str(data.get("author_name", ""))[:200], source="oembed")


def playlist_items(pid: str, key: str, limit: int = 500) -> tuple[str, list[str], str]:
    """(title, video ids, error) for a public or unlisted playlist."""
    title = ""
    try:
        info = http.get_json(f"{DATA_API}/playlists", params={"part": "snippet", "id": pid, "key": key})
        items = info.get("items") or []
        if not items:
            return "", [], "YouTube could not find this playlist. It may be private."
        title = str((items[0].get("snippet") or {}).get("title", ""))[:200]
        ids: list[str] = []
        token = ""
        while len(ids) < limit:
            params = {"part": "contentDetails", "playlistId": pid, "key": key, "maxResults": "50"}
            if token:
                params["pageToken"] = token
            page = http.get_json(f"{DATA_API}/playlistItems", params=params)
            for it in page.get("items") or []:
                vid = (it.get("contentDetails") or {}).get("videoId")
                if isinstance(vid, str) and ID_RE.match(vid) and vid not in ids:
                    ids.append(vid)
            token = page.get("nextPageToken") or ""
            if not token:
                break
        return title, ids[:limit], ""
    except http.HttpError as exc:
        return title, [], f"YouTube Data API: {_safe(exc.message, key) or exc.status}"
