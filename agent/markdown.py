"""vidledger/1 Markdown export: one file per video, the same format as the Learning Kit.

These files are written to md/<video id>.md on the state branch, so they can be
added to NotebookLM or imported by a future tool without the dashboard.
"""

from __future__ import annotations

import re

from .prompts import mmss

_MERMAID_BAD = re.compile(r"[()\[\]{}<>\"`#;:]")


def link(vid: str, t: int | float | None) -> str:
    s = max(0, int(t or 0))
    return f"[{mmss(s)}](https://youtu.be/{vid}?t={s})"


def _csv(value: str) -> str:
    return '"' + str(value).replace('"', '""') + '"'


def _cell(value: str) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def _slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:40] or "topic"


def _mermaid_label(value: str) -> str:
    return " ".join(_MERMAID_BAD.sub(" ", value).split())[:80] or "-"


def record_block(v: dict, kind: str, extra: dict) -> list[str]:
    tri = v.get("triage") or {}
    rows = {
        "schema": "vidledger/1",
        "type": kind,
        "video_id": v["id"],
        "url": f"https://www.youtube.com/watch?v={v['id']}",
        "title": v.get("title", ""),
        "channel": v.get("channel", ""),
        "published": v.get("published") or "?",
        "duration": mmss(v.get("duration_s")) if v.get("duration_s") else "?",
        "spoken_languages": ", ".join(tri.get("languages") or []),
        **extra,
    }
    return ["## 0. Record"] + [f"{k}: {val}" for k, val in rows.items()]


