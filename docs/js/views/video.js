// One video: header and player, your rating and notes, and then whatever the
// agent made for it: the triage (to decide), the learning pack, or the review card.

import { h, append, clear, icon, ICONS, dataTable } from '../dom.js';
import { mmss, formatDate, plural } from '../format.js';
import { S, getPack, getReview, getMarkdown, rerun, setStatus, saveMine, removeVideo, decide } from '../core.js';
import { ACTION_BY_KEY, NO_RETRY } from '../model.js';
import { watchUrl } from '../links.js';
import { renderMarkdown } from '../md.js';
import { ankiCsv, download } from '../exporter.js';
import { toast, confirm, emptyState, stageTag, actionTag, thumb, worthStars, tsLink, playerBox, playAt, clearPlayer, select } from '../ui.js';
import { banners, metaLine, processButton } from './common.js';
import { decideCard } from './decide.js';

const TABS = [
  ['overview', 'Overview'], ['notes', 'Notes'], ['visuals', 'Visual notes'], ['mindmap', 'Mind map'],
  ['glossary', 'Glossary & references'], ['transcript', 'Transcript'], ['practise', 'Practise'], ['checklist', 'Reviewer checklist'],
];
const ui = { tab: 'overview', tr: 'both', trQuery: '', screens: true };

export function viewVideo(id) {
  clearPlayer();
  const page = h('div', { class: 'page' });
  const e = S.index.byId.get(id);
  if (!e) {
    page.append(emptyState('Not in your library', 'This video was removed, or the link is wrong.', h('a', { href: '#/library', class: 'btn', text: 'Back to the library' })));
    return page;
  }
  append(page, banners());
  page.append(header(e));
  const issue = e.v && e.v.issue;
  if (issue) {
    const op = issue.op === 'meta' ? null : issue.op;
    page.append(h('div', { class: 'banner warn', role: 'alert' }, icon(ICONS.alert),
      h('div', { class: 'stack-sm' }, h('p', {}, h('strong', { text: `${opName(issue.op)} problem: ` }), issue.message),
        op && !NO_RETRY.has(issue.kind) ? h('div', {}, h('button', { type: 'button', class: 'btn sm', text: 'Try again', onclick: async () => { await rerun(e.id, op); toast('Requested again. Press Process now.'); S.render(); } })) : null)));
  }
  const body = h('div', { class: 'stack' });
  page.append(body);
  const v = e.v || {};
  if (e.stage === 'new') {
    body.append(emptyState('Waiting for the agent', 'The agent reads the title and triages this video on its next run.', processButton()));
  } else if (e.stage === 'decide' || (e.stage === 'dropped' && e.tri)) {
    if (e.stage === 'dropped') body.append(h('p', { class: 'note' }, icon(ICONS.alert), h('span', { text: 'You dropped this video. Choose another action to bring it back.' })));
    body.append(h('ul', { class: 'decide-list', role: 'list' }, decideCard(e)));
  } else if (v.learn && (v.learn.state === 'done' || (v.learn.state === 'partial' && v.learn.parts_done)) && e.kind !== 'card') {
    if (v.learn.state !== 'done') body.append(progressNote(e));
    if (v.learn.state === 'done') packView(e, body);
  } else if (v.review && v.review.state === 'done' && e.kind === 'card') {
    reviewView(e, body);
  } else if (e.stage === 'processing' || e.stage === 'issue') {
    body.append(progressNote(e));
  }
  if (e.tri && e.decision) body.append(triageDetails(e));
  body.append(myNotes(e, { rating: e.kind !== 'card' }));
  return page;
}

const opName = (op) => ({ triage: 'Triage', learn: 'Learning pack', review: 'Review card', meta: 'YouTube' }[op] || 'Agent');

