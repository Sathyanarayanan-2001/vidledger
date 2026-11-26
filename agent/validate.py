"""Re-validate everything Gemini returns before it is stored.

The schema constrains shape, but not sense: times can fall outside the video,
enums can drift, lists can be huge. Every field is clamped, trimmed and typed
here, so the dashboard can trust the state file.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from typing import Any

from .config import ACTIONS, CATEGORIES, ENTERTAINMENT_TOPICS
from .prompts import REFERENCE_KINDS, VISUAL_TYPES

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LANG = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NONSPEECH = {"[music]", "[laughter]", "[crosstalk]", "[inaudible]", "[applause]", "[silence]"}


class NotAccessed(Exception):
    """Gemini said it could not watch the video."""


def text(value: Any, limit: int = 500, *, multiline: bool = False) -> str:
    if value is None:
        return ""
    s = _CTRL.sub("", str(value))
    s = unicodedata.normalize("NFC", s)
    if not multiline:
        s = " ".join(s.split())
    else:
        s = "\n".join(line.rstrip() for line in s.strip().splitlines())
    return s[:limit].strip()


def number(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if v == v and v not in (float("inf"), float("-inf")) else default  # NaN and infinities are dropped


def seconds(value: Any, duration: int | None) -> int:
    v = max(0, int(number(value)))
    return min(v, duration) if duration else v


def integer(value: Any, lo: int, hi: int, default: int) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def choice(value: Any, allowed, default: str) -> str:
    v = str(value or "").strip()
    return v if v in allowed else default


def strings(value: Any, max_items: int, limit: int = 200) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for v in value:
        t = text(v, limit)
        if t and t not in out:
            out.append(t)
        if len(out) >= max_items:
            break
    return out


def langs(value: Any) -> list[str]:
    out = []
    for v in value if isinstance(value, list) else []:
        code = str(v or "").strip().lower()[:8]
        if _LANG.match(code) and code not in out:
            out.append(code)
    return out[:6]


def items(value: Any, max_items: int) -> list[dict]:
    return [v for v in value if isinstance(v, dict)][:max_items] if isinstance(value, list) else []


def card_id(front: str) -> str:
    """Stable card id from the question text, so spaced-repetition history survives a re-run."""
    key = " ".join(front.lower().split())
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]


def topic_name(value: Any, topics: list[str]) -> tuple[str, bool]:
    t = text(value, 60)
    for known in topics:
        if t.lower() == known.lower():
            return known, False
    return (t or "Uncategorised"), True


# ---------------------------------------------------------------- triage

def triage(raw: Any, duration: int | None, topics: list[str]) -> dict:
    if not isinstance(raw, dict) or raw.get("accessed") is not True:
        raise NotAccessed("Gemini said it could not watch this video.")
    category = choice(raw.get("category"), CATEGORIES, "Learning")
    topic, is_new = topic_name(raw.get("topic"), topics)
    action = choice(raw.get("action"), ACTIONS, "review" if category == "Entertainment" else "reference")
    if category == "Entertainment" and action in ("deep", "reference"):
        action = "review"
    if category != "Entertainment" and action == "review":
        action = "reference"
    published = text(raw.get("published"), 10)
    return {
        "evidence": text(raw.get("evidence"), 300),
        "title": text(raw.get("title"), 300),
        "channel": text(raw.get("channel"), 200),
        "duration_s": integer(raw.get("duration_s"), 0, 24 * 3600, 0) or None,
        "published": published if _DATE.match(published) else "",
        "languages": langs(raw.get("languages")) or ["en"],
        "category": category,
        "topic": topic,
        "topic_is_new": bool(raw.get("topic_is_new")) or is_new,
        "gives_me": text(raw.get("gives_me"), 300),
        "worth_it": integer(raw.get("worth_it"), 1, 5, 3),
        "action": action,
        "priority": integer(raw.get("priority"), 1, 5, 3),
        "confidence": choice(raw.get("confidence"), ("high", "medium", "low"), "medium"),
        "why": text(raw.get("why"), 300),
        "outdated": text(raw.get("outdated"), 300),
        "better_watched": bool(raw.get("better_watched")),
        "tags": strings(raw.get("tags"), 10, 40),
    }


# ---------------------------------------------------------------- transcript

def transcript_part(raw: Any, start: int, end: int, duration: int | None) -> tuple[list[dict], list[dict], int]:
    if not isinstance(raw, dict) or raw.get("accessed") is False:
        raise NotAccessed("Gemini said it could not hear this video.")
    lines: list[dict] = []
    for ln in items(raw.get("lines"), 6000):
        body = text(ln.get("text"), 2000)
        if not body:
            continue
        raw_t = max(0, int(number(ln.get("t"))))
        if raw_t < start - 5 or raw_t > end + 5:  # outside the part: another part owns it
            continue
        t = seconds(raw_t, duration)
        lang = str(ln.get("lang") or "").strip().lower()[:8]
        en = text(ln.get("en"), 2000)
        nonspeech = body.lower() in _NONSPEECH
        lines.append({
            "t": t,
            "sp": text(ln.get("sp"), 40),
            "lang": lang if _LANG.match(lang) else "",
            "text": body,
            "en": "" if nonspeech or lang == "en" or en == body else en,
            "unsure": bool(ln.get("unsure")) or "(?)" in body,
        })
    lines.sort(key=lambda x: x["t"])
    screens = []
    for sc in items(raw.get("screens"), 400):
        raw_t = max(0, int(number(sc.get("t"))))
        title = text(sc.get("title"), 160)
        if title and start - 5 <= raw_t <= end + 5:
            t = seconds(raw_t, duration)
            screens.append({"t": t, "type": choice(sc.get("type"), VISUAL_TYPES, "other"), "title": title})
    covered = seconds(raw.get("covered_until"), duration) or (lines[-1]["t"] if lines else end)
    return lines, screens, min(max(covered, start), end)


def merge_transcript(existing: list[dict], new: list[dict], start: int) -> list[dict]:
    """Replace whatever an earlier attempt stored from `start` on, keep the rest."""
    return [ln for ln in existing if ln["t"] < start] + new


# ---------------------------------------------------------------- pack

def pack(raw: Any, duration: int | None, topics: list[str], fallback_topic: str) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("The learning pack was empty.")
    d = duration
    topic, _ = topic_name(raw.get("topic") or fallback_topic, topics)

    def ts(v):
        return seconds(v, d)

    cards = []
    seen = set()
    for c in items(raw.get("flashcards"), 40):
        front, back = text(c.get("front"), 400), text(c.get("back"), 800)
        if not front or not back:
            continue
        cid = card_id(front)
        if cid in seen:
            continue
        seen.add(cid)
        cards.append({"id": cid, "front": front, "back": back, "t": ts(c.get("t")),
                      "kind": choice(c.get("kind"), ("recall", "why", "apply"), "recall")})
    quiz = []
    for q in items(raw.get("quiz"), 8):
        opts = strings(q.get("options"), 4, 300)
        if len(opts) < 2 or not text(q.get("q"), 400):
            continue
        quiz.append({"q": text(q.get("q"), 400), "options": opts, "answer": integer(q.get("answer"), 0, len(opts) - 1, 0),
                     "explain": text(q.get("explain"), 400)})
    mm = raw.get("mindmap") if isinstance(raw.get("mindmap"), dict) else {}
    conn = raw.get("connections") if isinstance(raw.get("connections"), dict) else {}
    chk = raw.get("checklist") if isinstance(raw.get("checklist"), dict) else {}
    rewatch = []
    for r in items(raw.get("rewatch"), 4):
        s, e = ts(r.get("start")), ts(r.get("end"))
        if e <= s:
            e = min(s + 60, d) if d else s + 60
        rewatch.append({"start": s, "end": e, "why": text(r.get("why"), 300)})
    return {
        "category": choice(raw.get("category"), CATEGORIES, "Learning"),
        "topic": topic,
        "tags": strings(raw.get("tags"), 10, 40),
        "difficulty": choice(raw.get("difficulty"), ("beginner", "intermediate", "advanced"), "intermediate"),
        "prerequisites": strings(raw.get("prerequisites"), 8),
        "tldr": strings(raw.get("tldr"), 5, 500),
        "rewatch": rewatch,
        "chapters": sorted(({"t": ts(c.get("t")), "title": text(c.get("title"), 160)} for c in items(raw.get("chapters"), 60)
                            if text(c.get("title"), 160)), key=lambda c: c["t"]),
        "notes": [{"chapter": text(n.get("chapter"), 160), "t": ts(n.get("t")),
                   "points": [{"text": text(p.get("text"), 600), "t": ts(p.get("t"))} for p in items(n.get("points"), 30) if text(p.get("text"), 600)]}
                  for n in items(raw.get("notes"), 60)],
        "visuals": [{"t": ts(v.get("t")), "type": choice(v.get("type"), VISUAL_TYPES, "other"), "title": text(v.get("title"), 200),
                     "content": text(v.get("content"), 6000, multiline=True), "latex": text(v.get("latex"), 1000),
                     "meaning": text(v.get("meaning"), 300)}
                    for v in items(raw.get("visuals"), 120) if text(v.get("title"), 200) or text(v.get("content"), 50)],
        "mindmap": {"root": text(mm.get("root"), 160),
                    "branches": [{"label": text(b.get("label"), 120), "t": ts(b.get("t")),
                                  "leaves": [{"label": text(lf.get("label"), 120), "t": ts(lf.get("t"))} for lf in items(b.get("leaves"), 12) if text(lf.get("label"), 120)]}
                                 for b in items(mm.get("branches"), 12) if text(b.get("label"), 120)]},
        "glossary": [{"term": text(g.get("term"), 120), "meaning": text(g.get("meaning"), 600), "t": ts(g.get("t"))}
                     for g in items(raw.get("glossary"), 80) if text(g.get("term"), 120)],
        "references": [{"kind": choice(r.get("kind"), REFERENCE_KINDS, "other"), "text": text(r.get("text"), 400), "t": ts(r.get("t"))}
                       for r in items(raw.get("references"), 120) if text(r.get("text"), 400)],
        "procedure": [{"step": text(p.get("step"), 500), "t": ts(p.get("t"))} for p in items(raw.get("procedure"), 40) if text(p.get("step"), 500)],
        "claims": [{"claim": text(c.get("claim"), 400), "why": text(c.get("why"), 300), "t": ts(c.get("t"))}
                   for c in items(raw.get("claims"), 30) if text(c.get("claim"), 400)],
        "connections": {"prerequisites": strings(conn.get("prerequisites"), 8), "next": strings(conn.get("next"), 8),
                        "related": strings(conn.get("related"), 8)},
        "apply": strings(raw.get("apply"), 4, 400),
        "explain_back": strings(raw.get("explain_back"), 4, 400),
        "flashcards": cards,
        "quiz": quiz,
        "checklist": {"spot_check": [ts(x) for x in (chk.get("spot_check") or [])[:3] if isinstance(x, (int, float))],
                      "unsure_terms": strings(chk.get("unsure_terms"), 10, 120),
                      "ambiguous": [{"t": ts(a.get("t")), "text": text(a.get("text"), 300)} for a in items(chk.get("ambiguous"), 10) if text(a.get("text"), 300)]},
        "added_context": [{"about": text(a.get("about"), 120), "text": text(a.get("text"), 800)} for a in items(raw.get("added_context"), 6) if text(a.get("text"), 800)],
    }


# ---------------------------------------------------------------- review card

def review(raw: Any, duration: int | None) -> dict:
    if not isinstance(raw, dict) or raw.get("accessed") is not True:
        raise NotAccessed("Gemini said it could not watch this video.")
    d = integer(raw.get("duration_s"), 0, 24 * 3600, 0) or duration
    return {
        "evidence": text(raw.get("evidence"), 300),
        "title": text(raw.get("title"), 300),
        "channel": text(raw.get("channel"), 200),
        "duration_s": d or None,
        "languages": langs(raw.get("languages")),
        "topic": choice(raw.get("topic"), ENTERTAINMENT_TOPICS, "other"),
        "tags": strings(raw.get("tags"), 8, 40),
        "one_line": text(raw.get("one_line"), 300),
        "worth": text(raw.get("worth"), 600),
        "suggested_rating": integer(raw.get("suggested_rating"), 1, 5, 3),
        "rating_reason": text(raw.get("rating_reason"), 300),
        "best_moments": [{"t": seconds(m.get("t"), d), "text": text(m.get("text"), 200)} for m in items(raw.get("best_moments"), 5) if text(m.get("text"), 200)],
        "when": text(raw.get("when"), 200),
        "minutes": integer(raw.get("minutes"), 0, 24 * 60, round((d or 0) / 60)),
        "nuggets": [{"t": seconds(m.get("t"), d), "text": text(m.get("text"), 300)} for m in items(raw.get("nuggets"), 5) if text(m.get("text"), 300)],
        "keep": choice(raw.get("keep"), ("keep_rewatch", "keep_log", "drop"), "keep_log"),
        "keep_reason": text(raw.get("keep_reason"), 300),
    }


# ---------------------------------------------------------------- topic guide

def guide(raw: Any, durations: dict[str, int | None]) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("The study guide was empty.")

    def ref(vid: Any, t: Any) -> tuple[str, int] | None:
        v = str(vid or "").strip()
        if v not in durations:
            return None
        return v, seconds(t, durations[v])

    concepts = []
    for c in items(raw.get("concepts"), 20):
        best = c.get("best") if isinstance(c.get("best"), dict) else {}
        r = ref(best.get("video_id"), best.get("t"))
        if not text(c.get("name"), 120):
            continue
        concepts.append({"name": text(c.get("name"), 120), "explanation": text(c.get("explanation"), 1500),
                         "best": {"video_id": r[0], "t": r[1]} if r else None, "disagreements": text(c.get("disagreements"), 600)})
    path = []
    for p in items(raw.get("path"), 20):
        r = ref(p.get("video_id"), p.get("start"))
        if not r:
            continue
        end = seconds(p.get("end"), durations[r[0]])
        path.append({"video_id": r[0], "start": r[1], "end": end if end > r[1] else r[1] + 60, "why": text(p.get("why"), 300)})
    cards = []
    seen = set()
    for c in items(raw.get("flashcards"), 30):
        front, back = text(c.get("front"), 400), text(c.get("back"), 800)
        r = ref(c.get("video_id"), c.get("t"))
        if not front or not back or card_id(front) in seen:
            continue
        seen.add(card_id(front))
        cards.append({"id": card_id(front), "front": front, "back": back, "video_id": r[0] if r else "", "t": r[1] if r else 0})
    return {
        "concepts": concepts,
        "path": path,
        "path_minutes": round(sum(p["end"] - p["start"] for p in path) / 60),
        "overlaps": [{"video_ids": [v for v in strings(o.get("video_ids"), 6, 20) if v in durations], "note": text(o.get("note"), 400),
                      "best_video_id": str(o.get("best_video_id") or "") if str(o.get("best_video_id") or "") in durations else ""}
                     for o in items(raw.get("overlaps"), 10)],
        "gaps": [{"gap": text(g.get("gap"), 200), "query": text(g.get("query"), 120)} for g in items(raw.get("gaps"), 10) if text(g.get("gap"), 200)],
        "glossary": [{"term": text(g.get("term"), 120), "meaning": text(g.get("meaning"), 600),
                      "video_id": (ref(g.get("video_id"), g.get("t")) or ("", 0))[0], "t": (ref(g.get("video_id"), g.get("t")) or ("", 0))[1]}
                     for g in items(raw.get("glossary"), 60) if text(g.get("term"), 120)],
        "formulas": [{"text": text(f.get("text"), 400), "video_id": (ref(f.get("video_id"), f.get("t")) or ("", 0))[0],
                      "t": (ref(f.get("video_id"), f.get("t")) or ("", 0))[1]} for f in items(raw.get("formulas"), 40) if text(f.get("text"), 400)],
        "flashcards": cards,
    }
