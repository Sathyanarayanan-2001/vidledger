"""HTTP with timeouts, retry and exponential backoff, using only the standard library.

The agent has no third-party runtime dependencies at all, so nothing can break
because a package changed. Tests swap the network with set_transport().
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from . import VERSION

RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})


class HttpError(Exception):
    def __init__(self, status: int, message: str, reason: str = "", body: Any = None, headers: dict | None = None):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status
        self.reason = reason
        self.message = message
        self.body = body
        self.headers = headers or {}


@dataclass
class Response:
    status: int
    body: bytes
    headers: dict[str, str]

    def json(self) -> Any:
        return json.loads(self.body.decode("utf-8")) if self.body else {}


Opener = Callable[[urllib.request.Request, float], Response]


def _default_opener(req: urllib.request.Request, timeout: float) -> Response:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - https only, set by callers
            return Response(resp.status, resp.read(), {k.lower(): v for k, v in resp.headers.items()})
    except urllib.error.HTTPError as exc:
        body = exc.read() if hasattr(exc, "read") else b""
        return Response(exc.code, body, {k.lower(): v for k, v in (exc.headers or {}).items()})


_opener: Opener = _default_opener
_sleep: Callable[[float], None] = time.sleep


def set_transport(opener: Opener | None = None, sleep: Callable[[float], None] | None = None) -> None:
    """Swap the network layer (tests use fakes for Gemini and YouTube)."""
    global _opener, _sleep
    _opener = opener or _default_opener
    _sleep = sleep or time.sleep


def sleep(seconds: float) -> None:
    _sleep(seconds)


def _parse_error(resp: Response) -> tuple[str, str, Any]:
    try:
        data = resp.json()
    except (ValueError, UnicodeDecodeError):
        return "", resp.body[:300].decode("utf-8", "replace"), None
    if isinstance(data, dict) and isinstance(data.get("error"), dict):
        err = data["error"]
        return str(err.get("status", "")), str(err.get("message", ""))[:500], data
    return "", "", data


def backoff_delay(attempt: int, retry_after: str | None = None, cap: float = 60.0) -> float:
    """Seconds before retry `attempt` (0-based): Retry-After if numeric, else 2**n plus jitter."""
    if retry_after and retry_after.strip().isdigit():
        return min(float(retry_after.strip()), cap)
    return min((2 ** attempt) + random.random(), cap)


def request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: Any = None,
    timeout: float = 30.0,
    retries: int = 4,
    retry_statuses: Iterable[int] = RETRYABLE_STATUS,
) -> Response:
    """Send a request; retry network errors and `retry_statuses`; raise HttpError on final failure."""
    retry_on = frozenset(retry_statuses)
    data: bytes | None = None
    hdrs = {"Accept": "application/json", "User-Agent": f"vidledger-agent/{VERSION}"}
    hdrs.update(headers or {})
    if json_body is not None:
        data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json; charset=utf-8"
    last: HttpError | None = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            resp = _opener(req, timeout)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as exc:
            last = HttpError(0, f"network error: {exc.__class__.__name__}")
            if attempt < retries:
                _sleep(backoff_delay(attempt))
                continue
            raise last from None
        if 200 <= resp.status < 300:
            return resp
        reason, message, body = _parse_error(resp)
        last = HttpError(resp.status, message or "request failed", reason, body, resp.headers)
        if resp.status in retry_on and attempt < retries:
            _sleep(backoff_delay(attempt, resp.headers.get("retry-after")))
            continue
        raise last
    raise last or HttpError(0, "request failed")


def get_json(url: str, *, params: dict[str, str] | None = None, timeout: float = 20.0, retries: int = 3) -> Any:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    return request("GET", url, timeout=timeout, retries=retries).json()
