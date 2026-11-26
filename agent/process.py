"""The jobs themselves: triage, learn (transcript parts + pack), review, guide.

Each job reads what it needs from the shared context, calls Gemini, validates
the answer, writes its files, and updates the library under a lock. A job that
cannot finish leaves a clear issue on the video and, for learn, keeps the
transcript parts it already has, so the next run resumes instead of starting over.
"""

from __future__ import annotations

import math
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from . import gemini, markdown, prompts, state, validate
from .config import DEFAULT_TOPICS, Settings
from .gemini import GeminiError, Usage
from .jobs import Budget, Job, duration_of
from .youtube import watch_url

LOW = "MEDIA_RESOLUTION_LOW"
HIGH = "MEDIA_RESOLUTION_HIGH"
PART_EN = 1800      # seconds of English speech per transcript request
PART_OTHER = 900    # non-English parts are shorter: the translation doubles the output
MIN_SPLIT = 120     # never split a truncated part below 2 minutes


@dataclass
class Ctx:
    settings: Settings
    lib: dict
    recs: dict
    budget: Budget
    now: datetime
    deadline: float
    usage: Usage = field(default_factory=Usage)
    video_s: int = 0
    lock: threading.RLock = field(default_factory=threading.RLock)
    stop_reason: str = ""
    stop_message: str = ""
    done: dict = field(default_factory=lambda: {"triage": 0, "learn": 0, "review": 0, "guide": 0})
    failed: int = 0
    log: Callable[[str], None] = print

    @property
    def topics(self) -> list[str]:
        t = self.recs.get("cfg:topics")
        clean = [validate.text(x, 60) for x in t] if isinstance(t, list) else []
        return [x for x in clean if x][:40] or list(DEFAULT_TOPICS)

    @property
    def profile(self) -> dict:
        p = self.recs.get("cfg:profile")
        p = p if isinstance(p, dict) else {}
        return {"about": validate.text(p.get("about"), 1500) or "(not provided)", "goals": validate.text(p.get("goals"), 1500) or "(not provided)"}

    def stopped(self) -> bool:
        return bool(self.stop_reason) or time.monotonic() > self.deadline

    def stop(self, reason: str, message: str) -> None:
        with self.lock:
            if not self.stop_reason:
                self.stop_reason, self.stop_message = reason, message

    def save(self) -> None:
        with self.lock:
            self.lib["budget"] = self.budget.to_dict()
            state.save_library(self.settings.library_file, self.lib)

    def video(self, vid: str) -> dict:
        return next(v for v in self.lib["videos"] if v["id"] == vid)

    def spend(self, usage: Usage, seconds: int, job: Job) -> None:
        with self.lock:
            self.usage.add(usage)
            self.video_s += seconds
            job.spent += seconds


class Paused(Exception):
    """The run stopped (time or budget) part-way through a job; the next run resumes it."""


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _meta(v: dict) -> dict:
    return {k: v.get(k) for k in ("title", "channel", "published", "duration_s", "description", "language") if v.get(k)}


def _call(ctx: Ctx, model: str, parts: list[dict], schema: dict, **kw):
    """generate_json with one retry for invalid output."""
    try:
        return gemini.generate_json(ctx.settings.gemini_key, model, parts, schema, system=prompts.SYSTEM, **kw)
    except GeminiError as err:
        if err.kind != "invalid_output":
            raise
        return gemini.generate_json(ctx.settings.gemini_key, model, parts, schema, system=prompts.SYSTEM, temperature=0.1, **kw)


def _fail(ctx: Ctx, job: Job, kind: str, message: str, target: dict) -> None:
    with ctx.lock:
        target.update({"state": "partial" if target.get("state") == "partial" and kind not in gemini.NO_RETRY else "failed",
                       "kind": kind, "error": message, "req": job.req, "at": _now(),
                       "attempts": int(target.get("attempts") or 0) + 1 if target.get("req") == job.req else 1})
        if job.op != "guide":
            ctx.video(job.key)["issue"] = {"op": job.op, "kind": kind, "message": message, "at": _now()}
        ctx.failed += 1
    if kind in gemini.STOP_RUN:
        if kind == "quota_day":
            ctx.budget.exhaust()
        ctx.stop(kind, message)
    ctx.log(f"{job.op} {job.key}: {kind}: {message}")


