"""Write the made-up demo library in docs/demo/ (run from the repository root).

    python scripts/make_demo.py

Uses the agent's own validation and Markdown code, so the demo has exactly the
shapes a real run produces. Every video, channel and figure here is invented.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agent import markdown, validate  # noqa: E402
from agent.config import DEFAULT_TOPICS  # noqa: E402

OUT = ROOT / "docs" / "demo"
TOPICS = list(DEFAULT_TOPICS)
DAY = "2026-11-26"


def iso(day: str, hh: int = 9, mm: int = 0) -> str:
    return f"{day}T{hh:02d}:{mm:02d}:00Z"


def tri(title, channel, dur, langs, cat, topic, gives, worth, action, pri, conf, why, outdated="", better=False, tags=()):
    return {"evidence": f"{pri:02d}:15 the presenter introduces the topic", "title": title, "channel": channel, "duration_s": dur, "published": "2025-06-12",
            "languages": langs, "category": cat, "topic": topic, "topic_is_new": False, "gives_me": gives, "worth_it": worth, "action": action,
            "priority": pri, "confidence": conf, "why": why, "outdated": outdated, "better_watched": better, "tags": list(tags)}


VIDEOS = [
    ("demoLVRT001", tri("Fault ride-through for wind turbines, explained", "Demo Grid Academy", 1080, ["en"], "Learning", "Wind & grid integration",
                        "Explain LVRT and HVRT curves and test them against a grid code", 5, "deep", 1, "high", "Core to grid compliance studies", tags=("lvrt", "frt", "grid code"))),
    ("demoSCR0002", tri("Short-circuit ratio and weak grids", "Demo Power Lab", 1440, ["en"], "Learning", "Wind & grid integration",
                        "Judge when a connection point is weak and what that means for converter control", 5, "deep", 1, "high", "Directly useful for interconnection studies", tags=("scr", "weak grid"))),
    ("demoTamil03", tri("Reactive power capability - Tamil explainer", "Demo Tamil Engineering", 1260, ["ta", "en"], "Learning", "Wind & grid integration",
                        "Read a P-Q capability chart and the reactive power rules in Tamil and English", 4, "deep", 2, "high", "Clear Tamil explanation of a hard topic", tags=("reactive power", "pq chart"))),
    ("demoHindi04", tri("Grid code compliance testing basics (Hindi)", "Demo Urja Shiksha", 960, ["hi", "en"], "Reference/How-to", "Standards & regulations",
                        "The order of compliance tests and the documents each needs", 4, "reference", 2, "medium", "Good checklist to come back to", tags=("testing", "compliance"))),
    ("demoCEA0005", tri("CEA technical standards: what changed", "Demo Policy Watch", 1920, ["en"], "News/Opinion", "Standards & regulations",
                        "A summary of recent changes to connectivity standards", 3, "reference", 3, "medium", "Useful, but check the date against the latest notification",
                        outdated="Published before the latest amendment; figures may have changed", tags=("cea", "regulation"))),
    ("demoJSDash6", tri("Build a dashboard with plain JavaScript", "Demo Web Workshop", 1620, ["en"], "Learning", "Software & web development",
                        "Structure a no-framework dashboard with modules and a service worker", 4, "deep", 2, "high", "Matches how you build your own apps", tags=("javascript", "pwa"))),
    ("demoIdx0007", tri("Index funds versus active funds in India", "Demo Money Basics", 840, ["en"], "Learning", "Personal finance",
                        "Compare costs and returns of index and active funds", 3, "reference", 4, "high", "Worth keeping as a reference", tags=("index funds", "costs"))),
    ("demoTalk008", tri("How to present technical results", "Demo Speak Clear", 660, ["en"], "Learning", "Career & communication",
                        "Structure a results talk for a mixed audience", 4, "deep", 3, "medium", "Short and practical", tags=("presenting",))),
    ("demoMusic09", tri("Live acoustic set: rain session", "Demo Strings", 540, ["en"], "Entertainment", "Entertainment - music",
                        "A calm 9-minute set", 4, "review", 5, "high", "Music to relax", better=True, tags=("acoustic",))),
    ("demoComed10", tri("Stand-up: engineers at work", "Demo Laughs", 720, ["en", "ta"], "Entertainment", "Entertainment - comedy",
                        "Office humour about engineering projects", 3, "review", 5, "high", "Light break", tags=("comedy",))),
    ("demoVlog011", tri("Monsoon trek in the Western Ghats", "Demo Trails", 1320, ["ta", "en"], "Entertainment", "Entertainment - vlog & travel",
                        "A trek vlog with route tips", 3, "review", 4, "medium", "Nice for a weekend", better=True, tags=("trek",))),
    ("demoOld0012", tri("Wind turbine basics (2012)", "Demo Archive", 1500, ["en"], "Learning", "Wind & grid integration",
                        "Introductory turbine anatomy", 2, "drop", 5, "medium", "Basics you already know; old figures",
                        outdated="Turbine sizes and grid rules have changed a lot since 2012", tags=("basics",))),
]
NEW_ONLY = "demoNew0013"      # added, not seen by the agent yet
PRIVATE = "demoPriv014"       # the agent could not watch it

LVRT_LINES = [
    ("S1", "en", "Welcome. Today we look at fault ride-through: what a wind turbine must do when the grid voltage dips."),
    ("S1", "en", "When a fault happens somewhere on the network, the voltage at the connection point can fall to a small fraction of normal for a few hundred milliseconds."),
    ("S1", "en", "Older turbines simply disconnected. With a lot of wind on the system, that would turn a small fault into a large loss of generation."),
    ("S1", "en", "So grid codes ask the plant to stay connected. That is low-voltage ride-through, LVRT."),
    ("S1", "en", "Here is the curve. Time on the horizontal axis, voltage in per unit on the vertical axis."),
    ("S1", "en", "Above the line the plant must stay connected. Below it, it may trip."),
    ("S1", "en", "In this example curve, the voltage can fall to 0.15 per unit for 300 milliseconds, then must recover along this slope."),
    ("S1", "en", "Staying connected is not enough. During the dip the plant should also inject reactive current to support the voltage."),
    ("S1", "en", "The reactive current is usually a gain, K, times the voltage deviation, um, up to the converter's current limit."),
    ("S1", "en", "After the fault clears, active power must come back within a set time. Too fast can shake the grid; too slow loses energy."),
    ("S1", "en", "High-voltage ride-through is the mirror image: overvoltages after a fault, often up to about 1.2 or 1.3 per unit for a short time (?)."),
    ("S1", "en", "Now, how do we test this? Two ways: a field test with a voltage-dip container, and simulation with a validated model."),
    ("S1", "en", "The container uses an impedance divider to create the dip at the turbine terminals without disturbing the whole grid."),
    ("S1", "en", "Simulation results are only accepted when the model has been validated against those measurements."),
    ("S1", "en", "A typical report shows voltage, active power and reactive current for each test case, on one page per case."),
    ("S1", "en", "Common mistakes: plotting the wrong per-unit base, and checking only the depth of the dip but not its duration."),
    ("S1", "en", "To sum up: stay connected above the curve, support the voltage during the dip, and recover active power at the right rate."),
]
TAMIL_LINES = [
    ("", "ta", "வணக்கம். இன்று reactive power capability பற்றி பார்க்கலாம்.", "Hello. Today let us look at reactive power capability."),
    ("", "ta", "ஒரு wind turbine எவ்வளவு reactive power கொடுக்க முடியும் என்பதை P-Q chart காட்டுகிறது.", "The P-Q chart shows how much reactive power a wind turbine can give."),
    ("", "ta", "Horizontal axis-ல reactive power, vertical axis-ல active power.", "Reactive power is on the horizontal axis, active power on the vertical axis."),
    ("", "ta", "Grid code சொல்லுது: rated power-ல 0.95 lagging முதல் 0.95 leading வரை power factor வேண்டும்.", "The grid code says: at rated power, the power factor must range from 0.95 lagging to 0.95 leading."),
    ("", "ta", "இந்த rectangle மாதிரி area தான் requirement. Turbine-ன் curve அதை cover பண்ணணும்.", "This rectangle-like area is the requirement. The turbine's curve must cover it."),
    ("", "ta", "Low power-ல converter limit காரணமா capability குறையலாம் (?).", "At low power, capability may reduce because of the converter limit (?)."),
    ("", "ta", "Plant level-ல cable, transformer losses எல்லாம் சேர்த்து point of interconnection-ல check பண்ணணும்.", "At plant level, include cable and transformer losses and check at the point of interconnection."),
    ("", "ta", "அதனால தான் சில நேரம் STATCOM அல்லது capacitor bank சேர்க்கிறோம்.", "That is why we sometimes add a STATCOM or a capacitor bank."),
    ("", "ta", "Test-ல ஒவ்வொரு power level-லும் maximum lagging, maximum leading reactive power measure பண்ணுவோம்.", "In the test, we measure maximum lagging and maximum leading reactive power at each power level."),
    ("", "ta", "சுருக்கமா: chart-ஐ சரியா படிங்க, POI-ல check பண்ணுங்க, gap இருந்தா compensation plan பண்ணுங்க.", "In short: read the chart correctly, check at the POI, and plan compensation if there is a gap."),
]
HINDI_LINES = [
    ("", "hi", "नमस्ते। आज हम grid code compliance testing के basic steps देखेंगे।", "Hello. Today we will look at the basic steps of grid code compliance testing."),
    ("", "hi", "पहला step: test plan बनाइए और उसे transmission utility से approve करवाइए।", "First step: prepare the test plan and get it approved by the transmission utility."),
    ("", "hi", "दूसरा: measurement equipment की calibration certificate रखिए।", "Second: keep the calibration certificate of the measurement equipment."),
    ("", "hi", "फिर power quality, reactive power और ride-through tests होते हैं।", "Then come the power quality, reactive power and ride-through tests."),
    ("", "hi", "हर test के लिए उस दिन की grid condition record कीजिए।", "For every test, record that day's grid conditions."),
    ("", "hi", "Report में raw data और plots दोनों चाहिए, सिर्फ़ summary नहीं।", "The report needs both raw data and plots, not just a summary."),
]


def spread(lines, duration):
    step = max(20, duration // (len(lines) + 1))
    out = []
    for i, ln in enumerate(lines):
        sp, lang, text = ln[0], ln[1], ln[2]
        en = ln[3] if len(ln) > 3 else ""
        out.append({"t": 15 + i * step, "sp": sp, "lang": lang, "text": text, "en": en, "unsure": "(?)" in text})
    return out


def pack_lvrt():
    return {
        "category": "Learning", "topic": "Wind & grid integration", "tags": ["lvrt", "hvrt", "frt", "grid code"], "difficulty": "intermediate",
        "prerequisites": ["Per-unit system", "Basic power electronics"],
        "tldr": ["Grid codes require wind plants to stay connected through voltage dips and support the voltage.",
                 "Stay connected above the LVRT curve, inject reactive current during the dip, and restore active power at a set rate.",
                 "Compliance is shown by field tests with a voltage-dip container plus a validated simulation model."],
        "rewatch": [{"start": 240, "end": 420, "why": "The LVRT curve, read point by point"}, {"start": 660, "end": 800, "why": "How the dip container test works"}],
        "chapters": [{"t": 0, "title": "Why ride-through matters"}, {"t": 240, "title": "The LVRT curve"}, {"t": 480, "title": "Reactive current and recovery"},
                     {"t": 660, "title": "Testing: field and simulation"}, {"t": 900, "title": "Common mistakes and summary"}],
        "notes": [
            {"chapter": "Why ride-through matters", "t": 0, "points": [{"text": "Faults pull the voltage down for a few hundred milliseconds.", "t": 75},
                                                                       {"text": "Mass disconnection of wind plants turns a small fault into a large generation loss.", "t": 135}]},
            {"chapter": "The LVRT curve", "t": 240, "points": [{"text": "Above the curve the plant must stay connected; below it, it may trip.", "t": 315},
                                                              {"text": "Example: 0.15 pu for 300 ms, then a recovery slope.", "t": 375}]},
            {"chapter": "Reactive current and recovery", "t": 480, "points": [{"text": "Reactive current = K x voltage deviation, up to the current limit.", "t": 495},
                                                                               {"text": "Active power must recover within a set time after fault clearance.", "t": 555}]},
            {"chapter": "Testing: field and simulation", "t": 660, "points": [{"text": "A voltage-dip container uses an impedance divider at the turbine terminals.", "t": 735},
                                                                               {"text": "Simulation counts only with a model validated against measurements.", "t": 795}]},
        ],
        "visuals": [
            {"t": 330, "type": "chart", "title": "Example LVRT curve", "meaning": "Where the plant must stay connected",
             "content": "| Time after fault (ms) | Minimum voltage (pu) |\n|---|---|\n| 0 | 0.15 |\n| 300 | 0.15 |\n| 3000 | 0.85 |\n\nThe plant must stay connected while the voltage is above the line.", "latex": ""},
            {"t": 500, "type": "equation", "title": "Reactive current during a dip", "meaning": "How much reactive current to inject",
             "content": "Delta I_q: extra reactive current (pu); K: gain (typically 2); Delta U: voltage deviation from nominal (pu); I_max: converter limit.",
             "latex": "\\Delta I_q = K \\cdot \\Delta U, \\quad |I_q| \\le I_{max}"},
            {"t": 740, "type": "diagram", "title": "Voltage-dip container", "meaning": "How a field test creates the dip",
             "content": "- Grid -> series impedance Z1 -> turbine terminals\n- Switch S closes -> shunt impedance Z2 to earth\n- Dip depth set by the ratio Z2 / (Z1 + Z2)", "latex": ""},
        ],
        "mindmap": {"root": "Fault ride-through", "branches": [
            {"label": "LVRT curve", "t": 315, "leaves": [{"label": "0.15 pu for 300 ms", "t": 375}, {"label": "Recovery slope", "t": 390}]},
            {"label": "Support during the dip", "t": 480, "leaves": [{"label": "Reactive current gain K", "t": 495}, {"label": "Current limit", "t": 510}]},
            {"label": "Recovery", "t": 555, "leaves": [{"label": "Active power ramp", "t": 560}]},
            {"label": "Testing", "t": 660, "leaves": [{"label": "Dip container", "t": 735}, {"label": "Validated model", "t": 795}]},
        ]},
        "glossary": [{"term": "LVRT", "meaning": "Low-voltage ride-through: staying connected through a voltage dip", "t": 200},
                     {"term": "HVRT", "meaning": "High-voltage ride-through: staying connected through an overvoltage", "t": 615},
                     {"term": "pu", "meaning": "Per unit: a value as a fraction of its base value", "t": 330}],
        "references": [{"kind": "value", "text": "0.15 pu for 300 ms (example curve)", "t": 375},
                       {"kind": "standard", "text": "IEC 61400-21-1 (power quality and grid compliance measurement)", "t": 700},
                       {"kind": "regulation", "text": "CEA technical standards for connectivity to the grid", "t": 250}],
        "procedure": [{"step": "Agree the test plan and cases with the utility", "t": 680}, {"step": "Run dip tests at low and high power", "t": 720},
                      {"step": "Validate the model against the measurements", "t": 790}, {"step": "Simulate the remaining cases with the validated model", "t": 820}],
        "claims": [{"claim": "HVRT limits are often around 1.2 to 1.3 pu", "why": "Values differ between grid codes; check the one that applies", "t": 615}],
        "connections": {"prerequisites": ["Per-unit system"], "next": ["Short-circuit ratio", "Model validation"], "related": ["Reactive power capability"]},
        "apply": ["Check a turbine's FRT test report against the applicable curve, case by case", "Add the recovery ramp rate to your compliance checklist"],
        "explain_back": ["Why do grid codes require ride-through at all?", "What two things must a plant do during a dip?", "Why is a simulation alone not enough?"],
        "flashcards": [
            {"front": "What does LVRT require of a wind plant?", "back": "Stay connected while the voltage stays above the grid code's LVRT curve.", "t": 200, "kind": "recall"},
            {"front": "Why do grid codes require fault ride-through?", "back": "Mass disconnection during faults would turn a small fault into a large loss of generation.", "t": 135, "kind": "why"},
            {"front": "How is reactive current during a dip usually set?", "back": "A gain K times the voltage deviation, up to the converter current limit.", "t": 495, "kind": "recall"},
            {"front": "What does a voltage-dip container use to create the dip?", "back": "An impedance divider: series impedance plus a switched shunt impedance at the turbine terminals.", "t": 735, "kind": "recall"},
            {"front": "When is a simulation accepted as compliance evidence?", "back": "Only when the model has been validated against field measurements.", "t": 795, "kind": "recall"},
            {"front": "Name two common plotting mistakes in FRT reports.", "back": "Using the wrong per-unit base, and checking only the depth of the dip but not its duration.", "t": 950, "kind": "apply"},
        ],
        "quiz": [
            {"q": "In the example curve, how deep and how long is the dip the plant must survive?", "options": ["0.15 pu for 300 ms", "0.5 pu for 3 s", "0 pu for 1 s", "0.9 pu for 10 ms"], "answer": 0, "explain": "The example curve holds 0.15 pu for 300 ms."},
            {"q": "What should the plant do during the dip besides staying connected?", "options": ["Trip quickly", "Inject reactive current", "Raise frequency", "Reduce the voltage"], "answer": 1, "explain": "Reactive current supports the voltage."},
            {"q": "What makes simulation results acceptable?", "options": ["Any software", "A validated model", "A short report", "A higher gain K"], "answer": 1, "explain": "The model must be validated against measurements."},
        ],
        "checklist": {"spot_check": [375, 495, 735], "unsure_terms": ["HVRT limit values"], "ambiguous": []},
        "added_context": [{"about": "Per unit", "text": "1 pu is the nominal value; 0.15 pu means 15 percent of nominal voltage."}],
    }


def pack_generic(topic, tldr, cards, chapters, category="Learning"):
    return {"category": category, "topic": topic, "tags": [], "difficulty": "intermediate", "prerequisites": [], "tldr": tldr,
            "rewatch": [{"start": chapters[1][0], "end": chapters[1][0] + 180, "why": "The core idea"}],
            "chapters": [{"t": t, "title": title} for t, title in chapters],
            "notes": [{"chapter": title, "t": t, "points": [{"text": f"Key point about {title.lower()}.", "t": t + 30}]} for t, title in chapters],
            "visuals": [], "mindmap": {"root": topic, "branches": [{"label": title, "t": t, "leaves": []} for t, title in chapters]},
            "glossary": [], "references": [], "procedure": [], "claims": [],
            "connections": {"prerequisites": [], "next": [], "related": []}, "apply": [], "explain_back": [],
            "flashcards": [{"front": f, "back": b, "t": t, "kind": "recall"} for f, b, t in cards],
            "quiz": [{"q": cards[0][0], "options": [cards[0][1], "None of these", "Both", "It depends on the weather"], "answer": 0, "explain": cards[0][1]}],
            "checklist": {"spot_check": [chapters[0][0] + 30], "unsure_terms": [], "ambiguous": []}, "added_context": []}


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    for sub in ("packs", "reviews", "guides", "md"):
        (OUT / sub).mkdir(parents=True)
    videos, records = [], {}

    def rec(key, value, u=1795600000000):
        records[key] = {"u": u, "v": value}

    added = {vid: iso(f"2026-11-{10 + i:02d}") for i, (vid, _) in enumerate(VIDEOS)}
    added[NEW_ONLY] = iso("2026-11-26", 4)
    added[PRIVATE] = iso("2026-11-25", 6)
    for vid, at in added.items():
        rec(f"v:{vid}", {"url": f"https://www.youtube.com/watch?v={vid}", "at": at})
    rec("cfg:profile", {"about": "Demo profile: an engineer in onshore wind energy in India who also builds small web apps.", "goals": "Master grid-code compliance; ship a PWA."})
    rec("cfg:topics", TOPICS)
    rec("cfg:revise", {"newPerDay": 15, "includeReference": False})

    packs = {
        "demoLVRT001": (pack_lvrt(), spread(LVRT_LINES, 1080)),
        "demoSCR0002": (pack_generic("Wind & grid integration", ["SCR compares grid strength with plant size.", "Below about 3, converter control needs extra care."],
                                     [("What does SCR compare?", "The short-circuit power at the connection point with the plant's rated power.", 120),
                                      ("Why do weak grids worry converter control?", "Voltage swings more with power changes, so control loops can become unstable.", 520)],
                                     [(0, "What SCR is"), (300, "Weak grids"), (900, "Mitigation")]),
                        spread([("S1", "en", "Short-circuit ratio compares the grid's strength with the size of the plant."),
                                ("S1", "en", "A low ratio means the voltage moves a lot when power changes."),
                                ("S1", "en", "Grid-forming control and synchronous condensers are two common fixes.")], 1440)),
        "demoTamil03": (pack_generic("Wind & grid integration", ["The P-Q chart must cover the grid code's power-factor range at the point of interconnection.",
                                                                  "Include cable and transformer losses; add a STATCOM or capacitors if there is a gap."],
                                     [("Where is reactive capability checked for compliance?", "At the point of interconnection (POI), including plant losses.", 400),
                                      ("What power factor range is required at rated power in this video?", "0.95 lagging to 0.95 leading.", 260),
                                      ("How is a reactive capability gap usually closed?", "With a STATCOM or a capacitor bank.", 520)],
                                     [(0, "P-Q chart basics"), (260, "The requirement"), (400, "Plant level and POI"), (640, "Testing")]),
                        spread(TAMIL_LINES, 1260)),
        "demoHindi04": (pack_generic("Standards & regulations", ["Compliance testing follows an approved plan with calibrated equipment.", "Reports need raw data and plots for each test."],
                                     [("What must the test report include?", "Raw data and plots for every test, not just a summary.", 700)],
                                     [(0, "Test plan"), (180, "Equipment"), (420, "Tests"), (700, "Report")], category="Reference/How-to"),
                        spread(HINDI_LINES, 960)),
        "demoJSDash6": None,
    }
    decisions = {"demoLVRT001": "deep", "demoSCR0002": "deep", "demoTamil03": "deep", "demoHindi04": "reference", "demoTalk008": "deep",
                 "demoMusic09": "review", "demoComed10": "review", "demoOld0012": "drop"}
    status = {"demoLVRT001": "reviewed", "demoHindi04": "learned", "demoComed10": "reviewed"}
    cards, quiz = [], []
    for vid, t in VIDEOS:
        v = {"id": vid, "added_at": added[vid], "title": t["title"], "channel": t["channel"], "published": t["published"], "duration_s": t["duration_s"],
             "languages": t["languages"], "meta_source": "oembed", "meta_at": added[vid], "triage": t,
             "triage_job": {"state": "done", "req": "auto", "at": added[vid], "model": "gemini-3.8-flash", "attempts": 0}, "issue": None}
        action = decisions.get(vid)
        if action:
            rec(f"d:{vid}", {"action": action, "topic": t["topic"], "category": t["category"], "at": added[vid]})
            if action in ("deep", "reference"):
                rec(f"j:{vid}:learn", {"at": added[vid]})
            if action == "review":
                rec(f"j:{vid}:review", {"at": added[vid]})
        if vid in status:
            rec(f"s:{vid}", {"status": status[vid], "at": iso("2026-11-24")})
        if packs.get(vid):
            raw, lines = packs[vid]
            p = validate.pack(raw, t["duration_s"], TOPICS, t["topic"])
            screens = [{"t": vis["t"], "type": vis["type"], "title": vis["title"]} for vis in p["visuals"]]
            tr = {"lines": lines, "screens": screens, "parts_done": 1, "parts_total": 1}
            (OUT / "packs" / f"{vid}.json").write_text(json.dumps({"schema": 1, "id": vid, "req": added[vid], "made_at": added[vid], "model": "gemini-3.8-flash",
                                                                   "transcript": tr, "pack": p}, ensure_ascii=False), encoding="utf-8")
            (OUT / "md" / f"{vid}.md").write_text(markdown.learning_markdown(v, p, lines, added[vid][:10], "gemini-3.8-flash"), encoding="utf-8")
            v["learn"] = {"state": "done", "req": added[vid], "at": added[vid], "model": "gemini-3.8-flash", "attempts": 0, "parts_done": 1, "parts_total": 1,
                          "cards": len(p["flashcards"]), "visuals": len(p["visuals"]), "lines": len(lines), "unsure": sum(1 for ln in lines if ln["unsure"]),
                          "tldr": p["tldr"][0], "topic": p["topic"], "difficulty": p["difficulty"]}
            for c in p["flashcards"]:
                cards.append({"key": f"{vid}:{c['id']}", "video_id": vid, "topic": p["topic"], "front": c["front"], "back": c["back"], "t": c["t"], "kind": c["kind"]})
            for q in p["quiz"]:
                quiz.append({"video_id": vid, "topic": p["topic"], **q})
        if vid == "demoTalk008":
            v["learn"] = {"state": "partial", "req": added[vid], "at": iso("2026-11-26", 3), "parts_done": 0, "parts_total": 1, "attempts": 0}
        if vid in ("demoMusic09", "demoComed10"):
            card = validate.review({"accessed": True, "evidence": "00:20 opening chords", "title": t["title"], "channel": t["channel"], "duration_s": t["duration_s"],
                                    "languages": t["languages"], "topic": "music" if vid == "demoMusic09" else "comedy", "tags": ["calm"] if vid == "demoMusic09" else ["office"],
                                    "one_line": "A calm acoustic set recorded during the rain." if vid == "demoMusic09" else "Ten minutes of jokes about deadlines, meetings and site visits.",
                                    "worth": "Good for a short break; the second song is the highlight." if vid == "demoMusic09" else "Light and relatable; a few jokes land very well.",
                                    "suggested_rating": 4 if vid == "demoMusic09" else 3, "rating_reason": "Warm sound, simple arrangement" if vid == "demoMusic09" else "Uneven but fun",
                                    "best_moments": [{"t": 150, "text": "The second song starts"}, {"t": 410, "text": "Guitar solo"}] if vid == "demoMusic09" else [{"t": 95, "text": "The site visit story"}],
                                    "when": "Short break or background while working" if vid == "demoMusic09" else "Evening break", "minutes": round(t["duration_s"] / 60),
                                    "nuggets": [] if vid == "demoMusic09" else [{"t": 300, "text": "A good way to explain scope creep"}],
                                    "keep": "keep_rewatch" if vid == "demoMusic09" else "keep_log", "keep_reason": "Worth replaying" if vid == "demoMusic09" else "Seen once is enough"},
                                   t["duration_s"])
            (OUT / "reviews" / f"{vid}.json").write_text(json.dumps({"schema": 1, "id": vid, "req": added[vid], "made_at": added[vid], "model": "gemini-3.8-flash", "card": card}, ensure_ascii=False), encoding="utf-8")
            (OUT / "md" / f"{vid}.md").write_text(markdown.entertainment_markdown(v, card, added[vid][:10], "gemini-3.8-flash"), encoding="utf-8")
            v["review"] = {"state": "done", "req": added[vid], "at": added[vid], "model": "gemini-3.8-flash", "attempts": 0, "keep": card["keep"],
                           "suggested_rating": card["suggested_rating"], "one_line": card["one_line"], "topic": card["topic"]}
        videos.append(v)
    videos.append({"id": PRIVATE, "added_at": added[PRIVATE], "title": "A private video", "meta_source": "oembed", "meta_at": added[PRIVATE], "privacy": "private",
                   "triage": None, "issue": {"op": "meta", "kind": "access", "message": "This video is private, so Gemini cannot watch it.", "at": added[PRIVATE]}})
    rec("m:demoComed10", {"rating": 4, "verdict": "Funny enough for a Friday", "rewatch": "no", "at": iso("2026-11-24")})
    rec("m:demoLVRT001", {"rating": 5, "notes": "Use the dip container section to explain tests to the client.", "checks": [], "at": iso("2026-11-24")})
    # Some revision history: a few cards already seen, with a review count per day.
    for i, c in enumerate(cards[:5]):
        rec(f"c:{c['key']}", {"due": "2026-11-26" if i < 3 else "2026-11-30", "ivl": 3, "ef": 2.5, "reps": 2, "lapses": 0, "last": "2026-11-23"})
    for d, n in (("2026-11-20", 12), ("2026-11-21", 9), ("2026-11-22", 15), ("2026-11-23", 7), ("2026-11-24", 11), ("2026-11-25", 6)):
        rec(f"rv:{d}", {"n": n, "again": 2, "fresh": 4})
    guide = validate.guide({
        "concepts": [{"name": "Fault ride-through", "explanation": "Plants stay connected through dips above the code's curve and support the voltage.", "best": {"video_id": "demoLVRT001", "t": 315}, "disagreements": ""},
                     {"name": "Grid strength (SCR)", "explanation": "Weak connection points need careful converter control.", "best": {"video_id": "demoSCR0002", "t": 300}, "disagreements": ""},
                     {"name": "Reactive power capability", "explanation": "The P-Q chart must cover the required power-factor range at the POI.", "best": {"video_id": "demoTamil03", "t": 260},
                      "disagreements": "One video checks at the turbine terminals, the other at the POI; the grid code means the POI."}],
        "path": [{"video_id": "demoLVRT001", "start": 240, "end": 420, "why": "The LVRT curve"}, {"video_id": "demoTamil03", "start": 260, "end": 520, "why": "The reactive power requirement"},
                 {"video_id": "demoSCR0002", "start": 300, "end": 600, "why": "Why weak grids matter"}],
        "overlaps": [{"video_ids": ["demoLVRT001", "demoTamil03"], "note": "Both explain reactive support; the LVRT video covers the dip, the Tamil video the steady state.", "best_video_id": "demoTamil03"}],
        "gaps": [{"gap": "Frequency response and inertia requirements", "query": "wind plant frequency response grid code"}],
        "glossary": [{"term": "POI", "meaning": "Point of interconnection with the grid", "video_id": "demoTamil03", "t": 400}],
        "formulas": [{"text": "Delta Iq = K x Delta U, limited by Imax", "video_id": "demoLVRT001", "t": 500}],
        "flashcards": [{"front": "Where is grid code compliance usually assessed for a wind plant?", "back": "At the point of interconnection (POI).", "video_id": "demoTamil03", "t": 400}],
    }, {"demoLVRT001": 1080, "demoSCR0002": 1440, "demoTamil03": 1260})
    slug = "wind-grid-integration"
    (OUT / "guides" / f"{slug}.json").write_text(json.dumps({"schema": 1, "slug": slug, "topic": "Wind & grid integration", "req": iso("2026-11-24"), "made_at": iso("2026-11-24", 10),
                                                            "model": "gemini-3.8-flash", "videos": ["demoLVRT001", "demoSCR0002", "demoTamil03"], "guide": guide}, ensure_ascii=False), encoding="utf-8")
    rec(f"g:{slug}", {"topic": "Wind & grid integration", "at": iso("2026-11-24")})
    for c in guide["flashcards"]:
        cards.append({"key": f"g:{slug}:{c['id']}", "video_id": c["video_id"], "topic": "Wind & grid integration", "front": c["front"], "back": c["back"], "t": c["t"], "kind": "guide", "guide": slug})
    runs = []
    for i, (d, s) in enumerate((("2026-11-03", 7200), ("2026-11-10", 18000), ("2026-11-17", 25200), ("2026-11-24", 14400), ("2026-11-26", 3600))):
        runs.append({"id": f"r-demo-{i}", "url": "", "started_at": iso(d, 6), "finished_at": iso(d, 6, 40), "minutes": 38.5, "planned": 8,
                     "done": {"triage": 4, "learn": 2, "review": 1, "guide": 1 if d == "2026-11-24" else 0}, "failed": 1 if d == "2026-11-25" else 0,
                     "added": 4, "removed": 0, "video_s": s, "tokens_in": 1_800_000, "tokens_out": 90_000, "stopped": ""})
    library = {"schema": 1, "app": "vidledger", "agent_version": "1.0.0", "generated_at": iso(DAY, 6, 40),
               "agent": {"ok": True, "message": "", "stopped": ""},
               "budget": {"day": DAY, "used_s": 3600, "limit_s": 27000, "resets_at": "2026-11-27T08:00:00Z"},
               "videos": videos,
               "guides": [{"slug": slug, "topic": "Wind & grid integration", "state": "done", "req": iso("2026-11-24"), "at": iso("2026-11-24", 10), "attempts": 0,
                           "videos": ["demoLVRT001", "demoSCR0002", "demoTamil03"], "concepts": 3, "path_minutes": guide["path_minutes"], "cards": 1}],
               "playlists": [], "runs": runs,
               "usage": {"2026-11": {"runner_minutes": 192.5, "video_s": 68400, "tokens_in": 9_000_000, "tokens_out": 450_000, "runs": 5}}}
    (OUT / "library.json").write_text(json.dumps(library, ensure_ascii=False), encoding="utf-8")
    (OUT / "cards.json").write_text(json.dumps({"schema": 1, "generated_at": iso(DAY), "cards": cards, "quiz": quiz}, ensure_ascii=False), encoding="utf-8")
    (OUT / "records.json").write_text(json.dumps({"schema": 1, "app": "vidledger", "records": records}, ensure_ascii=False), encoding="utf-8")
    print(f"demo: {len(videos)} videos, {len(cards)} cards, {len(records)} records")


if __name__ == "__main__":
    main()
