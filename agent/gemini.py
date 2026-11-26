"""Gemini API client: one JSON-schema request, with clear error kinds.

The agent calls generateContent over plain HTTPS. A YouTube URL goes in as a
fileData part, so Gemini watches the video itself (audio and frames); nothing
is downloaded on the runner.

Error kinds tell the caller what to do next:
  auth, config       -> stop the run; the user must fix a secret or variable
  quota_day          -> stop the run; Google's daily quota resets at midnight Pacific
  rate               -> stop the run after waiting did not help; the next run continues
  access             -> this video cannot be read (private, unlisted, removed); do not retry
  blocked            -> Gemini refused or stopped (safety, recitation); do not retry
  truncated          -> the answer hit the output limit; the caller asks for less
  too_long           -> the video is too long for one request at this setting
  invalid_output     -> not valid JSON; the caller may retry once
  server, invalid_request -> retry on a later run
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from . import http

API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
STOP_RUN = frozenset({"auth", "config", "quota_day", "rate"})
NO_RETRY = frozenset({"access", "blocked"})

# Google documents two spellings for a JSON-schema response. The newer
# responseFormat is tried first; if the endpoint rejects it, every later call in
# this process uses responseMimeType + responseJsonSchema instead.
_FORMAT = {"mode": "new"}


class GeminiError(Exception):
    def __init__(self, kind: str, message: str, status: int = 0):
        super().__init__(message)
        self.kind = kind
        self.status = status
        self.message = message


@dataclass
class Usage:
    prompt_tokens: int = 0
    output_tokens: int = 0

    def add(self, other: "Usage") -> None:
        self.prompt_tokens += other.prompt_tokens
        self.output_tokens += other.output_tokens


def video_part(url: str, *, start: float | None = None, end: float | None = None, fps: float | None = None) -> dict:
    """A YouTube video as a request part, optionally clipped (seconds) and sampled at `fps` frames per second."""
    part: dict[str, Any] = {"fileData": {"fileUri": url}}
    meta: dict[str, Any] = {}
    if start is not None:
        meta["startOffset"] = f"{max(0, int(start))}s"
    if end is not None:
        meta["endOffset"] = f"{max(1, int(end))}s"
    if fps:
        meta["fps"] = round(float(fps), 3)
    if meta:
        part["videoMetadata"] = meta
    return part


def text_part(text: str) -> dict:
    return {"text": text}


def _details(body: Any) -> list[dict]:
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        d = body["error"].get("details")
        return [x for x in d if isinstance(x, dict)] if isinstance(d, list) else []
    return []


def _is_daily_quota(exc: http.HttpError) -> bool:
    text = (exc.message or "").lower()
    if "per day" in text or "perday" in text or "daily" in text:
        return True
    for d in _details(exc.body):
        for v in d.get("violations") or []:
            if isinstance(v, dict) and "perday" in str(v.get("quotaId", "")).lower():
                return True
    return False


def _retry_delay(exc: http.HttpError, attempt: int) -> float:
    for d in _details(exc.body):
        m = re.match(r"^(\d+(?:\.\d+)?)s$", str(d.get("retryDelay", "")))
        if m:
            return min(float(m.group(1)) + 1, 120.0)
    ra = exc.headers.get("retry-after", "") if exc.headers else ""
    if ra.strip().isdigit():
        return min(float(ra), 120.0)
    return min(15.0 * (2 ** attempt), 120.0)


def classify_http_error(exc: http.HttpError) -> GeminiError:
    msg = (exc.message or "").strip()
    low = msg.lower()
    if exc.status == 429:
        if _is_daily_quota(exc):
            return GeminiError("quota_day", "Gemini's daily quota is used up. The agent continues after it resets at midnight Pacific time (13:30 IST).", 429)
        return GeminiError("rate", "Gemini asked us to slow down (rate limit). The next run continues where this one stopped.", 429)
    if exc.status in (401, 403):
        if "location" in low and "not supported" in low:
            return GeminiError("auth", "Gemini is not available from the runner's region for this key.", exc.status)
        return GeminiError("auth", "Gemini rejected the API key. Check the GEMINI_API_KEY secret in the private repository.", exc.status)
    if exc.status == 404:
        return GeminiError("config", f"Gemini does not know this model. Set the repository variable VIDLEDGER_MODEL to a current model id. ({msg[:160]})", 404)
    if exc.status == 400:
        if "api key" in low or "api_key" in low:
            return GeminiError("auth", "Gemini rejected the API key. Check the GEMINI_API_KEY secret.", 400)
        if any(s in low for s in ("youtube", "file_uri", "fileuri", "not accessible", "private", "unlisted", "unavailable",
                                  "cannot fetch", "could not fetch", "failed to fetch", "invalid video", "unsupported video")):
            return GeminiError("access", "Gemini could not open this video. It may be private, unlisted, age-restricted or removed; Gemini only reads public videos.", 400)
        if "token" in low and any(s in low for s in ("exceed", "too long", "too large", "maximum", "limit")):
            return GeminiError("too_long", "The video is too long for one Gemini request at this setting.", 400)
        return GeminiError("invalid_request", f"Gemini refused the request: {msg[:200]}", 400)
    if exc.status == 0:
        return GeminiError("server", "No connection to Gemini; the next run will retry.", 0)
    return GeminiError("server", f"Gemini had a server problem (HTTP {exc.status}); the next run will retry.", exc.status)


def _format_rejected(exc: http.HttpError) -> bool:
    low = (exc.message or "").lower()
    return exc.status == 400 and ("responseformat" in low or "response_format" in low
                                  or ("unknown name" in low and "generation" in low) or "invalid json payload" in low)


def _strip_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    return t


def parse_response(data: Any) -> tuple[Any, Usage]:
    if not isinstance(data, dict):
        raise GeminiError("invalid_output", "Gemini returned an empty answer.")
    um = data.get("usageMetadata") or {}
    usage = Usage(int(um.get("promptTokenCount") or 0), int(um.get("candidatesTokenCount") or 0) + int(um.get("thoughtsTokenCount") or 0))
    block = (data.get("promptFeedback") or {}).get("blockReason")
    if block:
        raise GeminiError("blocked", f"Gemini refused this request ({block}).")
    cands = data.get("candidates") or []
    if not cands:
        raise GeminiError("invalid_output", "Gemini returned no answer.")
    cand = cands[0] if isinstance(cands[0], dict) else {}
    reason = str(cand.get("finishReason") or "")
    parts = ((cand.get("content") or {}).get("parts")) or []
    text = "".join(str(p.get("text", "")) for p in parts if isinstance(p, dict) and not p.get("thought"))
    if reason == "MAX_TOKENS":
        raise GeminiError("truncated", "Gemini's answer hit the output limit.")
    if reason == "RECITATION":
        raise GeminiError("blocked", "Gemini stopped because the words matched published material (for example song lyrics).")
    if reason in {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY"}:
        raise GeminiError("blocked", f"Gemini declined this video ({reason.lower()}).")
    if not text.strip():
        raise GeminiError("invalid_output", f"Gemini returned an empty answer ({reason or 'no reason given'}).")
    try:
        return json.loads(_strip_fences(text)), usage
    except json.JSONDecodeError:
        raise GeminiError("invalid_output", "Gemini's answer was not valid JSON.") from None


def generate_json(
    key: str,
    model: str,
    parts: list[dict],
    schema: dict,
    *,
    system: str,
    temperature: float = 0.2,
    max_output_tokens: int = 65536,
    media_resolution: str | None = None,
    timeout: float = 900.0,
    attempts: int = 4,
) -> tuple[Any, Usage]:
    """One request; returns (parsed JSON, usage) or raises GeminiError."""
    url = API.format(model=model)
    for attempt in range(attempts):
        gen: dict[str, Any] = {"temperature": temperature, "maxOutputTokens": max_output_tokens}
        if media_resolution:
            gen["mediaResolution"] = media_resolution
        if _FORMAT["mode"] == "new":
            gen["responseFormat"] = {"text": {"mimeType": "APPLICATION_JSON", "schema": schema}}
        else:
            gen["responseMimeType"] = "application/json"
            gen["responseJsonSchema"] = schema
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": gen,
        }
        try:
            resp = http.request("POST", url, headers={"x-goog-api-key": key}, json_body=body, timeout=timeout,
                                retries=2, retry_statuses={500, 502, 503, 504})
        except http.HttpError as exc:
            if _format_rejected(exc) and _FORMAT["mode"] == "new":
                _FORMAT["mode"] = "legacy"
                continue
            err = classify_http_error(exc)
            if err.kind == "rate" and attempt < attempts - 1:
                http.sleep(_retry_delay(exc, attempt))
                continue
            raise err from None
        return parse_response(resp.json())
    raise GeminiError("rate", "Gemini kept asking us to slow down. The next run continues where this one stopped.", 429)
