// Topics: your library grouped by topic, and the study guide Gemini builds from
// all finished packs of a topic (concepts, a one-hour path, overlaps and gaps).

import { h, append, clear, icon, ICONS, dataTable } from '../dom.js';
import { formatCount, hoursText, formatDateTime, mmss, plural } from '../format.js';
import { S, getGuide, requestGuide, processNow } from '../core.js';
import { slugify } from '../model.js';
import { toast, emptyState, tsLink, externalLink } from '../ui.js';
import { pageHead, banners, videoRow } from './common.js';

function topicGroups() {
  const groups = new Map();
  for (const e of S.index.entries) {
    if (e.stage === 'dropped' || !e.topic) continue;
    const g = groups.get(e.topic) || { topic: e.topic, slug: slugify(e.topic), entries: [], packs: 0, seconds: 0 };
    g.entries.push(e);
    g.seconds += e.duration || 0;
    if (e.v && e.v.learn && e.v.learn.state === 'done') g.packs++;
    groups.set(e.topic, g);
  }
  return [...groups.values()].sort((a, b) => b.packs - a.packs || b.entries.length - a.entries.length || a.topic.localeCompare(b.topic));
}

function guideStatus(g) {
  const built = S.lib && S.lib.guides.find((x) => x.slug === g.slug);
  const req = S.records.get(`g:${g.slug}`);
  if (req && (!built || built.req !== String(req.at))) return { state: 'requested', built };
  return { state: built && built.state === 'done' ? 'done' : built ? built.state : 'none', built };
}

export function viewTopics() {
  const page = h('div', { class: 'page' });
  page.append(pageHead('Topics', 'Once a topic has a few finished packs, build its study guide: one path through the best segments, instead of rewatching every video.'));
  append(page, banners());
  const groups = topicGroups();
  if (!groups.length) {
    page.append(emptyState('No topics yet', 'Topics appear after triage.', h('a', { href: '#/add', class: 'btn primary', text: 'Add videos' })));
    return page;
  }
  page.append(h('ul', { class: 'topic-grid', role: 'list' }, groups.map((g) => {
    const st = guideStatus(g);
    const cards = S.cards.cards.filter((c) => c.topic === g.topic).length;
    return h('li', { class: 'card topic-card stack-sm' },
      h('h2', { class: 'topic-name', text: g.topic }),
      h('p', { class: 'muted small', text: `${plural(g.entries.length, 'video')} · ${formatCount(g.packs)} pack${g.packs === 1 ? '' : 's'} ready · ${hoursText(g.seconds)} · ${formatCount(cards)} cards` }),
      h('div', { class: 'row wrap' },
        st.state === 'done' ? h('a', { href: `#/topic/${g.slug}`, class: 'btn sm primary' }, icon(ICONS.guide), 'Open study guide') : null,
        st.state === 'requested' ? h('span', { class: 'tag queued', text: 'Guide requested' }) : null,
        st.state !== 'requested' ? h('button', {
          type: 'button', class: `btn sm ${st.state === 'done' ? 'ghost' : ''}`, disabled: g.packs ? null : true,
          title: g.packs ? '' : 'Needs at least one finished learning pack',
          onclick: async () => {
            await requestGuide(g.topic);
            toast(`Study guide for ${g.topic} requested.`);
            S.render();
          },
        }, st.state === 'done' ? 'Rebuild guide' : 'Build study guide') : null,
        h('a', { href: '#/library', class: 'btn sm ghost', text: 'Videos', onclick: () => { S.f.topic = g.topic; S.f.stage = 'all'; } })),
      st.built && st.built.state === 'failed' ? h('p', { class: 'note warn small' }, icon(ICONS.alert), h('span', { text: st.built.error || 'The last attempt failed.' })) : null);
  })));
  if (groups.some((g) => guideStatus(g).state === 'requested')) page.append(h('div', {}, h('button', { type: 'button', class: 'btn primary', onclick: () => processNow() }, icon(ICONS.spark), 'Process now')));
  return page;
}

