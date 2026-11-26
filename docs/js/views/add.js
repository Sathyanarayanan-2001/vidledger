// Add videos: paste links, or import a text, CSV or Google Takeout file. A preview
// shows what is new before anything is added. Expanded playlists can be added in one go.

import { h, clear, append, icon, ICONS, dataTable } from '../dom.js';
import { plural, formatCount } from '../format.js';
import { S, addVideos, processNow } from '../core.js';
import { extractLinks, watchUrl } from '../links.js';
import { toast, emptyState, externalLink } from '../ui.js';
import { pageHead, banners } from './common.js';

let draft = '';

export function viewAdd() {
  const page = h('div', { class: 'page narrow' });
  page.append(pageHead('Add videos', 'Paste links in any form, one per line or all mixed together. Playlist links work too.'));
  append(page, banners());
  const box = h('textarea', { rows: 8, spellcheck: 'false', placeholder: 'https://youtu.be/…\nhttps://www.youtube.com/watch?v=…\nhttps://www.youtube.com/playlist?list=…' });
  box.value = draft;
  const file = h('input', { type: 'file', accept: '.txt,.csv,.json,.md,text/plain,text/csv,application/json' });
  const preview = h('div', { class: 'stack', 'aria-live': 'polite' });

  const show = () => {
    draft = box.value;
    clear(preview);
    if (!box.value.trim()) return;
    const found = extractLinks(box.value);
    const fresh = found.videos.filter((v) => !S.records.get(`v:${v.id}`));
    const dupes = found.videos.length - fresh.length;
    const notes = [];
    if (dupes) notes.push(`${plural(dupes, 'video')} already in your library`);
    if (found.skipped) notes.push(`${plural(found.skipped, 'line')} not recognised`);
    if (found.watchLater) {
      preview.append(h('div', { class: 'banner warn', role: 'status' }, icon(ICONS.alert),
        h('p', { text: 'Watch Later and Liked videos are private lists, so nothing can read them by link. Export them as described below, or move the videos into a normal playlist first.' })));
    }
    preview.append(h('p', { class: 'small' }, h('strong', { text: `${plural(fresh.length, 'new video')}` }),
      found.playlists.length ? `, ${plural(found.playlists.length, 'playlist')}` : '', notes.length ? ` · ${notes.join(' · ')}` : ''));
    if (fresh.length) {
      preview.append(dataTable(['Video id', 'Link'], fresh.slice(0, 12).map((v) => [v.id, externalLink(watchUrl(v.id), 'Open on YouTube')]), { caption: 'New videos' }));
      if (fresh.length > 12) preview.append(h('p', { class: 'muted small', text: `…and ${formatCount(fresh.length - 12)} more.` }));
    }
    const go = async (thenProcess) => {
      const n = await addVideos(fresh, found.playlists);
      box.value = '';
      draft = '';
      toast(`${plural(n, 'video')} added${found.playlists.length ? ` and ${plural(found.playlists.length, 'playlist')} queued for expanding` : ''}.`);
      S.render();
      if (thenProcess) processNow();
    };
    if (fresh.length || found.playlists.length) {
      preview.append(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => go(true) }, icon(ICONS.spark), 'Add and process now'),
        h('button', { type: 'button', class: 'btn', onclick: () => go(false) }, icon(ICONS.plus), `Add ${formatCount(fresh.length)}`)));
    }
  };
  box.addEventListener('input', show);
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      toast('That file is larger than 20 MB. Split it, or paste the links instead.', 'error');
      return;
    }
    box.value = (box.value ? box.value + '\n' : '') + await f.text();
    file.value = '';
    show();
  });
  page.append(h('section', { class: 'card stack' },
    h('label', { class: 'field-label', text: 'YouTube links', for: 'add-box' }), box,
    h('div', { class: 'field' }, h('label', { for: 'add-file', text: 'Or import a file' }), file,
      h('p', { class: 'hint', text: 'A text list, a CSV with a "Video ID" column, or a Google Takeout playlist file (CSV or JSON).' })),
    preview));
  box.id = 'add-box';
  file.id = 'add-file';
  show();
  page.append(playlistsCard());
  page.append(h('section', { class: 'card stack' },
    h('h2', { text: 'Getting 100+ saved videos out of YouTube' }),
    h('ol', { class: 'steps' },
      h('li', {}, h('strong', { text: 'Your own playlists: ' }), 'paste the playlist link here. With the optional YOUTUBE_API_KEY secret, the agent lists every video in it (Guide, step 4).'),
      h('li', {}, h('strong', { text: 'Watch Later: ' }), 'it is private, so no link works. Use Google Takeout (YouTube and YouTube Music, playlists) and import the Watch Later CSV here, or move the videos into a normal playlist first.'),
      h('li', {}, h('strong', { text: 'Anything else: ' }), 'copy the links into a text file, one per line, and import it.'))));
  return page;
}

function playlistsCard() {
  const lists = S.lib ? S.lib.playlists : [];
  const requested = S.records.entries('p:');
  if (!lists.length && !requested.length) return null;
  const body = h('div', { class: 'stack' });
  for (const [k] of requested) {
    const pid = k.slice(2);
    const p = lists.find((x) => x.id === pid);
    const fresh = p ? p.video_ids.filter((id) => !S.records.get(`v:${id}`)) : [];
    body.append(h('div', { class: 'list-item' },
      h('div', {}, h('strong', { text: p && p.title ? p.title : `Playlist ${pid}` }),
        h('p', { class: 'muted small', text: !p ? 'Waiting for the agent to expand it.' : p.error ? p.error : `${plural(p.video_ids.length, 'video')}, ${formatCount(fresh.length)} not in your library yet.` })),
      h('div', { class: 'row' },
        fresh.length ? h('button', {
          type: 'button', class: 'btn sm', text: `Add ${formatCount(fresh.length)}`,
          onclick: async () => {
            const n = await addVideos(fresh.map((id) => ({ id, url: watchUrl(id) })));
            toast(`${plural(n, 'video')} added from the playlist.`);
            S.render();
          },
        }) : null,
        h('button', {
          type: 'button', class: 'btn sm ghost', text: 'Remove',
          onclick: async () => {
            await S.records.remove([k]);
            S.render();
          },
        }))));
  }
  return h('section', { class: 'card stack' }, h('h2', { text: 'Playlists' }), body.childNodes.length ? body : emptyState('No playlists', 'Paste a playlist link above.'));
}
