"""Which jobs to run, in what order, and whether today's video budget allows them.

Requests come from the dashboard's records:
  v:<id>          a video in the library ({"url", "at"})
  j:<id>:<op>     run op (triage | learn | review) again; "at" changes on every request
  d:<id>          the user's decision ({"action", "topic", "category"})
  g:<slug>        build or rebuild a topic study guide ({"topic", "at"})
  p:<playlist>    expand a playlist into video ids ({"url", "at"})
  cfg:profile     {"about", "goals"};  cfg:topics  [topic, ...]

Every job remembers the request time it served (`req`). A job runs when the
request time differs, or when it is unfinished and has attempts left.
"""

from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo

    PACIFIC = ZoneInfo("America/Los_Angeles")
except Exception:  # pragma: no cover - zoneinfo data missing on an odd runner
    PACIFIC = timezone(timedelta(hours=-8))

from .gemini import NO_RETRY

MAX_ATTEMPTS = 3
DEFAULT_DURATION = 20 * 60  # used for budgeting until the real duration is known
TRIAGE_CLIP = 300           # with exact metadata, triage watches the first 5 minutes


def budget_day(now: datetime) -> str:
    """Google's free-tier day runs midnight to midnight Pacific time."""
    return now.astimezone(PACIFIC).date().isoformat()


def next_reset(now: datetime) -> str:
    local = now.astimezone(PACIFIC)
    midnight = datetime(local.year, local.month, local.day, tzinfo=PACIFIC) + timedelta(days=1)
    return midnight.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Budget:
    """Seconds of YouTube video sent to Gemini today. Thread-safe reserve/settle."""

    def __init__(self, stored: dict, limit_s: int, now: datetime):
        self.day = budget_day(now)
        self.limit_s = limit_s
        self.used_s = int(stored.get("used_s") or 0) if stored.get("day") == self.day else 0
        self.resets_at = next_reset(now)
        self.exhausted = False
        self._lock = threading.Lock()

    def remaining(self) -> int:
        return max(0, self.limit_s - self.used_s)

    def reserve(self, seconds: int) -> bool:
        with self._lock:
            if self.used_s + seconds > self.limit_s:
                return False
            self.used_s += seconds
            return True

    def release(self, seconds: int) -> None:
        with self._lock:
            if not self.exhausted:
                self.used_s = max(0, self.used_s - seconds)

    def exhaust(self) -> None:
        """Google said the day's quota is used: nothing more today."""
        with self._lock:
            self.exhausted = True
            self.used_s = max(self.used_s, self.limit_s)

    def to_dict(self) -> dict:
        return {"day": self.day, "used_s": self.used_s, "limit_s": self.limit_s, "resets_at": self.resets_at}


@dataclass
class Job:
    op: str            # triage | learn | review | guide
    key: str           # video id, or guide slug
    req: str           # request time this job serves ("auto" for automatic triage)
    rank: tuple        # sort key
    cost_s: int = 0    # estimated seconds of video for the budget
    spent: int = 0     # seconds actually sent to Gemini


def _req(recs: dict, vid: str, op: str) -> str | None:
    rec = recs.get(f"j:{vid}:{op}")
    return str(rec.get("at")) if isinstance(rec, dict) and rec.get("at") else None


def _due(state: dict | None, req: str) -> bool:
    """Should a job with this stored state run for request `req`?"""
    if not state:
        return True
    if state.get("req") != req:
        return True
    if state.get("state") == "done":
        return False
    if state.get("kind") in NO_RETRY:
        return False
    return int(state.get("attempts") or 0) < MAX_ATTEMPTS


def duration_of(v: dict) -> int:
    return int(v.get("duration_s") or (v.get("triage") or {}).get("duration_s") or DEFAULT_DURATION)


def triage_cost(v: dict, has_exact_meta: bool) -> int:
    d = duration_of(v)
    return min(d, TRIAGE_CLIP) if has_exact_meta and d > TRIAGE_CLIP + 120 else d


def learn_cost(v: dict) -> int:
    d = duration_of(v)
    st = v.get("learn") or {}
    if st.get("state") == "partial" and st.get("parts_total"):
        left = max(0, int(st["parts_total"]) - int(st.get("parts_done") or 0))
        return math.ceil(d * left / int(st["parts_total"])) + d
    return 2 * d


def plan(lib: dict, recs: dict, *, exact_meta: bool) -> list[Job]:
    jobs: list[Job] = []
    for order, v in enumerate(lib["videos"]):
        vid = v["id"]
        if v.get("removed"):
            continue
        meta_issue = (v.get("issue") or {}).get("op") == "meta" and (v.get("issue") or {}).get("kind") in NO_RETRY
        if meta_issue:
            continue
        tri_req = _req(recs, vid, "triage") or "auto"
        tri_state = v.get("triage_job")
        if (not v.get("triage") and _due(tri_state, tri_req)) or (tri_req != "auto" and _due(tri_state, tri_req)):
            jobs.append(Job("triage", vid, tri_req, (0, order), triage_cost(v, exact_meta)))
        pri = int((v.get("triage") or {}).get("priority") or 3)
        for op in ("learn", "review"):
            req = _req(recs, vid, op)
            if req and _due(v.get(op), req):
                cost = learn_cost(v) if op == "learn" else duration_of(v)
                jobs.append(Job(op, vid, req, (1, pri, order), cost))
    for key, rec in recs.items():
        if not key.startswith("g:") or not isinstance(rec, dict) or not rec.get("at") or not rec.get("topic"):
            continue
        slug = key[2:]
        current = next((g for g in lib.get("guides", []) if g.get("slug") == slug), None)
        if _due(current, str(rec["at"])):
            jobs.append(Job("guide", slug, str(rec["at"]), (2, str(rec["at"]))))
    jobs.sort(key=lambda j: j.rank)
    return jobs
