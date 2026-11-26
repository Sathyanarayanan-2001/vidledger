// Dashboard logic tests: links, spaced repetition, library model, records sync, exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, videoIdFrom, playlistIdFrom } from '../../docs/js/links.js';
import { schedule, buildQueue, deckStats, intervalLabel } from '../../docs/js/srs.js';
import { buildIndex, stageOf, validateLibrary, filterEntries, sortEntries, pendingWork, deckCards, slugify } from '../../docs/js/model.js';
import { RemoteRecords, parseRecordsFile } from '../../docs/js/remote.js';
import { merge } from '../../docs/js/merge.js';
import { csvCell, ankiCsv, libraryCsv } from '../../docs/js/exporter.js';
import { utf8ToB64, b64ToUtf8 } from '../../docs/js/github.js';
import { mmss, durationText, addDays, daysBetween } from '../../docs/js/format.js';

class Recs {
  constructor(obj = {}) { this.records = {}; for (const [k, v] of Object.entries(obj)) this.records[k] = { u: 1, v }; this.listeners = new Set(); }
  get(k) { const r = this.records[k]; return r && r.d !== 1 ? r.v : undefined; }
  entries(p) { return Object.entries(this.records).filter(([k, r]) => k.startsWith(p) && r.d !== 1).map(([k, r]) => [k, r.v]); }
  snapshot() { return { ...this.records }; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async mergeIn(inc, source) { this.records = merge(this.records, inc); for (const fn of this.listeners) fn(source); }
  async put(k, v) { this.records[k] = { u: Date.now(), v }; for (const fn of this.listeners) fn('local'); }
}

test('links: every YouTube form, playlists, Takeout CSV, no false ids', () => {
  assert.equal(videoIdFrom('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFrom('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoIdFrom('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(playlistIdFrom('https://www.youtube.com/playlist?list=WL'), null);
  const r = extractLinks('see https://youtu.be/dQw4w9WgXcQ and https://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://www.youtube.com/playlist?list=PLabcdefghijkl information https://www.youtube.com/playlist?list=WL');
  assert.deepEqual(r.videos.map((v) => v.id), ['dQw4w9WgXcQ']);
  assert.deepEqual(r.playlists, ['PLabcdefghijkl']);
  assert.equal(r.watchLater, true);
  const csv = 'Playlist Id,x\n\nVideo ID,Playlist Video Creation Timestamp\naaaaaaaaaa1,2024\nbbbbbbbbbb2,2024\n';
  assert.deepEqual(extractLinks(csv).videos.map((v) => v.id), ['aaaaaaaaaa1', 'bbbbbbbbbb2']);
  assert.deepEqual(extractLinks('{"videoId": "Ab_cd-EF123"}').videos.map((v) => v.id), ['Ab_cd-EF123']);
});

test('srs: the ladder, lapses and queue order', () => {
  const t = '2026-11-26';
  let p = schedule(undefined, 2, t);
  assert.deepEqual([p.ivl, p.due, p.reps], [1, '2026-11-27', 1]);
  p = schedule(p, 2, '2026-11-27');
  assert.equal(p.ivl, 3);
  p = schedule(p, 2, '2026-11-30');
  assert.equal(p.ivl, 8);
  const lapsed = schedule(p, 0, '2026-12-08');
  assert.deepEqual([lapsed.ivl, lapsed.due, lapsed.lapses], [0, '2026-12-08', 1]);
  assert.ok(lapsed.ef < p.ef);
  assert.equal(schedule(undefined, 3, t).ivl, 4);
  assert.equal(intervalLabel(0), 'today');
  assert.equal(intervalLabel(45), '6 wk');
  const cards = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  const prog = { a: { due: '2026-11-20', ivl: 3 }, b: { due: '2026-12-01', ivl: 30 }, c: { due: '2026-11-10', ivl: 1 } };
  assert.deepEqual(buildQueue(cards, (k) => prog[k], t, 5).map((c) => c.key), ['c', 'a', 'd']);
  assert.deepEqual(deckStats(cards, (k) => prog[k], t), { due: 2, fresh: 1, learned: 3, mature: 1, total: 4 });
});

const lib = validateLibrary({ app: 'vidledger', schema: 1, videos: [
  { id: 'aaaaaaaaaaa', title: 'A', duration_s: 600, triage: { category: 'Learning', topic: 'Grid', action: 'deep', priority: 1, worth_it: 5, languages: ['en'] } },
  { id: 'bbbbbbbbbbb', title: 'B', triage: { category: 'Learning', topic: 'Grid', action: 'reference', priority: 2, worth_it: 3, languages: ['ta', 'en'] },
    learn: { state: 'done', req: 'r1', topic: 'Grid' } },
  { id: 'ccccccccccc', title: 'C', triage: null, issue: { op: 'meta', kind: 'access', message: 'private' } },
  { id: 'ddddddddddd', title: 'D', triage: { category: 'Learning', topic: 'X', action: 'deep', priority: 3, worth_it: 2, languages: ['en'] },
    learn: { state: 'failed', req: 'r1', kind: 'server', attempts: 3 } },
  { bad: true },
], guides: [] });

test('model: stages from library plus records', () => {
  assert.equal(lib.dropped, 1);
  const recs = new Recs({
    'v:aaaaaaaaaaa': { at: '1' }, 'v:bbbbbbbbbbb': { at: '2' }, 'v:ccccccccccc': { at: '3' }, 'v:ddddddddddd': { at: '4' }, 'v:eeeeeeeeeee': { at: '5' },
    'd:bbbbbbbbbbb': { action: 'reference' }, 'j:bbbbbbbbbbb:learn': { at: 'r1' }, 'd:ddddddddddd': { action: 'deep' }, 'j:ddddddddddd:learn': { at: 'r1' },
  });
  const idx = buildIndex(lib.lib, recs);
  assert.deepEqual(idx.entries.map((e) => e.stage), ['decide', 'ready', 'issue', 'issue', 'new']);
  assert.equal(pendingWork(idx, lib.lib, recs), 1);
  recs.records['j:ddddddddddd:learn'] = { u: 2, v: { at: 'r2' } };
  assert.equal(stageOf('ddddddddddd', lib.lib.videos[3], recs), 'processing');
  recs.records['s:aaaaaaaaaaa'] = { u: 2, v: { status: 'dropped' } };
  assert.equal(stageOf('aaaaaaaaaaa', lib.lib.videos[0], recs), 'dropped');
  const idx2 = buildIndex(lib.lib, recs);
  assert.deepEqual(filterEntries(idx2.entries, { stage: 'all', lang: 'ta', query: '' }).map((e) => e.id), ['bbbbbbbbbbb']);
  assert.deepEqual(sortEntries(idx2.entries, 'worth').map((e) => e.id)[0], 'aaaaaaaaaaa');
  const cards = [{ key: 'bbbbbbbbbbb:1', video_id: 'bbbbbbbbbbb', topic: 'Grid' }, { key: 'g:grid:1', guide: 'grid', topic: 'Grid' }];
  assert.deepEqual(deckCards(cards, idx2).map((c) => c.key), ['g:grid:1']);
  assert.equal(deckCards(cards, idx2, { includeReference: true }).length, 2);
  assert.equal(slugify('Wind & grid integration'), 'wind-grid-integration');
});

test('remote: merges with another device and retries on conflict', async () => {
  const store = new Recs({ 'v:aaaaaaaaaaa': { at: '1' } });
  let remote = { exists: true, sha: 's1', text: JSON.stringify({ records: { 'v:bbbbbbbbbbb': { u: 5, v: { at: '2' } } } }) };
  let puts = 0;
  const gh = {
    async getUserRecords() { return remote; },
    async putUserRecords(text, sha) {
      puts++;
      if (puts === 1) { remote = { exists: true, sha: 's2', text: JSON.stringify({ records: { 'v:ccccccccccc': { u: 6, v: { at: '3' } }, 'v:bbbbbbbbbbb': { u: 5, v: { at: '2' } } } }) }; const e = new Error('conflict'); e.status = 409; throw e; }
      remote = { exists: true, sha: 's3', text };
      return 's3';
    },
  };
  const rr = new RemoteRecords(store, gh, { setTimer: () => 1, clearTimer: () => {}, online: () => true });
  await store.put('d:aaaaaaaaaaa', { action: 'deep' });
  await rr.flush();
  assert.equal(puts, 2);
  const saved = parseRecordsFile(remote.text);
  assert.deepEqual(Object.keys(saved).sort(), ['d:aaaaaaaaaaa', 'v:aaaaaaaaaaa', 'v:bbbbbbbbbbb', 'v:ccccccccccc']);
  assert.ok(store.get('v:ccccccccccc'));
  assert.equal(rr.status, 'saved');
});

test('exports and encodings', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  const anki = ankiCsv([{ front: 'Q?', back: 'A', video_id: 'aaaaaaaaaaa', t: 30, topic: 'Wind & grid' }]);
  assert.equal(anki, 'Q?,A (https://youtu.be/aaaaaaaaaaa?t=30),wind-grid vid_aaaaaaaaaaa\r\n');
  assert.ok(libraryCsv([]).startsWith('﻿Video ID,Title'));
  const tamil = 'வணக்கம் grid';
  assert.equal(b64ToUtf8(utf8ToB64(tamil)), tamil);
  assert.equal(mmss(3725), '1:02:05');
  assert.equal(durationText(59), '59 s');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-11-26', '2027-01-01'), 36);
});
