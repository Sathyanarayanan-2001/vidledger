// Connect: the private repository and a fine-grained token, or the demo.

import { h } from '../dom.js';
import { S, connect, enterDemo, refresh } from '../core.js';
import { GitHub, validateConnection } from '../github.js';
import { toast, field, setFieldError } from '../ui.js';

export function viewConnect() {
  const repo = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: 'owner/vidledger-data', value: S.conn ? S.conn.repo : '' });
  const token = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
  const remember = h('input', { type: 'checkbox', checked: true, id: 'remember' });
  const status = h('p', { class: 'muted small', role: 'status' });
  const submit = h('button', { type: 'submit', class: 'btn primary', text: 'Connect' });
  const form = h('form', {
    class: 'card stack', novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const v = validateConnection(repo.value, token.value);
      setFieldError(repo, v.errors.repo || '');
      setFieldError(token, v.errors.token || '');
      if (v.errors.repo || v.errors.token) return;
      submit.disabled = true;
      status.textContent = 'Checking the repository…';
      try {
        await new GitHub(v.repo, v.token).verifyRepo();
        await connect({ repo: v.repo, token: v.token }, remember.checked);
        toast('Connected. Loading your library…');
        location.hash = '#/home';
        refresh({ quiet: true });
      } catch (err) {
        status.textContent = '';
        setFieldError(err.status === 401 || err.status === 403 ? token : repo, err.message);
      } finally {
        submit.disabled = false;
      }
    },
  },
  h('h2', { text: 'Connect your private repository' }),
  h('p', { class: 'muted', text: 'VidLedger keeps your library in your own private GitHub repository. The token stays in this browser and is sent only to api.github.com.' }),
  field('Repository', repo, { hint: 'The private data repository, as owner/name.' }),
  field('Fine-grained token', token, { hint: 'Only this repository. Permissions: Contents read and write; Actions read and write.' }),
  h('div', { class: 'check' }, remember, h('label', { for: 'remember', text: 'Remember on this device' })),
  h('p', { class: 'hint', text: 'Untick on a shared computer: the token is then forgotten when you close the tab.' }),
  h('div', { class: 'row' }, submit, h('a', { href: '#/guide', class: 'btn ghost', text: 'How to set this up' })),
  status);
  const demo = h('div', { class: 'card stack' },
    h('h2', { text: 'Just looking?' }),
    h('p', { class: 'muted', text: 'Try VidLedger with a made-up library of 14 videos in English, Tamil and Hindi. Nothing leaves this browser.' }),
    h('div', {}, h('button', {
      type: 'button', class: 'btn', text: 'Try the demo',
      onclick: async () => {
        await enterDemo();
        location.hash = '#/home';
      },
    })));
  return h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('h1', { text: 'Your saved videos, finally learned.' }),
      h('p', { class: 'lead', text: 'Paste YouTube links. Gemini watches each one, even without captions, and turns it into a transcript, translation, visual notes, mind map and flashcards. You decide and review.' })),
    form, demo);
}
