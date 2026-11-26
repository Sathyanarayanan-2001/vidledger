// Decide: you are the reviewer. Gemini suggests an action for each triaged video;
// approve it, pick another, or change the topic. Nothing heavy runs until you decide.

import { h, append, clear, icon, ICONS } from '../dom.js';
import { formatCount, plural } from '../format.js';
import { S, decide, config } from '../core.js';
import { ACTIONS, ACTION_BY_KEY, CATEGORIES, sortEntries } from '../model.js';
import { DEFAULT_TOPICS } from './topics-list.js';
import { toast, emptyState, thumb, worthStars, actionTag, confirm, select } from '../ui.js';
import { pageHead, banners, metaLine, processButton } from './common.js';

export function topicOptions(current) {
  const list = [...(config('topics', null) || DEFAULT_TOPICS)];
  for (const e of S.index.entries) if (e.topic && !list.includes(e.topic)) list.push(e.topic);
  if (current && !list.includes(current)) list.push(current);
  return list;
}

export function viewDecide() {
  const page = h('div', { class: 'page' });
  const items = sortEntries(S.index.entries.filter((e) => e.stage === 'decide'), 'priority');
  page.append(pageHead('Decide', 'Gemini watched each video and suggests what to do with it. You approve or change; the agent then builds packs and cards.'));
  append(page, banners());
  if (!items.length) {
    const waiting = S.index.entries.filter((e) => e.stage === 'new').length;
    page.append(emptyState('Nothing to decide right now',
      waiting ? `${plural(waiting, 'video')} still wait${waiting === 1 ? 's' : ''} for triage. Press Process now, or wait for the next scheduled run.` : 'Add videos, and they appear here after triage.',
      waiting ? processButton() : h('a', { href: '#/add', class: 'btn primary', text: 'Add videos' })));
    return page;
  }
  const sure = items.filter((e) => e.tri && e.tri.confidence === 'high');
  page.append(h('div', { class: 'bulkbar card' },
    h('p', {}, h('strong', { text: `${formatCount(items.length)} to decide` }), sure.length ? ` · ${formatCount(sure.length)} with high confidence` : ''),
    h('div', { class: 'row' },
      sure.length ? h('button', {
        type: 'button', class: 'btn', text: `Approve ${formatCount(sure.length)} high-confidence`,
        onclick: () => bulkApprove(sure),
      }) : null,
      h('button', { type: 'button', class: 'btn ghost', text: `Approve all ${formatCount(items.length)}`, onclick: () => bulkApprove(items) }))));
  page.append(h('ul', { class: 'decide-list', role: 'list' }, items.map(decideCard)));
  return page;
}

async function bulkApprove(list) {
  const counts = {};
  for (const e of list) counts[e.tri.action] = (counts[e.tri.action] || 0) + 1;
  const summary = Object.entries(counts).map(([a, n]) => `${ACTION_BY_KEY.get(a).name} ${n}`).join(' · ');
  if (!await confirm('Approve these suggestions?', `${summary}. You can change any of them later from the video's page.`, `Approve ${list.length}`)) return;
  for (const e of list) await decide(e.id, e.tri.action, e.tri.topic, e.tri.category);
  toast(`${plural(list.length, 'decision')} saved. Press Process now to start the agent.`);
  S.render();
}

export function decideCard(e) {
  const t = e.tri || {};
  let action = t.action || 'reference';
  const actionBtns = h('div', { class: 'segmented wrap', role: 'radiogroup', 'aria-label': `Action for ${e.title}` });
  const paint = () => {
    clear(actionBtns);
    for (const a of ACTIONS) {
      actionBtns.append(h('button', {
        type: 'button', class: `seg act-${a.key}`, role: 'radio', 'aria-checked': String(a.key === action), title: a.hint,
        onclick: () => { action = a.key; paint(); },
      }, a.key === t.action ? `${a.name} ✓` : a.name));
    }
  };
  paint();
  const topic = select(topicOptions(t.topic), t.topic || '', { 'aria-label': 'Topic' });
  const category = select(CATEGORIES, t.category || 'Learning', { 'aria-label': 'Category' });
  const li = h('li', { class: 'card decide' },
    h('div', { class: 'decide-head' },
      h('a', { href: `#/video/${e.id}`, class: 'decide-thumb', 'aria-label': `Open ${e.title}` }, thumb(e.id, { demo: S.demo })),
      h('div', { class: 'stack-sm' },
        h('a', { href: `#/video/${e.id}`, class: 'decide-title', text: e.title }),
        h('p', { class: 'muted small', text: metaLine(e) }),
        h('div', { class: 'tags' }, worthStars(t.worth_it), h('span', { class: 'tag', text: t.category || '' }), actionTag(t.action, 'Suggests: '),
          t.confidence ? h('span', { class: `tag conf-${t.confidence}`, text: `${t.confidence} confidence` }) : null))),
    t.gives_me ? h('p', {}, h('strong', { text: 'What it gives you: ' }), t.gives_me) : null,
    t.why ? h('p', { class: 'small' }, h('strong', { text: 'Why: ' }), t.why) : null,
    t.outdated ? h('p', { class: 'note warn small' }, icon(ICONS.alert), h('span', { text: `May be outdated: ${t.outdated}` })) : null,
    t.better_watched ? h('p', { class: 'note small' }, icon(ICONS.eye), h('span', { text: 'Better watched than read.' })) : null,
    t.evidence ? h('p', { class: 'muted small', text: `Gemini saw: ${t.evidence}` }) : null,
    actionBtns,
    h('div', { class: 'decide-foot' },
      h('label', { class: 'inline-field' }, h('span', { class: 'small', text: 'Topic' }), topic),
      h('label', { class: 'inline-field' }, h('span', { class: 'small', text: 'Category' }), category),
      h('button', {
        type: 'button', class: 'btn primary',
        onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          await decide(e.id, action, topic.value, category.value);
          toast(`${ACTION_BY_KEY.get(action).name}: ${e.title}`);
          S.render();
        },
      }, icon(ICONS.check), 'Confirm')));
  return li;
}

