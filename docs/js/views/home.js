// Home: the one next thing to do, the figures that matter, and quick add.

import { h, append, icon, ICONS } from '../dom.js';
import { formatCount, hoursText, plural } from '../format.js';
import { S, addVideos, processNow } from '../core.js';
import { extractLinks } from '../links.js';
import { tile, toast, emptyState } from '../ui.js';
import { pageHead, banners, budgetCard, dueCount, videoRow } from './common.js';

const go = (route) => { location.hash = `#/${route}`; };

export function viewHome() {
  const page = h('div', { class: 'page' });
  page.append(pageHead('Learn from your backlog, not just save it.',
    'Paste YouTube links. Gemini watches each video and VidLedger sorts it; you only decide and review.'));
  append(page, banners());
  const e = S.index.entries;
  const by = (stage) => e.filter((x) => x.stage === stage);
  const decide = by('decide');
  const ready = by('ready');
  const waiting = [...by('new'), ...by('processing')];
  const cards = dueCount();
  const dueNow = cards.due + Math.min(cards.fresh, Number((S.records.get('cfg:revise') || {}).newPerDay ?? 15));

  if (!e.length) {
    page.append(emptyState(S.loading ? 'Loading your library…' : 'Your library is empty',
      S.loading ? 'This takes a few seconds.' : 'Add the links of the videos you saved. The agent triages them first, then you decide what deserves a full learning pack.',
      h('div', { class: 'row' }, h('a', { href: '#/add', class: 'btn primary' }, icon(ICONS.plus), 'Add videos'), h('a', { href: '#/guide', class: 'btn ghost', text: 'Setup guide' }))));
    page.append(quickAdd());
    return page;
  }

  let hero;
  if (decide.length) hero = ['decide', `${plural(decide.length, 'video')} need${decide.length === 1 ? 's' : ''} your decision`, 'Gemini has triaged them. Approve its suggestion or choose another, and the agent does the rest.', 'Review decisions', () => go('decide')];
  else if (ready.length) hero = ['ready', `${plural(ready.length, 'pack')} ready to review`, 'Read the TL;DR, rewatch only the segments that matter, and tick the reviewer checklist.', 'Open the first', () => go(`video/${ready[0].id}`)];
  else if (dueNow) hero = ['revise', `${plural(dueNow, 'flashcard')} to revise today`, 'A few minutes a day keeps what you learned.', 'Start revising', () => go('revise')];
  else if (waiting.length) hero = ['waiting', `${plural(waiting.length, 'video')} waiting for the agent`, 'Press Process now to start it, or wait for the next scheduled run (every 6 hours).', 'Process now', () => processNow()];
  else hero = ['done', 'All caught up', 'Nothing waits for you. Add more videos, or revise a topic.', 'Add videos', () => go('add')];
  page.append(h('section', { class: 'card hero', 'aria-labelledby': 'hero-title' },
    h('div', {}, h('h2', { id: 'hero-title', text: hero[1] }), h('p', { class: 'muted', text: hero[2] })),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary lg', onclick: hero[4], disabled: hero[0] === 'waiting' && S.agent.running ? true : null }, hero[3]))));

  const learned = by('learned').length + by('mastered').length;
  const live = e.filter((x) => x.stage !== 'dropped');
  const hours = live.reduce((s, x) => s + (x.duration || 0), 0);
  page.append(h('div', { class: 'tiles' },
    tile('In your library', formatCount(live.length), hours ? `${hoursText(hours)} of video` : 'videos', () => go('library')),
    tile('Needs your decision', formatCount(decide.length), 'triaged by Gemini', () => go('decide')),
    tile('Ready to review', formatCount(ready.length), 'packs and cards', () => { S.f.stage = 'ready'; go('library'); }),
    tile('Cards due today', formatCount(dueNow), `${formatCount(cards.total)} in your deck`, () => go('revise')),
    tile('Learned', formatCount(learned), `${formatCount(by('mastered').length)} mastered`, () => { S.f.stage = 'learned'; go('library'); }),
    tile('Waiting for the agent', formatCount(waiting.length), 'new or processing', () => go('activity'))));
  page.append(h('div', { class: 'grid-2' }, budgetCard(), quickAdd()));
  if (ready.length) {
    page.append(h('section', { class: 'card stack', 'aria-labelledby': 'ready-title' },
      h('h2', { id: 'ready-title', text: 'Ready to review' }),
      h('ul', { class: 'vlist', role: 'list' }, ready.slice(0, 5).map((x) => videoRow(x)))));
  }
  return page;
}

function quickAdd() {
  const box = h('textarea', { rows: 3, placeholder: 'Paste one or more YouTube links', 'aria-label': 'YouTube links', spellcheck: 'false' });
  const status = h('p', { class: 'muted small', role: 'status' });
  const add = async () => {
    const found = extractLinks(box.value);
    if (!found.videos.length && !found.playlists.length) {
      status.textContent = found.watchLater
        ? 'Watch Later is private, so it cannot be read by link. Open Add videos for how to export it.'
        : 'No YouTube links found. Paste links like https://youtu.be/… or https://www.youtube.com/watch?v=…';
      return;
    }
    const n = await addVideos(found.videos, found.playlists);
    box.value = '';
    status.textContent = '';
    toast(n ? `${plural(n, 'video')} added. Press Process now to triage ${n === 1 ? 'it' : 'them'}.` : 'Those videos are already in your library.');
    S.render();
  };
  return h('section', { class: 'card stack', 'aria-labelledby': 'qa-title' },
    h('h2', { id: 'qa-title', text: 'Quick add' }),
    box,
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onclick: add }, icon(ICONS.plus), 'Add'),
      h('a', { href: '#/add', class: 'btn ghost', text: 'Import a list or file' })),
    status);
}
