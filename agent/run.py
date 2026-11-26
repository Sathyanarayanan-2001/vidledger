"""Agent entry point: python -m agent.run

1. Read the dashboard's records (user/records.json) and the library (state/library.json).
2. Add new videos, drop removed ones, fill in titles and durations.
3. Expand requested playlists.
4. Plan jobs and run them, two at a time, within today's video budget and the run's time limit.
5. Write the library; the workflow then publishes state/ to the vidledger-state branch.

The run always writes the library, even when a job fails, so the dashboard can
show what happened. It exits non-zero only when a key or setting must be fixed.
"""

from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from . import state, validate, youtube
from .config import ConfigError, Settings, load_settings
from .jobs import Budget, plan
from .process import Ctx, run_job

PRIVATE_MSG = {
    "private": "This video is private, so Gemini cannot watch it.",
    "unlisted": "This video is unlisted. Gemini only reads public videos, so it cannot be processed.",
    "missing": "This video no longer exists on YouTube.",
}


def _video_record(rec: object) -> dict:
    return rec if isinstance(rec, dict) else {}


def sync_videos(lib: dict, recs: dict, settings: Settings) -> tuple[int, int]:
    """Add videos the dashboard listed (v:<id>) and remove those it deleted."""
    wanted = {k[2:]: _video_record(v) for k, v in recs.items() if k.startswith("v:") and youtube.ID_RE.match(k[2:])}
    have = {v["id"]: v for v in lib["videos"]}
    added = 0
    for vid, rec in wanted.items():
        if vid not in have:
            lib["videos"].append({"id": vid, "added_at": str(rec.get("at") or state.now_iso()), "title": validate.text(rec.get("title"), 300),
                                  "triage": None, "issue": None})
            added += 1
    removed = 0
    keep = []
    for v in lib["videos"]:
        if v["id"] in wanted:
            keep.append(v)
        else:
            state.remove_video_files(settings.state_dir, v["id"])
            removed += 1
    lib["videos"] = keep
    return added, removed


def refresh_metadata(lib: dict, settings: Settings) -> None:
    todo = [v for v in lib["videos"] if not v.get("meta_at")]
    if not todo:
        return
    if settings.youtube_key:
        metas = youtube.fetch_metadata([v["id"] for v in todo], settings.youtube_key)
    else:
        metas = {v["id"]: youtube.oembed(v["id"]) for v in todo}
    for v in todo:
        m = metas.get(v["id"])
        if not m:
            continue
        if m.error and not m.privacy:  # temporary problem: try again next run
            continue
        for key in ("title", "channel", "published", "duration_s", "description", "language"):
            val = getattr(m, key)
            if val:
                v[key] = val
        if m.captions is not None:
            v["captions"] = m.captions
        v["privacy"] = m.privacy or v.get("privacy", "")
        v["meta_source"] = m.source
        v["meta_at"] = state.now_iso()
        if m.privacy in PRIVATE_MSG:
            v["issue"] = {"op": "meta", "kind": "access", "message": PRIVATE_MSG[m.privacy], "at": state.now_iso()}


def expand_playlists(lib: dict, recs: dict, settings: Settings) -> None:
    done = {p.get("id"): p for p in lib["playlists"] if isinstance(p, dict)}
    for key, rec in recs.items():
        if not key.startswith("p:") or not isinstance(rec, dict):
            continue
        pid = key[2:]
        req = str(rec.get("at") or "")
        if pid in done and done[pid].get("req") == req:
            continue
        entry = {"id": pid, "req": req, "at": state.now_iso(), "title": "", "video_ids": [], "error": ""}
        if not settings.youtube_key:
            entry["error"] = "Add the YOUTUBE_API_KEY secret to expand playlists (see the Guide)."
        else:
            entry["title"], entry["video_ids"], entry["error"] = youtube.playlist_items(pid, settings.youtube_key)
        lib["playlists"] = [p for p in lib["playlists"] if p.get("id") != pid] + [entry]
    wanted = {k[2:] for k in recs if k.startswith("p:")}
    lib["playlists"] = [p for p in lib["playlists"] if p.get("id") in wanted]