function header(e) {
  const statusSel = select([['', 'Not reviewed yet'], ['reviewed', 'Reviewed'], ['learned', 'Learned'], ['mastered', 'Mastered'], ['dropped', 'Dropped']],
    (S.records.get(`s:${e.id}`) || {}).status || '', { 'aria-label': 'Your status for this video' });
  statusSel.addEventListener('change', async () => { await setStatus(e.id, statusSel.value); toast('Status saved.'); S.render(); });
  const player = playerBox(e.id, { demo: S.demo });
  const more = h('details', { class: 'menu' }, h('summary', { class: 'btn ghost sm', text: 'More' }),
    h('div', { class: 'menu-body' },
      e.v ? h('button', { type: 'button', class: 'btn ghost sm', text: 'Triage again', onclick: async () => { await rerun(e.id, 'triage'); toast('Triage requested. Press Process now.'); S.render(); } }) : null,
      e.decision && e.decision.action !== 'drop' ? h('button', {
        type: 'button', class: 'btn ghost sm', text: e.kind === 'card' ? 'Rebuild the review card' : 'Rebuild the pack',
        onclick: async () => {
          if (!await confirm('Rebuild with Gemini?', 'The agent watches the video again and replaces what it made. This uses video budget.', 'Rebuild')) return;
          await rerun(e.id, e.kind === 'card' ? 'review' : 'learn');
          toast('Requested. Press Process now.');
          S.render();
        },
      }) : null,
      (e.v && ((e.v.learn || {}).state === 'done' || (e.v.review || {}).state === 'done')) ? h('button', {
        type: 'button', class: 'btn ghost sm', text: 'Download Markdown (vidledger/1)',
        onclick: async () => {
          try {
            download(`${e.id}.md`, await getMarkdown(e.id), 'text/markdown;charset=utf-8');
          } catch (err) {
            toast(err.message, 'error');
          }
        },
      }) : null,
      h('button', {
        type: 'button', class: 'btn ghost sm danger-text', text: 'Remove from library',
        onclick: async () => {
          if (!await confirm('Remove this video?', 'It disappears from your library and the agent deletes its pack on the next run.', 'Remove', 'danger')) return;
          await removeVideo(e.id);
          toast('Removed.');
          location.hash = '#/library';
        },
      })));
  return h('section', { class: 'card video-head' },
    h('div', { class: 'video-top' },
      h('button', { type: 'button', class: 'thumb-btn', 'aria-label': 'Play here', onclick: () => playAt(e.id, 0, { open: S.demo }) }, thumb(e.id, { demo: S.demo, size: 'hq' }), h('span', { class: 'play-badge', 'aria-hidden': 'true' }, icon(ICONS.play))),
      h('div', { class: 'stack-sm video-meta' },
        h('h1', { class: 'video-title', text: e.title }),
        h('p', { class: 'muted small', text: [metaLine(e), e.v && e.v.published ? `published ${formatDate(new Date(e.v.published + 'T00:00:00Z'), 'UTC')}` : ''].filter(Boolean).join(' · ') }),
        h('div', { class: 'tags' }, stageTag(e.stage), e.topic ? h('span', { class: 'tag', text: e.topic }) : null,
          e.category ? h('span', { class: 'tag', text: e.category }) : null, e.decision ? actionTag(e.decision.action, 'You chose: ') : null,
          e.worth ? worthStars(e.worth) : null),
        h('div', { class: 'row wrap' },
          h('button', { type: 'button', class: 'btn sm', onclick: () => playAt(e.id, 0, { open: S.demo }) }, icon(ICONS.play), 'Play here'),
          h('a', { class: 'btn sm ghost', href: watchUrl(e.id), target: '_blank', rel: 'noopener' }, icon(ICONS.external), 'YouTube'),
          h('label', { class: 'inline-field' }, h('span', { class: 'small', text: 'Status' }), statusSel),
          more))),
    player);
}

function progressNote(e) {
  const v = e.v || {};
  const st = (e.kind === 'card' ? v.review : v.learn) || {};
  let text = 'Requested. The agent picks it up on its next run.';
  if (st.state === 'partial') text = `Transcript part ${st.parts_done} of ${st.parts_total} done. The rest follows on the next run.`;
  if (st.state === 'failed') text = `The last attempt failed: ${st.error || 'unknown error'}${NO_RETRY.has(st.kind) ? '' : ' It will be retried.'}`;
  return h('section', { class: 'card stack' }, h('h2', { text: e.kind === 'card' ? 'Review card' : 'Learning pack' }), h('p', { class: 'muted', text }),
    st.state === 'failed' && NO_RETRY.has(st.kind) ? null : h('div', {}, processButton()));
}

