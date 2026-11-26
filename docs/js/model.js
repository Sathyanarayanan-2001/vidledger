// The library as the dashboard sees it: the agent's library.json joined with
// your records (decisions, status, reviews). Pure functions, so Node tests can
// import them. Lookups go through Maps; filters are one pass over the list.

import { isoWeek, cwKey, cwLabel, localParts } from './format.js';

export const STAGES = [
  { key: 'new', name: 'Waiting for the agent', short: 'Waiting', slot: 1 },
  { key: 'decide', name: 'Needs your decision', short: 'Decide', slot: 2 },
  { key: 'processing', name: 'Agent working on it', short: 'Processing', slot: 3 },
  { key: 'ready', name: 'Ready to review', short: 'Ready', slot: 4 },
  { key: 'reviewed', name: 'Reviewed', short: 'Reviewed', slot: 5 },
  { key: 'learned', name: 'Learned', short: 'Learned', slot: 6 },
  { key: 'mastered', name: 'Mastered', short: 'Mastered', slot: 7 },
  { key: 'dropped', name: 'Dropped', short: 'Dropped', slot: 8 },
  { key: 'issue', name: 'Needs attention', short: 'Issue', slot: 9 },
];
export const STAGE_BY_KEY = new Map(STAGES.map((s) => [s.key, s]));

export const ACTIONS = [
  { key: 'deep', name: 'Deep-learn', hint: 'Full learning pack plus flashcards in your revision deck' },
  { key: 'reference', name: 'Reference', hint: 'Full learning pack to look up later; no flashcards' },
  { key: 'review', name: 'Review card', hint: 'Short card for entertainment: best moments and your rating' },
  { key: 'drop', name: 'Drop', hint: 'Outdated, duplicate or not worth the time' },
];
export const ACTION_BY_KEY = new Map(ACTIONS.map((a) => [a.key, a]));
export const CATEGORIES = ['Learning', 'Reference/How-to', 'News/Opinion', 'Motivation', 'Entertainment'];
export const NO_RETRY = new Set(['access', 'blocked']);
const MAX_ATTEMPTS = 3;

const LANG_NAMES = { en: 'English', ta: 'Tamil', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi', bn: 'Bengali',
  gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', de: 'German', fr: 'French', es: 'Spanish', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  ar: 'Arabic', ru: 'Russian', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', hr: 'Croatian' };
export const langName = (code) => LANG_NAMES[String(code || '').slice(0, 2)] || String(code || '').toUpperCase();

export function slugify(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'topic';
}

/** Checks the shape of library.json. Malformed videos are dropped and counted. */
export function validateLibrary(data) {
  if (!data || typeof data !== 'object' || data.app !== 'vidledger') return { error: 'This is not a VidLedger library file.' };
  if (data.schema !== 1) return { error: `This library was written by a newer agent (schema ${data.schema}). Reload the page to update the dashboard.` };
  const videos = [];
  let dropped = 0;
  for (const v of Array.isArray(data.videos) ? data.videos : []) {
    if (v && typeof v === 'object' && /^[A-Za-z0-9_-]{11}$/.test(String(v.id))) videos.push(v);
    else dropped++;
  }
  return {
    lib: {
      ...data, videos,
      guides: Array.isArray(data.guides) ? data.guides.filter((g) => g && typeof g.slug === 'string') : [],
      playlists: Array.isArray(data.playlists) ? data.playlists : [],
      runs: Array.isArray(data.runs) ? data.runs : [],
      budget: data.budget && typeof data.budget === 'object' ? data.budget : {},
      agent: data.agent && typeof data.agent === 'object' ? data.agent : { ok: true, message: '' },
      usage: data.usage && typeof data.usage === 'object' ? data.usage : {},
    },
    dropped,
  };
}

/** Records lookup helper over a RecordStore-like object with get(key) and entries(prefix). */
function jobReq(recs, id, op) {
  const r = recs.get(`j:${id}:${op}`);
  return r && r.at ? String(r.at) : null;
}

