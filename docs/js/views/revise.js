// Revise: spaced-repetition flashcards from your Deep-learn videos and topic guides,
// and a quiz from every pack. Keys: Space shows the answer, 1-4 grade it.

import { h, append, icon, ICONS } from '../dom.js';
import { formatCount, plural } from '../format.js';
import { S, gradeCard, config, setConfig, today } from '../core.js';
import { deckCards } from '../model.js';
import { buildQueue, deckStats, schedule, intervalLabel, GRADES } from '../srs.js';
import { tile, emptyState, tsLink, select } from '../ui.js';
import { pageHead, banners } from './common.js';
import { quizItem } from './video.js';

const sess = { queue: [], i: 0, revealed: false, done: 0, again: 0, active: false, topic: 'all', mode: 'cards', requeued: new Set() };
const progressOf = (k) => S.records.get(`c:${k}`);

function settings() {
  const c = config('revise', {}) || {};
  return { newPerDay: Number.isFinite(Number(c.newPerDay)) ? Number(c.newPerDay) : 15, includeReference: !!c.includeReference };
}

function deck() {
  const st = settings();
  return deckCards(S.cards.cards, S.index, { includeReference: st.includeReference, topic: sess.topic });
}

function newLeft() {
  const rv = S.records.get(`rv:${today()}`) || {};
  return Math.max(0, settings().newPerDay - (Number(rv.fresh) || 0));
}

export function viewRevise() {
  const page = h('div', { class: 'page narrow' });
  page.append(pageHead('Revise', 'A few minutes a day. Cards come back just before you would forget them.'));
  append(page, banners());
  const cards = deck();
  const stats = deckStats(cards, progressOf, today());
  const mode = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Revise mode' },
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(sess.mode === 'cards'), text: 'Flashcards', onclick: () => { sess.mode = 'cards'; S.render(); } }),
    h('button', { type: 'button', class: 'seg', 'aria-pressed': String(sess.mode === 'quiz'), text: 'Quiz', onclick: () => { sess.mode = 'quiz'; sess.active = false; S.render(); } }));
  const topics = [...new Set(S.cards.cards.map((c) => c.topic).filter(Boolean))].sort();
  const topicSel = select([['all', 'All topics'], ...topics.map((t) => [t, t])], sess.topic, { 'aria-label': 'Topic' });
  topicSel.addEventListener('change', () => { sess.topic = topicSel.value; sess.active = false; S.render(); });
  page.append(h('div', { class: 'row wrap' }, mode, h('label', { class: 'inline-field' }, h('span', { class: 'small', text: 'Topic' }), topicSel)));
  if (sess.mode === 'quiz') {
    page.append(quizView());
    return page;
  }
  if (!S.cards.cards.length) {
    page.append(emptyState('No flashcards yet', 'Cards come from videos you mark Deep-learn, once the agent has built their packs.', h('a', { href: '#/decide', class: 'btn', text: 'Decide' })));
    return page;
  }
  const dueToday = stats.due + Math.min(stats.fresh, newLeft());
  page.append(h('div', { class: 'tiles tiles-4' },
    tile('Due now', formatCount(stats.due), 'reviews'),
    tile('New today', formatCount(Math.min(stats.fresh, newLeft())), `of ${formatCount(stats.fresh)} unseen`),
    tile('In your deck', formatCount(stats.total), sess.topic === 'all' ? 'cards' : sess.topic),
    tile('Mature', formatCount(stats.mature), 'interval of 3 weeks or more')));
  if (!sess.active) {
    const inc = h('input', { type: 'checkbox', id: 'inc-ref', checked: settings().includeReference ? true : null });
    inc.addEventListener('change', async () => { await setConfig('revise', { ...settings(), includeReference: inc.checked }); S.render(); });
    page.append(h('section', { class: 'card stack' },
      h('h2', { text: dueToday ? `${plural(dueToday, 'card')} for today` : 'Nothing due right now' }),
      h('p', { class: 'muted', text: dueToday ? 'Answer in your head first, then show the answer and grade yourself honestly.' : 'Come back tomorrow, or switch to the quiz.' }),
      h('div', { class: 'check' }, inc, h('label', { for: 'inc-ref', text: 'Include Reference videos too' })),
      dueToday ? h('div', {}, h('button', {
        type: 'button', class: 'btn primary lg',
        onclick: () => {
          Object.assign(sess, { queue: buildQueue(cards, progressOf, today(), newLeft()), i: 0, revealed: false, done: 0, again: 0, active: true, requeued: new Set() });
          S.render();
        },
      }, icon(ICONS.cards), 'Start')) : null));
    return page;
  }
  page.append(sessionCard());
  return page;
}