def _job_state(v: dict, op: str) -> dict:
    key = "triage_job" if op == "triage" else op
    if not isinstance(v.get(key), dict):
        v[key] = {}
    return v[key]


def run_job(ctx: Ctx, job: Job) -> None:
    if ctx.stopped():
        return
    if job.cost_s and not ctx.budget.reserve(job.cost_s):
        ctx.stop("budget", "Today's video budget is used up. The agent continues after midnight Pacific time (13:30 IST).")
        return
    fn = {"triage": triage, "learn": learn, "review": review, "guide": guide}[job.op]
    target = {} if job.op == "guide" else _job_state(ctx.video(job.key), job.op)
    if job.op == "guide":
        with ctx.lock:
            target = next((g for g in ctx.lib["guides"] if g.get("slug") == job.key), None)
            if target is None:
                target = {"slug": job.key}
                ctx.lib["guides"].append(target)
    started = time.monotonic()
    try:
        fn(ctx, job, target)
        with ctx.lock:
            ctx.done[job.op] += 1
            if job.op != "guide":
                v = ctx.video(job.key)
                if (v.get("issue") or {}).get("op") == job.op:
                    v["issue"] = None
        ctx.log(f"{job.op} {job.key}: done in {time.monotonic() - started:.0f} s")
    except validate.NotAccessed as exc:
        _fail(ctx, job, "access", str(exc) + " It may be private, unlisted or removed.", target)
    except GeminiError as err:
        _fail(ctx, job, err.kind, err.message, target)
    except ValueError as exc:
        _fail(ctx, job, "invalid_output", str(exc), target)
    except Paused:
        ctx.log(f"{job.op} {job.key}: paused, resumes next run")
    finally:
        if job.cost_s > job.spent:
            ctx.budget.release(job.cost_s - job.spent)
        ctx.save()


# ---------------------------------------------------------------- triage

def triage(ctx: Ctx, job: Job, target: dict) -> None:
    v = ctx.video(job.key)
    exact = v.get("meta_source") == "youtube_api" and bool(v.get("duration_s"))
    dur = duration_of(v)
    clip = 300 if exact and dur > 420 else None
    part = gemini.video_part(watch_url(v["id"]), start=0 if clip else None, end=clip, fps=0.2 if clip else (0.05 if dur > 1800 else 0.1))
    raw, usage = _call(ctx, ctx.settings.triage_model, [part, gemini.text_part(prompts.triage_prompt(_meta(v), ctx.profile, ctx.topics, clip))],
                       prompts.TRIAGE_SCHEMA, max_output_tokens=4096, media_resolution=LOW, timeout=600)
    tri = validate.triage(raw, v.get("duration_s"), ctx.topics)
    ctx.spend(usage, clip or tri.get("duration_s") or dur, job)
    with ctx.lock:
        for key in ("title", "channel", "published", "duration_s"):
            if not v.get(key) and tri.get(key):
                v[key] = tri[key]
        v["triage"] = tri
        v["languages"] = tri["languages"]
        target.clear()
        target.update({"state": "done", "req": job.req, "at": _now(), "model": ctx.settings.triage_model, "attempts": 0})


# ---------------------------------------------------------------- learn

def _part_ranges(duration: int, languages: list[str]) -> list[tuple[int, int]]:
    size = PART_EN if languages and all(lang == "en" for lang in languages) else PART_OTHER
    n = max(1, math.ceil(duration / size))
    step = math.ceil(duration / n)
    return [(i * step, min(duration, (i + 1) * step)) for i in range(n)]


def _transcribe_range(ctx: Ctx, job: Job, v: dict, start: int, end: int, part: int, parts: int, languages: list[str], duration: int):
    try:
        raw, usage = _call(ctx, ctx.settings.model,
                           [gemini.video_part(watch_url(v["id"]), start=start, end=end, fps=0.1),
                            gemini.text_part(prompts.transcript_prompt(part, parts, start, end, languages, _meta(v)))],
                           prompts.TRANSCRIPT_SCHEMA, media_resolution=LOW)
    except GeminiError as err:
        if err.kind == "truncated" and end - start >= 2 * MIN_SPLIT:
            mid = start + (end - start) // 2
            a = _transcribe_range(ctx, job, v, start, mid, part, parts, languages, duration)
            b = _transcribe_range(ctx, job, v, mid, end, part, parts, languages, duration)
            return a[0] + b[0], a[1] + b[1]
        raise
    ctx.spend(usage, end - start, job)
    lines, screens, _ = validate.transcript_part(raw, start, end, duration)
    return lines, screens


