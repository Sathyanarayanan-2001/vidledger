# Security and privacy

## Where data lives

| Data | Where | Who writes it |
| --- | --- | --- |
| Library, transcripts, packs, guides | Private repo, branch `vidledger-state` | Agent only |
| Your videos, decisions, notes, ratings, flashcard progress, settings | Private repo, branch `vidledger-user`, `records.json` | Dashboard only |
| GitHub token | Your browser (localStorage, or sessionStorage if "Remember" is off) | You |
| Gemini and YouTube keys | Actions secrets of the private repo | You |

The public repository holds code and the made-up demo only. `.gitignore` blocks `state/`, `user/`, exports and backups on `main`.

## Safeguards

- The agent refuses to run in a public repository, and runs only where `VIDLEDGER_ROLE=data`.
- Workflow inputs reach Python through environment variables, never the shell command line. Actions are pinned to commit SHAs. The CI deploy job alone may write to Pages.
- The dashboard has a strict Content Security Policy: its own scripts only; network to `api.github.com`; images from `i.ytimg.com`; frames from `www.youtube-nocookie.com`. No analytics, no third-party scripts.
- Every string from YouTube or Gemini is rendered as text (`textContent`), never as HTML. Model output is re-validated (types, ranges, lengths) before it is stored.
- Video content and metadata are untrusted: prompts wrap them in nonce-tagged blocks and tell Gemini that text inside the video is content, not instructions. Model output only ever becomes data on a branch; it cannot trigger actions.
- CSV exports neutralise formulas (`=`, `+`, `-`, `@`).
- The token needs only: this one repository; Contents read and write; Actions read and write.

## Reporting

Open a private security advisory on this repository.