function triageDetails(e) {
  const t = e.tri;
  return h('details', { class: 'card' }, h('summary', { text: 'Triage by Gemini' }),
    h('div', { class: 'stack-sm details-body' },
      h('div', { class: 'tags' }, worthStars(t.worth_it), actionTag(t.action, 'Suggested: '), h('span', { class: 'tag', text: `Priority ${t.priority}` }), h('span', { class: 'tag', text: `${t.confidence} confidence` })),
      t.gives_me ? h('p', {}, h('strong', { text: 'What it gives you: ' }), t.gives_me) : null,
      t.why ? h('p', {}, h('strong', { text: 'Why: ' }), t.why) : null,
      t.outdated ? h('p', {}, h('strong', { text: 'May be outdated: ' }), t.outdated) : null,
      t.evidence ? h('p', { class: 'muted small', text: `Gemini saw: ${t.evidence}` }) : null,
      e.decision ? h('div', { class: 'row' }, h('span', { class: 'small', text: 'Change your decision:' }),
        ...['deep', 'reference', 'review', 'drop'].filter((a) => a !== e.decision.action).map((a) => h('button', {
          type: 'button', class: 'btn sm ghost', text: ACTION_BY_KEY.get(a).name,
          onclick: async () => { await decide(e.id, a, e.topic, e.category); toast(`Changed to ${ACTION_BY_KEY.get(a).name}.`); S.render(); },
        }))) : null));
}

function ratingInput(initial) {
  const state = { value: Number(initial) || 0 };
  const stars = h('div', { class: 'rate', role: 'radiogroup', 'aria-label': 'Your rating' });
  const paint = () => {
    clear(stars);
    for (let i = 1; i <= 5; i++) {
      stars.append(h('button', { type: 'button', role: 'radio', 'aria-checked': String(i === state.value), 'aria-label': `${i} of 5`, class: i <= state.value ? 'star on' : 'star', text: '★', onclick: () => { state.value = i === state.value ? 0 : i; paint(); } }));
    }
  };
  paint();
  state.node = stars;
  return state;
}

function myNotes(e, { rating: withRating = true } = {}) {
  const mine = e.mine || {};
  const rating = ratingInput(mine.rating);
  const notes = h('textarea', { rows: 4, placeholder: 'What you want to remember, apply or follow up' });
  notes.value = mine.notes || '';
  return h('section', { class: 'card stack', 'aria-labelledby': 'mine-title' },
    h('h2', { id: 'mine-title', text: 'Your notes' }),
    withRating ? h('div', { class: 'row' }, h('span', { class: 'small', text: 'Your rating' }), rating.node) : null,
    notes,
    h('div', {}, h('button', { type: 'button', class: 'btn', onclick: async () => { await saveMine(e.id, withRating ? { rating: rating.value, notes: notes.value.slice(0, 5000) } : { notes: notes.value.slice(0, 5000) }); toast('Notes saved.'); } }, icon(ICONS.check), 'Save notes')));
}

// ------------------------------------------------------------------ learning pack

function packView(e, body) {
  const holder = h('div', { class: 'stack' }, h('p', { class: 'muted', text: 'Loading the learning pack…' }));
  body.append(holder);
  getPack(e.id).then((data) => {
    clear(holder);
    if (!data || !data.pack) {
      holder.append(h('p', { class: 'muted', text: 'The pack is not available yet.' }));
      return;
    }
    renderPack(e, data, holder);
  }).catch((err) => {
    clear(holder);
    holder.append(h('div', { class: 'banner warn', role: 'alert' }, icon(ICONS.alert), h('p', { text: `Could not load the pack: ${err.message}` })));
  });
}

function renderPack(e, data, holder) {
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel', tabindex: '0' });
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Learning pack' });
  const show = (key) => {
    ui.tab = key;
    clear(tabs);
    for (const [k, label] of TABS) {
      tabs.append(h('button', { type: 'button', role: 'tab', class: 'tab-btn', 'aria-selected': String(k === key), id: `tab-${k}`, onclick: () => show(k) }, label));
    }
    panel.setAttribute('aria-labelledby', `tab-${key}`);
    clear(panel);
    const fn = { overview, notes, visuals, mindmap, glossary, transcript, practise, checklist }[key];
    append(panel, fn(e, data.pack, data.transcript || { lines: [], screens: [] }));
  };
  holder.append(h('section', { class: 'card pack' }, tabs, panel));
  show(TABS.some(([k]) => k === ui.tab) ? ui.tab : 'overview');
}

const section = (title, ...kids) => h('section', { class: 'pack-sec' }, h('h3', { text: title }), ...kids);
const tsItem = (id, t, ...rest) => h('li', {}, tsLink(id, t), ' ', ...rest);

