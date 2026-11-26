"""Make the repository root importable, keep tests offline, and provide a fake Gemini."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from agent import gemini, http  # noqa: E402


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    def refuse(req, timeout):
        raise AssertionError(f"unexpected network call to {req.full_url}")

    http.set_transport(opener=refuse, sleep=lambda s: None)
    gemini._FORMAT["mode"] = "new"
    yield
    http.set_transport()
    gemini._FORMAT["mode"] = "new"


def gemini_reply(obj, finish="STOP", prompt_tokens=1000, out_tokens=200) -> http.Response:
    body = {
        "candidates": [{"content": {"parts": [{"text": json.dumps(obj, ensure_ascii=False)}]}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": prompt_tokens, "candidatesTokenCount": out_tokens},
    }
    return http.Response(200, json.dumps(body).encode(), {})


def error_reply(status: int, message: str, status_text: str = "", details=None) -> http.Response:
    body = {"error": {"code": status, "message": message, "status": status_text, "details": details or []}}
    return http.Response(status, json.dumps(body).encode(), {})


class FakeNet:
    """Routes requests by URL and prompt text. Records every request body."""

    def __init__(self):
        self.calls: list[dict] = []
        self.handlers: list = []

    def on(self, predicate, responder):
        self.handlers.append((predicate, responder))
        return self

    def __call__(self, req, timeout):
        body = json.loads(req.data.decode()) if req.data else None
        call = {"url": req.full_url, "body": body, "method": req.get_method()}
        self.calls.append(call)
        for pred, resp in self.handlers:
            if pred(call):
                return resp(call) if callable(resp) else resp
        raise AssertionError(f"no fake for {req.full_url}")


def prompt_text(call) -> str:
    try:
        return "\n".join(p["text"] for p in call["body"]["contents"][0]["parts"] if p.get("text"))
    except (TypeError, KeyError, IndexError):
        return ""


def video_url(call) -> str:
    try:
        for p in call["body"]["contents"][0]["parts"]:
            if "fileData" in p:
                return p["fileData"]["fileUri"]
    except (TypeError, KeyError, IndexError):
        pass
    return ""


def part_range(call) -> tuple[int, int] | None:
    m = re.search(r"\(second (\d+) to second (\d+)\)", prompt_text(call))
    return (int(m.group(1)), int(m.group(2))) if m else None


@pytest.fixture
def fake_net():
    net = FakeNet()
    http.set_transport(opener=net, sleep=lambda s: None)
    return net
