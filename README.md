# VidLedger

**Learn from your saved YouTube videos, not just save them.**

Paste YouTube links. An agent on GitHub Actions has Gemini watch each video (audio and frames, so videos without captions work too), triages it, and, once you decide, builds a learning pack: a verbatim transcript with an English line under every non-English line, visual notes for every slide, table, equation and diagram, a mind map, glossary, references, flashcards and a quiz. Every item links to its moment in the video. You decide, review and revise; the dashboard keeps the record.

- **Dashboard** (this repository, public): a static GitHub Pages app. Plain HTML, CSS and JavaScript modules; no framework, no CDN, no build step. Works on a phone and offline.
- **Agent** (the same code in your private `vidledger-data` repository): Python standard library only, run by `.github/workflows/agent.yml` every 6 hours and whenever you press **Process now**.

## What you get

| Stage | You | The agent |
| --- | --- | --- |
| Add | Paste links, playlists or a Google Takeout file | Reads titles, durations, privacy |
| Triage | | Watches the video, suggests category, topic, worth-it (1-5) and an action |
| Decide | Approve or change: Deep-learn, Reference, Review card, Drop | |
| Build | | Transcript and translation in parts, then the learning pack or review card; vidledger/1 Markdown for NotebookLM or other tools |
| Review | Reviewer checklist, rating, notes, status | |
| Revise | Spaced-repetition flashcards and quizzes | Topic study guides: core concepts, a one-hour path through the best segments, overlaps and gaps |

## Set up

See [docs/SETUP.md](docs/SETUP.md) (the same steps are in the app under **Guide**). In short: two repositories, a free Gemini API key as a secret, `VIDLEDGER_ROLE=data` in the private one, Pages on in the public one, and a fine-grained token for the dashboard.

## Limits worth knowing

- Gemini reads **public** videos only. Private, unlisted and members-only videos are marked "Needs attention".
- The free tier allows 8 hours of YouTube video a day. The agent stops at 7.5 hours and continues after midnight Pacific time (13:30 IST); a long video resumes where it stopped.
- Timestamps are per line, not per word. The reviewer checklist asks you to spot-check three.
- Private repositories get 2,000 free Actions minutes a month; the Dashboard shows usage.

## Develop

```bash
python -m pytest tests/python          # agent (offline, fake Gemini)
npm test                               # dashboard logic
python -m pytest tests/e2e             # browser tests (Playwright + Chromium)
python scripts/make_demo.py            # rebuild the made-up demo library
python -m http.server -d docs 8000     # open http://localhost:8000 and press "Try the demo"
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Security: [SECURITY.md](SECURITY.md). Changes: [CHANGELOG.md](CHANGELOG.md).

MIT licence.
