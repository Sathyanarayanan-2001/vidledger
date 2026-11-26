"""Browser tests of the dashboard with Playwright (Chromium).

Run:  python -m pytest tests/e2e -q
The GitHub API is replaced by a fake inside the browser (page.route), so the
real flows (connect, save records, start the agent, follow the run) run offline.
"""

from __future__ import annotations

import base64
import functools
import http.server
import json
import os
import socketserver
import threading
from pathlib import Path

import pytest

pw = pytest.importorskip("playwright.sync_api")
ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs"
TOKEN = "github_pat_" + "A1" * 20
REPO = "sample-owner/vidledger-data"
ROUTES = ["home", "add", "decide", "library", "revise", "topics", "stats", "activity", "settings", "guide",
          "video/demoLVRT001", "video/demoTamil03", "video/demoMusic09", "video/demoPriv014", "video/demoNew0013", "video/demoTalk008",
          "topic/wind-grid-integration"]


@pytest.fixture(scope="session")
def base_url():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(DOCS)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}/"
    httpd.shutdown()


@pytest.fixture(scope="session")
def browser():
    with pw.sync_playwright() as p:
        path = os.environ.get("CHROME_PATH") or ("/usr/bin/google-chrome" if Path("/usr/bin/google-chrome").exists() else None)
        try:
            b = p.chromium.launch(executable_path=path) if path else p.chromium.launch()
        except Exception as exc:  # no browser installed
            pytest.skip(f"no Chromium available: {exc}")
        yield b
        b.close()