def build_cards(lib: dict, settings: Settings) -> dict:
    """One small file with every flashcard and quiz question, so the dashboard never loads whole packs to revise."""
    cards, quiz = [], []
    for v in lib["videos"]:
        if (v.get("learn") or {}).get("state") != "done":
            continue
        saved = state.read_json(state.pack_path(settings.state_dir, v["id"]), {}) or {}
        pack = saved.get("pack") if isinstance(saved.get("pack"), dict) else None
        if not pack:
            continue
        topic = (v.get("learn") or {}).get("topic") or pack.get("topic", "")
        for c in pack.get("flashcards", []):
            cards.append({"key": f"{v['id']}:{c['id']}", "video_id": v["id"], "topic": topic, "front": c["front"], "back": c["back"],
                          "t": c["t"], "kind": c.get("kind", "recall")})
        for q in pack.get("quiz", []):
            quiz.append({"video_id": v["id"], "topic": topic, **q})
    for g in lib.get("guides", []):
        if g.get("state") != "done":
            continue
        saved = state.read_json(state.guide_path(settings.state_dir, g["slug"]), {}) or {}
        for c in ((saved.get("guide") or {}).get("flashcards") or []):
            cards.append({"key": f"g:{g['slug']}:{c['id']}", "video_id": c.get("video_id", ""), "topic": g.get("topic", ""),
                          "front": c["front"], "back": c["back"], "t": c.get("t", 0), "kind": "guide", "guide": g["slug"]})
    data = {"schema": 1, "generated_at": state.now_iso(), "cards": cards, "quiz": quiz}
    state.write_json(settings.state_dir / "cards.json", data)
    return data


def main() -> int:
    started = time.monotonic()
    started_iso = state.now_iso()
    try:
        settings = load_settings()
    except ConfigError as exc:
        print(f"::error::{exc}")
        return 1
    lib = state.load_library(settings.library_file)
    recs = state.load_records(settings.records_file)
    now = datetime.now(timezone.utc)
    budget = Budget(lib.get("budget") or {}, settings.daily_video_seconds, now)
    added, removed = sync_videos(lib, recs, settings)
    refresh_metadata(lib, settings)
    expand_playlists(lib, recs, settings)
    ctx = Ctx(settings=settings, lib=lib, recs=recs, budget=budget, now=now,
              deadline=started + settings.run_minutes * 60)
    jobs = []
    if not settings.gemini_key:
        ctx.stop("config", "Add the GEMINI_API_KEY secret to the private repository (Guide, step 3). Until then, videos are listed but not processed.")
    else:
        jobs = plan(lib, recs, exact_meta=bool(settings.youtube_key))[: settings.max_jobs]
        print(f"Planned {len(jobs)} job(s): " + ", ".join(f"{j.op} {j.key}" for j in jobs[:30]))
        for phase in ("triage", "learn-review", "guide"):
            batch = [j for j in jobs if (j.op == phase) or (phase == "learn-review" and j.op in ("learn", "review"))]
            if not batch or ctx.stopped():
                continue
            with ThreadPoolExecutor(max_workers=1 if phase == "guide" else settings.parallel) as pool:
                list(pool.map(lambda j: run_job(ctx, j), batch))
    minutes = round((time.monotonic() - started) / 60, 1)
    reason = ctx.stop_reason or ("time" if time.monotonic() > ctx.deadline else "")
    if reason == "time":
        ctx.stop_message = "The run reached its time limit; the next run continues."
    lib["agent"] = {"ok": reason not in ("auth", "config"), "message": ctx.stop_message if reason else "", "stopped": reason}
    month = started_iso[:7]
    use = lib["usage"].setdefault(month, {"runner_minutes": 0, "video_s": 0, "tokens_in": 0, "tokens_out": 0, "runs": 0})
    use["runner_minutes"] = round(use["runner_minutes"] + max(minutes, 0.1), 1)
    use["video_s"] += ctx.video_s
    use["tokens_in"] += ctx.usage.prompt_tokens
    use["tokens_out"] += ctx.usage.output_tokens
    use["runs"] += 1
    lib["usage"] = {k: lib["usage"][k] for k in sorted(lib["usage"])[-12:]}
    lib["runs"].append({
        "id": settings.run_id, "url": settings.run_url, "started_at": started_iso, "finished_at": state.now_iso(),
        "minutes": minutes, "planned": len(jobs), "done": ctx.done, "failed": ctx.failed, "added": added, "removed": removed,
        "video_s": ctx.video_s, "tokens_in": ctx.usage.prompt_tokens, "tokens_out": ctx.usage.output_tokens, "stopped": reason,
    })
    ctx.save()
    cards = build_cards(lib, settings)
    print(f"Done in {minutes} min: {ctx.done}, failed {ctx.failed}, video {ctx.video_s} s, stopped: {reason or 'no'}, {len(cards['cards'])} cards")
    return 1 if reason in ("auth", "config") and settings.gemini_key else 0


if __name__ == "__main__":
    sys.exit(main())
