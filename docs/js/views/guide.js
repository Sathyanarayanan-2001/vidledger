// Guide: one-time setup, how it works, limits and privacy. Plain steps, no jargon beyond what GitHub shows.

import { h, dataTable } from '../dom.js';
import { pageHead } from './common.js';
import { externalLink } from '../ui.js';

const step = (title, ...body) => h('li', {}, h('h3', { text: title }), ...body);
const p = (...kids) => h('p', {}, ...kids);
const code = (t) => h('code', { text: t });

export function viewGuide() {
  return h('div', { class: 'page narrow guide' },
    pageHead('Guide', 'Set up once (about 20 minutes), then add links from any device.'),
    h('nav', { class: 'card toc', 'aria-label': 'On this page' }, h('ul', {},
      [['setup', 'One-time setup'], ['how', 'How it works'], ['use', 'Daily use'], ['limits', 'Limits'], ['privacy', 'Privacy'], ['vars', 'Optional settings']]
        .map(([id, t]) => h('li', {}, h('a', { href: `#/guide`, onclick: (e) => { e.preventDefault(); document.getElementById(id).scrollIntoView(); }, text: t }))))),
    h('section', { class: 'card stack', id: 'setup' }, h('h2', { text: 'One-time setup' }),
      h('ol', { class: 'steps' },
        step('1. Two repositories', p('The same code lives in two repositories on your GitHub account: ', code('vidledger'), ' (public) serves this page; ',
          code('vidledger-data'), ' (private) runs the agent and keeps your library.')),
        step('2. Gemini API key', p('Open ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener', text: 'Google AI Studio' }),
          ', create an API key, and copy it. The free tier processes up to 8 hours of YouTube video a day.')),
        step('3. Secrets and the role variable (private repository)', p('In ', code('vidledger-data'), ': Settings → Secrets and variables → Actions.'),
          h('ul', { class: 'bullets' },
            h('li', {}, 'New repository secret ', code('GEMINI_API_KEY'), ' = the key from step 2.'),
            h('li', {}, 'Variables tab → New repository variable ', code('VIDLEDGER_ROLE'), ' = ', code('data'), '. This tells the agent to run here, and only here.'))),
        step('4. Optional: YouTube Data API key', p('In the Google Cloud console, enable "YouTube Data API v3" for the same project, create an API key restricted to that API, and add it as the secret ',
          code('YOUTUBE_API_KEY'), '. With it, the agent knows exact durations, spots private and unlisted videos before spending budget, triages from the first 5 minutes only, and expands playlist links.')),
        step('5. Turn on the page (public repository)', p('In ', code('vidledger'), ': Settings → Pages → Source: GitHub Actions. Every push to main then tests and publishes this page.')),
        step('6. A token for this page', p('GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.'),
          h('ul', { class: 'bullets' },
            h('li', {}, 'Repository access: Only select repositories → ', code('vidledger-data'), '.'),
            h('li', {}, 'Permissions: Contents: Read and write; Actions: Read and write.'),
            h('li', {}, 'Expiration: 90 days is a good balance. When it expires, create a new one and paste it in Settings.'))),
        step('7. Connect', p('Open this page, enter ', code('your-name/vidledger-data'), ' and the token, and press Connect. Then add videos and press Process now. The first run creates the branches it needs.')))),
    h('section', { class: 'card stack', id: 'how' }, h('h2', { text: 'How it works' }),
      h('ol', { class: 'steps' },
        h('li', {}, h('strong', { text: 'You add links. ' }), 'They are saved as records in your private repository (branch vidledger-user).'),
        h('li', {}, h('strong', { text: 'The agent triages. ' }), 'On GitHub Actions, Gemini watches each video (audio and frames) and suggests a category, topic, worth-it score and action. It works even when a video has no captions.'),
        h('li', {}, h('strong', { text: 'You decide. ' }), 'Deep-learn or Reference gets a full learning pack; Review card is for entertainment; Drop removes it from your way.'),
        h('li', {}, h('strong', { text: 'The agent builds. ' }), 'A verbatim transcript with an English translation line under every non-English line, visual notes for every slide, table, equation and diagram, a mind map, glossary, flashcards and a quiz. Every item links to its moment in the video.'),
        h('li', {}, h('strong', { text: 'You review and revise. ' }), 'Tick the reviewer checklist, then revise flashcards a few minutes a day. Topic study guides give one path through the best segments.'))),
    h('section', { class: 'card stack', id: 'use' }, h('h2', { text: 'Daily use' }),
      h('ul', { class: 'bullets' },
        h('li', {}, 'On your phone, open this page and choose "Add to Home screen" for an app icon.'),
        h('li', {}, 'Share a YouTube link into Quick add on Home, or paste many on Add videos.'),
        h('li', {}, 'Decide in batches: "Approve high-confidence" handles the obvious ones.'),
        h('li', {}, 'Ten minutes of Revise a day keeps what you learned.'))),
    h('section', { class: 'card stack', id: 'limits' }, h('h2', { text: 'Limits' }),
      h('ul', { class: 'bullets' },
        h('li', {}, 'Gemini can only watch ', h('strong', { text: 'public' }), ' videos: private, unlisted, members-only and some age-restricted videos fail and are marked "Needs attention".'),
        h('li', {}, 'Free tier: 8 hours of YouTube video a day. The agent stops at 7.5 hours and continues after midnight Pacific time (13:30 IST). A long video spreads its transcript over several runs and resumes where it stopped.'),
        h('li', {}, 'Timestamps are per line, not per word, and can drift by a few seconds. The reviewer checklist asks you to spot-check three.'),
        h('li', {}, 'Private repositories get 2,000 free GitHub Actions minutes a month. While Gemini works on a video the runner waits, and those minutes count; the Dashboard shows this month\'s total.'),
        h('li', {}, 'Gemini can make mistakes. Claims to verify and Added context are listed apart from what the video says.'))),
    h('section', { class: 'card stack', id: 'privacy' }, h('h2', { text: 'Privacy' }),
      h('ul', { class: 'bullets' },
        h('li', {}, 'Your library, notes and progress live only in your private repository.'),
        h('li', {}, 'This page talks only to api.github.com (and YouTube for thumbnails and the player). No analytics, no other servers.'),
        h('li', {}, 'Your token stays in this browser. Untick "Remember on this device" on a shared computer.'),
        h('li', {}, 'Videos are sent to Gemini by link only; nothing is downloaded. ', externalLink('https://ai.google.dev/gemini-api/terms', 'Gemini API terms')))),
    h('section', { class: 'card stack', id: 'vars' }, h('h2', { text: 'Optional settings (repository variables)' }),
      dataTable(['Variable', 'Default', 'What it does'], [
        ['VIDLEDGER_MODEL', 'gemini-3.8-flash', 'Gemini model for transcripts, packs, cards and guides'],
        ['VIDLEDGER_TRIAGE_MODEL', 'same as above', 'A cheaper or faster model for triage'],
        ['VIDLEDGER_DAILY_VIDEO_HOURS', '7.5', 'Daily video budget; raise it on a paid plan'],
        ['VIDLEDGER_PARALLEL', '2', 'Videos processed at the same time (1 to 4)'],
        ['VIDLEDGER_MAX_JOBS_PER_RUN', '20', 'Jobs per run'],
        ['VIDLEDGER_RUN_MINUTES', '50', 'Stop starting new work after this many minutes'],
      ])));
}