export function viewTopic(slug) {
  const page = h('div', { class: 'page' });
  const built = S.lib && S.lib.guides.find((g) => g.slug === slug);
  page.append(h('p', {}, h('a', { href: '#/topics', text: '← All topics' })));
  if (!built || built.state !== 'done') {
    page.append(emptyState('No study guide yet', 'Build it from the Topics page.', h('a', { href: '#/topics', class: 'btn', text: 'Topics' })));
    return page;
  }
  page.append(pageHead(built.topic, `${plural(built.videos.length, 'video')} · built ${formatDateTime(new Date(built.at), S.tz)}`));
  const holder = h('div', { class: 'stack' }, h('p', { class: 'muted', text: 'Loading the study guide…' }));
  page.append(holder);
  getGuide(slug).then((data) => {
    clear(holder);
    renderGuide(data, holder);
  }).catch((err) => {
    clear(holder);
    holder.append(h('div', { class: 'banner warn', role: 'alert' }, icon(ICONS.alert), h('p', { text: `Could not load the guide: ${err.message}` })));
  });
  return page;
}

const titleOf = (id) => (S.index.byId.get(id) || { title: id }).title;

function renderGuide(data, holder) {
  const g = data.guide;
  if (g.path.length) {
    holder.append(h('section', { class: 'card stack' }, h('h2', { text: `Your ${g.path_minutes}-minute path` }),
      h('p', { class: 'muted small', text: 'Watch these segments in this order. Together they cover every core concept.' }),
      h('ol', { class: 'path' }, g.path.map((p) => h('li', {},
        h('div', {}, tsLink(p.video_id, p.start, `${mmss(p.start)}–${mmss(p.end)}`), ' ', h('a', { href: `#/video/${p.video_id}`, text: titleOf(p.video_id) })),
        h('p', { class: 'muted small', text: p.why }))))));
  }
  if (g.concepts.length) {
    holder.append(h('section', { class: 'card stack' }, h('h2', { text: 'Core concepts' }),
      h('ol', { class: 'concepts' }, g.concepts.map((c) => h('li', { class: 'concept' },
        h('h3', { text: c.name }), h('p', { text: c.explanation }),
        c.best ? h('p', { class: 'small' }, 'Best explained: ', tsLink(c.best.video_id, c.best.t), ' in ', h('a', { href: `#/video/${c.best.video_id}`, text: titleOf(c.best.video_id) })) : null,
        c.disagreements ? h('p', { class: 'note warn small' }, icon(ICONS.alert), h('span', { text: `Sources differ: ${c.disagreements}` })) : null)))));
  }
  if (g.overlaps.length) {
    holder.append(h('section', { class: 'card stack' }, h('h2', { text: 'Overlaps' }),
      h('ul', { class: 'bullets' }, g.overlaps.map((o) => h('li', {}, o.note, o.best_video_id ? h('span', { class: 'muted' }, ' Best: ', h('a', { href: `#/video/${o.best_video_id}`, text: titleOf(o.best_video_id) })) : null)))));
  }
  if (g.gaps.length) {
    holder.append(h('section', { class: 'card stack' }, h('h2', { text: 'Gaps: not covered by any of your videos' }),
      h('ul', { class: 'bullets' }, g.gaps.map((x) => h('li', {}, x.gap, ' ', externalLink(`https://www.youtube.com/results?search_query=${encodeURIComponent(x.query)}`, `Search: ${x.query}`))))));
  }
  const src = (id, t) => (id ? h('span', {}, tsLink(id, t), ' ', h('a', { href: `#/video/${id}`, class: 'muted small', text: titleOf(id) })) : '');
  if (g.glossary.length) holder.append(h('section', { class: 'card stack' }, h('h2', { text: 'Glossary' }), dataTable(['Term', 'Meaning', 'Source'], g.glossary.map((x) => [x.term, x.meaning, src(x.video_id, x.t)]))));
  if (g.formulas.length) holder.append(h('section', { class: 'card stack' }, h('h2', { text: 'Formulas, numbers and standards' }), h('ul', { class: 'ts-list' }, g.formulas.map((f) => h('li', {}, f.text, ' ', src(f.video_id, f.t))))));
  if (g.flashcards.length) holder.append(h('section', { class: 'card stack' }, h('h2', { text: `Flashcards (${g.flashcards.length})` }), h('p', { class: 'muted small' }, 'These are in your revision deck. ', h('a', { href: '#/revise', text: 'Revise' }))));
  const videos = data.videos.map((id) => S.index.byId.get(id)).filter(Boolean);
  if (videos.length) holder.append(h('section', { class: 'card stack' }, h('h2', { text: 'Videos in this guide' }), h('ul', { class: 'vlist', role: 'list' }, videos.map((e) => videoRow(e)))));
}