function overview(e, p) {
  const out = [];
  out.push(section('TL;DR', h('ul', { class: 'bullets' }, p.tldr.map((x) => h('li', { text: x })))));
  if (p.rewatch.length) {
    const mins = Math.round(p.rewatch.reduce((s, r) => s + (r.end - r.start), 0) / 60);
    out.push(section(`Rewatch only these (${mins} min)`, h('ul', { class: 'ts-list' }, p.rewatch.map((r) => h('li', {}, tsLink(e.id, r.start, `${mmss(r.start)}–${mmss(r.end)}`), ' ', r.why)))));
  }
  if (p.chapters.length) out.push(section('Chapters', h('ol', { class: 'ts-list' }, p.chapters.map((c) => tsItem(e.id, c.t, c.title)))));
  if (p.apply.length) out.push(section('Apply it', h('ul', { class: 'bullets' }, p.apply.map((x) => h('li', { text: x })))));
  if (p.explain_back.length) out.push(section('Explain it back (from memory)', h('ol', { class: 'bullets' }, p.explain_back.map((x) => h('li', { text: x })))));
  const c = p.connections || {};
  const chipsOf = (label, list) => (list && list.length ? h('div', { class: 'conn-row' }, h('strong', { class: 'small', text: label }), h('div', { class: 'tags' }, list.map((x) => h('span', { class: 'tag', text: x })))) : null);
  if ((c.prerequisites || []).length || (c.next || []).length || (c.related || []).length) {
    out.push(section('Connections', chipsOf('Before this:', c.prerequisites), chipsOf('Learn next:', c.next), chipsOf('Related:', c.related)));
  }
  if (p.added_context.length) {
    out.push(section('Added context (from Gemini, not from the video)', h('ul', { class: 'bullets added' }, p.added_context.map((a) => h('li', {}, h('strong', { text: `${a.about}: ` }), a.text)))));
  }
  return out;
}

function notes(e, p) {
  if (!p.notes.length) return [h('p', { class: 'muted', text: 'No detailed notes.' })];
  return p.notes.map((n) => section(n.chapter, h('p', {}, tsLink(e.id, n.t)), h('ul', { class: 'ts-list' }, n.points.map((pt) => tsItem(e.id, pt.t, pt.text)))));
}

function visuals(e, p) {
  if (!p.visuals.length) return [h('p', { class: 'muted', text: 'Gemini found no slides, diagrams, tables or code worth writing out.' })];
  return [h('p', { class: 'muted small', text: `${plural(p.visuals.length, 'visual')} written out. Click a time to see the frame.` }),
    ...p.visuals.map((v) => h('article', { class: 'visual' },
      h('div', { class: 'row' }, tsLink(e.id, v.t), h('span', { class: 'tag', text: v.type }), h('strong', { text: v.title })),
      v.meaning ? h('p', { class: 'muted small', text: v.meaning }) : null,
      ...renderMarkdown(v.content),
      v.latex ? h('pre', { class: 'code latex', 'data-lang': 'LaTeX' }, h('code', { text: v.latex })) : null))];
}

function mermaidOf(e, p) {
  const clean = (s) => String(s).replace(/[()[\]{}<>"`#;:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '-';
  const lines = ['mindmap', `  root((${clean(p.mindmap.root || e.title)}))`];
  for (const b of p.mindmap.branches) {
    lines.push(`    ${clean(b.label)} · ${mmss(b.t)}`);
    for (const l of b.leaves) lines.push(`      ${clean(l.label)} · ${mmss(l.t)}`);
  }
  return lines.join('\n');
}

function mindmap(e, p) {
  const mm = p.mindmap || { root: '', branches: [] };
  if (!mm.branches.length) return [h('p', { class: 'muted', text: 'No mind map in this pack.' })];
  return [
    h('div', { class: 'mindmap', role: 'tree', 'aria-label': 'Mind map' },
      h('div', { class: 'mm-root', role: 'treeitem', text: mm.root || e.title }),
      h('ul', { class: 'mm-branches', role: 'group' }, mm.branches.map((b, i) => h('li', { class: `mm-branch series-border-${(i % 6) + 1}`, role: 'treeitem' },
        h('div', { class: 'mm-label' }, h('span', { text: b.label }), ' ', tsLink(e.id, b.t)),
        b.leaves.length ? h('ul', { class: 'mm-leaves', role: 'group' }, b.leaves.map((l) => h('li', { role: 'treeitem' }, l.label, ' ', tsLink(e.id, l.t)))) : null)))),
    h('div', { class: 'row' }, h('button', {
      type: 'button', class: 'btn sm ghost', text: 'Copy as Mermaid',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(mermaidOf(e, p));
          toast('Copied. Paste it into any Mermaid editor, Notion or Obsidian.');
        } catch {
          toast('Copying was blocked by the browser.', 'error');
        }
      },
    })),
  ];
}

