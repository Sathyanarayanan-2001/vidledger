// Pieces several views share: page header, banners, the budget card, video rows.

import { h, icon, ICONS } from '../dom.js';
import { durationText, formatDateTime, formatTime, hoursText, plural } from '../format.js';
import { S, pending, processNow, config, today } from '../core.js';
import { deckCards, langName } from '../model.js';
import { deckStats } from '../srs.js';
import { stageTag, thumb, worthStars } from '../ui.js';

export function pageHead(title, lead, ...actions) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'row-between' }, h('h1', { text: title }), actions.length ? h('div', { class: 'row' }, actions) : null),
    lead ? h('p', { class: 'lead', text: lead }) : null);
}

export function banners() {
  const out = [];
  if (S.libError) out.push(h('div', { class: 'banner warn', role: 'alert' }, icon(ICONS.alert), h('p', { text: S.libError })));
  const a = S.lib && S.lib.agent;
  if (a && a.message) {
    const warn = !a.ok || ['auth', 'config'].includes(a.stopped);
    out.push(h('div', { class: `banner ${warn ? 'warn' : ''}`, role: warn ? 'alert' : 'status' }, icon(warn ? ICONS.alert : ICONS.clock),
      h('p', {}, h('strong', { text: 'Agent: ' }), a.message)));
  }
  if (S.libDropped) out.push(h('div', { class: 'banner', role: 'status' }, icon(ICONS.alert), h('p', { text: `${S.libDropped} malformed video(s) in the library file were skipped.` })));
  if (S.syncStatus === 'error') {
    out.push(h('div', { class: 'banner warn', role: 'alert' }, icon(ICONS.alert),
      h('p', {}, h('strong', { text: 'Not saved to GitHub: ' }), S.syncDetail || 'unknown error', ' Your changes are kept on this device.')));
  }
  return out;
}

export function processButton({ size = '' } = {}) {
  const n = pending();
  return h('button', {
    type: 'button', class: `btn primary ${size}`, disabled: S.agent.running ? true : null,
    onclick: () => processNow(),
  }, icon(ICONS.spark), S.agent.running ? 'Agent running…' : (n ? `Process now (${n})` : 'Process now'));
}

/** Today's video budget, the last run, and the Process now button. */
export function budgetCard() {
  const b = (S.lib && S.lib.budget) || {};
  const limit = Number(b.limit_s) || 27000;
  const used = Math.min(limit, Number(b.used_s) || 0);
  const pct = Math.round((used / limit) * 100);
  const run = S.lib && S.lib.runs.length ? S.lib.runs[S.lib.runs.length - 1] : null;
  const bar = h('span', { class: 'meter-fill' });
  bar.style.width = `${pct}%`;
  const resets = b.resets_at ? formatTime(new Date(b.resets_at), S.tz) : '';
  return h('section', { class: 'card stack', 'aria-labelledby': 'budget-title' },
    h('div', { class: 'row-between' },
      h('h2', { id: 'budget-title', text: 'Agent' }),
      processButton()),
    h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(limit), 'aria-valuenow': String(used),
      'aria-label': `Today's video budget: ${hoursText(used)} of ${hoursText(limit)} used` }, bar),
    h('p', { class: 'muted small', text: `Today's video budget: ${hoursText(used)} of ${hoursText(limit)} used${resets ? ` · resets at ${resets}` : ''}. Gemini's free tier allows 8 hours of YouTube video a day.` }),
    run ? h('p', { class: 'small' }, `Last run ${formatDateTime(new Date(run.finished_at || run.started_at), S.tz)}: `,
      `${run.done ? run.done.triage + run.done.learn + run.done.review + run.done.guide : 0} job(s) done`,
      run.failed ? `, ${run.failed} failed` : '', run.stopped ? ` (stopped: ${run.stopped})` : '', '. ',
      h('a', { href: '#/activity', text: 'Activity' })) : h('p', { class: 'muted small', text: 'The agent has not run yet.' }));
}

export function dueCount() {
  const cards = deckCards(S.cards.cards, S.index, { includeReference: !!config('revise', {}).includeReference });
  return deckStats(cards, (k) => S.records.get(`c:${k}`), today());
}

export function metaLine(e) {
  const parts = [e.channel, e.duration ? durationText(e.duration) : '', e.languages.map(langName).join(' + ')].filter(Boolean);
  return parts.join(' · ');
}

/** One video as a row (table-like on desktop, a card on phones). */
export function videoRow(e, { extra = null } = {}) {
  return h('li', { class: 'vrow' },
    h('a', { class: 'vrow-link', href: `#/video/${e.id}` },
      thumb(e.id, { demo: S.demo }),
      h('span', { class: 'vrow-main' },
        h('span', { class: 'vrow-title', text: e.title }),
        h('span', { class: 'vrow-meta muted small', text: metaLine(e) || 'Waiting for the agent to read the title' }),
        e.topic ? h('span', { class: 'vrow-topic small', text: e.topic }) : null)),
    h('span', { class: 'vrow-side' }, stageTag(e.stage), e.worth ? worthStars(e.worth) : null, extra));
}

export function countLine(n, one, many) {
  return plural(n, one, many);
}
