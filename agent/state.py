"""Read and write the two branches' files.

state/ (branch vidledger-state, written only by the agent):
  library.json          index of every video, job states, budget, runs
  packs/<id>.json       transcript + learning pack
  reviews/<id>.json     entertainment review card
  guides/<slug>.json    topic study guide
  md/<id>.md            vidledger/1 Markdown export

user/ (branch vidledger-user, written only by the dashboard; read-only here):
  records.json          {"schema": 1, "records": {key: {"u": ms, "v": value} | {"d": 1, "u": ms}}}
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import VERSION

SCHEMA = 1
SLUG_RE = re.compile(r"^[a-z0-9-]{1,60}$")
MAX_RUNS = 40


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, data: Any) -> None:
    """Atomic write: a crash mid-write never leaves a half file behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".md")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except (json.JSONDecodeError, UnicodeDecodeError):
        return default


def empty_library() -> dict:
    return {
        "schema": SCHEMA, "app": "vidledger", "agent_version": VERSION, "generated_at": now_iso(),
        "agent": {"ok": True, "message": ""},
        "budget": {"day": "", "used_s": 0, "limit_s": 0, "resets_at": ""},
        "videos": [], "guides": [], "playlists": [], "runs": [], "usage": {},
    }


def load_library(path: Path) -> dict:
    lib = read_json(path, None)
    if not isinstance(lib, dict) or lib.get("app") != "vidledger":
        return empty_library()
    base = empty_library()
    for key, val in base.items():
        if not isinstance(lib.get(key), type(val)):
            lib[key] = val
    lib["videos"] = [v for v in lib["videos"] if isinstance(v, dict) and isinstance(v.get("id"), str)]
    return lib


def save_library(path: Path, lib: dict) -> None:
    lib["schema"] = SCHEMA
    lib["agent_version"] = VERSION
    lib["generated_at"] = now_iso()
    lib["runs"] = lib.get("runs", [])[-MAX_RUNS:]
    write_json(path, lib)


def load_records(path: Path) -> dict[str, Any]:
    """Live records only: {key: value}. Tombstones and malformed entries are dropped."""
    data = read_json(path, {})
    recs = data.get("records") if isinstance(data, dict) else None
    out: dict[str, Any] = {}
    if not isinstance(recs, dict):
        return out
    for key, rec in recs.items():
        if not isinstance(key, str) or not isinstance(rec, dict) or rec.get("d") == 1:
            continue
        if "v" in rec and isinstance(rec.get("u"), (int, float)):
            out[key] = rec["v"]
    return out


def deleted_keys(path: Path) -> set[str]:
    data = read_json(path, {})
    recs = data.get("records") if isinstance(data, dict) else None
    return {k for k, r in (recs or {}).items() if isinstance(r, dict) and r.get("d") == 1} if isinstance(recs, dict) else set()


def pack_path(state: Path, vid: str) -> Path:
    return state / "packs" / f"{vid}.json"


def review_path(state: Path, vid: str) -> Path:
    return state / "reviews" / f"{vid}.json"


def guide_path(state: Path, slug: str) -> Path:
    if not SLUG_RE.match(slug):
        raise ValueError(f"bad guide slug {slug!r}")
    return state / "guides" / f"{slug}.json"


def md_path(state: Path, vid: str) -> Path:
    return state / "md" / f"{vid}.md"


def remove_video_files(state: Path, vid: str) -> None:
    for p in (pack_path(state, vid), review_path(state, vid), md_path(state, vid)):
        p.unlink(missing_ok=True)