function glossary(e, p) {
  const out = [];
  if (p.glossary.length) {
    out.push(section('Glossary', dataTable(['Term', 'Meaning as explained', 'Time'], p.glossary.map((g) => [g.term, g.meaning, tsLink(e.id, g.t)]), { caption: 'Glossary' })));
  }
  if (p.references.length) {
    const groups = new Map();
    for (const r of p.references) groups.set(r.kind, [...(groups.get(r.kind) || []), r]);
    out.push(section('Numbers, formulas, standards & references', ...[...groups].map(([kind, list]) => h('div', {},
      h('h4', { class: 'kind', text: kind[0].toUpperCase() + kind.slice(1) }), h('ul', { class: 'ts-list' }, list.map((r) => tsItem(e.id, r.t, r.text)))))));
  }
  if (p.procedure.length) out.push(section('Procedure', h('ol', { class: 'ts-list' }, p.procedure.map((s) => tsItem(e.id, s.t, s.step)))));
  if (p.claims.length) out.push(section('Claims to verify', h('ul', { class: 'ts-list' }, p.claims.map((c) => tsItem(e.id, c.t, h('strong', { text: c.claim }), ` (${c.why})`)))));
  return out.length ? out : [h('p', { class: 'muted', text: 'No glossary or references.' })];
}

function highlight(text, query) {
  if (!query) return [text];
  const out = [];
  const low = text.toLowerCase();
  let i = 0;
  let j;
  while ((j = low.indexOf(query, i)) >= 0) {
    if (j > i) out.push(text.slice(i, j));
    out.push(h('mark', { text: text.slice(j, j + query.length) }));
    i = j + query.length;
  }
  out.push(text.slice(i));
  return out;
}

function transcript(e, p, tr) {
  const lines = tr.lines || [];
  if (!lines.length) return [h('p', { class: 'muted', text: 'No transcript.' })];
  const translated = lines.some((l) => l.en);
  const list = h('ol', { class: 'transcript', 'aria-live': 'off' });
  const count = h('p', { class: 'muted small', role: 'status' });
  const draw = () => {
    clear(list);
    const q = ui.trQuery.trim().toLowerCase();
    const screens = ui.screens ? (tr.screens || []) : [];
    const merged = [...lines.map((l) => ({ l })), ...screens.map((s) => ({ s }))].sort((a, b) => (a.l ? a.l.t : a.s.t) - (b.l ? b.l.t : b.s.t));
    let shown = 0;
    for (const item of merged) {
      if (item.s) {
        if (!q) list.append(h('li', { class: 'tr-screen' }, tsLink(e.id, item.s.t), h('span', { text: ` ▣ ${item.s.type}: ${item.s.title}` })));
        continue;
      }
      const l = item.l;
      const orig = ui.tr !== 'en' || !l.en;
      const en = (ui.tr !== 'orig') && l.en;
      if (q && !(`${l.text} ${l.en}`.toLowerCase().includes(q))) continue;
      shown++;
      list.append(h('li', { class: `tr-line${l.unsure ? ' unsure' : ''}`, lang: orig && l.lang ? l.lang : null },
        tsLink(e.id, l.t),
        h('div', { class: 'tr-text' },
          l.sp ? h('span', { class: 'tr-sp', text: `${l.sp}: ` }) : null,
          orig ? h('span', { class: 'tr-orig' }, highlight(l.text, q)) : null,
          en ? h('span', { class: 'tr-en', lang: 'en' }, highlight(l.en, q)) : null,
          l.unsure ? h('span', { class: 'tag warn small', text: 'unclear' }) : null)));
    }
    count.textContent = q ? `${plural(shown, 'line')} match` : `${plural(lines.length, 'line')}${lines.some((l) => l.unsure) ? ` · ${lines.filter((l) => l.unsure).length} unclear` : ''}`;
  };
  const search = h('input', { type: 'search', placeholder: 'Search the transcript', value: ui.trQuery, 'aria-label': 'Search the transcript' });
  search.addEventListener('input', () => { ui.trQuery = search.value; draw(); });
  const mode = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Transcript language' });
  const paintMode = () => {
    clear(mode);
    for (const [k, label] of [['both', 'Both'], ['orig', 'Original'], ['en', 'English']]) {
      mode.append(h('button', { type: 'button', class: 'seg', 'aria-pressed': String(ui.tr === k), text: label, onclick: () => { ui.tr = k; paintMode(); draw(); } }));
    }
  };
  paintMode();
  const scr = h('input', { type: 'checkbox', id: 'tr-screens', checked: ui.screens ? true : null });
  scr.addEventListener('change', () => { ui.screens = scr.checked; draw(); });
  draw();
  return [h('div', { class: 'row wrap tr-tools' }, search, translated ? mode : null,
    (tr.screens || []).length ? h('span', { class: 'check' }, scr, h('label', { for: 'tr-screens', text: 'Screen moments' })) : null), count, list];
}

