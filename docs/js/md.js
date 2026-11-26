// A small, safe Markdown-to-DOM renderer for the visual notes Gemini writes out:
// paragraphs, bullet and numbered lists, pipe tables, fenced code, **bold** and `code`.
// Everything becomes DOM nodes with text content, so no markup from the model can run.

import { h } from './dom.js';

function inline(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith('**') ? h('strong', { text: tok.slice(2, -2) }) : h('code', { text: tok.slice(1, -1) }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
const isRule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function renderMarkdown(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line.trim())) {
      const lang = line.trim().slice(3).trim();
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) body.push(lines[i++]);
      i++;
      out.push(h('pre', { class: 'code', 'data-lang': lang || null }, h('code', { text: body.join('\n') })));
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const head = rows.length > 1 && isRule(rows[1]) ? cells(rows[0]) : null;
      const body = rows.filter((r, n) => !(head && n <= 1) && !isRule(r)).map(cells);
      out.push(h('div', { class: 'table-wrap' }, h('table', { class: 'data-table md-table' },
        head ? h('thead', {}, h('tr', {}, head.map((c) => h('th', { scope: 'col' }, inline(c))))) : null,
        h('tbody', {}, body.map((r) => h('tr', {}, r.map((c) => h('td', {}, inline(c)))))))));
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ''));
      out.push(h(ordered ? 'ol' : 'ul', { class: 'md-list' }, items.map((t) => h('li', {}, inline(t)))));
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^```|^\s*\||^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) para.push(lines[i++].trim());
    out.push(h('p', {}, inline(para.join(' '))));
  }
  return out;
}
