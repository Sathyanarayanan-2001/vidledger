# Architecture

```
Dashboard (GitHub Pages, public repo)          Private repo vidledger-data
  docs/app.js + js/*                            main               code + .github/workflows/agent.yml
     │  GitHub REST API (your token)            vidledger-user     records.json   (dashboard writes)
     ├── PUT records.json ───────────────────►  vidledger-state    library.json, cards.json,
     ├── POST workflow dispatch (agent.yml) ─►                     packs/, reviews/, guides/, md/   (agent writes)
     └── GET library / packs / cards ◄───────
                                                agent (Actions): python -m agent.run
                                                   └── Gemini generateContent with the YouTube URL
```

## Agent (`agent/`)

| Module | Role |
| --- | --- |
| `run.py` | Entry point: sync videos from records, metadata, playlists, plan, run jobs in parallel, write the library and `cards.json` |
| `jobs.py` | Planning from request times (`req`), retry rules, daily budget on the Pacific day |
| `process.py` | Triage, learn (transcript parts then pack, resumable), review, guide |
| `gemini.py` | One JSON-schema request; error kinds that decide stop, retry or give up |
| `prompts.py` | Prompts and schemas; untrusted text in nonce-tagged blocks |
| `validate.py` | Re-validates every model answer (types, ranges, lengths, enums) |
| `markdown.py` | vidledger/1 Markdown, the same format as the Learning Kit |
| `youtube.py` | Id parsing, Data API metadata, oEmbed fallback, playlists |
| `state.py`, `publish.py` | Atomic file writes; branch checkout, squash (state) and compaction (user) |

A job runs when the dashboard's request time differs from the one it last served, or when it is unfinished with attempts left. Learn jobs save each transcript part as they go, so a run that hits the time or budget limit resumes on the next run.

## Dashboard (`docs/`)

`core.js` holds state and every change you can make; `model.js` joins the library with your records into stages; `srs.js` schedules flashcards (SM-2); `remote.js` saves records to the user branch with per-record merge (`merge.js`, newest edit wins); `views/*` render pages. All DOM is built with `dom.js` from text nodes.

## Records (`vidledger-user/records.json`)

`{"schema": 1, "records": {key: {"u": ms, "v": value} | {"d": 1, "u": ms}}}`

| Key | Value |
| --- | --- |
| `v:<id>` | video added `{url, at}` |
| `j:<id>:<op>` | request triage, learn or review again `{at}` |
| `d:<id>` | your decision `{action, topic, category, at}` |
| `s:<id>` | status: reviewed, learned, mastered, dropped |
| `m:<id>` | rating, notes, verdict, rewatch, checklist ticks |
| `c:<video>:<card>` | flashcard progress `{due, ivl, ef, reps, lapses, last}` |
| `rv:<date>` | flashcard answers that day |
| `g:<slug>`, `p:<playlist>` | guide and playlist requests |
| `cfg:profile`, `cfg:topics`, `cfg:revise` | settings the agent and dashboard use |