function practise(e, p) {
  const out = [];
  const inDeck = e.decision && e.decision.action === 'deep';
  out.push(h('p', { class: 'muted small' }, inDeck ? 'These cards are in your revision deck.' : 'These cards are not in your revision deck (only Deep-learn videos are). ',
    !inDeck ? h('button', { type: 'button', class: 'btn sm ghost', text: 'Make it Deep-learn', onclick: async () => { await decide(e.id, 'deep', e.topic, e.category); S.render(); } }) : null,
    ' ', h('button', { type: 'button', class: 'btn sm ghost', text: 'Download for Anki', onclick: () => download(`vidledger-${e.id}-anki.csv`, ankiCsv(p.flashcards.map((c) => ({ ...c, video_id: e.id, topic: p.topic }))), 'text/csv;charset=utf-8') })));
  out.push(section(`Flashcards (${p.flashcards.length})`, h('ul', { class: 'flash-list' }, p.flashcards.map((c) => {
    const back = h('div', { class: 'flash-back', hidden: true }, h('p', { text: c.back }), tsLink(e.id, c.t));
    return h('li', { class: 'flash' }, h('button', { type: 'button', class: 'flash-front', 'aria-expanded': 'false', onclick: (ev) => { back.hidden = !back.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!back.hidden)); } }, c.front), back);
  }))));
  if (p.quiz.length) out.push(section('Quiz', ...p.quiz.map((q, n) => quizItem(q, n, false))));
  return out;
}

export function quizItem(q, n, showVideo = false) {
  const feedback = h('p', { class: 'small', role: 'status' });
  const opts = h('div', { class: 'quiz-opts', role: 'group', 'aria-label': `Question ${n + 1}` });
  q.options.forEach((o, i) => opts.append(h('button', {
    type: 'button', class: 'btn ghost quiz-opt', text: `${String.fromCharCode(65 + i)}. ${o}`,
    onclick: () => {
      for (const b of opts.children) b.disabled = true;
      opts.children[q.answer].classList.add('right');
      if (i !== q.answer) opts.children[i].classList.add('wrong');
      feedback.textContent = `${i === q.answer ? 'Right.' : `Not quite: ${String.fromCharCode(65 + q.answer)}.`} ${q.explain || ''}`;
    },
  })));
  return h('div', { class: 'quiz' }, h('p', {}, h('strong', { text: `${n + 1}. ${q.q}` }), showVideo && q.video_id ? h('span', { class: 'muted small' }, ' · ', h('a', { href: `#/video/${q.video_id}`, text: 'from this video' })) : null), opts, feedback);
}

