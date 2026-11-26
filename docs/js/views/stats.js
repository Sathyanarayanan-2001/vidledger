// Dashboard: where the backlog stands, what it is about, and how learning is going.

import { h, append } from '../dom.js';
import { formatCount, hoursText, addDays } from '../format.js';
import { S, today } from '../core.js';
import { STAGES, libraryStats, reviewSeries, langName } from '../model.js';
import { chartCard } from '../charts.js';
import { tile, emptyState } from '../ui.js';
import { pageHead, banners, dueCount } from './common.js';

export function viewStats() {
  const page = h('div', { class: 'page' });
  page.append(pageHead('Dashboard', 'Your backlog, your topics and your revision, at a glance. Every chart has a table view.'));
  append(page, banners());
  if (!S.index.entries.length) {
    page.append(emptyState('Nothing to show yet', 'Add videos and let the agent triage them.', h('a', { href: '#/add', class: 'btn primary', text: 'Add videos' })));
    return page;
  }
  const st = libraryStats(S.index, S.lib, { timeZone: S.tz, reviewsByDay: reviewSeries(S.records, today(), 30, addDays) });
  const cards = dueCount();
  const month = new Date().toISOString().slice(0, 7);
  const use = (S.lib && S.lib.usage && S.lib.usage[month]) || {};
  const reviews30 = st.reviewsByDay.reduce((s, d) => s + d.value, 0);
  page.append(h('div', { class: 'tiles' },
    tile('Videos', formatCount(st.total), `${hoursText(st.hoursTotal)} in total`),
    tile('Processed', hoursText(st.hoursDone), 'of video turned into packs and cards'),
    tile('Flashcards', formatCount(cards.total), `${formatCount(cards.learned)} seen · ${formatCount(cards.mature)} mature`),
    tile('Reviews, 30 days', formatCount(reviews30), 'flashcard answers'),
    tile('Agent minutes', `${formatCount(Math.round(use.runner_minutes || 0))}`, 'this month on GitHub Actions (2,000 free in private repos)'),
    tile('Gemini tokens', formatCount(Math.round(((use.tokens_in || 0) + (use.tokens_out || 0)) / 1000)) + 'K', 'this month')));
  const stageData = STAGES.map((s) => ({ key: s.key, label: s.short, tableLabel: s.name, value: st.byStage.get(s.key) || 0, slot: s.slot })).filter((d) => d.value);
  page.append(h('div', { class: 'chart-grid' },
    chartCard({ id: 'c-stage', title: 'Where your videos are', subtitle: 'From added to mastered', data: stageData, format: formatCount, labelHeader: 'Stage', valueHeader: 'Videos' }),
    chartCard({ id: 'c-topic', title: 'Topics', subtitle: 'Top 12, dropped videos excluded', data: st.topics.slice(0, 12).map(([k, v]) => ({ key: k, label: k, value: v })), format: formatCount, labelHeader: 'Topic', valueHeader: 'Videos' }),
    chartCard({ id: 'c-cat', title: 'Categories', data: st.byCategory.map(([k, v]) => ({ key: k, label: k, value: v })), format: formatCount, labelHeader: 'Category', valueHeader: 'Videos' }),
    chartCard({ id: 'c-lang', title: 'Spoken languages', data: st.byLanguage.map(([k, v]) => ({ key: k, label: langName(k), value: v })), format: formatCount, labelHeader: 'Language', valueHeader: 'Videos' }),
    chartCard({ id: 'c-week', title: 'Video processed per week', subtitle: 'ISO weeks, hours of video sent to Gemini', kind: 'columns', data: st.weeks, format: hoursText, axisFormat: hoursText, labelHeader: 'Week', valueHeader: 'Video' }),
    chartCard({ id: 'c-rev', title: 'Flashcard answers per day', subtitle: 'Last 30 days', kind: 'columns', data: st.reviewsByDay, format: formatCount, labelHeader: 'Day', valueHeader: 'Answers' })));
  return page;
}