def open_page(browser, base_url, *, width=1280, scheme="light"):
    ctx = browser.new_context(viewport={"width": width, "height": 900}, color_scheme=scheme)
    page = ctx.new_page()
    page.errors = []
    page.on("pageerror", lambda e: page.errors.append(str(e)))
    page.on("console", lambda m: page.errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
    page.route("https://i.ytimg.com/**", lambda r: r.abort())
    return page


def start_demo(page, base_url):
    page.goto(base_url + "#/connect")
    page.get_by_role("button", name="Try the demo").click()
    page.wait_for_selector("text=need your decision")


@pytest.mark.parametrize("width,scheme", [(1280, "light"), (390, "dark")])
def test_every_view_renders(browser, base_url, width, scheme):
    page = open_page(browser, base_url, width=width, scheme=scheme)
    start_demo(page, base_url)
    for route in ROUTES:
        page.goto(base_url + "#/" + route)
        page.wait_for_timeout(250)
        assert page.locator("#view").inner_text().strip(), route
        overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        assert overflow <= 1, f"{route} scrolls sideways by {overflow}px at {width}px"
    assert page.errors == []
    page.context.close()


def test_pack_tabs_and_transcript(browser, base_url):
    page = open_page(browser, base_url)
    start_demo(page, base_url)
    page.goto(base_url + "#/video/demoTamil03")
    for tab in ["Notes", "Visual notes", "Mind map", "Glossary & references", "Practise", "Reviewer checklist", "Transcript"]:
        page.get_by_role("tab", name=tab, exact=True).click()
    page.get_by_role("button", name="English", exact=True).click()
    text = page.locator(".transcript").text_content()
    assert "This rectangle-like area" in text and "இந்த" not in text
    page.get_by_placeholder("Search the transcript").fill("statcom")
    assert page.locator(".tr-line").count() == 1
    assert page.errors == []
    page.context.close()


def test_decide_and_revise_in_demo(browser, base_url):
    page = open_page(browser, base_url)
    start_demo(page, base_url)
    page.goto(base_url + "#/decide")
    first = page.locator(".card.decide").first
    first.get_by_role("radio", name="Drop").click()
    first.get_by_role("button", name="Confirm").click()
    page.wait_for_function("() => document.querySelectorAll('.card.decide').length === 3", timeout=5000)
    page.goto(base_url + "#/revise")
    page.get_by_role("button", name="Start", exact=True).click()
    page.keyboard.press("Space")
    page.keyboard.press("3")
    page.wait_for_function("() => document.querySelector('.flashcard') && document.querySelector('.flashcard').innerText.startsWith('2 of')", timeout=5000)
    assert page.errors == []
    page.context.close()


def b64(obj) -> str:
    return base64.b64encode(json.dumps(obj).encode()).decode()


def test_connected_flow_saves_records_and_starts_agent(browser, base_url):
    page = open_page(browser, base_url)
    lib = json.loads((DOCS / "demo" / "library.json").read_text(encoding="utf-8"))
    lib["videos"] = lib["videos"][:2]
    state = {"records": None, "dispatched": None, "refs": []}

    def api(route):
        req = route.request
        url = req.url
        if url.endswith(f"/repos/{REPO}"):
            return route.fulfill(json={"private": True, "full_name": REPO})
        if "/contents/library.json" in url:
            return route.fulfill(body=json.dumps(lib), headers={"ETag": '"lib1"', "Content-Type": "application/json"})
        if "/contents/cards.json" in url:
            return route.fulfill(status=404, json={"message": "Not Found"})
        if "/contents/records.json" in url and req.method == "GET":
            if state["records"] is None:
                return route.fulfill(status=404, json={"message": "Not Found"})
            return route.fulfill(json={"sha": "s1", "encoding": "base64", "content": b64(state["records"])})
        if "/contents/records.json" in url and req.method == "PUT":
            if not state["refs"]:  # like GitHub: the branch does not exist before the first save
                return route.fulfill(status=404, json={"message": "Branch vidledger-user not found"})
            body = json.loads(req.post_data)
            state["records"] = json.loads(base64.b64decode(body["content"]).decode())
            return route.fulfill(json={"content": {"sha": "s2"}})
        if "/git/blobs" in url:
            state["records"] = json.loads(json.loads(req.post_data)["content"])
            return route.fulfill(status=201, json={"sha": "b1"})
        if "/git/trees" in url or "/git/commits" in url:
            return route.fulfill(status=201, json={"sha": "t1"})
        if "/git/refs" in url:
            state["refs"].append(json.loads(req.post_data)["ref"])
            return route.fulfill(status=201, json={"ref": "x"})
        if "/dispatches" in url:
            state["dispatched"] = json.loads(req.post_data)["inputs"]["run_id"]
            return route.fulfill(status=204, body="")
        if "/actions/workflows/agent.yml/runs" in url:
            return route.fulfill(json={"workflow_runs": [{"id": 7, "display_title": f"VidLedger agent {state['dispatched']}", "html_url": "https://github.com/x/runs/7"}]})
        if "/actions/runs/7" in url:
            return route.fulfill(json={"id": 7, "status": "completed", "conclusion": "success", "html_url": "https://github.com/x/runs/7"})
        return route.fulfill(status=404, json={"message": "Not Found"})

    page.route("https://api.github.com/**", api)
    page.goto(base_url + "#/connect")
    page.get_by_label("Repository").fill(REPO)
    page.get_by_label("Fine-grained token").fill(TOKEN)
    page.get_by_role("button", name="Connect").click()
    page.wait_for_selector("text=Learn from your backlog")
    page.goto(base_url + "#/add")
    page.get_by_label("YouTube links").fill("https://youtu.be/dQw4w9WgXcQ")
    page.get_by_role("button", name="Add and process now").click()
    for _ in range(250):  # the agent run is followed with real timers: wait until it has finished
        page.wait_for_timeout(200)
        if state["dispatched"] and "finished" in page.locator("#toasts").inner_text():
            break
    assert "refs/heads/vidledger-user" in state["refs"]
    assert "v:dQw4w9WgXcQ" in state["records"]["records"]
    assert state["dispatched"] and state["dispatched"].startswith("r-")
    page.goto(base_url + "#/activity")
    assert "Loading the new library" in page.locator("#view").inner_text()
    assert page.errors == []
    page.context.close()
