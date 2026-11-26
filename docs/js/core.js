// App state, data loading and every change you can make.
// Views read S and call these functions; nothing here touches the page layout.

import { GitHub, GitHubError } from './github.js';
import { ls, session, kvGet, kvSet, RecordStore } from './store.js';
import { RemoteRecords } from './remote.js';
import { validateLibrary, buildIndex, slugify, pendingWork } from './model.js';
import { schedule } from './srs.js';
import { deviceTimeZone, ymd } from './format.js';
import { toast } from './ui.js';

export const VERSION = '1.0.0';
export const RELEASE_DATE = '26/11/2026';

export const S = {
  conn: null, gh: null, demo: false,
  lib: null, libError: '', libDropped: 0, etag: null, fetchedAt: null, loading: false,
  cards: { cards: [], quiz: [] }, cardsEtag: null,
  index: { entries: [], byId: new Map() },
  records: new RecordStore(), remote: null, syncStatus: 'local', syncDetail: '',
  packs: new Map(), reviews: new Map(), guides: new Map(),
  tz: ls.get('tz') || deviceTimeZone(),
  route: 'home', param: '',
  agent: { running: false, steps: [], runId: '', runUrl: '', error: '', conclusion: '' },
  f: { stage: 'all', category: 'all', topic: 'all', lang: 'all', query: '', sort: 'priority', limit: 60 },
  render: () => {},
  renderChrome: () => {},
};

export const today = () => ymd(new Date(), S.tz);
export const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ connection

export function loadConnection() {
  const remembered = ls.get('conn');
  const sess = session.get('conn');
  let conn = remembered;
  if (!conn && sess) {
    try {
      conn = JSON.parse(sess);
    } catch {
      conn = null;
    }
  }
  if (conn && conn.repo && conn.token) {
    S.conn = conn;
    S.gh = new GitHub(conn.repo, conn.token);
  }
  S.demo = !S.conn && ls.get('demo') === true;
}

export function startRemote() {
  if (S.remote) S.remote.stop();
  S.remote = null;
  if (!S.gh || S.demo) {
    S.syncStatus = S.demo ? 'local' : 'local';
    return;
  }
  S.remote = new RemoteRecords(S.records, S.gh, {
    onStatus: (status, detail) => {
      S.syncStatus = status;
      S.syncDetail = detail;
      S.renderChrome();
    },
  });
}

export async function connect(conn, remember) {
  S.conn = conn;
  S.gh = new GitHub(conn.repo, conn.token);
  S.demo = false;
  ls.set('demo', false);
  if (remember) ls.set('conn', conn);
  else {
    ls.remove('conn');
    session.set('conn', JSON.stringify(conn));
  }
  S.lib = null;
  S.etag = null;
  S.packs.clear();
  S.reviews.clear();
  S.guides.clear();
  await S.records.use(conn.repo);
  startRemote();
  try {
    await S.remote.pull();
  } catch (err) {
    toast(err.message, 'error', 8000);
  }
  reindex();
}

export async function disconnect() {
  ls.remove('conn');
  session.remove('conn');
  ls.remove('run');
  if (S.remote) S.remote.stop();
  S.conn = null;
  S.gh = null;
  S.remote = null;
  S.lib = null;
  S.cards = { cards: [], quiz: [] };
  reindex();
}

export async function enterDemo() {
  S.demo = true;
  ls.set('demo', true);
  S.lib = null;
  S.packs.clear();
  S.reviews.clear();
  S.guides.clear();
  if (S.remote) S.remote.stop();
  S.remote = null;
  await S.records.use('demo');
  if (!Object.keys(S.records.records).length) await resetDemo(false);
  await refresh({ quiet: true });
}

/** Put the demo back to its starting records (your demo choices are only ever kept in this browser). */
export async function resetDemo(rerender = true) {
  const res = await fetch('demo/records.json', { cache: 'no-cache' });
  const data = await res.json();
  S.records.records = Object.create(null);
  await S.records.mergeIn(data.records || {}, 'remote');
  await S.records.persist('remote');
  reindex();
  if (rerender) S.render();
}

export async function leaveDemo() {
  S.demo = false;
  ls.set('demo', false);
  S.lib = null;
  if (S.conn) await S.records.use(S.conn.repo);
  reindex();
}

// ------------------------------------------------------------------ loading

export function reindex() {
  S.index = buildIndex(S.lib, S.records);
}

export const pending = () => pendingWork(S.index, S.lib, S.records);

async function readText(path, etag) {
  if (S.demo) {
    const res = await fetch(`demo/${path}`, { cache: 'no-cache' });
    if (res.status === 404) throw new GitHubError(`${path} is not in the demo.`, 404);
    if (!res.ok) throw new GitHubError(`The demo file ${path} could not be loaded (HTTP ${res.status}).`, res.status);
    return { status: 200, text: await res.text(), etag: null };
  }
  return S.gh.getStateFile(path, etag);
}

