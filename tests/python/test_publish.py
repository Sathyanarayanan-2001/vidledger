"""Branch plumbing against a real local git remote."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from agent import publish


def sh(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path):
    remote = tmp_path / "remote.git"
    sh(tmp_path, "init", "--quiet", "--bare", "-b", "main", str(remote))
    work = tmp_path / "work"
    sh(tmp_path, "clone", "--quiet", str(remote), str(work))
    sh(work, "config", "user.name", "t")
    sh(work, "config", "user.email", "t@example.test")
    (work / "README.md").write_text("code\n")
    sh(work, "add", ".")
    sh(work, "commit", "--quiet", "-m", "init")
    sh(work, "push", "--quiet", "origin", "main")
    return work, remote


def test_state_branch_is_created_and_squashed(repo, monkeypatch):
    work, remote = repo
    monkeypatch.chdir(work)
    assert publish.main(["x", "checkout", "state"]) == 0
    state = work / "state"
    assert [p.name for p in state.iterdir()] == [".git"]  # orphan: no code files
    (state / "library.json").write_text("{}")
    assert publish.main(["x", "squash", "state", "agent r1"]) == 0
    assert sh(remote, "rev-list", "--count", "vidledger-state") == "1"
    (state / "library.json").write_text('{"v":2}')
    assert publish.main(["x", "squash", "state", "agent r2"]) == 0
    assert sh(remote, "rev-list", "--count", "vidledger-state") == "1"
    assert sh(remote, "show", "vidledger-state:library.json") == '{"v":2}'


def test_missing_user_branch_gives_empty_dir(repo, monkeypatch):
    work, _ = repo
    monkeypatch.chdir(work)
    assert publish.main(["x", "checkout", "user"]) == 0
    assert not (work / "user" / "records.json").exists()


def test_compact_user_history(repo, monkeypatch):
    work, remote = repo
    sh(work, "checkout", "--quiet", "--orphan", "vidledger-user")
    sh(work, "rm", "-rf", "--quiet", ".")
    for i in range(publish.COMPACT_AFTER + 5):
        (work / "records.json").write_text(f'{{"n":{i}}}')
        sh(work, "add", "records.json")
        sh(work, "commit", "--quiet", "-m", f"save {i}")
    sh(work, "push", "--quiet", "origin", "vidledger-user")
    sh(work, "checkout", "--quiet", "main")
    monkeypatch.chdir(work)
    assert publish.compact(work, "vidledger-user") == "compacted"
    assert sh(remote, "rev-list", "--count", "vidledger-user") == "1"
    assert sh(remote, "show", "vidledger-user:records.json") == f'{{"n":{publish.COMPACT_AFTER + 4}}}'
    assert publish.compact(work, "vidledger-user").startswith("kept")