function sessionCard() {
  if (sess.i >= sess.queue.length) {
    sess.active = false;
    return h('section', { class: 'card stack', role: 'status' }, h('h2', { text: 'Done for now' }),
      h('p', { text: `${plural(sess.done, 'answer')}, ${formatCount(sess.again)} to see again. Well done.` }),
      h('div', {}, h('button', { type: 'button', class: 'btn', text: 'Back to revise', onclick: () => S.render() })));
  }
  const c = sess.queue[sess.i];
  const prev = progressOf(c.key);
  const e = c.video_id ? S.index.byId.get(c.video_id) : null;
  const grade = async (g) => {
    await gradeCard(c.key, g);
    sess.done++;
    if (g === 0) {
      sess.again++;
      if (!sess.requeued.has(c.key)) {
        sess.requeued.add(c.key);
        sess.queue.push(c);
      }
    }
    sess.i++;
    sess.revealed = false;
    S.render();
  };
  const card = h('section', { class: 'card flashcard stack', 'aria-live': 'polite' },
    h('p', { class: 'muted small', text: `${sess.i + 1} of ${sess.queue.length}${!prev || !prev.due ? ' · new' : ''}${c.topic ? ` · ${c.topic}` : ''}` }),
    h('p', { class: 'flash-q', text: c.front }),
    sess.revealed
      ? h('div', { class: 'stack' },
        h('hr'),
        h('p', { class: 'flash-a', text: c.back }),
        e ? h('p', { class: 'small' }, tsLink(c.video_id, c.t), ' ', h('a', { href: `#/video/${c.video_id}`, class: 'muted', text: e.title })) : null,
        h('div', { class: 'grades', role: 'group', 'aria-label': 'How well did you recall it?' },
          GRADES.map((gr, n) => h('button', { type: 'button', class: `btn grade g-${gr.key}`, onclick: () => grade(n), title: gr.hint },
            h('span', { text: gr.label }), h('span', { class: 'small muted', text: intervalLabel(schedule(prev, n, today()).ivl) })))),
        h('p', { class: 'muted small', text: 'Keys: 1 Again · 2 Hard · 3 Good · 4 Easy' }))
      : h('div', {}, h('button', { type: 'button', class: 'btn primary lg', text: 'Show answer', onclick: () => { sess.revealed = true; S.render(); } }),
        h('p', { class: 'muted small', text: 'Key: Space' })));
  card._grade = grade;
  return card;
}

function quizView() {
  const qs = S.cards.quiz.filter((q) => sess.topic === 'all' || q.topic === sess.topic);
  if (!qs.length) return emptyState('No quiz questions yet', 'Every learning pack adds five questions.');
  const pick = [...qs].sort(() => Math.random() - 0.5).slice(0, 10);
  return h('section', { class: 'card stack' }, h('h2', { text: `Quiz: ${pick.length} questions` }),
    ...pick.map((q, n) => quizItem(q, n, true)),
    h('div', {}, h('button', { type: 'button', class: 'btn', text: 'New questions', onclick: () => S.render() })));
}

document.addEventListener('keydown', (ev) => {
  if (S.route !== 'revise' || !sess.active || sess.mode !== 'cards') return;
  if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
  if (!sess.revealed && (ev.key === ' ' || ev.key === 'Enter')) {
    ev.preventDefault();
    sess.revealed = true;
    S.render();
  } else if (sess.revealed && ['1', '2', '3', '4'].includes(ev.key)) {
    const card = document.querySelector('.flashcard');
    if (card && card._grade) card._grade(Number(ev.key) - 1);
  }
});