export async function loadCached() {
  const owner = S.demo ? 'demo' : S.conn && S.conn.repo;
  const cached = await kvGet('library');
  if (cached && cached.owner === owner && cached.text) {
    try {
      const res = validateLibrary(JSON.parse(cached.text));
      if (res.lib) {
        S.lib = res.lib;
        S.etag = cached.etag || null;
        S.fetchedAt = cached.fetchedAt || null;
      }
    } catch { /* ignore a damaged cache */ }
  }
  const cards = await kvGet('cards');
  if (cards && cards.owner === owner && cards.data) {
    S.cards = cards.data;
    S.cardsEtag = cards.etag || null;
  }
  reindex();
}

export async function refresh({ quiet = false } = {}) {
  if (S.loading || (!S.conn && !S.demo)) return;
  S.loading = true;
  S.renderChrome();
  const owner = S.demo ? 'demo' : S.conn.repo;
  try {
    if (S.remote) {
      try {
        await S.remote.pull();
      } catch (err) {
        if (!quiet) toast(err.message, 'error', 8000);
      }
    }
    const res = await readText('library.json', S.lib ? S.etag : null);
    if (res.status !== 304) {
      const parsed = validateLibrary(JSON.parse(res.text));
      if (parsed.error) throw new Error(parsed.error);
      S.lib = parsed.lib;
      S.libDropped = parsed.dropped;
      S.etag = res.etag;
      await kvSet('library', { owner, text: res.text, etag: S.etag, fetchedAt: nowIso() });
    }
    S.libError = '';
    S.fetchedAt = nowIso();
    try {
      const c = await readText('cards.json', S.cards.cards.length ? S.cardsEtag : null);
      if (c.status !== 304) {
        const data = JSON.parse(c.text);
        S.cards = { cards: Array.isArray(data.cards) ? data.cards : [], quiz: Array.isArray(data.quiz) ? data.quiz : [] };
        S.cardsEtag = c.etag;
        await kvSet('cards', { owner, data: S.cards, etag: S.cardsEtag });
      }
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    if (!quiet) toast(res.status === 304 ? 'Already up to date.' : 'Library refreshed.');
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404 && !S.lib) {
      S.libError = '';
    } else {
      S.libError = err.message || String(err);
      if (!quiet) toast(S.libError, 'error', 9000);
    }
  } finally {
    S.loading = false;
    reindex();
    S.render();
  }
}

/** A JSON file from the state branch, cached in IndexedDB under a version key so it is fetched once. */
async function cachedJson(path, version, memo) {
  const key = `${path}@${version}`;
  if (memo.has(key)) return memo.get(key);
  const owner = S.demo ? 'demo' : S.conn && S.conn.repo;
  const stored = await kvGet(`file:${owner}:${key}`);
  if (stored) {
    memo.set(key, stored);
    return stored;
  }
  const res = await readText(path, null);
  const data = JSON.parse(res.text);
  memo.set(key, data);
  kvSet(`file:${owner}:${key}`, data);
  return data;
}

export const getPack = (id) => cachedJson(`packs/${id}.json`, (S.index.byId.get(id)?.v?.learn || {}).at || 'x', S.packs);
export const getReview = (id) => cachedJson(`reviews/${id}.json`, (S.index.byId.get(id)?.v?.review || {}).at || 'x', S.reviews);
export const getGuide = (slug) => cachedJson(`guides/${slug}.json`, ((S.lib && S.lib.guides.find((g) => g.slug === slug)) || {}).at || 'x', S.guides);

export async function getMarkdown(id) {
  const res = await readText(`md/${id}.md`, null);
  return res.text;
}

// ------------------------------------------------------------------ your changes (records)

async function put(pairs) {
  await S.records.putMany(pairs);
  reindex();
}

export async function addVideos(videos, playlists = []) {
  const at = nowIso();
  const pairs = [];
  for (const v of videos) if (!S.records.get(`v:${v.id}`)) pairs.push([`v:${v.id}`, { url: v.url, at }]);
  for (const p of playlists) pairs.push([`p:${p}`, { url: `https://www.youtube.com/playlist?list=${p}`, at }]);
  if (pairs.length) await put(pairs);
  return pairs.filter(([k]) => k.startsWith('v:')).length;
}

/** Your decision; it also asks the agent for the pack or card. Drop needs no agent work. */
export async function decide(id, action, topic, category) {
  const at = nowIso();
  const e = S.index.byId.get(id);
  const pairs = [[`d:${id}`, { action, topic: topic || (e ? e.topic : '') || '', category: category || (e ? e.category : '') || '', at }]];
  if (action === 'deep' || action === 'reference') pairs.push([`j:${id}:learn`, { at }]);
  if (action === 'review') pairs.push([`j:${id}:review`, { at }]);
  const s = S.records.get(`s:${id}`);
  if (action !== 'drop' && s && s.status === 'dropped') pairs.push([`s:${id}`, { status: '', at }]);
  await put(pairs);
}

