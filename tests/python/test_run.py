"""End-to-end agent runs against a fake Gemini and a fake YouTube oEmbed."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agent import http, run, state
from conftest import error_reply, gemini_reply, part_range, prompt_text, video_url

A, B, C = "aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"
DUR = {A: 600, B: 1200, C: 240}


def triage_answer(vid):
    if vid == C:
        return {"accessed": True, "evidence": "00:12 a guitar riff", "title": "Song", "channel": "Band", "duration_s": DUR[C], "published": "2024-05-01",
                "languages": ["en"], "category": "Entertainment", "topic": "Entertainment - music", "topic_is_new": False,
                "gives_me": "Relaxing", "worth_it": 4, "action": "review", "priority": 4, "confidence": "high", "why": "Music",
                "outdated": "", "better_watched": True, "tags": ["music"]}
    return {"accessed": True, "evidence": "00:30 a slide with the LVRT curve", "title": f"Video {vid}", "channel": "Grid Academy",
            "duration_s": DUR[vid], "published": "2025-02-03", "languages": ["en"] if vid == A else ["ta", "en"],
            "category": "Learning", "topic": "Wind & grid integration", "topic_is_new": False, "gives_me": "Explain LVRT",
            "worth_it": 5, "action": "deep", "priority": 1 if vid == A else 2, "confidence": "high", "why": "Core to my work",
            "outdated": "", "better_watched": False, "tags": ["lvrt"]}


def transcript_answer(call):
    start, end = part_range(call)
    tamil = B in video_url(call)
    lines = []
    for t in range(start, end, 120):
        if tamil:
            lines.append({"t": t, "sp": "", "lang": "ta", "text": f"இது பகுதி {t}", "en": f"This is part {t}", "unsure": t == start})
        else:
            lines.append({"t": t, "sp": "S1", "lang": "en", "text": f"Line at {t}", "en": "", "unsure": False})
    return {"accessed": True, "lines": lines, "screens": [{"t": start + 5, "type": "slide", "title": f"Slide {start}"}], "covered_until": end}


def pack_answer(call):
    return {"category": "Learning", "topic": "Wind & grid integration", "tags": ["lvrt"], "difficulty": "intermediate", "prerequisites": ["AC basics"],
            "tldr": ["Fault ride-through keeps turbines online."], "rewatch": [{"start": 30, "end": 90, "why": "The curve"}],
            "chapters": [{"t": 0, "title": "Intro"}], "notes": [{"chapter": "Intro", "t": 0, "points": [{"text": "Point", "t": 10}]}],
            "visuals": [{"t": 35, "type": "chart", "title": "LVRT curve", "content": "| t | V |\n|---|---|\n| 0 | 0.15 |", "latex": "", "meaning": "Voltage limit"}],
            "mindmap": {"root": "FRT", "branches": [{"label": "LVRT", "t": 30, "leaves": [{"label": "0.15 pu", "t": 35}]}]},
            "glossary": [{"term": "LVRT", "meaning": "Low-voltage ride-through", "t": 30}],
            "references": [{"kind": "standard", "text": "CEA Technical Standards", "t": 40}], "procedure": [], "claims": [],
            "connections": {"prerequisites": [], "next": ["HVRT"], "related": []}, "apply": ["Check the curve"], "explain_back": ["Why ride through?"],
            "flashcards": [{"front": "What is LVRT?", "back": "Low-voltage ride-through", "t": 30, "kind": "recall"},
                           {"front": "Why ride through faults?", "back": "Grid stability", "t": 50, "kind": "why"}],
            "quiz": [{"q": "LVRT means?", "options": ["Low-voltage ride-through", "Line voltage", "x", "y"], "answer": 0, "explain": "By definition"}],
            "checklist": {"spot_check": [30, 50, 70], "unsure_terms": [], "ambiguous": []}, "added_context": []}


def review_answer(call):
    return {"accessed": True, "evidence": "00:05 intro", "title": "Song", "channel": "Band", "duration_s": DUR[C], "languages": ["en"], "topic": "music",
            "tags": ["calm"], "one_line": "A calm acoustic set.", "worth": "Good for a break.", "suggested_rating": 4, "rating_reason": "Well played",
            "best_moments": [{"t": 60, "text": "Solo"}], "when": "Short break", "minutes": 4, "nuggets": [], "keep": "keep_log", "keep_reason": "Nice"}


def guide_answer(call):
    return {"concepts": [{"name": "LVRT", "explanation": "Ride through dips.", "best": {"video_id": A, "t": 30}, "disagreements": ""}],
            "path": [{"video_id": A, "start": 30, "end": 90, "why": "Best explanation"}], "overlaps": [], "gaps": [{"gap": "HVRT", "query": "HVRT wind"}],
            "glossary": [{"term": "LVRT", "meaning": "x", "video_id": A, "t": 30}], "formulas": [],
            "flashcards": [{"front": "LVRT?", "back": "ride-through", "video_id": A, "t": 30}]}


def route(call):
    text = prompt_text(call)
    vid = video_url(call)[-11:]
    if text.startswith("Triage this"):
        return gemini_reply(triage_answer(vid))
    if text.startswith("Transcribe part"):
        return gemini_reply(transcript_answer(call))
    if text.startswith("Build my learning pack"):
        return gemini_reply(pack_answer(call))
    if text.startswith("Log this entertainment"):
        return gemini_reply(review_answer(call))
    if text.startswith("Build my master study guide"):
        return gemini_reply(guide_answer(call))
    raise AssertionError("unexpected prompt: " + text[:60])


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    st, us = tmp_path / "state", tmp_path / "user"
    st.mkdir()
    us.mkdir()
    monkeypatch.setenv("VIDLEDGER_STATE_DIR", str(st))
    monkeypatch.setenv("VIDLEDGER_USER_DIR", str(us))
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.delenv("YOUTUBE_API_KEY", raising=False)
    monkeypatch.setenv("VIDLEDGER_PARALLEL", "2")
    return st, us


def write_records(us: Path, recs: dict):
    (us / "records.json").write_text(json.dumps({"schema": 1, "records": {k: {"u": 1, "v": v} for k, v in recs.items()}}), encoding="utf-8")


def base_records():
    return {f"v:{v}": {"url": f"https://youtu.be/{v}", "at": "2026-11-26T05:00:00Z"} for v in (A, B, C)} | {
        "cfg:profile": {"about": "Wind energy engineer", "goals": "Grid codes"},
        "cfg:topics": ["Wind & grid integration", "Entertainment - music"],
    }


def install(fake_net):
    fake_net.on(lambda c: "oembed" in c["url"], lambda c: http.Response(200, json.dumps({"title": "From oEmbed", "author_name": "Chan"}).encode(), {}))
    fake_net.on(lambda c: "generateContent" in c["url"], route)


def test_full_pipeline(dirs, fake_net):
    st, us = dirs
    install(fake_net)
    write_records(us, base_records())
    assert run.main() == 0
    lib = json.loads((st / "library.json").read_text())
    assert [v["id"] for v in lib["videos"]] == [A, B, C]
    assert all(v["triage"] for v in lib["videos"]) and lib["videos"][0]["title"] == "From oEmbed"
    assert lib["videos"][0]["duration_s"] == 600 and lib["runs"][-1]["done"]["triage"] == 3
    assert lib["budget"]["used_s"] == 600 + 1200 + 240

    # Second run: the user approved packs for A and B and a review card for C.
    recs = base_records() | {f"j:{A}:learn": {"at": "t1"}, f"j:{B}:learn": {"at": "t1"}, f"j:{C}:review": {"at": "t1"},
                             f"d:{B}": {"action": "deep", "topic": "Power systems"}}
    write_records(us, recs)
    fake_net.calls.clear()
    assert run.main() == 0
    lib = json.loads((st / "library.json").read_text())
    va, vb, vc = lib["videos"]
    assert va["learn"]["state"] == "done" and va["learn"]["parts_total"] == 1 and va["learn"]["cards"] == 2
    assert vb["learn"]["parts_total"] == 2 and vb["learn"]["topic"] == "Power systems"
    assert vc["review"]["state"] == "done" and vc["review"]["keep"] == "keep_log"
    pb = json.loads((st / "packs" / f"{B}.json").read_text())
    assert pb["transcript"]["lines"][0]["en"].startswith("This is part") and pb["transcript"]["lines"][0]["unsure"]
    assert [ln["t"] for ln in pb["transcript"]["lines"]] == sorted(ln["t"] for ln in pb["transcript"]["lines"])
    md = (st / "md" / f"{A}.md").read_text()
    assert "## 17. Transcript" in md and "Line at 0" in md
    assert (st / "md" / f"{C}.md").read_text().count("## ") == 8
    cards = json.loads((st / "cards.json").read_text())
    assert {c["key"] for c in cards["cards"]} >= {f"{A}:" + json.loads((st / "packs" / f"{A}.json").read_text())["pack"]["flashcards"][0]["id"]}
    assert len(cards["quiz"]) == 2
    transcribe_calls = [c for c in fake_net.calls if prompt_text(c).startswith("Transcribe part")]
    assert {c["body"]["contents"][0]["parts"][0]["videoMetadata"]["endOffset"] for c in transcribe_calls} >= {"600s", "1200s"}

    # Third run: nothing new to do, so Gemini is not called at all.
    fake_net.calls.clear()
    assert run.main() == 0
    assert not [c for c in fake_net.calls if "generateContent" in c["url"]]

    # Guide for the topic that holds A.
    write_records(us, recs | {"g:wind-grid-integration": {"topic": "Wind & grid integration", "at": "g1"}})
    assert run.main() == 0
    guide = json.loads((st / "guides" / "wind-grid-integration.json").read_text())
    assert guide["videos"] == [A] and guide["guide"]["path_minutes"] == 1
    lib = json.loads((st / "library.json").read_text())
    assert lib["guides"][0]["state"] == "done" and lib["usage"]


def test_quota_stops_and_resumes_partial_learn(dirs, fake_net):
    st, us = dirs
    install(fake_net)
    write_records(us, base_records())
    run.main()
    write_records(us, base_records() | {f"j:{B}:learn": {"at": "t1"}})
    calls = {"n": 0}

    def flaky(call):
        if prompt_text(call).startswith("Transcribe part 2"):
            calls["n"] += 1
            return error_reply(429, "Quota exceeded for requests per day", "RESOURCE_EXHAUSTED")
        return route(call)

    fake_net.handlers = [h for h in fake_net.handlers if h[1] is not route] + [(lambda c: "generateContent" in c["url"], flaky)]
    assert run.main() == 0
    lib = json.loads((st / "library.json").read_text())
    vb = lib["videos"][1]
    assert vb["learn"]["state"] == "partial" and vb["learn"]["parts_done"] == 1
    assert lib["agent"]["stopped"] == "quota_day" and lib["budget"]["used_s"] >= lib["budget"]["limit_s"]

    # Next day: the budget resets, and the run resumes at part 2 instead of starting over.
    lib["budget"]["day"] = "2000-01-01"
    state.save_library(st / "library.json", lib)
    fake_net.handlers = [h for h in fake_net.handlers if h[1] is not flaky] + [(lambda c: "generateContent" in c["url"], route)]
    fake_net.calls.clear()
    assert run.main() == 0
    parts = [prompt_text(c)[:22] for c in fake_net.calls if prompt_text(c).startswith("Transcribe part")]
    assert parts == ["Transcribe part 2 of 2"]
    assert json.loads((st / "library.json").read_text())["videos"][1]["learn"]["state"] == "done"


def test_inaccessible_video_is_not_retried(dirs, fake_net):
    st, us = dirs
    fake_net.on(lambda c: "oembed" in c["url"], lambda c: http.Response(200, b'{"title":"t"}', {}))
    fake_net.on(lambda c: "generateContent" in c["url"], lambda c: error_reply(400, "Cannot fetch the YouTube video: it is private"))
    write_records(us, {f"v:{A}": {"at": "x"}})
    run.main()
    lib = json.loads((st / "library.json").read_text())
    assert lib["videos"][0]["issue"]["kind"] == "access"
    fake_net.calls.clear()
    run.main()
    assert not [c for c in fake_net.calls if "generateContent" in c["url"]]


def test_removed_video_and_missing_key(dirs, fake_net, monkeypatch):
    st, us = dirs
    install(fake_net)
    write_records(us, base_records())
    run.main()
    assert (st / "library.json").exists()
    recs = base_records()
    del recs[f"v:{C}"]
    write_records(us, recs)
    monkeypatch.delenv("GEMINI_API_KEY")
    assert run.main() == 0
    lib = json.loads((st / "library.json").read_text())
    assert [v["id"] for v in lib["videos"]] == [A, B]
    assert lib["agent"]["ok"] is False and "GEMINI_API_KEY" in lib["agent"]["message"]
