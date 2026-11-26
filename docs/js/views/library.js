// Library: every video you added, filterable by stage, category, topic and language.

import { h, append, clear, icon, ICONS } from '../dom.js';
import { formatCount, hoursText } from '../format.js';
import { S } from '../core.js';
import { STAGES, CATEGORIES, filterEntries, sortEntries, langName } from '../model.js';
import { emptyState, select } from '../ui.js';
import { pageHead, banners, videoRow } from './common.js';

export function viewLibrary() {
  const page = h('div', { class: 'page' });
  const all = S.index.entries;
  page.append(pageHead('Library', `${formatCount(all.length)} videos. Search by title, channel, topic or tag.`,
    h('a', { href: '#/add', class: 'btn' }, icon(ICONS.plus), 'Add videos')));
  append(page, banners());
  if (!all.length) {
    page.append(emptyState('No videos yet', 'Add links, and they appear here.', h('a', { href: '#/add', class: 'btn primary', text: 'Add videos' })));
    return page;
  }
  const counts = new Map();
  for (const e of all) counts.set(e.stage, (counts.get(e.stage) || 0) + 1);
  const topics = [...new Set(all.map((e) => e.topic).filter(Boolean))].sort();
  const langs = [...new Set(all.flatMap((e) => e.languages))].sort();
  const list = h('ul', { class: 'vlist', role: 'list', 'aria-live': 'polite' });
  const summary = h('p', { class: 'muted small', role: 'status' });
  const more = h('div', {});

  const draw = () => {
    const rows = sortEntries(filterEntries(all, S.f), S.f.sort);
    clear(list);
    clear(more);
    const hours = rows.reduce((s, e) => s + (e.duration || 0), 0);
    summary.textContent = `${formatCount(rows.length)} of ${formatCount(all.length)} shown${hours ? ` · ${hoursText(hours)}` : ''}`;
    if (!rows.length) list.append(h('li', { class: 'empty-row', text: 'No videos match these filters.' }));
    for (const e of rows.slice(0, S.f.limit)) list.append(videoRow(e));
    if (rows.length > S.f.limit) {
      more.append(h('button', { type: 'button', class: 'btn ghost', text: `Show ${formatCount(Math.min(60, rows.length - S.f.limit))} more`, onclick: () => { S.f.limit += 60; draw(); } }));
    }
  };
  const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Stage' });
  const paintChips = () => {
    clear(chips);
    for (const s of [{ key: 'all', short: 'All' }, ...STAGES]) {
      const n = s.key === 'all' ? all.length : counts.get(s.key) || 0;
      if (s.key !== 'all' && !n) continue;
      chips.append(h('button', {
        type: 'button', class: 'chip', role: 'tab', 'aria-selected': String(S.f.stage === s.key),
        onclick: () => { S.f.stage = s.key; S.f.limit = 60; paintChips(); draw(); },
      }, s.short, h('span', { class: 'chip-n', text: formatCount(n) })));
    }
  };
  paintChips();
  const search = h('input', { type: 'search', placeholder: 'Search', value: S.f.query, 'aria-label': 'Search the library' });
  search.addEventListener('input', () => { S.f.query = search.value; S.f.limit = 60; draw(); });
  const sel = (key, opts, label) => {
    const s = select(opts, S.f[key], { 'aria-label': label });
    s.addEventListener('change', () => { S.f[key] = s.value; S.f.limit = 60; draw(); });
    return h('label', { class: 'inline-field' }, h('span', { class: 'small', text: label }), s);
  };
  page.append(h('section', { class: 'card filters-card stack' },
    h('div', { class: 'row search-row' }, icon(ICONS.search), search),
    chips,
    h('div', { class: 'row wrap' },
      sel('category', [['all', 'All'], ...CATEGORIES.map((c) => [c, c])], 'Category'),
      sel('topic', [['all', 'All'], ...topics.map((t) => [t, t])], 'Topic'),
      sel('lang', [['all', 'All'], ...langs.map((l) => [l, langName(l)])], 'Language'),
      sel('sort', [['priority', 'Priority'], ['worth', 'Worth-it'], ['added', 'Recently added'], ['duration', 'Shortest first'], ['title', 'Title']], 'Sort'))));
  page.append(summary, list, more);
  draw();
  return page;
}