def learning_markdown(v: dict, pack: dict, transcript: list[dict], processed_on: str, model: str) -> str:
    vid = v["id"]
    out: list[str] = [f"# {v.get('title') or vid}", ""]
    out += record_block(v, "learning", {
        "category": pack.get("category", ""), "topic": pack.get("topic", ""), "tags": ", ".join(pack.get("tags", [])),
        "difficulty": pack.get("difficulty", ""), "prerequisites": ", ".join(pack.get("prerequisites", [])),
        "processed_on": processed_on, "processed_by": f"Gemini ({model})", "status": "draft", "my_rating": "", "my_verdict": "",
    })
    out += ["", "## 1. TL;DR", *[f"- {x}" for x in pack.get("tldr", [])]]
    out += ["", "## 2. Rewatch only these",
            *[f"- {link(vid, r['start'])}-{mmss(r['end'])} {r['why']}" for r in pack.get("rewatch", [])]]
    out += ["", "## 3. Chapters", *[f"- {link(vid, c['t'])} {c['title']}" for c in pack.get("chapters", [])]]
    out += ["", "## 4. Detailed notes"]
    for n in pack.get("notes", []):
        out += ["", f"### {n['chapter']} ({link(vid, n['t'])})", *[f"- {p['text']} {link(vid, p['t'])}" for p in n.get("points", [])]]
    out += ["", "## 5. Visual notes"]
    for vis in pack.get("visuals", []):
        out += ["", f"### {link(vid, vis['t'])} · {vis['type']} · {vis['title']}"]
        if vis.get("meaning"):
            out.append(f"_{vis['meaning']}_")
        if vis.get("content"):
            out += ["", vis["content"]]
        if vis.get("latex"):
            out += ["", "```latex", vis["latex"], "```"]
    mm = pack.get("mindmap") or {}
    out += ["", "## 6. Mind map", "", "```mermaid", "mindmap", f"  root(({_mermaid_label(mm.get('root') or v.get('title', ''))}))"]
    for b in mm.get("branches", []):
        out.append(f"    {_mermaid_label(b['label'])} · {mmss(b['t'])}")
        out += [f"      {_mermaid_label(lf['label'])} · {mmss(lf['t'])}" for lf in b.get("leaves", [])]
    out += ["```"]
    out += ["", "## 7. Glossary", "", "| Term | Meaning as explained in the video | Timestamp |", "| --- | --- | --- |",
            *[f"| {_cell(g['term'])} | {_cell(g['meaning'])} | {link(vid, g['t'])} |" for g in pack.get("glossary", [])]]
    out += ["", "## 8. Numbers, formulas, standards & references",
            *[f"- {r['kind']}: {r['text']} {link(vid, r['t'])}" for r in pack.get("references", [])]]
    proc = pack.get("procedure", [])
    out += ["", "## 9. Procedure", *([f"{i}. {p['step']} {link(vid, p['t'])}" for i, p in enumerate(proc, 1)] or ["n/a"])]
    out += ["", "## 10. Claims to verify", *[f"- {c['claim']} ({c['why']}) {link(vid, c['t'])}" for c in pack.get("claims", [])]]
    con = pack.get("connections") or {}
    out += ["", "## 11. Connections", f"- Prerequisites: {', '.join(con.get('prerequisites', [])) or '-'}",
            f"- Learn next: {', '.join(con.get('next', [])) or '-'}", f"- Related: {', '.join(con.get('related', [])) or '-'}"]
    out += ["", "## 12. Apply it", *[f"- {x}" for x in pack.get("apply", [])]]
    out += ["", "## 13. Explain-back", *[f"- {x}" for x in pack.get("explain_back", [])]]
    tag = f"{_slug(pack.get('topic', ''))} vid_{vid}"
    out += ["", "## 14. Flashcards", "", "```csv",
            *[f"{_csv(c['front'])},{_csv(c['back'] + ' https://youtu.be/' + vid + '?t=' + str(c['t']))},{_csv(tag)}" for c in pack.get("flashcards", [])],
            "```"]
    out += ["", "## 15. Quiz"]
    for i, q in enumerate(pack.get("quiz", []), 1):
        out += ["", f"{i}. {q['q']}", *[f"    {chr(65 + j)}. {o}" for j, o in enumerate(q["options"])]]
    out += ["", "Answers"] + [f"{i}. {chr(65 + q['answer'])}: {q['explain']}" for i, q in enumerate(pack.get("quiz", []), 1)]
    chk = pack.get("checklist") or {}
    unsure = [ln for ln in transcript if ln.get("unsure") or ln.get("text", "").lower() == "[inaudible]"]
    out += ["", "## 16. Reviewer checklist",
            *[f"- [ ] Unclear: {link(vid, ln['t'])} {ln['text']}" for ln in unsure[:40]],
            *[f"- [ ] Spot-check {link(vid, t)}" for t in chk.get("spot_check", [])],
            *[f"- [ ] Term to confirm: {t}" for t in chk.get("unsure_terms", [])],
            *[f"- [ ] Translation could be read two ways: {link(vid, a['t'])} {a['text']}" for a in chk.get("ambiguous", [])]]
    if pack.get("added_context"):
        out += ["", "### Added context", *[f"- {a['about']}: {a['text']}" for a in pack["added_context"]]]
    out += ["", "## 17. Transcript", ""]
    for ln in transcript:
        speaker = f"{ln['sp']}: " if ln.get("sp") else ""
        out.append(f"{link(vid, ln['t'])} {speaker}{ln['text']}")
        if ln.get("en"):
            out.append(f"EN: {ln['en']}")
    return "\n".join(out).rstrip() + "\n"


def entertainment_markdown(v: dict, card: dict, processed_on: str, model: str) -> str:
    vid = v["id"]
    out = [f"# {v.get('title') or vid}", ""]
    out += record_block(v, "entertainment", {
        "category": "Entertainment", "topic": card.get("topic", ""), "tags": ", ".join(card.get("tags", [])),
        "processed_on": processed_on, "processed_by": f"Gemini ({model})", "status": "draft", "my_rating": "", "my_verdict": "",
    })
    keep = {"keep_rewatch": "Keep & rewatch", "keep_log": "Keep as a log entry", "drop": "Drop"}[card["keep"]]
    out += ["", "## 1. In one line", card.get("one_line", ""),
            "", "## 2. Worth the time?", card.get("worth", ""), f"Suggested rating: {card['suggested_rating']}/5. {card.get('rating_reason', '')}",
            "", "## 3. Best moments", *[f"- {link(vid, m['t'])} {m['text']}" for m in card.get("best_moments", [])],
            "", "## 4. When to watch", f"{card.get('when', '')} ({card.get('minutes', 0)} min)",
            "", "## 5. Learning nuggets", *([f"- {link(vid, m['t'])} {m['text']}" for m in card.get("nuggets", [])] or ["none"]),
            "", "## 6. Keep or drop", f"{keep}: {card.get('keep_reason', '')}",
            "", "## 7. My review", "Rating: __/5 · Rewatch: yes/no · One-line verdict: __"]
    return "\n".join(out).rstrip() + "\n"