function checklist(e, p, tr) {
  const items = [];
  for (const l of (tr.lines || []).filter((x) => x.unsure).slice(0, 40)) items.push({ key: `u${l.t}`, t: l.t, text: `Unclear: ${l.text}` });
  for (const t of p.checklist.spot_check) items.push({ key: `s${t}`, t, text: 'Spot-check that the time matches what is said' });
  for (const term of p.checklist.unsure_terms) items.push({ key: `w${term}`, t: null, text: `Term to confirm: ${term}` });
  for (const a of p.checklist.ambiguous) items.push({ key: `a${a.t}`, t: a.t, text: `Translation could be read two ways: ${a.text}` });
  for (const c of p.claims) items.push({ key: `c${c.t}${c.claim.slice(0, 20)}`, t: c.t, text: `Claim to verify: ${c.claim}` });
  const mine = S.records.get(`m:${e.id}`) || {};
  const checks = new Set(mine.checks || []);
  const status = (S.records.get(`s:${e.id}`) || {}).status || '';
  const list = h('ul', { class: 'checklist' }, items.map((it, i) => {
    const box = h('input', { type: 'checkbox', id: `chk-${i}`, checked: checks.has(it.key) ? true : null });
    box.addEventListener('change', async () => {
      if (box.checked) checks.add(it.key);
      else checks.delete(it.key);
      await saveMine(e.id, { checks: [...checks] });
    });
    return h('li', { class: 'check' }, box, h('label', { for: `chk-${i}` }, it.t !== null ? tsLink(e.id, it.t) : null, it.t !== null ? ' ' : null, it.text));
  }));
  return [
    h('p', { class: 'muted small', text: items.length ? `${plural(items.length, 'item')} for you to check. Ticks are saved as you go.` : 'Gemini flagged nothing to check. Spot-check two or three times anyway.' }),
    list,
    h('div', { class: 'row' },
      status === 'reviewed' || status === 'learned' || status === 'mastered'
        ? h('p', { class: 'note ok' }, icon(ICONS.check), h('span', { text: `Marked ${status}.` }))
        : h('button', { type: 'button', class: 'btn primary', onclick: async () => { await setStatus(e.id, 'reviewed'); toast('Marked as reviewed.'); S.render(); } }, icon(ICONS.check), 'Mark as reviewed')),
  ];
}

// ------------------------------------------------------------------ review card (entertainment)

function reviewView(e, body) {
  const holder = h('div', { class: 'stack' }, h('p', { class: 'muted', text: 'Loading the review card…' }));
  body.append(holder);
  getReview(e.id).then((data) => {
    clear(holder);
    const c = data.card;
    const keep = { keep_rewatch: 'Keep & rewatch', keep_log: 'Keep as a log entry', drop: 'Drop' }[c.keep];
    holder.append(h('section', { class: 'card stack review-card' },
      h('h2', { text: 'Review card' }),
      h('p', { class: 'lead', text: c.one_line }),
      h('p', { text: c.worth }),
      h('div', { class: 'row' }, worthStars(c.suggested_rating, 'Gemini suggests'), h('span', { class: 'muted small', text: c.rating_reason })),
      c.best_moments.length ? section('Best moments', h('ul', { class: 'ts-list' }, c.best_moments.map((m) => tsItem(e.id, m.t, m.text)))) : null,
      section('When to watch', h('p', { text: `${c.when}${c.minutes ? ` (${c.minutes} min)` : ''}` })),
      c.nuggets.length ? section('Learning nuggets', h('ul', { class: 'ts-list' }, c.nuggets.map((m) => tsItem(e.id, m.t, m.text)))) : null,
      section('Keep or drop', h('p', {}, h('strong', { text: `${keep}: ` }), c.keep_reason))));
    holder.append(myReview(e));
  }).catch((err) => {
    clear(holder);
    holder.append(h('div', { class: 'banner warn', role: 'alert' }, icon(ICONS.alert), h('p', { text: `Could not load the card: ${err.message}` })));
  });
}

function myReview(e) {
  const mine = e.mine || {};
  const verdict = h('input', { type: 'text', maxlength: '200', placeholder: 'One line, your words', value: mine.verdict || '' });
  const rewatch = select([['', 'Not decided'], ['yes', 'Yes'], ['no', 'No']], mine.rewatch || '', { 'aria-label': 'Rewatch?' });
  const rating = ratingInput(mine.rating);
  return h('section', { class: 'card stack' }, h('h2', { text: 'Your review' }),
    h('p', { class: 'muted small', text: 'Saving marks the video as reviewed.' }),
    h('div', { class: 'row' }, h('span', { class: 'small', text: 'Your rating' }), rating.node),
    h('label', { class: 'inline-field' }, h('span', { class: 'small', text: 'Rewatch?' }), rewatch),
    h('label', { class: 'field' }, h('span', { class: 'small', text: 'One-line verdict' }), verdict),
    h('div', {}, h('button', {
      type: 'button', class: 'btn primary',
      onclick: async () => {
        await saveMine(e.id, { rating: rating.value, verdict: verdict.value.slice(0, 200), rewatch: rewatch.value });
        await setStatus(e.id, 'reviewed');
        toast('Review saved.');
        S.render();
      },
    }, icon(ICONS.check), 'Save review')));
}