/** Where a video stands, from the library entry `v` (may be missing) and your records. */
export function stageOf(id, v, recs) {
  const decision = recs.get(`d:${id}`) || null;
  const status = (recs.get(`s:${id}`) || {}).status || '';
  if (status === 'dropped' || (decision && decision.action === 'drop')) return 'dropped';
  if (['reviewed', 'learned', 'mastered'].includes(status)) return status;
  if (!v) return 'new';
  const issue = v.issue;
  if (issue && issue.op === 'meta' && NO_RETRY.has(issue.kind)) return 'issue';
  if (!decision) {
    if (v.triage) return 'decide';
    const tj = v.triage_job || {};
    if (tj.state === 'failed' && (NO_RETRY.has(tj.kind) || (tj.attempts || 0) >= MAX_ATTEMPTS)) return 'issue';
    return 'new';
  }
  const op = decision.action === 'review' ? 'review' : 'learn';
  const req = jobReq(recs, id, op);
  const st = v[op] || {};
  if (st.state === 'done' && (!req || st.req === req)) return 'ready';
  if (st.state === 'failed' && st.req === req && (NO_RETRY.has(st.kind) || (st.attempts || 0) >= MAX_ATTEMPTS)) return 'issue';
  return 'processing';
}

export function effectiveTopic(v, decision) {
  if (decision && decision.topic) return decision.topic;
  if (!v) return '';
  return (v.learn && v.learn.topic) || (v.triage && v.triage.topic) || (v.review && v.review.topic ? `Entertainment - ${v.review.topic}` : '') || '';
}

/**
 * Join library and records into one list of entries, in the order you added them.
 * Videos you added that the agent has not seen yet appear as stage "new".
 */
export function buildIndex(lib, recs) {
  const byId = new Map((lib ? lib.videos : []).map((v) => [v.id, v]));
  const entries = [];
  const seen = new Set();
  const added = recs.entries('v:').map(([k, val]) => [k.slice(2), val]).sort((a, b) => String(a[1].at || '').localeCompare(String(b[1].at || '')));
  for (const [id, rec] of added) {
    if (seen.has(id)) continue;
    seen.add(id);
    const v = byId.get(id) || null;
    const decision = recs.get(`d:${id}`) || null;
    const tri = (v && v.triage) || null;
    const title = (v && v.title) || (tri && tri.title) || rec.title || '';
    const entry = {
      id, v, rec, decision, tri,
      title: title || `Video ${id}`,
      channel: (v && v.channel) || (tri && tri.channel) || '',
      duration: (v && v.duration_s) || (tri && tri.duration_s) || 0,
      languages: (v && v.languages) || (tri && tri.languages) || [],
      category: (decision && decision.category) || (tri && tri.category) || '',
      topic: effectiveTopic(v, decision),
      action: (decision && decision.action) || (tri && tri.action) || '',
      worth: tri ? tri.worth_it : 0,
      priority: tri ? tri.priority : 3,
      added: String(rec.at || ''),
      stage: stageOf(id, v, recs),
      mine: recs.get(`m:${id}`) || {},
      kind: decision ? (decision.action === 'review' ? 'card' : decision.action === 'drop' ? '' : 'pack') : '',
    };
    entry.search = `${entry.title} ${entry.channel} ${entry.topic} ${(tri && tri.tags || []).join(' ')} ${id}`.toLowerCase();
    entries.push(entry);
  }
  return { entries, byId: new Map(entries.map((e) => [e.id, e])) };
}

/** Pending work the agent has not picked up yet (shown on "Process now"). */
export function pendingWork(index, lib, recs) {
  let n = 0;
  for (const e of index.entries) {
    if (e.stage === 'new' && !e.v) n++;
    else if (e.stage === 'processing') n++;
    else if (e.v && !e.v.triage && e.stage === 'new') n++;
  }
  const guides = new Map((lib ? lib.guides : []).map((g) => [g.slug, g]));
  for (const [k, rec] of recs.entries('g:')) {
    const g = guides.get(k.slice(2));
    if (!g || g.req !== String(rec.at)) n++;
  }
  return n;
}

