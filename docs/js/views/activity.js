// Activity: the agent's runs, anything that needs attention, and what is waiting.

import { h, append, icon, ICONS, dataTable } from '../dom.js';
import { formatDateTime, formatCount, hoursText, plural } from '../format.js';
import { S, rerun, refresh } from '../core.js';
import { NO_RETRY } from '../model.js';
import { toast, emptyState, externalLink } from '../ui.js';
import { pageHead, banners, budgetCard, videoRow } from './common.js';

export function viewActivity() {
  const page = h('div', { class: 'page' });
  page.append(pageHead('Activity', 'The agent runs every 6 hours, and whenever you press Process now.',
    h('button', { type: 'button', class: 'btn ghost', onclick: () => refresh() }, icon(ICONS.refresh), 'Refresh')));
  append(page, banners());
  if (S.agent.steps.length) {
    page.append(h('section', { class: 'card stack', 'aria-live': 'polite' }, h('h2', { text: S.agent.running ? 'Agent running' : 'Last run from this device' }),
      h('ol', { class: 'progress' }, S.agent.steps.map((s) => h('li', { class: s.state },
        h('span', { class: `status-dot ${s.state === 'done' ? 'ok' : s.state === 'failed' ? 'failed' : 'running'}`, 'aria-hidden': 'true' }),
        h('span', { text: s.text }), s.url ? externalLink(s.url, 'View on GitHub') : null))),
      S.agent.error ? h('p', { class: 'error-text', text: S.agent.error }) : null));
  }
  page.append(budgetCard());
  const issues = S.index.entries.filter((e) => e.stage === 'issue');
  if (issues.length) {
    page.append(h('section', { class: 'card stack' }, h('h2', { text: `Needs attention (${issues.length})` }),
      h('ul', { class: 'vlist', role: 'list' }, issues.map((e) => {
        const issue = (e.v && e.v.issue) || {};
        const op = issue.op && issue.op !== 'meta' ? issue.op : null;
        return videoRow(e, {
          extra: h('span', { class: 'stack-sm' }, h('span', { class: 'small', text: issue.message || 'The agent could not finish.' }),
            op && !NO_RETRY.has(issue.kind) ? h('button', { type: 'button', class: 'btn sm', text: 'Try again', onclick: async () => { await rerun(e.id, op); toast('Requested again.'); S.render(); } }) : null),
        });
      }))));
  }
  const waiting = S.index.entries.filter((e) => e.stage === 'new' || e.stage === 'processing');
  if (waiting.length) {
    page.append(h('section', { class: 'card stack' }, h('h2', { text: `Waiting for the agent (${waiting.length})` }),
      h('ul', { class: 'vlist', role: 'list' }, waiting.slice(0, 30).map((e) => videoRow(e)))));
  }
  const runs = S.lib ? [...S.lib.runs].reverse() : [];
  if (!runs.length) page.append(emptyState('No runs yet', 'Press Process now, or wait for the next scheduled run.'));
  else {
    page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Recent runs' }),
      dataTable(['Finished', 'Jobs done', 'Failed', 'Video', 'Minutes', 'Stopped', 'Log'], runs.map((r) => [
        formatDateTime(new Date(r.finished_at || r.started_at), S.tz),
        r.done ? `${r.done.triage} triage · ${r.done.learn} packs · ${r.done.review} cards · ${r.done.guide} guides` : '-',
        formatCount(r.failed || 0), hoursText(r.video_s || 0), String(r.minutes ?? ''), r.stopped || '-',
        r.url ? externalLink(r.url, 'GitHub') : '-',
      ]), { numeric: new Set([2, 4]), caption: 'Recent agent runs' })));
  }
  const months = S.lib ? Object.entries(S.lib.usage || {}).reverse() : [];
  if (months.length) {
    page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Usage by month' }),
      dataTable(['Month', 'Runs', 'Runner minutes', 'Video', 'Gemini tokens in', 'Tokens out'], months.map(([m, u]) => [
        m, formatCount(u.runs || 0), formatCount(Math.round(u.runner_minutes || 0)), hoursText(u.video_s || 0), formatCount(u.tokens_in || 0), formatCount(u.tokens_out || 0),
      ]), { numeric: new Set([1, 2, 4, 5]) }),
      h('p', { class: 'muted small', text: `Private repositories get 2,000 free GitHub Actions minutes a month. ${plural(months.length, 'month')} shown.` })));
  }
  return page;
}
