"""Configuration: keys, models and limits, all read from the environment.

Secrets (GEMINI_API_KEY, YOUTUBE_API_KEY) come from GitHub Actions secrets.
Tunables (VIDLEDGER_*) come from repository variables; every one has a default.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

REPO_ROOT = Path(__file__).resolve().parent.parent

# Current Gemini Flash model in Google's video-understanding guide (Nov 2026).
# Change it with the repository variable VIDLEDGER_MODEL; no code change needed.
DEFAULT_MODEL = "gemini-3.8-flash"

# Google's free tier allows 8 hours of YouTube video per day. The agent stops at
# 7.5 hours so a long final video never trips the hard limit mid-request.
DEFAULT_DAILY_HOURS = 7.5

CATEGORIES = ("Learning", "Reference/How-to", "News/Opinion", "Motivation", "Entertainment")

# What triage may suggest, and what the dashboard may decide.
ACTIONS = ("deep", "reference", "review", "drop")

DEFAULT_TOPICS = (
    "Wind & grid integration",
    "Power systems",
    "Standards & regulations",
    "Software & web development",
    "AI tools",
    "Personal finance",
    "Career & communication",
    "Languages",
    "General science",
    "Entertainment - music",
    "Entertainment - comedy",
    "Entertainment - film & TV",
    "Entertainment - vlog & travel",
    "Entertainment - sports",
    "Entertainment - other",
)

ENTERTAINMENT_TOPICS = ("music", "comedy", "film & TV", "vlog & travel", "sports", "gaming", "other")


class ConfigError(Exception):
    """A configuration problem the user must fix; the message says how."""


@dataclass(frozen=True)
class Settings:
    gemini_key: str | None
    youtube_key: str | None
    model: str
    triage_model: str
    daily_video_seconds: int
    max_jobs: int
    run_minutes: int
    parallel: int
    state_dir: Path
    user_dir: Path
    run_id: str
    run_url: str

    @property
    def library_file(self) -> Path:
        return self.state_dir / "library.json"

    @property
    def records_file(self) -> Path:
        return self.user_dir / "records.json"


def _int_env(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a whole number between {low} and {high}; got {raw!r}.") from None
    if not low <= value <= high:
        raise ConfigError(f"{name} must be between {low} and {high}; got {value}.")
    return value


def _float_env(env: Mapping[str, str], name: str, default: float, low: float, high: float) -> float:
    raw = (env.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number between {low:g} and {high:g}; got {raw!r}.") from None
    if not low <= value <= high:
        raise ConfigError(f"{name} must be between {low:g} and {high:g}; got {value:g}.")
    return value


def _model(env: Mapping[str, str], name: str, default: str) -> str:
    value = (env.get(name) or "").strip() or default
    if not value.replace("-", "").replace(".", "").replace("_", "").isalnum() or len(value) > 80:
        raise ConfigError(f"{name} must be a Gemini model id such as {DEFAULT_MODEL}; got {value!r}.")
    return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    env = os.environ if env is None else env
    model = _model(env, "VIDLEDGER_MODEL", DEFAULT_MODEL)
    server = env.get("GITHUB_SERVER_URL", "https://github.com")
    repo = env.get("GITHUB_REPOSITORY", "")
    gh_run = env.get("GITHUB_RUN_ID", "")
    run_url = f"{server}/{repo}/actions/runs/{gh_run}" if repo and gh_run else ""
    hours = _float_env(env, "VIDLEDGER_DAILY_VIDEO_HOURS", DEFAULT_DAILY_HOURS, 0.25, 1000)
    return Settings(
        gemini_key=(env.get("GEMINI_API_KEY") or "").strip() or None,
        youtube_key=(env.get("YOUTUBE_API_KEY") or "").strip() or None,
        model=model,
        triage_model=_model(env, "VIDLEDGER_TRIAGE_MODEL", model),
        daily_video_seconds=int(hours * 3600),
        max_jobs=_int_env(env, "VIDLEDGER_MAX_JOBS_PER_RUN", 20, 1, 500),
        run_minutes=_int_env(env, "VIDLEDGER_RUN_MINUTES", 50, 5, 330),
        parallel=_int_env(env, "VIDLEDGER_PARALLEL", 2, 1, 4),
        state_dir=Path(env.get("VIDLEDGER_STATE_DIR") or REPO_ROOT / "state"),
        user_dir=Path(env.get("VIDLEDGER_USER_DIR") or REPO_ROOT / "user"),
        run_id=(env.get("VIDLEDGER_RUN_ID") or "").strip()[:60] or f"r-{gh_run or 'local'}",
        run_url=run_url,
    )