export function filterEntries(entries, f) {
  const q = String(f.query || '').trim().toLowerCase();
  const words = q ? q.split(/\s+/) : [];
  return entries.filter((e) => (f.stage === 'all' || !f.stage || e.stage === f.stage)
    && (!f.category || f.category === 'all' || e.category === f.category)
    && (!f.topic || f.topic === 'all' || e.topic === f.topic)
    && (!f.lang || f.lang === 'all' || e.languages.includes(f.lang))
    && words.every((w) => e.search.includes(w)));
}

const BY = {
  priority: (a, b) => a.priority - b.priority || b.worth - a.worth || a.added.localeCompare(b.added),
  worth: (a, b) => b.worth - a.worth || a.priority - b.priority,
  added: (a, b) => b.added.localeCompare(a.added),
  duration: (a, b) => a.duration - b.duration,
  title: (a, b) => a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }),
};
export function sortEntries(entries, key) {
  return [...entries].sort((a, b) => (BY[key] || BY.priority)(a, b) || a.id.localeCompare(b.id));
}

function countBy(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    for (const k of [].concat(keyFn(x))) if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/** Figures for Home and the Dashboard. One pass per figure; O(n log n) for the sorted lists. */
export function libraryStats(index, lib, { timeZone, reviewsByDay = [] } = {}) {
  const e = index.entries;
  const byStage = countBy(e, (x) => x.stage);
  const topics = [...countBy(e.filter((x) => x.stage !== 'dropped'), (x) => x.topic || 'Not triaged yet')].sort((a, b) => b[1] - a[1]);
  const weeks = new Map();
  for (const r of lib ? lib.runs : []) {
    const w = isoWeek(new Date(r.started_at), timeZone);
    if (!w) continue;
    const k = cwKey(w);
    const cur = weeks.get(k) || { key: k, label: cwLabel(w), value: 0 };
    cur.value += Number(r.video_s) || 0;
    weeks.set(k, cur);
  }
  const done = e.filter((x) => x.stage !== 'dropped' && x.v && ((x.v.learn && x.v.learn.state === 'done') || (x.v.review && x.v.review.state === 'done')));
  return {
    total: e.length,
    byStage,
    byCategory: [...countBy(e.filter((x) => x.category), (x) => x.category)].sort((a, b) => b[1] - a[1]),
    byLanguage: [...countBy(e, (x) => x.languages)].sort((a, b) => b[1] - a[1]),
    topics,
    hoursTotal: e.filter((x) => x.stage !== 'dropped').reduce((s, x) => s + (x.duration || 0), 0),
    hoursDone: done.reduce((s, x) => s + (x.duration || 0), 0),
    weeks: [...weeks.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-12),
    reviewsByDay,
  };
}

/** Flashcards that belong in your deck: Deep-learn videos, plus Reference if asked, plus topic-guide cards. */
export function deckCards(cards, index, { includeReference = false, topic = 'all' } = {}) {
  return cards.filter((c) => {
    if (topic !== 'all' && c.topic !== topic) return false;
    if (c.guide) return true;
    const e = index.byId.get(c.video_id);
    if (!e || ['dropped', 'issue'].includes(e.stage)) return false;
    const action = e.decision ? e.decision.action : '';
    return action === 'deep' || (includeReference && action === 'reference');
  });
}

/** Daily review counts from rv:<YYYY-MM-DD> records for the last `days` days, oldest first. */
export function reviewSeries(recs, today, days, addDays) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const r = recs.get(`rv:${d}`) || {};
    out.push({ key: d, label: `${d.slice(8, 10)}/${d.slice(5, 7)}`, value: Number(r.n) || 0 });
  }
  return out;
}

export function hourOfDay(iso, timeZone) {
  const p = localParts(new Date(iso), timeZone);
  return p ? p.hh : 0;
}
