// Settings: connection, what Gemini should know about you, your topic list,
// revision, appearance, and exports and backups.

import { h, append, icon, ICONS } from '../dom.js';
import { plural, formatDate } from '../format.js';
import { S, VERSION, RELEASE_DATE, config, setConfig, disconnect, leaveDemo, resetDemo, refresh } from '../core.js';
import { ls, kvDelete, kvDeletePrefix } from '../store.js';
import { deckCards } from '../model.js';
import { libraryCsv, ankiCsv, download } from '../exporter.js';
import { merge } from '../merge.js';
import { toast, confirm, field, select } from '../ui.js';
import { pageHead, banners } from './common.js';
import { DEFAULT_TOPICS } from './topics-list.js';

const stamp = () => formatDate(new Date(), S.tz).split('/').reverse().join('-');

export function viewSettings() {
  const page = h('div', { class: 'page narrow' });
  page.append(pageHead('Settings', ''));
  append(page, banners());

  // Connection
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Connection' }),
    S.demo ? h('p', { text: 'You are trying the demo. Nothing leaves this browser.' })
      : S.conn ? h('p', {}, 'Connected to ', h('strong', { text: S.conn.repo }), '. Your token stays in this browser and is sent only to api.github.com.')
        : h('p', { text: 'Not connected.' }),
    h('div', { class: 'row wrap' },
      S.demo ? h('button', { type: 'button', class: 'btn', text: 'Reset the demo', onclick: () => resetDemo() }) : null,
      S.demo ? h('button', { type: 'button', class: 'btn ghost', text: 'Leave the demo', onclick: async () => { await leaveDemo(); location.hash = '#/connect'; } }) : null,
      S.conn ? h('button', { type: 'button', class: 'btn ghost', text: 'Refresh now', onclick: () => refresh() }) : null,
      S.conn ? h('button', {
        type: 'button', class: 'btn danger', text: 'Disconnect this device',
        onclick: async () => {
          if (!await confirm('Disconnect?', 'This forgets the token on this device. Your library and records stay in GitHub.', 'Disconnect', 'danger')) return;
          await disconnect();
          location.hash = '#/connect';
        },
      }) : null,
      !S.conn && !S.demo ? h('a', { href: '#/connect', class: 'btn primary', text: 'Connect' }) : null)));

  // Profile
  const prof = config('profile', {}) || {};
  const about = h('textarea', { rows: 3, maxlength: '1500', placeholder: 'For example: I work in onshore wind energy in India (grid codes, compliance studies) and build small web apps.' });
  about.value = prof.about || '';
  const goals = h('textarea', { rows: 3, maxlength: '1500', placeholder: 'For example: master fault ride-through requirements; learn React; get better at presenting.' });
  goals.value = prof.goals || '';
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'About you' }),
    h('p', { class: 'muted small', text: 'Gemini reads this during triage to judge how much each video is worth your time.' }),
    field('About you', about), field('Your current learning goals', goals),
    h('div', {}, h('button', { type: 'button', class: 'btn', onclick: async () => { await setConfig('profile', { about: about.value.trim(), goals: goals.value.trim() }); toast('Saved. The next triage uses it.'); } }, icon(ICONS.check), 'Save'))));

  // Topics
  const topics = h('textarea', { rows: 10, spellcheck: 'false' });
  topics.value = (config('topics', null) || DEFAULT_TOPICS).join('\n');
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Your topics' }),
    h('p', { class: 'muted small', text: 'One per line. Triage files each video under one of these, or proposes a new one. Study guides are built per topic.' }),
    topics,
    h('div', { class: 'row' },
      h('button', {
        type: 'button', class: 'btn', onclick: async () => {
          const list = [...new Set(topics.value.split('\n').map((t) => t.trim().slice(0, 60)).filter(Boolean))].slice(0, 40);
          if (!list.length) { toast('Keep at least one topic.', 'error'); return; }
          await setConfig('topics', list);
          toast(`${plural(list.length, 'topic')} saved.`);
        },
      }, icon(ICONS.check), 'Save topics'),
      h('button', { type: 'button', class: 'btn ghost', text: 'Restore the defaults', onclick: () => { topics.value = DEFAULT_TOPICS.join('\n'); } }))));

  // Revision
  const rev = config('revise', {}) || {};
  const perDay = h('input', { type: 'number', min: '0', max: '200', step: '1', value: String(Number.isFinite(Number(rev.newPerDay)) ? rev.newPerDay : 15) });
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Revision' }),
    field('New flashcards per day', perDay, { hint: 'Reviews of cards you have already seen are always shown. 10 to 20 new cards a day suits most people.' }),
    h('div', {}, h('button', {
      type: 'button', class: 'btn', onclick: async () => {
        const n = Math.max(0, Math.min(200, Math.round(Number(perDay.value) || 0)));
        await setConfig('revise', { ...rev, newPerDay: n });
        toast('Saved.');
      },
    }, icon(ICONS.check), 'Save'))));

  // Appearance
  const theme = select([['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']], ls.get('theme') || 'system', { 'aria-label': 'Theme' });
  theme.addEventListener('change', () => setTheme(theme.value));
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Appearance' }),
    h('label', { class: 'inline-field' }, h('span', { text: 'Theme' }), theme),
    h('p', { class: 'muted small', text: `Dates are shown day first; times are in ${S.tz}.` })));

  // Data
  const restore = h('input', { type: 'file', accept: '.json,application/json', id: 'restore-file' });
  restore.addEventListener('change', async () => {
    const f = restore.files && restore.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const recs = data && data.records && typeof data.records === 'object' ? data.records : null;
      if (!recs || data.app !== 'vidledger') throw new Error('This is not a VidLedger backup.');
      if (!await confirm('Restore this backup?', `It merges ${plural(Object.keys(recs).length, 'record')} into yours. For each record, the newer version wins.`, 'Restore')) return;
      await S.records.mergeIn(merge({}, recs), 'local');
      toast('Backup restored.');
      S.render();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      restore.value = '';
    }
  });
  page.append(h('section', { class: 'card stack' }, h('h2', { text: 'Export and back up' }),
    h('div', { class: 'row wrap' },
      h('button', { type: 'button', class: 'btn', onclick: () => download(`vidledger-library-${stamp()}.csv`, libraryCsv(S.index.entries), 'text/csv;charset=utf-8') }, icon(ICONS.data), 'Library (CSV)'),
      h('button', {
        type: 'button', class: 'btn', onclick: () => {
          const cards = deckCards(S.cards.cards, S.index, { includeReference: true });
          download(`vidledger-anki-${stamp()}.csv`, ankiCsv(cards), 'text/csv;charset=utf-8');
        },
      }, icon(ICONS.cards), 'Flashcards for Anki'),
      h('button', { type: 'button', class: 'btn', onclick: () => download(`vidledger-backup-${stamp()}.json`, JSON.stringify({ app: 'vidledger', schema: 1, saved_at: new Date().toISOString(), records: S.records.snapshot() }), 'application/json') }, icon(ICONS.data), 'Back up your records')),
    h('div', { class: 'field' }, h('label', { for: 'restore-file', text: 'Restore a backup' }), restore),
    h('p', { class: 'muted small', text: 'Every learning pack is also saved as Markdown (vidledger/1) in your private repository, branch vidledger-state, folder md. Add those files to NotebookLM, or import them into another tool.' }),
    h('div', {}, h('button', {
      type: 'button', class: 'btn ghost', text: 'Clear downloaded packs on this device',
      onclick: async () => {
        await kvDelete('library');
        await kvDelete('cards');
        await kvDeletePrefix('file:');
        S.packs.clear();
        S.reviews.clear();
        S.guides.clear();
        toast('Cleared. They download again when you open them.');
      },
    }))));
  page.append(h('p', { class: 'muted small', text: `VidLedger ${VERSION} · ${RELEASE_DATE} · MIT licence` }));
  return page;
}

export function setTheme(v) {
  ls.set('theme', v);
  if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
  else document.documentElement.removeAttribute('data-theme');
  S.renderChrome();
}
