"""Unit tests: YouTube parsing, Gemini responses and errors, validation, planning and budget."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from agent import gemini, http, jobs, markdown, validate, youtube
from agent.config import ConfigError, load_settings
from conftest import error_reply, gemini_reply, prompt_text


# ---------------------------------------------------------------- youtube

@pytest.mark.parametrize("text,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"),
    ("youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/live/dQw4w9WgXcQ?si=x", "dQw4w9WgXcQ"),
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://evil.example/watch?v=dQw4w9WgXcQ", None),
    ("https://www.youtube.com/watch?v=short", None),
    ("not a link", None),
])
def test_video_id(text, expected):
    assert youtube.video_id(text) == expected


def test_playlist_id_skips_private_lists():
    assert youtube.playlist_id("https://www.youtube.com/playlist?list=PLabcdefghijkl") == "PLabcdefghijkl"
    assert youtube.playlist_id("https://www.youtube.com/playlist?list=WL") is None
    assert youtube.playlist_id("https://example.com/playlist?list=PLabcdefghijkl") is None


@pytest.mark.parametrize("iso,secs", [("PT1H2M3S", 3723), ("PT45S", 45), ("PT10M", 600), ("P1DT1S", 86401), ("", None), ("PT", None)])
def test_parse_duration(iso, secs):
    assert youtube.parse_duration(iso) == secs


def test_metadata_flags_missing_and_masks_key(fake_net):
    fake_net.on(lambda c: "/videos" in c["url"], http.Response(200, b'{"items":[{"id":"aaaaaaaaaaa","snippet":{"title":"T","channelTitle":"C","publishedAt":"2025-01-02T00:00:00Z"},"contentDetails":{"duration":"PT5M","caption":"true"},"status":{"privacyStatus":"unlisted"}}]}', {}))
    out = youtube.fetch_metadata(["aaaaaaaaaaa", "bbbbbbbbbbb"], "SECRETKEY")
    assert out["aaaaaaaaaaa"].duration_s == 300 and out["aaaaaaaaaaa"].privacy == "unlisted" and out["aaaaaaaaaaa"].captions is True
    assert out["aaaaaaaaaaa"].published == "2025-01-02"
    assert out["bbbbbbbbbbb"].privacy == "missing"


def test_oembed_private(fake_net):
    fake_net.on(lambda c: "oembed" in c["url"], http.Response(401, b"Unauthorized", {}))
    assert youtube.oembed("aaaaaaaaaaa").privacy == "private"


# ---------------------------------------------------------------- gemini

def test_parse_response_strips_fences_and_thoughts():
    data = {"candidates": [{"content": {"parts": [{"text": "thinking", "thought": True}, {"text": '```json\n{"a": 1}\n```'}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 2, "thoughtsTokenCount": 3}}
    obj, usage = gemini.parse_response(data)
    assert obj == {"a": 1} and usage.prompt_tokens == 5 and usage.output_tokens == 5


@pytest.mark.parametrize("finish,kind", [("MAX_TOKENS", "truncated"), ("RECITATION", "blocked"), ("SAFETY", "blocked")])
def test_parse_response_finish_reasons(finish, kind):
    with pytest.raises(gemini.GeminiError) as e:
        gemini.parse_response({"candidates": [{"content": {"parts": [{"text": "{"}]}, "finishReason": finish}]})
    assert e.value.kind == kind


def test_parse_response_invalid_json():
    with pytest.raises(gemini.GeminiError) as e:
        gemini.parse_response({"candidates": [{"content": {"parts": [{"text": "not json"}]}, "finishReason": "STOP"}]})
    assert e.value.kind == "invalid_output"


@pytest.mark.parametrize("status,msg,details,kind", [
    (429, "Quota exceeded", [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}], "quota_day"),
    (429, "Resource exhausted, please retry", [], "rate"),
    (400, "Cannot fetch content from the provided URL: the video is private", [], "access"),
    (400, "The input token count exceeds the maximum number of tokens allowed", [], "too_long"),
    (403, "Permission denied", [], "auth"),
    (404, "models/gemini-x is not found", [], "config"),
    (503, "overloaded", [], "server"),
])
def test_classify_http_error(status, msg, details, kind):
    exc = http.HttpError(status, msg, "", {"error": {"message": msg, "details": details}})
    assert gemini.classify_http_error(exc).kind == kind


def test_format_fallback_to_legacy_fields(fake_net):
    replies = iter([error_reply(400, 'Invalid JSON payload received. Unknown name "responseFormat" at \'generation_config\''),
                    gemini_reply({"ok": True})])
    fake_net.on(lambda c: "generateContent" in c["url"], lambda c: next(replies))
    obj, _ = gemini.generate_json("k", "m", [gemini.text_part("hi")], {"type": "object"}, system="s")
    assert obj == {"ok": True}
    first, second = fake_net.calls
    assert "responseFormat" in first["body"]["generationConfig"]
    assert second["body"]["generationConfig"]["responseJsonSchema"] == {"type": "object"}
    assert gemini._FORMAT["mode"] == "legacy"


def test_rate_limit_waits_then_succeeds(fake_net):
    replies = iter([error_reply(429, "slow down", "RESOURCE_EXHAUSTED", [{"retryDelay": "7s"}]), gemini_reply({"x": 1})])
    fake_net.on(lambda c: True, lambda c: next(replies))
    slept = []
    http.set_transport(opener=fake_net, sleep=slept.append)
    obj, _ = gemini.generate_json("k", "m", [gemini.text_part("hi")], {}, system="s")
    assert obj == {"x": 1} and slept == [8.0]


def test_video_part_clip_and_fps():
    p = gemini.video_part("https://www.youtube.com/watch?v=aaaaaaaaaaa", start=0, end=300, fps=0.2)
    assert p == {"fileData": {"fileUri": "https://www.youtube.com/watch?v=aaaaaaaaaaa"}, "videoMetadata": {"startOffset": "0s", "endOffset": "300s", "fps": 0.2}}


# ---------------------------------------------------------------- validate

TOPICS = ["Wind & grid integration", "Personal finance", "Entertainment - music"]


def test_triage_requires_access():
    with pytest.raises(validate.NotAccessed):
        validate.triage({"accessed": False}, 100, TOPICS)


def test_triage_normalises_action_and_topic():
    out = validate.triage({"accessed": True, "category": "Entertainment", "action": "deep", "topic": "wind & GRID integration",
                           "worth_it": 9, "priority": 0, "languages": ["TA", "en", "xx-123456789"], "published": "2025-13"}, 600, TOPICS)
    assert out["action"] == "review" and out["topic"] == "Wind & grid integration" and not out["topic_is_new"]
    assert out["worth_it"] == 5 and out["priority"] == 1 and out["languages"] == ["ta", "en"] and out["published"] == ""


def test_transcript_part_clamps_and_drops_out_of_range():
    raw = {"accessed": True, "covered_until": 700, "lines": [
        {"t": 650, "sp": "", "lang": "ta", "text": "வணக்கம் everyone", "en": "Hello everyone", "unsure": False},
        {"t": 10, "sp": "", "lang": "en", "text": "outside the part", "en": "", "unsure": False},
        {"t": 610, "sp": "S1", "lang": "en", "text": "grid code (?)", "en": "grid code (?)", "unsure": False},
        {"t": 620, "sp": "", "lang": "", "text": "[music]", "en": "music", "unsure": False},
    ], "screens": [{"t": 615, "type": "slide", "title": "LVRT curve"}, {"t": 9999, "type": "nope", "title": "x"}]}
    lines, screens, covered = validate.transcript_part(raw, 600, 900, 900)
    assert [ln["t"] for ln in lines] == [610, 620, 650]
    assert lines[0]["unsure"] and lines[0]["en"] == "" and lines[1]["en"] == ""
    assert lines[2]["en"] == "Hello everyone"
    assert screens == [{"t": 615, "type": "slide", "title": "LVRT curve"}]
    assert covered == 700


def test_pack_card_ids_are_stable_and_deduplicated():
    raw = {"flashcards": [{"front": "What is SCR?", "back": "Short-circuit ratio", "t": 5},
                          {"front": "what is  SCR?", "back": "dup", "t": 9},
                          {"front": "", "back": "x", "t": 1}],
           "rewatch": [{"start": 100, "end": 50, "why": "w"}], "quiz": [{"q": "Q", "options": ["a", "b"], "answer": 7, "explain": ""}]}
    p = validate.pack(raw, 1000, TOPICS, "Wind & grid integration")
    assert len(p["flashcards"]) == 1 and p["flashcards"][0]["id"] == validate.card_id("What is SCR?")
    assert p["rewatch"][0]["end"] > p["rewatch"][0]["start"]
    assert p["quiz"][0]["answer"] == 1 and p["topic"] == "Wind & grid integration"


def test_guide_drops_unknown_video_ids():
    g = validate.guide({"concepts": [{"name": "LVRT", "explanation": "x", "best": {"video_id": "zzzzzzzzzzz", "t": 5}, "disagreements": ""}],
                        "path": [{"video_id": "aaaaaaaaaaa", "start": 10, "end": 70, "why": "w"}, {"video_id": "nope", "start": 0, "end": 5, "why": ""}]},
                       {"aaaaaaaaaaa": 600})
    assert g["concepts"][0]["best"] is None and len(g["path"]) == 1 and g["path_minutes"] == 1


# ---------------------------------------------------------------- jobs and budget

def test_budget_resets_on_a_new_pacific_day():
    now = datetime(2026, 11, 26, 9, 0, tzinfo=timezone.utc)  # 01:00 Pacific on 26/11
    b = jobs.Budget({"day": "2026-11-25", "used_s": 9999}, 3600, now)
    assert b.day == "2026-11-26" and b.used_s == 0
    assert b.reserve(3000) and not b.reserve(700)
    b.release(1000)
    assert b.remaining() == 1600
    assert jobs.next_reset(now) == "2026-11-27T08:00:00Z"


def test_plan_orders_triage_first_and_respects_requests():
    lib = {"videos": [
        {"id": "aaaaaaaaaaa", "triage": None},
        {"id": "bbbbbbbbbbb", "triage": {"priority": 1}, "triage_job": {"state": "done", "req": "auto"}},
        {"id": "ccccccccccc", "triage": {"priority": 4}, "triage_job": {"state": "done", "req": "auto"},
         "learn": {"state": "failed", "req": "t1", "kind": "access", "attempts": 1}},
        {"id": "ddddddddddd", "triage": {"priority": 2}, "triage_job": {"state": "done", "req": "auto"},
         "learn": {"state": "failed", "req": "t1", "kind": "server", "attempts": 3}},
    ], "guides": []}
    recs = {"j:bbbbbbbbbbb:learn": {"at": "t1"}, "j:ccccccccccc:learn": {"at": "t1"}, "j:ddddddddddd:learn": {"at": "t1"},
            "g:wind": {"topic": "Wind", "at": "g1"}}
    plan = jobs.plan(lib, recs, exact_meta=False)
    assert [(j.op, j.key) for j in plan] == [("triage", "aaaaaaaaaaa"), ("learn", "bbbbbbbbbbb"), ("guide", "wind")]


def test_settings_validate_numbers():
    with pytest.raises(ConfigError):
        load_settings({"VIDLEDGER_DAILY_VIDEO_HOURS": "lots"})
    s = load_settings({"VIDLEDGER_DAILY_VIDEO_HOURS": "2", "GEMINI_API_KEY": " k "})
    assert s.daily_video_seconds == 7200 and s.gemini_key == "k"


# ---------------------------------------------------------------- markdown

def test_learning_markdown_has_every_section():
    v = {"id": "aaaaaaaaaaa", "title": "LVRT basics", "duration_s": 600, "triage": {"languages": ["en"]}}
    pack = validate.pack({"tldr": ["x"], "flashcards": [{"front": 'Say "hi"', "back": "b", "t": 3}],
                          "mindmap": {"root": "Root (main)", "branches": [{"label": "A [1]", "t": 5, "leaves": [{"label": "leaf: x", "t": 6}]}]}},
                         600, TOPICS, "Wind & grid integration")
    md = markdown.learning_markdown(v, pack, [{"t": 1, "sp": "", "text": "hello", "en": "", "unsure": True}], "2026-11-26", "m")
    for n in range(18):
        assert f"## {n}. " in md
    assert '"Say ""hi"""' in md and "root((Root main))" in md and "[00:01](https://youtu.be/aaaaaaaaaaa?t=1)" in md
