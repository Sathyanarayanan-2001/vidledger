// Exports: the library as CSV (opens in Excel), flashcards for Anki, and a backup of your records.
// CSV cells that start with = + - @ are prefixed with ' so spreadsheets never run them as formulas.

import { mmss } from './format.js';
import { shortUrl, watchUrl } from './links.js';
import { STAGE_BY_KEY, ACTION_BY_KEY } from './model.js';

export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells) => cells.map(csvCell).join(',');

export function libraryCsv(entries) {
  const head = ['Video ID', 'Title', 'Channel', 'URL', 'Duration', 'Languages', 'Category', 'Topic', 'Worth-it', 'Priority',
    'Suggested action', 'My decision', 'Stage', 'My rating', 'Added'];
  const rows = entries.map((e) => [
    e.id, e.title, e.channel, watchUrl(e.id), e.duration ? mmss(e.duration) : '', e.languages.join(' '), e.category, e.topic,
    e.worth || '', e.tri ? e.tri.priority : '', e.tri ? (ACTION_BY_KEY.get(e.tri.action) || {}).name || '' : '',
    e.decision ? (ACTION_BY_KEY.get(e.decision.action) || {}).name || '' : '', (STAGE_BY_KEY.get(e.stage) || {}).name || e.stage,
    e.mine.rating || '', e.added.slice(0, 10),
  ]);
  return '﻿' + [head, ...rows].map(csvRow).join('\r\n') + '\r\n';
}

/** Anki import: Front, Back (with the timestamp link), Tags. No header row; choose "Comma" in Anki's import dialog. */
export function ankiCsv(cards) {
  const tag = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cards.map((c) => csvRow([
    c.front,
    c.video_id ? `${c.back} (${shortUrl(c.video_id, c.t)})` : c.back,
    [tag(c.topic) || 'vidledger', c.video_id ? `vid_${c.video_id}` : '', c.guide ? 'guide' : ''].filter(Boolean).join(' '),
  ])).join('\r\n') + '\r\n';
}

export function download(name, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
