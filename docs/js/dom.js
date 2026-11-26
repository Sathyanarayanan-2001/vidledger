// Tiny DOM builder. Strings always become text nodes (textContent), never HTML,
// so video titles, transcripts and model output cannot inject markup or script.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); // CSSOM is allowed by the CSP
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/**
 * Accessible table. The first cell of each row is a row header. On phones the
 * CSS turns rows into label/value cards using each cell's data-label.
 * cells may be strings or nodes. numeric: Set of column indexes to right-align.
 */
export function dataTable(headers, rows, { numeric = new Set(), caption = '', rowClass = () => null } = {}) {
  return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
    caption ? h('caption', { class: 'sr-only', text: caption }) : null,
    h('thead', {}, h('tr', {}, headers.map((t, i) => h('th', { scope: 'col', class: numeric.has(i) ? 'num' : null, text: t })))),
    h('tbody', {}, rows.map((cells, r) => h('tr', { class: rowClass(r) }, cells.map((c, i) => h(i === 0 ? 'th' : 'td', {
      scope: i === 0 ? 'row' : null, class: numeric.has(i) ? 'num' : null, 'data-label': i === 0 ? null : headers[i],
    }, c)))))));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Inline SVG icon from a list of path strings (24x24, stroke style). */
const iconCache = new Map();
/** Icons are built once per shape and cloned after that: cloning is much cheaper than rebuilding. */
export function icon(paths, label = '') {
  const id = [].concat(paths).join('|');
  let tpl = iconCache.get(id);
  if (!tpl) {
    tpl = buildIcon(paths);
    iconCache.set(id, tpl);
  }
  const svg = tpl.cloneNode(true);
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    svg.removeAttribute('aria-hidden');
  }
  return svg;
}

function buildIcon(paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export const ICONS = {
  plus: ['M12 5v14', 'M5 12h14'],
  video: ['M3 5h18v14H3z', 'M10 9l5 3-5 3z'],
  decide: ['M9 11l3 3 8-8', 'M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  cards: ['M3 8h13v13H3z', 'M8 3h13v13'],
  layers: ['M12 3 2 8l10 5 10-5z', 'M2 13l10 5 10-5', 'M2 18l10 5 10-5'],
  external: ['M14 3h7v7', 'M21 3l-9 9', 'M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-4.3-4.3'],
  upload: ['M12 21V9', 'M7 14l5-5 5 5', 'M4 3h16'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  film: ['M4 4h16v16H4z', 'M8 4v16', 'M16 4v16', 'M4 9h4', 'M16 9h4', 'M4 15h4', 'M16 15h4'],
  spark: ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M5.6 5.6l2.8 2.8', 'M15.6 15.6l2.8 2.8', 'M5.6 18.4l2.8-2.8', 'M15.6 8.4l2.8-2.8'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  map: ['M12 12h.01', 'M12 12 5 6', 'M12 12l7-6', 'M12 12l-7 6', 'M12 12l7 6', 'M5 6h.01', 'M19 6h.01', 'M5 18h.01', 'M19 18h.01'],
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h14V9.5', 'M10 21v-6h4v6'],
  inbox: ['M3 13h5l1.5 3h5L16 13h5', 'M5 5h14l2 8v6H3v-6z'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  broom: ['M14 4l6 6', 'M12 6l6 6-7 8H4v-7z', 'M8 14l2 2'],
  queue: ['M4 6h16', 'M4 12h16', 'M4 18h10', 'M18 16l3 2-3 2z'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  data: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  guide: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  archive: ['M3 4h18v4H3z', 'M5 8v12h14V8', 'M10 12h4'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14'],
  label: ['M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z', 'M7.5 7.5h.01'],
  read: ['M3 8l9 6 9-6', 'M3 8v10h18V8', 'M3 8l9-5 9 5'],
  star: ['M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z'],
  unsub: ['M4 4l16 16', 'M5 5h14v10', 'M5 5v12h10'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 1v2', 'M12 21v2', 'M4.2 4.2l1.4 1.4', 'M18.4 18.4l1.4 1.4', 'M1 12h2', 'M21 12h2', 'M4.2 19.8l1.4-1.4', 'M18.4 5.6l1.4-1.4'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  check: ['M5 12l5 5 9-11'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 3v6h-6'],
  play: ['M6 4l14 8-14 8z'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
};