def learn(ctx: Ctx, job: Job, target: dict) -> None:
    v = ctx.video(job.key)
    tri = v.get("triage") or {}
    duration = duration_of(v)
    languages = tri.get("languages") or v.get("languages") or []
    ranges = _part_ranges(duration, languages)
    path = state.pack_path(ctx.settings.state_dir, v["id"])
    saved = state.read_json(path, {}) or {}
    resume = saved.get("req") == job.req and isinstance(saved.get("transcript"), dict)
    tr = saved["transcript"] if resume else {"lines": [], "screens": [], "parts_done": 0}
    tr["parts_total"] = len(ranges)
    for i, (start, end) in enumerate(ranges, 1):
        if i <= int(tr.get("parts_done") or 0):
            continue
        if ctx.stopped():
            with ctx.lock:
                target.update({"state": "partial", "req": job.req, "parts_done": tr["parts_done"], "parts_total": len(ranges), "at": _now()})
            raise Paused()
        lines, screens = _transcribe_range(ctx, job, v, start, end, i, len(ranges), languages, duration)
        tr["lines"] = validate.merge_transcript(tr["lines"], lines, start)
        tr["screens"] = [s for s in tr["screens"] if s["t"] < start] + screens
        tr["parts_done"] = i
        state.write_json(path, {"schema": 1, "id": v["id"], "req": job.req, "transcript": tr, "pack": None})
        with ctx.lock:
            target.update({"state": "partial", "req": job.req, "parts_done": i, "parts_total": len(ranges), "at": _now(),
                           "attempts": target.get("attempts", 0) if target.get("req") == job.req else 0})
    if ctx.stopped():
        raise Paused()
    # Visual notes need readable frames: high resolution, fewer frames on long videos.
    fps = 0.5 if duration <= 1200 else max(0.1, round(600 / duration, 3))
    cards = max(10, min(25, round(duration / 150)))
    decision = ctx.recs.get(f"d:{v['id']}") if isinstance(ctx.recs.get(f"d:{v['id']}"), dict) else {}
    fallback_topic = decision.get("topic") or tri.get("topic") or "Uncategorised"
    text_tr = prompts.compact_transcript(tr["lines"])
    attempt_settings = [(HIGH, fps, ""), (LOW, 0.1, ""), (LOW, 0.1, "\n\nKeep every section short: at most 10 flashcards and 12 visuals.")]
    last: GeminiError | None = None
    for resolution, f, extra in attempt_settings:
        try:
            raw, usage = _call(ctx, ctx.settings.model,
                               [gemini.video_part(watch_url(v["id"]), fps=f),
                                gemini.text_part(prompts.pack_prompt(_meta(v), tri, ctx.topics, text_tr, cards) + extra)],
                               prompts.PACK_SCHEMA, media_resolution=resolution)
            break
        except GeminiError as err:
            if err.kind not in ("too_long", "truncated"):
                raise
            last = err
    else:
        raise last or GeminiError("truncated", "The learning pack was too long.")
    ctx.spend(usage, duration, job)
    pack = validate.pack(raw, duration, ctx.topics, fallback_topic)
    if decision.get("topic"):
        pack["topic"] = validate.text(decision["topic"], 60)
    made = _now()
    state.write_json(path, {"schema": 1, "id": v["id"], "req": job.req, "made_at": made, "model": ctx.settings.model,
                            "transcript": tr, "pack": pack})
    state.write_text(state.md_path(ctx.settings.state_dir, v["id"]),
                     markdown.learning_markdown(v, pack, tr["lines"], made[:10], ctx.settings.model))
    with ctx.lock:
        target.clear()
        target.update({"state": "done", "req": job.req, "at": made, "model": ctx.settings.model, "attempts": 0,
                       "parts_done": len(ranges), "parts_total": len(ranges), "cards": len(pack["flashcards"]),
                       "visuals": len(pack["visuals"]), "lines": len(tr["lines"]),
                       "unsure": sum(1 for ln in tr["lines"] if ln.get("unsure")),
                       "tldr": pack["tldr"][0] if pack["tldr"] else "", "topic": pack["topic"], "difficulty": pack["difficulty"]})


# ---------------------------------------------------------------- review

