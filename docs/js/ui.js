// Shared UI pieces: toasts, dialogs, form fields, tiles, badges, thumbnails,
// timestamp links and the embedded player. All text goes in as text nodes.

import { h, clear, $, icon, ICONS } from './dom.js';
import { mmss, safeUrl } from './format.js';
import { STAGE_BY_KEY, ACTION_BY_KEY } from './model.js';
import { shortUrl } from './links.js';

export function toast(message, kind = 'info', ms = 5000) {
  const region = $('#toasts');
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? ICONS.alert : ICONS.check), h('span', { text: message }),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Dismiss', onclick: () => t.remove() }, icon(ICONS.close)));
  region.append(t);
  if (ms) setTimeout(() => t.remove(), ms);
}

/** Modal dialog. Resolves to the clicked action's value (null when closed). */
export function dialog({ title, body, actions = [{ label: 'Close', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const dlg = $('#dlg');
    clear(dlg);
    dlg.className = wide ? 'wide' : '';
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      dlg.close();
      resolve(v);
    };
    const form = h('form', { method: 'dialog', class: 'dlg-inner', onsubmit: (e) => e.preventDefault() },
      h('div', { class: 'dlg-head' }, h('h2', { id: 'dlg-title', text: title }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => close(null) }, icon(ICONS.close))),
      h('div', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-actions' }, actions.map((a) => h('button', {
        type: 'button', class: `btn ${a.kind || ''}`, text: a.label,
        onclick: async () => {
          if (a.validate && !(await a.validate())) return;
          close(a.value);
        },
      }))));
    dlg.setAttribute('aria-labelledby', 'dlg-title');
    dlg.append(form);
    dlg.onclose = () => close(null);
    dlg.showModal();
    const first = dlg.querySelector('input, select, textarea') || dlg.querySelector('.dlg-actions .btn:last-child');
    if (first) first.focus();
  });
}

export async function confirm(title, text, okLabel = 'OK', kind = 'primary') {
  return (await dialog({ title, body: h('p', { text }), actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: okLabel, value: true, kind }] })) === true;
}

export function field(label, input, { hint = '', error = '', id } = {}) {
  const fid = id || input.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  input.id = fid;
  const hintId = `${fid}-hint`;
  const errId = `${fid}-err`;
  const described = [hint ? hintId : '', errId].filter(Boolean).join(' ');
  input.setAttribute('aria-describedby', described);
  if (error) input.setAttribute('aria-invalid', 'true');
  return h('div', { class: 'field' }, h('label', { for: fid, text: label }), input,
    hint ? h('p', { class: 'hint', id: hintId, text: hint }) : null,
    h('p', { class: 'error-text', id: errId, role: 'alert', text: error, hidden: !error }));
}

export function setFieldError(input, message) {
  const err = document.getElementById(`${input.id}-err`);
  if (err) {
    err.textContent = message;
    err.hidden = !message;
  }
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map((o) => {
    const [val, label] = Array.isArray(o) ? o : [o, o];
    return h('option', { value: val, selected: String(val) === String(value) ? true : null, text: label });
  }));
}

export function emptyState(title, text, action) {
  return h('div', { class: 'empty' }, h('h3', { text: title }), h('p', { class: 'muted', text }), action || null);
}

export function tile(label, value, sub, onclick) {
  return h(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: 'tile', onclick },
    h('span', { class: 'tile-label', text: label }), h('span', { class: 'tile-value', text: value }), h('span', { class: 'tile-sub', text: sub }));
}

export function stageTag(stage) {
  const s = STAGE_BY_KEY.get(stage) || { short: stage, slot: 1 };
  return h('span', { class: `tag stage stage-${stage}` }, h('span', { class: `key series-${s.slot}`, 'aria-hidden': 'true' }), s.short);
}

export function actionTag(action, prefix = '') {
  const a = ACTION_BY_KEY.get(action);
  return a ? h('span', { class: `tag act-${action}`, title: a.hint, text: `${prefix}${a.name}` }) : null;
}

export function worthStars(n, label = 'Worth-it') {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  return h('span', { class: 'stars', role: 'img', 'aria-label': `${label} ${v} of 5`, title: `${label} ${v}/5` },
    [1, 2, 3, 4, 5].map((i) => h('span', { class: i <= v ? 'star on' : 'star', 'aria-hidden': 'true', text: '★' })));
}

/** Thumbnail from YouTube's image server; demo videos and failures fall back to a neutral tile. */
export function thumb(id, { demo = false, size = 'mq', title = '' } = {}) {
  const box = h('span', { class: 'thumb', 'aria-hidden': 'true' });
  if (demo) {
    box.classList.add('thumb-demo');
    box.append(icon(ICONS.video));
    return box;
  }
  const img = h('img', { src: `https://i.ytimg.com/vi/${id}/${size}default.jpg`, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', title });
  img.addEventListener('error', () => {
    box.classList.add('thumb-demo');
    img.remove();
    box.append(icon(ICONS.video));
  }, { once: true });
  box.append(img);
  return box;
}

// ------------------------------------------------------------------ player and timestamps

let player = null; // {id, frame, wrap}

/** Embedded player (youtube-nocookie, no YouTube script on this page). Timestamp links seek it. */
export function playerBox(id, { demo = false } = {}) {
  const wrap = h('div', { class: 'player', hidden: true });
  const frame = h('iframe', {
    title: 'YouTube video player', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin', loading: 'lazy',
  });
  wrap.append(demo ? h('p', { class: 'muted small player-note', text: 'Demo video: playback is not available.' }) : frame);
  player = { id, frame, wrap, demo };
  return wrap;
}

export function playAt(id, t, { open = true } = {}) {
  if (player && player.id === id && !player.demo) {
    player.wrap.hidden = false;
    player.frame.src = `https://www.youtube-nocookie.com/embed/${id}?start=${Math.max(0, Math.floor(t))}&autoplay=1&rel=0&modestbranding=1`;
    player.wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return true;
  }
  if (open) window.open(shortUrl(id, t), '_blank', 'noopener');
  return false;
}

export function clearPlayer() {
  player = null;
}

/** "[12:34]" link: seeks the embedded player when it is open, else opens YouTube at that time. */
export function tsLink(id, t, label) {
  const href = safeUrl(shortUrl(id, t));
  return h('a', {
    class: 'ts', href, target: '_blank', rel: 'noopener', 'aria-label': `Play from ${mmss(t)}`,
    onclick: (e) => {
      if (player && player.id === id && !player.wrap.hidden && !player.demo) {
        e.preventDefault();
        playAt(id, t);
      }
    },
  }, label || mmss(t));
}

export function externalLink(href, text) {
  const url = safeUrl(href);
  return url ? h('a', { href: url, target: '_blank', rel: 'noopener', text }) : h('span', { text });
}
