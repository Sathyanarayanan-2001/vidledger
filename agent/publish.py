"""Branch plumbing for the private data repository.

  vidledger-state  written by the agent only; replaced by one squashed commit per run,
                   so transcripts from earlier runs do not pile up in git history.
  vidledger-user   written by the dashboard only (records.json through the GitHub API);
                   the agent reads it, and compacts its history to one commit now and then.

Run from the repository root:
  python -m agent.publish checkout state           # worktree of vidledger-state at ./state
  python -m agent.publish checkout user            # read-only copy of vidledger-user at ./user
  python -m agent.publish squash state "agent …"   # after agent.run
  python -m agent.publish compact user             # optional: squash the user branch's history
"""

from __future__ import annotations

import subprocess
import sys
import time
import uuid
from pathlib import Path

BRANCHES = {"state": "vidledger-state", "user": "vidledger-user"}
ATTEMPTS = 5
COMPACT_AFTER = 40  # commits on vidledger-user before its history is squashed


class PublishError(Exception):
    pass


def git(cwd: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    proc = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise PublishError(f"git {' '.join(args[:2])} failed: {proc.stderr.strip()[:300]}")
    return proc


def remote_sha(cwd: Path, branch: str) -> str:
    out = git(cwd, "ls-remote", "origin", f"refs/heads/{branch}").stdout.strip()
    return out.split()[0] if out else ""


def _identity(cwd: Path) -> None:
    git(cwd, "config", "user.name", "vidledger-bot")
    git(cwd, "config", "user.email", "vidledger-bot@users.noreply.github.com")


def _remove(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        for child in path.iterdir():
            _remove(child)
        path.rmdir()
    else:
        path.unlink()


def checkout(repo: Path, target: Path, branch: str) -> None:
    """Detached worktree of `branch`, or an empty orphan worktree when the branch does not exist yet."""
    if target.exists() and any(target.iterdir()):
        raise PublishError(f"{target} already exists and is not empty.")
    if remote_sha(repo, branch):
        git(repo, "fetch", "--quiet", "origin", branch)
        git(repo, "worktree", "add", "--quiet", "--detach", str(target), "FETCH_HEAD")
        return
    git(repo, "worktree", "add", "--quiet", "--detach", str(target), "HEAD")
    git(target, "checkout", "--quiet", "--orphan", f"{branch}-new")
    git(target, "rm", "-r", "-f", "--quiet", "--cached", ".")
    for child in target.iterdir():
        if child.name != ".git":
            _remove(child)


def squash(cwd: Path, branch: str, message: str, sleep=time.sleep) -> str:
    """Replace `branch` with one commit holding the worktree, guarded by a lease on the tip we started from."""
    _identity(cwd)
    for attempt in range(ATTEMPTS):
        base = remote_sha(cwd, branch)
        tmp = f"squash-{uuid.uuid4().hex[:12]}"
        git(cwd, "checkout", "--quiet", "--orphan", tmp)
        git(cwd, "add", "--all", ".")
        git(cwd, "commit", "--quiet", "--allow-empty", "-m", message)
        lease = f"--force-with-lease=refs/heads/{branch}:{base}"
        push = git(cwd, "push", "--quiet", lease, "origin", f"HEAD:refs/heads/{branch}", check=False)
        if push.returncode == 0:
            return git(cwd, "rev-parse", "HEAD").stdout.strip()
        sleep(2 + attempt * 3)
    raise PublishError(f"Could not publish {branch} after several attempts; the next run will retry.")


def compact(repo: Path, branch: str) -> str:
    """Squash a long history to one commit with the same files. Skips quietly if the branch moved meanwhile."""
    tip = remote_sha(repo, branch)
    if not tip:
        return "absent"
    git(repo, "fetch", "--quiet", "origin", branch)
    count = int(git(repo, "rev-list", "--count", "FETCH_HEAD").stdout.strip() or 0)
    if count <= COMPACT_AFTER:
        return f"kept ({count} commits)"
    tree = git(repo, "rev-parse", "FETCH_HEAD^{tree}").stdout.strip()
    env_name = ["-c", "user.name=vidledger-bot", "-c", "user.email=vidledger-bot@users.noreply.github.com"]
    commit = git(repo, *env_name, "commit-tree", tree, "-m", f"compact {count} commits").stdout.strip()
    push = git(repo, "push", "--quiet", f"--force-with-lease=refs/heads/{branch}:{tip}", "origin", f"{commit}:refs/heads/{branch}", check=False)
    return "compacted" if push.returncode == 0 else "skipped (the dashboard saved meanwhile)"


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 3 and argv[1] == "checkout" and argv[2] in BRANCHES:
            checkout(Path.cwd(), Path(argv[2]).resolve(), BRANCHES[argv[2]])
            return 0
        if len(argv) == 4 and argv[1] == "squash" and argv[2] == "state":
            sha = squash(Path(argv[2]).resolve(), BRANCHES["state"], argv[3][:200])
            print(f"Published {BRANCHES['state']} at {sha[:10]}")
            return 0
        if len(argv) == 3 and argv[1] == "compact" and argv[2] == "user":
            print(f"{BRANCHES['user']}: {compact(Path.cwd(), BRANCHES['user'])}")
            return 0
    except PublishError as exc:
        print(f"::error::{exc}")
        return 1
    print("usage: python -m agent.publish checkout state|user | squash state <message> | compact user")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