/** Ask the agent to run a job again (for example after an error). */
export async function rerun(id, op) {
  await put([[`j:${id}:${op}`, { at: nowIso() }]]);
}

export async function setStatus(id, status) {
  await put([[`s:${id}`, { status, at: nowIso() }]]);
}

export async function saveMine(id, patch) {
  const cur = S.records.get(`m:${id}`) || {};
  await put([[`m:${id}`, { ...cur, ...patch, at: nowIso() }]]);
}

export async function removeVideo(id) {
  const keys = Object.keys(S.records.records).filter((k) => k === `v:${id}` || k === `d:${id}` || k === `s:${id}` || k === `m:${id}` || k.startsWith(`j:${id}:`));
  await S.records.remove(keys);
  reindex();
}

export async function requestGuide(topic) {
  await put([[`g:${slugify(topic)}`, { topic, at: nowIso() }]]);
}

export function config(key, fallback) {
  const v = S.records.get(`cfg:${key}`);
  return v === undefined ? fallback : v;
}

export async function setConfig(key, value) {
  await put([[`cfg:${key}`, value]]);
}

export async function gradeCard(cardKey, grade) {
  const d = today();
  const prev = S.records.get(`c:${cardKey}`);
  const next = schedule(prev, grade, d);
  const rv = S.records.get(`rv:${d}`) || { n: 0, again: 0, fresh: 0 };
  await S.records.putMany([
    [`c:${cardKey}`, next],
    [`rv:${d}`, { n: rv.n + 1, again: rv.again + (grade === 0 ? 1 : 0), fresh: rv.fresh + (prev && prev.due ? 0 : 1) }],
  ]);
  return next;
}

// ------------------------------------------------------------------ the agent

function newRunId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `r-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${rand}`;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function step(text, state = 'active', url = '') {
  for (const s of S.agent.steps) if (s.state === 'active') s.state = 'done';
  S.agent.steps.push({ text, state, url });
  S.renderChrome();
}

/** Save your records, start the agent workflow, and follow it until it finishes. */
export async function processNow() {
  if (S.agent.running) return;
  if (S.demo) {
    toast('In the demo there is no agent to start. Connect your repository to process real videos.');
    return;
  }
  S.agent = { running: true, steps: [], runId: newRunId(), runUrl: '', error: '', conclusion: '' };
  try {
    step('Saving your choices to GitHub');
    await S.remote.flush();
    const since = new Date(Date.now() - 60_000).toISOString();
    step('Starting the agent');
    await S.gh.dispatchAgent(S.agent.runId);
    ls.set('run', { runId: S.agent.runId, since });
    await follow(S.agent.runId, since);
  } catch (err) {
    S.agent.error = err.message || String(err);
    for (const s of S.agent.steps) if (s.state === 'active') s.state = 'failed';
    toast(S.agent.error, 'error', 9000);
  } finally {
    S.agent.running = false;
    ls.remove('run');
    S.renderChrome();
    S.render();
  }
}

async function follow(runId, since) {
  let run = null;
  for (let i = 0; i < 20 && !run; i++) {
    await wait(i ? 4000 : 2500);
    run = await S.gh.findRun(runId, since);
  }
  if (!run) throw new GitHubError('GitHub has not shown the agent run yet. Check Actions in your private repository; the run may still start.', 0);
  S.agent.runUrl = run.html_url;
  step('Queued on GitHub', 'active', run.html_url);
  const started = Date.now();
  let shownRunning = false;
  while (Date.now() - started < 100 * 60_000) {
    run = await S.gh.getRun(run.id);
    if (run.status === 'in_progress' && !shownRunning) {
      shownRunning = true;
      step('Gemini is watching your videos (a few minutes per video)', 'active', run.html_url);
    }
    if (run.status === 'completed') break;
    await wait(document.hidden ? 30_000 : 10_000);
  }
  if (!run || run.status !== 'completed') throw new GitHubError('The agent is still running. This page will show the results after your next refresh.', 0);
  S.agent.conclusion = run.conclusion;
  step('Loading the new library');
  await refresh({ quiet: true });
  for (const s of S.agent.steps) if (s.state === 'active') s.state = 'done';
  if (run.conclusion === 'success') toast('The agent finished. Your library is up to date.');
  else toast(`The agent finished with "${run.conclusion}". Open Activity for details.`, 'error', 9000);
}

/** After a reload, keep following a run that was started from this browser. */
export async function resumeFollow() {
  const r = ls.get('run');
  if (!r || !S.gh || S.agent.running) return;
  S.agent = { running: true, steps: [{ text: 'Agent started from this device', state: 'done', url: '' }], runId: r.runId, runUrl: '', error: '', conclusion: '' };
  try {
    await follow(r.runId, r.since);
  } catch (err) {
    S.agent.error = err.message;
  } finally {
    S.agent.running = false;
    ls.remove('run');
    S.renderChrome();
    S.render();
  }
}
