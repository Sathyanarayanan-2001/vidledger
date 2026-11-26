// VidLedger dashboard. A static page: reads your library from your private
// GitHub repository with your token, saves your choices back to it, and starts
// the agent by running a GitHub Actions workflow. No other servers, no analytics.

import { h, clear, append, $, icon, ICONS } from './js/dom.js';
import { formatCount } from './js/format.js';
import { ls } from './js/store.js';
import { STATUS_TEXT } from './js/remote.js';
import {
  S, VERSION, loadConnection, startRemote, loadCached, refresh, reindex, resumeFollow, pending, processNow, resetDemo,
} from './js/core.js';
import { viewHome } from './js/views/home.js';
import { viewAdd } from './js/views/add.js';
import { viewDecide } from './js/views/decide.js';
import { viewLibrary } from './js/views/library.js';
import { viewVideo } from './js/views/video.js';
import { viewTopics, viewTopic } from './js/views/topics.js';
import { viewRevise } from './js/views/revise.js';
import { viewStats } from './js/views/stats.js';
import { viewActivity } from './js/views/activity.js';
import { viewSettings, setTheme } from './js/views/settings.js';
import { viewGuide } from './js/views/guide.js';
import { viewConnect } from './js/views/connect.js';
import { dueCount } from './js/views/common.js';
import { dialog } from './js/ui.js';

const ROUTES = [
  { id: 'home', label: 'Home', icon: ICONS.home, view: viewHome },
  { id: 'add', label: 'Add videos', icon: ICONS.plus, view: viewAdd },
  { id: 'decide', label: 'Decide', icon: ICONS.decide, view: viewDecide, badge: () => S.index.entries.filter((e) => e.stage === 'decide').length },
  { id: 'library', label: 'Library', icon: ICONS.video, view: viewLibrary },
  { id: 'revise', label: 'Revise', icon: ICONS.cards, view: viewRevise, badge: () => dueCount().due },
  { id: 'topics', label: 'Topics', icon: ICONS.layers, view: viewTopics },
  { id: 'stats', label: 'Dashboard', icon: ICONS.chart, view: viewStats },
  { id: 'activity', label: 'Activity', icon: ICONS.activity, view: viewActivity },
  { id: 'settings', label: 'Settings', icon: ICONS.settings, view: viewSettings },
  { id: 'guide', label: 'Guide', icon: ICONS.guide, view: viewGuide },
];
const HIDDEN = { video: viewVideo, topic: viewTopic, connect: viewConnect };
const PHONE_TABS = ['home', 'decide', 'library', 'revise'];
let lastRoute = '';

function parseHash() {
  const [id, ...rest] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const param = decodeURIComponent(rest.join('/'));
  if (ROUTES.some((r) => r.id === id) || HIDDEN[id]) return { id, param };
  return { id: 'home', param: '' };
}

function badgeOf(r) {
  const n = r.badge ? r.badge() : 0;
  return n ? h('span', { class: 'count', text: n > 99 ? '99+' : String(n) }) : null;
}

function renderNav() {
  const side = $('#sidenav-list');
  clear(side);
  for (const r of ROUTES) {
    const current = S.route === r.id || (S.route === 'video' && r.id === 'library') || (S.route === 'topic' && r.id === 'topics');
    side.append(h('li', {}, h('a', { href: `#/${r.id}`, class: 'nav-link', 'aria-current': current ? 'page' : null }, icon(r.icon), h('span', { text: r.label }), badgeOf(r))));
  }
  const bottom = $('#bottomnav-list');
  clear(bottom);
  for (const id of PHONE_TABS) {
    const r = ROUTES.find((x) => x.id === id);
    bottom.append(h('li', {}, h('a', { href: `#/${id}`, class: 'tab', 'aria-current': S.route === id ? 'page' : null },
      h('span', { class: 'tab-icon' }, icon(r.icon), badgeOf(r)), h('span', { text: r.label }))));
  }
  const moreActive = !PHONE_TABS.includes(S.route);
  bottom.append(h('li', {}, h('button', { type: 'button', class: 'tab', 'aria-current': moreActive ? 'page' : null, onclick: openMore }, icon(ICONS.more), h('span', { text: 'More' }))));
}