def review(ctx: Ctx, job: Job, target: dict) -> None:
    v = ctx.video(job.key)
    duration = duration_of(v)
    raw, usage = _call(ctx, ctx.settings.model,
                       [gemini.video_part(watch_url(v["id"]), fps=0.2 if duration <= 1800 else 0.1),
                        gemini.text_part(prompts.review_prompt(_meta(v), ctx.profile))],
                       prompts.REVIEW_SCHEMA, max_output_tokens=8192, media_resolution=LOW)
    ctx.spend(usage, duration, job)
    card = validate.review(raw, duration)
    made = _now()
    state.write_json(state.review_path(ctx.settings.state_dir, v["id"]),
                     {"schema": 1, "id": v["id"], "req": job.req, "made_at": made, "model": ctx.settings.model, "card": card})
    with ctx.lock:
        for key in ("title", "channel", "duration_s"):
            if not v.get(key) and card.get(key):
                v[key] = card[key]
    state.write_text(state.md_path(ctx.settings.state_dir, v["id"]), markdown.entertainment_markdown(v, card, made[:10], ctx.settings.model))
    with ctx.lock:
        target.clear()
        target.update({"state": "done", "req": job.req, "at": made, "model": ctx.settings.model, "attempts": 0,
                       "keep": card["keep"], "suggested_rating": card["suggested_rating"], "one_line": card["one_line"],
                       "topic": card["topic"]})


# ---------------------------------------------------------------- topic guide

def effective_topic(v: dict, recs: dict) -> str:
    d = recs.get(f"d:{v['id']}")
    if isinstance(d, dict) and d.get("topic"):
        return validate.text(d["topic"], 60)
    return (v.get("learn") or {}).get("topic") or (v.get("triage") or {}).get("topic") or ""


def _source(v: dict, pack: dict) -> dict:
    return {
        "video_id": v["id"], "title": v.get("title", ""), "duration_s": v.get("duration_s"),
        "tldr": pack.get("tldr", []),
        "chapters": [{"t": c["t"], "title": c["title"]} for c in pack.get("chapters", [])],
        "notes": [{"chapter": n["chapter"], "points": [{"t": p["t"], "text": p["text"]} for p in n.get("points", [])[:12]]}
                  for n in pack.get("notes", [])[:20]],
        "visuals": [{"t": x["t"], "title": x["title"], "meaning": x.get("meaning", ""), "latex": x.get("latex", "")} for x in pack.get("visuals", [])[:30]],
        "glossary": pack.get("glossary", [])[:40],
        "references": pack.get("references", [])[:40],
        "flashcards": [{"front": c["front"], "back": c["back"], "t": c["t"]} for c in pack.get("flashcards", [])],
    }


def guide(ctx: Ctx, job: Job, target: dict) -> None:
    rec = ctx.recs.get(f"g:{job.key}") or {}
    topic = validate.text(rec.get("topic"), 60)
    sources, durations = [], {}
    for v in ctx.lib["videos"]:
        if v.get("removed") or (v.get("learn") or {}).get("state") != "done" or effective_topic(v, ctx.recs).lower() != topic.lower():
            continue
        saved = state.read_json(state.pack_path(ctx.settings.state_dir, v["id"]), {}) or {}
        if isinstance(saved.get("pack"), dict):
            sources.append(_source(v, saved["pack"]))
            durations[v["id"]] = v.get("duration_s")
    if not sources:
        raise ValueError(f"No finished learning packs in the topic \"{topic}\" yet.")
    raw, usage = _call(ctx, ctx.settings.model, [gemini.text_part(prompts.guide_prompt(topic, sources))],
                       prompts.GUIDE_SCHEMA, max_output_tokens=32768)
    ctx.spend(usage, 0, job)
    g = validate.guide(raw, durations)
    made = _now()
    state.write_json(state.guide_path(ctx.settings.state_dir, job.key),
                     {"schema": 1, "slug": job.key, "topic": topic, "req": job.req, "made_at": made, "model": ctx.settings.model,
                      "videos": list(durations), "guide": g})
    with ctx.lock:
        target.clear()
        target.update({"slug": job.key, "topic": topic, "state": "done", "req": job.req, "at": made, "attempts": 0,
                       "videos": list(durations), "concepts": len(g["concepts"]), "path_minutes": g["path_minutes"],
                       "cards": len(g["flashcards"])})
