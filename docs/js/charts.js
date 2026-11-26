// Charts built from HTML elements (from Mailean): they reflow on a 320 px phone without
// shrinking text, and every value is real text for screen readers.
// Rules: colour follows the category (fixed slot per group), never rank; one
// axis; recessive grid; selective labels; every chart has a Table toggle.

import { h, clear, dataTable } from './dom.js';

let tip = null;
function tooltip() {
  if (!tip) {
    tip = h('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite', hidden: true });
    document.body.append(tip);
  }
  return tip;
}
function showTip(target, text) {
  const t = tooltip();
  t.textContent = text;
  t.hidden = false;
  const r = target.getBoundingClientRect();
  const w = t.offsetWidth;
  const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const y = r.top - t.offsetHeight - 8;
  t.style.left = `${x}px`;
  t.style.top = `${Math.max(8, y) + window.scrollY}px`;
}
function hideTip() {
  if (tip) tip.hidden = true;
}
function hoverable(el, text) {
  el.tabIndex = 0;
  el.setAttribute('aria-label', text);
  el.addEventListener('pointerenter', () => showTip(el, text));
  el.addEventListener('pointerleave', hideTip);
  el.addEventListener('focus', () => showTip(el, text));
  el.addEventListener('blur', hideTip);
  return el;
}

/** Clean axis maximum: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function tableView(data, labelHeader, valueHeader, fmt) {
  return dataTable([labelHeader, valueHeader], data.map((d) => [d.tableLabel || d.label, fmt(d.value)]), { numeric: new Set([1]) });
}

/**
 * A card with a Chart/Table toggle.
 * kind: 'bars' (horizontal, categories) or 'columns' (time order).
 * data: [{key, label, value, slot?}] slot = categorical colour slot 1..6 (bars only).
 */
export function chartCard({ id, title, subtitle = '', kind = 'bars', data, format = String, axisFormat = null, labelHeader = 'Item', valueHeader = 'Value', empty = 'Nothing to show yet.' }) {
  const body = h('div', { class: 'chart-body' });
  let mode = 'chart';
  const btnChart = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'true', text: 'Chart' });
  const btnTable = h('button', { type: 'button', class: 'seg', 'aria-pressed': 'false', text: 'Table' });
  const render = () => {
    clear(body);
    btnChart.setAttribute('aria-pressed', String(mode === 'chart'));
    btnTable.setAttribute('aria-pressed', String(mode === 'table'));
    const total = data.reduce((s, d) => s + d.value, 0);
    if (!data.length || total === 0) {
      body.append(h('p', { class: 'empty-note', text: empty }));
      return;
    }
    if (mode === 'table') body.append(tableView(data, labelHeader, valueHeader, format));
    else body.append(kind === 'columns' ? columns(data, format, title, axisFormat || format) : bars(data, format));
  };
  btnChart.addEventListener('click', () => { mode = 'chart'; render(); });
  btnTable.addEventListener('click', () => { mode = 'table'; render(); });
  render();
  return h('section', { class: 'card chart-card', id, 'aria-labelledby': `${id}-title` },
    h('div', { class: 'card-head' },
      h('div', {}, h('h3', { id: `${id}-title`, text: title }), subtitle ? h('p', { class: 'muted small', text: subtitle }) : null),
      h('div', { class: 'segmented', role: 'group', 'aria-label': `${title}: view as` }, btnChart, btnTable)),
    body);
}

function bars(data, fmt) {
  const max = Math.max(...data.map((d) => d.value));
  return h('ul', { class: 'bars', role: 'list' }, data.map((d) => {
    const pct = max ? (d.value / max) * 100 : 0;
    const bar = h('span', { class: `bar series-${d.slot || 'single'}` });
    bar.style.width = `${Math.max(pct, d.value ? 1.5 : 0)}%`;
    return hoverable(h('li', { class: 'bar-row' },
      h('span', { class: 'bar-label' }, d.slot ? h('span', { class: `key series-${d.slot}`, 'aria-hidden': 'true' }) : null, d.label),
      h('span', { class: 'bar-track' }, bar),
      h('span', { class: 'bar-value num', text: fmt(d.value) })), `${d.tableLabel || d.label}: ${fmt(d.value)}`);
  }));
}

function columns(data, fmt, title, axisFmt) {
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const grid = h('div', { class: 'col-grid', 'aria-hidden': 'true' },
    [1, 0.5, 0].map((f) => h('div', { class: 'grid-line' }, h('span', { class: 'grid-label num', text: axisFmt(max * f) }))));
  const cols = h('ol', { class: 'cols', 'aria-label': title }, data.map((d, i) => {
    const bar = h('span', { class: 'col-bar' });
    bar.style.height = `${(d.value / max) * 100}%`;
    const showValue = d.value > 0 && (i === peak || i === data.length - 1);
    // Long series (30 days) label every few columns so labels never overlap.
    const every = data.length > 14 ? Math.ceil(data.length / 8) : 1;
    const showLabel = i % every === 0 || i === data.length - 1;
    return hoverable(h('li', { class: 'col' },
      h('span', { class: 'col-plot' }, showValue ? h('span', { class: 'col-value num', text: axisFmt(d.value) }) : null, bar),
      h('span', { class: 'col-label', text: showLabel ? d.label : '' })), `${d.tableLabel || d.label}: ${fmt(d.value)}`);
  }));
  return h('div', { class: 'col-chart' }, grid, cols);
}