function openMore() {
  const list = h('ul', { class: 'more-list' }, ROUTES.filter((r) => !PHONE_TABS.includes(r.id)).map((r) => h('li', {},
    h('a', { href: `#/${r.id}`, class: 'more-link', onclick: () => $('#dlg').close() }, icon(r.icon), h('span', { text: r.label })))));
  dialog({ title: 'More', body: list });
}

function renderChrome() {
  const pill = $('#sync-pill');
  const st = S.demo ? 'local' : S.syncStatus;
  pill.dataset.status = S.loading ? 'saving' : st;
  pill.textContent = S.loading ? 'Loading…' : (S.demo ? 'Demo: saved on this device' : STATUS_TEXT[st] || st);
  pill.title = S.syncDetail || 'Where your choices are saved';
  $('#mode-chip').hidden = !S.demo;
  const pb = $('#process-btn');
  clear(pb);
  const n = S.conn || S.demo ? pending() : 0;
  append(pb, [icon(ICONS.spark), h('span', { class: 'label', text: S.agent.running ? 'Agent running…' : 'Process now' }), h('span', { class: 'count', text: formatCount(n), hidden: !n || S.agent.running })]);
  pb.disabled = S.agent.running || (!S.conn && !S.demo);
  pb.setAttribute('aria-label', S.agent.running ? 'The agent is running' : `Process now: start the agent${n ? `, ${n} waiting` : ''}`);
  pb.classList.toggle('running', S.agent.running);
  const theme = ls.get('theme') || 'system';
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const tb = $('#theme-btn');
  clear(tb);
  tb.append(icon(dark ? ICONS.sun : ICONS.moon));
  tb.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  renderNav();
}

function render() {
  const { id, param } = parseHash();
  const routeChanged = `${id}/${param}` !== lastRoute;
  lastRoute = `${id}/${param}`;
  S.route = id;
  S.param = param;
  const needsConnect = !S.conn && !S.demo && !['guide', 'connect'].includes(id);
  const view = $('#view');
  const scrollY = window.scrollY;
  clear(view);
  renderChrome();
  if (needsConnect || id === 'connect') {
    S.route = 'connect';
    view.append(viewConnect());
    document.title = 'Connect · VidLedger';
    return;
  }
  const r = ROUTES.find((x) => x.id === id);
  view.append(r ? r.view() : HIDDEN[id](param));
  const entry = id === 'video' ? S.index.byId.get(param) : null;
  document.title = `${entry ? entry.title : r ? r.label : 'Topic'} · VidLedger`;
  if (routeChanged) {
    window.scrollTo(0, 0);
    $('#main').focus({ preventScroll: true });
  } else window.scrollTo(0, scrollY);
}

S.render = render;
S.renderChrome = renderChrome;

async function init() {
  loadConnection();
  if (S.conn) {
    await S.records.use(S.conn.repo);
    startRemote();
  } else if (S.demo) {
    await S.records.use('demo');
    if (!Object.keys(S.records.records).length) await resetDemo(false);
  }
  S.records.onChange((source) => {
    reindex();
    const editing = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (source === 'remote' && !editing) render();
    else renderChrome();
  });
  await loadCached();
  render();
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark'
      || (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    setTheme(dark ? 'light' : 'dark');
  });
  $('#process-btn').addEventListener('click', () => processNow());
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => { if (S.remote && S.remote.dirty) S.remote.push().catch(() => {}); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || (!S.conn && !S.demo)) return;
    if (!S.fetchedAt || Date.now() - Date.parse(S.fetchedAt) > 120_000) refresh({ quiet: true });
  });
  window.addEventListener('beforeunload', (ev) => {
    if (S.remote && S.remote.dirty) {
      S.remote.flush().catch(() => {});
      ev.preventDefault();
    }
  });
  if (S.conn || S.demo) {
    refresh({ quiet: true });
    resumeFollow();
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init().catch((err) => {
  const view = $('#view');
  clear(view);
  view.append(h('div', { class: 'page narrow' }, h('div', { class: 'banner warn', role: 'alert' }, h('p', { text: `VidLedger could not start: ${err.message}` }))));
});

export { VERSION };
